//! Shared position snapshots: aggregates in memory, complete matches in a bounded temporary file.
//! Pages contain metadata only; PGN is decoded only when a game is opened.
use super::{
    search::{
        begin_position_search, convert_position_query, find_position_match_cancellable,
        PositionStats,
    },
    search_index::{GameResult, SearchGameEntryRef},
    GameQuery, MmapSearchIndex, NormalizedGame, SortDirection,
};
use crate::{error::Error, AppState};
use diesel::prelude::*;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use shakmaty::{fen::Fen, ByColor, EnPassantMode, Position};
use specta::Type;
use std::{
    cmp::Reverse,
    collections::{BTreeMap, BinaryHeap, VecDeque},
    fs::File,
    io::{BufWriter, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc, Mutex},
    time::{Duration, Instant, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

const RECORD_BYTES: usize = 24;
const SCAN_BATCH: usize = 65536;
const ORDER_BATCH: u32 = 4096;
const MAX_SNAPSHOT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_CACHE_BYTES: u64 = 512 * 1024 * 1024;

fn invalid(message: &str) -> Error {
    std::io::Error::other(message).into()
}

fn file_stamp(path: &Path) -> Result<String, Error> {
    let meta = std::fs::metadata(path)?;
    let modified = meta.modified()?.duration_since(UNIX_EPOCH)?.as_nanos();
    // SQLite's header includes its change counter. This is a local revision, not a content hash.
    let mut header = [0; 100];
    let n = File::open(path)?.read(&mut header)?;
    Ok(format!("{}:{modified}:{:02x?}", meta.len(), &header[..n]))
}

pub(super) fn source_stamp(path: &Path) -> Result<String, Error> {
    let mut wal = path.as_os_str().to_os_string();
    wal.push("-wal");
    let wal = PathBuf::from(wal);
    let wal_stamp = match file_stamp(&wal) {
        Ok(value) => value,
        Err(Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => "none".into(),
        Err(error) => return Err(error),
    };
    Ok(format!("position-v1:{}:{wal_stamp}", file_stamp(path)?))
}

fn fingerprint(path: &Path) -> Result<String, Error> {
    Ok(format!(
        "{}:{}",
        source_stamp(path)?,
        file_stamp(&super::get_index_path(path))?
    ))
}

pub(super) fn canonical_query(mut query: GameQuery) -> Result<GameQuery, Error> {
    if query.tournament_id.is_some() || query.sides.is_some() || query.outcome.is_some() {
        return Err(invalid("Unsupported position filter"));
    }
    query.options = None;
    let position = query
        .position
        .as_mut()
        .ok_or_else(|| invalid("Missing position"))?;
    let parsed = convert_position_query(position.clone())?;
    let mut setup = Fen::from_ascii(position.fen.as_bytes())?.into_setup();
    if position.type_ == "exact" {
        let mode = shakmaty::CastlingMode::detect(&setup);
        let chess: shakmaty::Chess = setup.position(mode)?;
        setup = chess.into_setup(EnPassantMode::Legal);
    }
    setup.halfmoves = 0;
    setup.fullmoves = std::num::NonZeroU32::new(1).unwrap();
    position.fen = Fen::from_setup(setup).to_string();
    drop(parsed);
    if !matches!(
        query.wanted_result.as_deref(),
        None | Some("any" | "whitewon" | "blackwon" | "draw" | "unknown")
    ) {
        return Err(invalid("Invalid result filter"));
    }
    if query.wanted_result.as_deref() == Some("any") {
        query.wanted_result = None;
    }
    Ok(query)
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PositionSummary {
    pub token: String,
    pub fingerprint: String,
    pub fen: String,
    pub total: u32,
    pub openings: Vec<PositionStats>,
    pub skipped_games: u32,
    pub scan_ms: f64,
    pub cache_hit: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PositionGameSort {
    Index,
    Date,
    AverageElo,
    WhiteElo,
    BlackElo,
}

struct PositionGameOrder {
    sort: PositionGameSort,
    direction: SortDirection,
    offsets: Arc<Vec<u32>>,
}

pub(super) struct Snapshot {
    pub(super) database: PathBuf,
    pub(super) query: GameQuery,
    pub(super) summary: PositionSummary,
    matches: Mutex<File>,
    pub(super) report: Mutex<Option<super::opening_report::OpeningReport>>,
    order: Mutex<Option<PositionGameOrder>>,
}

impl Snapshot {
    fn bytes(&self) -> u64 {
        self.summary.total as u64 * RECORD_BYTES as u64
            + self
                .order
                .lock()
                .unwrap()
                .as_ref()
                .map_or(0, |order| order.offsets.len() as u64 * 4)
    }
    pub(super) fn check_revision(&self) -> Result<(), Error> {
        if fingerprint(&self.database)? != self.summary.fingerprint {
            return Err(invalid("Position query expired"));
        }
        Ok(())
    }
    pub(super) fn records(&self, offset: u32, limit: u32) -> Result<Vec<MatchRecord>, Error> {
        let take = limit.min(self.summary.total.saturating_sub(offset));
        let mut file = self.matches.lock().unwrap();
        file.seek(SeekFrom::Start(offset as u64 * RECORD_BYTES as u64))?;
        let mut bytes = vec![0; take as usize * RECORD_BYTES];
        file.read_exact(&mut bytes)?;
        Ok(bytes
            .chunks_exact(RECORD_BYTES)
            .map(|record| MatchRecord::decode(record.try_into().unwrap()))
            .collect())
    }
}

#[derive(Default)]
pub struct PositionQueryCache {
    entries: VecDeque<Arc<Snapshot>>,
}
impl PositionQueryCache {
    pub fn remove_database(&mut self, path: &Path) {
        self.entries.retain(|s| s.database != path);
    }
    fn find(&mut self, predicate: impl Fn(&Snapshot) -> bool) -> Option<Arc<Snapshot>> {
        let index = self.entries.iter().position(|s| predicate(s))?;
        let value = self.entries.remove(index)?;
        self.entries.push_back(value.clone());
        Some(value)
    }
    fn insert(&mut self, value: Arc<Snapshot>) {
        self.entries
            .retain(|s| s.database != value.database || s.query != value.query);
        self.entries.push_back(value);
        self.enforce_limits();
    }
    fn enforce_limits(&mut self) {
        while self.entries.len() > 32
            || self.entries.iter().map(|s| s.bytes()).sum::<u64>() > MAX_CACHE_BYTES
        {
            self.entries.pop_front();
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct MatchRecord {
    pub(super) id: i32,
    pub(super) ply: u32,
    pub(super) index_offset: u32,
    pub(super) next_move: String,
}
impl MatchRecord {
    fn encode(&self) -> [u8; RECORD_BYTES] {
        let mut bytes = [0; RECORD_BYTES];
        bytes[..4].copy_from_slice(&self.id.to_le_bytes());
        bytes[4..8].copy_from_slice(&self.ply.to_le_bytes());
        bytes[8..12].copy_from_slice(&self.index_offset.to_le_bytes());
        let san = self.next_move.as_bytes();
        // SAN in standard chess/Chess960 fits in twelve bytes. Snapshots are session-local.
        bytes[12..12 + san.len()].copy_from_slice(san);
        bytes
    }
    fn decode(bytes: [u8; RECORD_BYTES]) -> Self {
        let end = bytes[12..].iter().position(|b| *b == 0).unwrap_or(12);
        Self {
            id: i32::from_le_bytes(bytes[..4].try_into().unwrap()),
            ply: u32::from_le_bytes(bytes[4..8].try_into().unwrap()),
            index_offset: u32::from_le_bytes(bytes[8..12].try_into().unwrap()),
            next_move: String::from_utf8_lossy(&bytes[12..12 + end]).into_owned(),
        }
    }
}

fn matches_filters(entry: &SearchGameEntryRef<'_>, query: &GameQuery) -> bool {
    if query.player1.is_some_and(|id| id != entry.white_id)
        || query.player2.is_some_and(|id| id != entry.black_id)
        || query
            .any_player
            .is_some_and(|id| id != entry.white_id && id != entry.black_id)
    {
        return false;
    }
    if query.range1.is_some_and(|(lo, hi)| {
        entry.white_elo == 0 || !(lo..=hi).contains(&(entry.white_elo as i32))
    }) || query.range2.is_some_and(|(lo, hi)| {
        entry.black_elo == 0 || !(lo..=hi).contains(&(entry.black_elo as i32))
    }) {
        return false;
    }
    if let Some(start) = &query.start_date {
        if entry
            .date
            .is_none_or(|d| d.contains('?') || d < start.as_str())
        {
            return false;
        }
    }
    if let Some(end) = &query.end_date {
        if entry
            .date
            .is_none_or(|d| d.contains('?') || d > end.as_str())
        {
            return false;
        }
    }
    match query.wanted_result.as_deref() {
        Some("whitewon") => entry.result == GameResult::WhiteWin,
        Some("blackwon") => entry.result == GameResult::BlackWin,
        Some("draw") => entry.result == GameResult::Draw,
        Some("unknown") => matches!(entry.result, GameResult::None | GameResult::Other),
        _ => true,
    }
}

fn scan(
    database: PathBuf,
    query: GameQuery,
    revision: String,
    index: &MmapSearchIndex,
    cancelled: &(impl Fn() -> bool + Sync),
    progress: &impl Fn(usize),
) -> Result<Snapshot, Error> {
    let started = Instant::now();
    if index.len() > u32::MAX as usize {
        return Err(invalid("Position index exceeds supported game count"));
    }
    let position = convert_position_query(query.position.clone().unwrap())?;
    let mut output = BufWriter::new(tempfile::tempfile()?);
    let mut openings: BTreeMap<String, PositionStats> = BTreeMap::new();
    let mut total = 0u32;
    let mut skipped = 0u32;
    for offset in (0..index.len()).step_by(SCAN_BATCH) {
        if cancelled() {
            return Err(Error::SearchCancelled);
        }
        // Ordered collection keeps cursor order reproducible regardless of Rayon scheduling.
        let batch: Vec<_> = (offset..(offset + SCAN_BATCH).min(index.len()))
            .into_par_iter()
            .map(|i| {
                if cancelled() {
                    return Ok(None);
                }
                let entry = index.get_entry_ref(i).unwrap();
                if !matches_filters(&entry, &query)
                    || !position.can_reach(
                        &ByColor {
                            white: entry.white_material,
                            black: entry.black_material,
                        },
                        entry.pawn_home,
                    )
                {
                    return Ok(None);
                }
                find_position_match_cancellable(entry.moves, &entry.fen, &position, cancelled).map(
                    |hit| {
                        hit.map(|(ply, next_move)| {
                            (
                                MatchRecord {
                                    id: entry.id,
                                    ply,
                                    index_offset: i as u32,
                                    next_move,
                                },
                                entry.result,
                            )
                        })
                    },
                )
            })
            .collect();
        if cancelled() {
            return Err(Error::SearchCancelled);
        }
        for hit in batch {
            let (record, result) = match hit {
                Ok(Some(hit)) => hit,
                Ok(None) => continue,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            if (total as u64 + 1) * RECORD_BYTES as u64 > MAX_SNAPSHOT_BYTES {
                return Err(invalid(
                    "Position query exceeds 256 MiB; narrow the filters",
                ));
            }
            output.write_all(&record.encode())?;
            total += 1;
            let counts = openings
                .entry(record.next_move.clone())
                .or_insert(PositionStats {
                    move_: record.next_move,
                    white: 0,
                    draw: 0,
                    black: 0,
                    unknown: 0,
                });
            match result {
                GameResult::WhiteWin => counts.white += 1,
                GameResult::BlackWin => counts.black += 1,
                GameResult::Draw => counts.draw += 1,
                _ => counts.unknown += 1,
            }
        }
        progress((offset + SCAN_BATCH).min(index.len()));
    }
    output.flush()?;
    let file = output.into_inner().map_err(|e| e.into_error())?;
    let snapshot = Snapshot {
        database,
        summary: PositionSummary {
            token: format!("position-{:016x}", rand::random::<u64>()),
            fingerprint: revision,
            fen: query.position.as_ref().unwrap().fen.clone(),
            total,
            openings: openings.into_values().collect(),
            skipped_games: skipped,
            scan_ms: started.elapsed().as_secs_f64() * 1000.0,
            cache_hit: false,
        },
        query,
        matches: Mutex::new(file),
        report: Mutex::new(None),
        order: Mutex::new(None),
    };
    snapshot.check_revision()?;
    Ok(snapshot)
}

pub(super) fn open_index(
    database: &Path,
    state: &AppState,
    cancelled: &dyn Fn() -> bool,
    progress: &dyn Fn(u64),
) -> Result<MmapSearchIndex, Error> {
    if MmapSearchIndex::is_up_to_date(database) {
        if let Some((path, index)) = state.db_cache.lock().unwrap().as_ref() {
            if path == database && index.is_current(&super::get_index_path(database)) {
                return Ok(index.clone());
            }
        }
        match MmapSearchIndex::open_checked(super::get_index_path(database), cancelled) {
            Ok(index) => {
                *state.db_cache.lock().unwrap() = Some((database.into(), index.clone()));
                return Ok(index);
            }
            Err(error) if error.kind() == std::io::ErrorKind::InvalidData => {}
            Err(error) => return Err(error.into()),
        }
    }
    super::generate_search_index_cancellable(database, state, cancelled, progress)?;
    let index = MmapSearchIndex::open_checked(super::get_index_path(database), cancelled)?;
    *state.db_cache.lock().unwrap() = Some((database.into(), index.clone()));
    Ok(index)
}

pub(super) fn preempt_background_searches(searches: &super::search::ActivePositionSearches) {
    for search in searches {
        if search.background.load(Ordering::Acquire) {
            search.preempted.store(true, Ordering::Release);
            search.cancel();
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn query_position(
    file: PathBuf,
    query: GameQuery,
    tab_id: String,
    background: bool,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<PositionSummary, Error> {
    let file = file.canonicalize()?;
    let query = canonical_query(query)?;
    let sequence = state
        .position_search_sequence
        .fetch_add(1, Ordering::Relaxed)
        + 1;
    let request = begin_position_search(
        &state.active_position_searches,
        tab_id.clone(),
        file.clone(),
        sequence,
    );
    request
        .cancellation
        .background
        .store(background, Ordering::Release);
    if !background {
        preempt_background_searches(&state.active_position_searches);
    }
    let run = async {
        if background {
            while state.active_position_searches.iter().any(|s| s.key() != &tab_id && !s.background.load(Ordering::Acquire)) {
                tokio::select! { _ = tokio::time::sleep(Duration::from_millis(25)) => {}, _ = request.cancelled() => return Err(Error::SearchCancelled) }
            }
        }
        let key = (query.clone(), file.clone());
        let collision = state.search_collisions.entry(key.clone()).or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))).clone();
        let _cleanup = super::search::SearchCollisionCleanup { collisions: &state.search_collisions, key, lock: &collision };
        let _shared = tokio::select! { lock = collision.lock() => lock, _ = request.cancelled() => return Err(Error::SearchCancelled) };
        let _background_permit = if background { Some(tokio::select! {
            permit = state.background_position_request.acquire() => permit.unwrap(),
            _ = request.cancelled() => return Err(Error::SearchCancelled),
        }) } else { None };
        let _permit = tokio::select! { permit = state.new_request.acquire() => permit.unwrap(), _ = request.cancelled() => return Err(Error::SearchCancelled) };
        let build_lock = tokio::select! { lock = state.position_index_build.lock() => lock, _ = request.cancelled() => return Err(Error::SearchCancelled) };
        let index_app = app.clone(); let index_file = file.clone(); let flag = request.cancellation.clone();
        let event_tab = tab_id.clone();
        let index = tauri::async_runtime::spawn_blocking(move || {
            open_index(&index_file, &index_app.state::<AppState>(), &|| flag.cancelled.load(Ordering::Acquire), &|loaded| {
                let _ = index_app.emit("search_progress", serde_json::json!({"id":event_tab,"requestId":sequence,"progress":0,"finished":false,"stage":"index","processed":loaded}));
            })
        }).await.map_err(|e| invalid(&e.to_string()))??;
        drop(build_lock);
        request.ensure_active("position-index")?;
        let revision = fingerprint(&file)?;
        if let Some(cached) = state.position_queries.lock().unwrap().find(|s| s.database == file && s.query == query && s.summary.fingerprint == revision) {
            request.ensure_active("position-cache")?;
            let mut summary = cached.summary.clone(); summary.cache_hit = true; return Ok(summary);
        }
        let flag = request.cancellation.clone(); let scan_app = app.clone(); let scan_tab = tab_id.clone();
        let snapshot = tauri::async_runtime::spawn_blocking(move || scan(file, query, revision, &index, &|| flag.cancelled.load(Ordering::Acquire), &|processed| {
            let _ = scan_app.emit("search_progress", serde_json::json!({"id":scan_tab,"requestId":sequence,"progress":processed as f64 / index.len().max(1) as f64 *100.0,"finished":false,"stage":"scan"}));
        })).await.map_err(|e| invalid(&e.to_string()))??;
        request.ensure_active("position-publication")?;
        let summary = snapshot.summary.clone();
        log::info!("position snapshot total={} scan_ms={} disk_bytes={}", summary.total, summary.scan_ms, snapshot.bytes());
        state.position_queries.lock().unwrap().insert(Arc::new(snapshot));
        Ok(summary)
    }.await;
    let _ = app.emit(
        "search_progress",
        serde_json::json!({"id":tab_id,"requestId":sequence,"progress":100,"finished":true}),
    );
    if request.cancellation.preempted.load(Ordering::Acquire) {
        return Err(invalid("Search preempted"));
    }
    run
}

pub(super) fn snapshot_for(token: &str, state: &AppState) -> Result<Arc<Snapshot>, Error> {
    let snapshot = state
        .position_queries
        .lock()
        .unwrap()
        .find(|s| s.summary.token == token)
        .ok_or_else(|| invalid("Position query expired"))?;
    snapshot.check_revision()?;
    Ok(snapshot)
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PositionGameMetadata {
    pub snapshot_offset: u32,
    pub id: i32,
    pub white: String,
    pub black: String,
    pub white_elo: Option<i32>,
    pub black_elo: Option<i32>,
    pub date: Option<String>,
    pub result: String,
    pub event: String,
    pub ply: u32,
    pub next_move: String,
}

#[tauri::command]
#[specta::specta]
pub async fn get_position_games(
    token: String,
    offset: u32,
    limit: u32,
    sort: PositionGameSort,
    direction: SortDirection,
    tab_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PositionGameMetadata>, Error> {
    let snapshot = snapshot_for(&token, &state)?;
    if sort == PositionGameSort::Index {
        return tauri::async_runtime::spawn_blocking(move || {
            read_ordered_page(&snapshot, offset, limit, None, &direction)
        })
        .await
        .map_err(|e| invalid(&e.to_string()))?;
    }
    let sequence = state
        .position_search_sequence
        .fetch_add(1, Ordering::Relaxed)
        + 1;
    let request = begin_position_search(
        &state.active_position_searches,
        tab_id.clone(),
        snapshot.database.clone(),
        sequence,
    );
    let run = async {
        let _order_permit = tokio::select! { guard=state.position_order_request.lock()=>guard, _=request.cancelled()=>return Err(Error::SearchCancelled) };
        request.ensure_active("position-order-cache")?;
        let cached = snapshot.order.lock().unwrap().as_ref()
            .filter(|order| order.sort == sort && order.direction == direction).map(|order| order.offsets.clone());
        let order = if let Some(cached) = cached { cached } else {
            let _permit = tokio::select! { permit=state.new_request.acquire()=>permit.unwrap(), _=request.cancelled()=>return Err(Error::SearchCancelled) };
            let build_lock = tokio::select! { lock=state.position_index_build.lock()=>lock, _=request.cancelled()=>return Err(Error::SearchCancelled) };
            let index_app=app.clone(); let database=snapshot.database.clone(); let flag=request.cancellation.clone();
            let index=tauri::async_runtime::spawn_blocking(move||open_index(&database,&index_app.state::<AppState>(),&||flag.cancelled.load(Ordering::Acquire),&|_|{})).await.map_err(|e|invalid(&e.to_string()))??;
            drop(build_lock); request.ensure_active("position-order-index")?;
            let ordered_snapshot=snapshot.clone(); let flag=request.cancellation.clone(); let order_app=app.clone(); let owner=tab_id.clone(); let build_direction=direction.clone();
            let offsets=Arc::new(tauri::async_runtime::spawn_blocking(move||build_order(&ordered_snapshot,&index,sort,&build_direction,&||flag.cancelled.load(Ordering::Acquire),&|progress| {
                let _=order_app.emit("search_progress",serde_json::json!({"id":owner,"requestId":sequence,"progress":progress,"finished":false,"stage":"sort"}));
            })).await.map_err(|e|invalid(&e.to_string()))??);
            request.ensure_active("position-order-publication")?; snapshot.check_revision()?;
            *snapshot.order.lock().unwrap()=Some(PositionGameOrder {sort,direction:direction.clone(),offsets:offsets.clone()}); offsets
        };
        state.position_queries.lock().unwrap().enforce_limits();
        let page_snapshot=snapshot.clone();
        tauri::async_runtime::spawn_blocking(move||read_ordered_page(&page_snapshot,offset,limit,Some(order.as_slice()),&direction)).await.map_err(|e|invalid(&e.to_string()))?
    }.await;
    let _ = app.emit(
        "search_progress",
        serde_json::json!({"id":tab_id,"requestId":sequence,"progress":100,"finished":true}),
    );
    run
}

#[derive(Clone, Copy, Eq, Ord, PartialEq, PartialOrd)]
struct CompactSortKey {
    rank: u64,
    offset: u32,
}

fn date_key(date: Option<&str>) -> Option<u32> {
    let mut parts = date?.split('.');
    let year = parts.next()?.parse::<u32>().ok()?;
    if !(1..=9999).contains(&year) {
        return None;
    }
    let month = parts
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|month| (1..=12).contains(month))
        .unwrap_or(0);
    let day = (month > 0)
        .then(|| parts.next())
        .flatten()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|day| (1..=31).contains(day))
        .unwrap_or(0);
    Some(year * 10_000 + month * 100 + day)
}

fn build_order(
    snapshot: &Snapshot,
    index: &MmapSearchIndex,
    sort: PositionGameSort,
    direction: &SortDirection,
    cancelled: &dyn Fn() -> bool,
    progress: &dyn Fn(f64),
) -> Result<Vec<u32>, Error> {
    const CHUNK: usize = 262_144;
    let mut keys = Vec::with_capacity(snapshot.summary.total as usize);
    for offset in (0..snapshot.summary.total).step_by(ORDER_BATCH as usize) {
        if cancelled() {
            return Err(Error::SearchCancelled);
        }
        for record in snapshot.records(offset, ORDER_BATCH)? {
            let entry = index
                .get_entry_ref(record.index_offset as usize)
                .filter(|entry| entry.id == record.id)
                .ok_or_else(|| invalid("Position query expired"))?;
            let value = match sort {
                PositionGameSort::Date => date_key(entry.date),
                PositionGameSort::AverageElo => (entry.white_elo > 0 && entry.black_elo > 0)
                    .then_some((entry.white_elo as u32 + entry.black_elo as u32) / 2),
                PositionGameSort::WhiteElo => {
                    (entry.white_elo > 0).then_some(entry.white_elo as u32)
                }
                PositionGameSort::BlackElo => {
                    (entry.black_elo > 0).then_some(entry.black_elo as u32)
                }
                PositionGameSort::Index => Some(record.id as u32),
            };
            let primary = value.map_or(u32::MAX, |value| match direction {
                SortDirection::Asc => value,
                SortDirection::Desc => u32::MAX - 1 - value,
            });
            let id = (record.id as u32) ^ 0x8000_0000;
            keys.push(CompactSortKey {
                rank: ((primary as u64) << 32) | id as u64,
                offset: keys.len() as u32,
            });
        }
        progress(
            (offset + ORDER_BATCH).min(snapshot.summary.total) as f64
                / snapshot.summary.total.max(1) as f64
                * 45.0,
        );
    }
    let chunk_count = keys.len().div_ceil(CHUNK).max(1);
    for (i, chunk) in keys.chunks_mut(CHUNK).enumerate() {
        if cancelled() {
            return Err(Error::SearchCancelled);
        }
        chunk.sort_unstable();
        progress(45.0 + (i + 1) as f64 / chunk_count as f64 * 25.0);
    }
    if keys.len() <= CHUNK {
        return Ok(keys.into_iter().map(|key| key.offset).collect());
    }
    let run_count = keys.len().div_ceil(CHUNK);
    let mut positions = vec![0usize; run_count];
    let mut heap = BinaryHeap::new();
    for run in 0..run_count {
        heap.push(Reverse((keys[run * CHUNK], run)));
    }
    let mut offsets = Vec::with_capacity(keys.len());
    while let Some(Reverse((key, run))) = heap.pop() {
        if offsets.len() % 4096 == 0 && cancelled() {
            return Err(Error::SearchCancelled);
        }
        offsets.push(key.offset);
        positions[run] += 1;
        let index_in_keys = run * CHUNK + positions[run];
        if index_in_keys < ((run + 1) * CHUNK).min(keys.len()) {
            heap.push(Reverse((keys[index_in_keys], run)));
        }
    }
    progress(95.0);
    Ok(offsets)
}

fn read_ordered_page(
    snapshot: &Snapshot,
    offset: u32,
    limit: u32,
    order: Option<&[u32]>,
    direction: &SortDirection,
) -> Result<Vec<PositionGameMetadata>, Error> {
    if limit == 0 || limit > 100 {
        return Err(invalid("Page size must be between 1 and 100"));
    }
    let take = limit.min(snapshot.summary.total.saturating_sub(offset));
    let offsets: Vec<u32> = if let Some(order) = order {
        order
            .iter()
            .skip(offset as usize)
            .take(take as usize)
            .copied()
            .collect()
    } else {
        (0..take)
            .map(|i| match direction {
                SortDirection::Asc => offset + i,
                SortDirection::Desc => snapshot.summary.total - 1 - offset - i,
            })
            .collect()
    };
    read_offsets(snapshot, &offsets)
}

pub(super) fn read_page(
    snapshot: &Snapshot,
    offset: u32,
    limit: u32,
) -> Result<Vec<PositionGameMetadata>, Error> {
    if limit == 0 || limit > 100 {
        return Err(invalid("Page size must be between 1 and 100"));
    }
    snapshot.check_revision()?;
    let offsets: Vec<u32> = (offset..(offset + limit).min(snapshot.summary.total)).collect();
    read_offsets(snapshot, &offsets)
}

fn read_offsets(snapshot: &Snapshot, offsets: &[u32]) -> Result<Vec<PositionGameMetadata>, Error> {
    snapshot.check_revision()?;
    let connection = rusqlite::Connection::open_with_flags(
        &snapshot.database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    connection.busy_timeout(Duration::from_millis(500))?;
    let mut statement = connection.prepare("SELECT COALESCE(w.Name,'?'), COALESCE(b.Name,'?'), g.WhiteElo, g.BlackElo, g.Date, COALESCE(g.Result,'*'), COALESCE(e.Name,'?') FROM Games g JOIN Players w ON w.ID=g.WhiteID JOIN Players b ON b.ID=g.BlackID JOIN Events e ON e.ID=g.EventID WHERE g.ID=?1")?;
    let mut page = Vec::with_capacity(offsets.len());
    for &snapshot_offset in offsets {
        let record = snapshot
            .records(snapshot_offset, 1)?
            .pop()
            .ok_or_else(|| invalid("Game is outside this position query"))?;
        page.push(statement.query_row([record.id], |row| {
            Ok(PositionGameMetadata {
                snapshot_offset,
                id: record.id,
                white: row.get(0)?,
                black: row.get(1)?,
                white_elo: row.get(2)?,
                black_elo: row.get(3)?,
                date: row.get(4)?,
                result: row.get(5)?,
                event: row.get(6)?,
                ply: record.ply,
                next_move: record.next_move,
            })
        })?);
    }
    snapshot.check_revision()?;
    Ok(page)
}

#[derive(Serialize, Type)]
pub struct PositionGame {
    pub game: NormalizedGame,
    pub ply: u32,
}

#[tauri::command]
#[specta::specta]
pub async fn get_position_game(
    token: String,
    offset: u32,
    app: tauri::AppHandle,
) -> Result<PositionGame, Error> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let snapshot = snapshot_for(&token, &state)?;
        read_game(&snapshot, offset, &state)
    })
    .await
    .map_err(|e| invalid(&e.to_string()))?
}

fn read_game(snapshot: &Snapshot, offset: u32, state: &AppState) -> Result<PositionGame, Error> {
    snapshot.check_revision()?;
    let record = snapshot
        .records(offset, 1)?
        .pop()
        .ok_or_else(|| invalid("Game is outside this position query"))?;
    use super::schema::{events, games, players, sites};
    let db = &mut super::get_db_or_create(
        state,
        snapshot
            .database
            .to_str()
            .ok_or_else(|| invalid("Invalid database path"))?,
        super::ConnectionOptions::default(),
    )?;
    let (white, black) = diesel::alias!(players as white, players as black);
    let rows: Vec<(
        super::models::Game,
        super::models::Player,
        super::models::Player,
        super::models::Event,
        super::models::Site,
    )> = games::table
        .inner_join(white.on(games::white_id.eq(white.field(players::id))))
        .inner_join(black.on(games::black_id.eq(black.field(players::id))))
        .inner_join(events::table.on(games::event_id.eq(events::id)))
        .inner_join(sites::table.on(games::site_id.eq(sites::id)))
        .filter(games::id.eq(record.id))
        .load(db)?;
    let game = super::normalize_games(rows)
        .pop()
        .ok_or_else(|| invalid("Game no longer exists"))?;
    snapshot.check_revision()?;
    Ok(PositionGame {
        game,
        ply: record.ply,
    })
}

#[cfg(test)]
pub(super) fn benchmark_snapshot(
    path: &Path,
    query: GameQuery,
    index: &MmapSearchIndex,
) -> Snapshot {
    scan(
        path.into(),
        canonical_query(query).unwrap(),
        fingerprint(path).unwrap(),
        index,
        &|| false,
        &|_| {},
    )
    .unwrap()
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::db::{PositionQueryJs, SearchIndex};

    fn fixture(count: i32) -> (tempfile::TempDir, PathBuf, AppState) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("games.db3");
        let mut db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch(include_str!("create.sql")).unwrap();
        let tx = db.transaction().unwrap();
        for id in 1..=count {
            tx.execute("INSERT INTO Games (ID,EventID,SiteID,WhiteID,BlackID,Date,WhiteElo,BlackElo,WhiteMaterial,BlackMaterial,Result,PlyCount,Moves,PawnHome) VALUES (?1,0,0,0,0,?2,2400,2300,39,39,?3,2,?4,61423)",
                rusqlite::params![id, if id%2 == 0 {Some("2024.01.01")} else {None}, if id%3 == 0 {"*"} else if id%3 == 1 {"1-0"} else {"1/2-1/2"}, vec![12u8,12]]).unwrap();
        }
        tx.commit().unwrap();
        drop(db);
        (dir, path, AppState::default())
    }
    fn query() -> GameQuery {
        GameQuery::new().position(PositionQueryJs {
            fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1".into(),
            type_: "exact".into(),
        })
    }
    pub(in crate::db) fn snapshot(path: &Path, state: &AppState, query: GameQuery) -> Snapshot {
        let index = open_index(path, state, &|| false, &|_| {}).unwrap();
        scan(
            path.into(),
            canonical_query(query).unwrap(),
            fingerprint(path).unwrap(),
            &index,
            &|| false,
            &|_| {},
        )
        .unwrap()
    }

    #[test]
    fn complete_matches_pages_and_single_game_share_one_snapshot() {
        let (_dir, path, state) = fixture(650);
        let result = snapshot(&path, &state, query());
        assert_eq!(result.summary.total, 650);
        let e5 = &result.summary.openings[0];
        assert_eq!(
            (e5.move_.as_str(), e5.white, e5.draw, e5.unknown),
            ("e5", 217, 217, 216)
        );
        let page = read_page(&result, 640, 20).unwrap();
        assert_eq!(page.len(), 10);
        assert_eq!(page[0].id, 641);
        assert_eq!(page[0].ply, 1);
        assert!(read_page(&result, 0, 101).is_err());
        let game = read_game(&result, 649, &state).unwrap();
        assert_eq!((game.game.id, game.ply), (650, 1));
        assert!(game.game.moves.contains("e5"));
        let json = serde_json::to_value(&page).unwrap();
        assert!(json[0].get("moves").is_none());
        assert_eq!(result.bytes(), 650 * 24);
    }

    #[test]
    fn filters_unknown_dates_and_results_have_explicit_denominators() {
        let (_dir, path, state) = fixture(12);
        let mut filter = query();
        filter.start_date = Some("2020.01.01".into());
        filter.wanted_result = Some("unknown".into());
        let result = snapshot(&path, &state, filter);
        assert_eq!(result.summary.total, 2);
        assert_eq!(result.summary.openings[0].unknown, 2);
        let mut filter = query();
        filter.range1 = Some((2500, 2900));
        assert_eq!(snapshot(&path, &state, filter).summary.total, 0);
    }

    #[test]
    fn full_snapshot_sorting_is_stable_and_keeps_unknown_values_last() {
        let (_dir, path, state) = fixture(6);
        let db = rusqlite::Connection::open(&path).unwrap();
        for (id, date, white, black) in [
            (1, Some("2020.05.01"), 2000, 2500),
            (2, Some("2019.01.01"), 2600, 2100),
            (3, None, 0, 0),
            (4, Some("2021.12.31"), 2400, 2800),
        ] {
            db.execute(
                "UPDATE Games SET Date=?2, WhiteElo=?3, BlackElo=?4 WHERE ID=?1",
                rusqlite::params![id, date, white, black],
            )
            .unwrap();
        }
        drop(db);
        let result = snapshot(&path, &state, query());
        let index = open_index(&path, &state, &|| false, &|_| {}).unwrap();
        let ids = |sort, direction| {
            let order = build_order(&result, &index, sort, &direction, &|| false, &|_| {}).unwrap();
            read_ordered_page(&result, 0, 20, Some(&order), &direction)
                .unwrap()
                .into_iter()
                .map(|game| game.id)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            ids(PositionGameSort::Date, SortDirection::Asc),
            vec![2, 1, 4, 6, 3, 5]
        );
        assert_eq!(
            ids(PositionGameSort::Date, SortDirection::Desc),
            vec![6, 4, 1, 2, 3, 5]
        );
        assert_eq!(
            ids(PositionGameSort::WhiteElo, SortDirection::Asc),
            vec![1, 4, 5, 6, 2, 3]
        );
        assert_eq!(
            ids(PositionGameSort::BlackElo, SortDirection::Desc),
            vec![4, 1, 5, 6, 2, 3]
        );
        assert!(matches!(
            build_order(
                &result,
                &index,
                PositionGameSort::AverageElo,
                &SortDirection::Desc,
                &|| true,
                &|_| {}
            ),
            Err(Error::SearchCancelled)
        ));
        assert_eq!(date_key(Some("2024.??.??")), Some(20_240_000));
        assert_eq!(date_key(Some("2024.05.??")), Some(20_240_500));
        assert_eq!(date_key(Some("????.??.??")), None);
    }

    #[test]
    fn cancelled_index_build_keeps_existing_index_and_does_not_publish_partial_results() {
        let (_dir, path, state) = fixture(12);
        super::super::generate_search_index(&path, &state).unwrap();
        let original = std::fs::read(super::super::get_index_path(&path)).unwrap();
        assert!(matches!(
            super::super::generate_search_index_cancellable(&path, &state, &|| true, &|_| {}),
            Err(Error::SearchCancelled)
        ));
        assert_eq!(
            std::fs::read(super::super::get_index_path(&path)).unwrap(),
            original
        );
        let index = MmapSearchIndex::open(super::super::get_index_path(&path)).unwrap();
        assert!(matches!(
            scan(
                path.clone(),
                query(),
                fingerprint(&path).unwrap(),
                &index,
                &|| true,
                &|_| {}
            ),
            Err(Error::SearchCancelled)
        ));
        assert!(state.position_queries.lock().unwrap().entries.is_empty());
    }

    #[test]
    fn corrupt_body_is_rebuilt_and_old_snapshot_expires_after_database_update() {
        let (_dir, path, state) = fixture(4);
        let before = snapshot(&path, &state, query());
        *state.db_cache.lock().unwrap() = None;
        let index_path = super::super::get_index_path(&path);
        let mut bytes = std::fs::read(&index_path).unwrap();
        bytes.truncate(bytes.len() - 8);
        std::fs::write(&index_path, bytes).unwrap();
        assert!(MmapSearchIndex::open(&index_path).is_err());
        assert_eq!(
            open_index(&path, &state, &|| false, &|_| {}).unwrap().len(),
            4
        );
        assert!(before.check_revision().is_err());
        let current = snapshot(&path, &state, query());
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute("UPDATE Games SET Result='0-1' WHERE ID=1", [])
            .unwrap();
        assert!(read_page(&current, 0, 20).is_err());
        assert!(!MmapSearchIndex::is_up_to_date(&path));
        assert_eq!(
            snapshot(&path, &state, query()).summary.openings[0].black,
            1
        );
    }

    #[test]
    fn canonical_position_ignores_counters_and_irrelevant_ep_but_not_castling() {
        let mut first = query();
        let mut second = query();
        first.position.as_mut().unwrap().fen =
            "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 8 9".into();
        assert_eq!(
            canonical_query(first).unwrap(),
            canonical_query(second.clone()).unwrap()
        );
        second.position.as_mut().unwrap().fen =
            "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b - - 0 1".into();
        assert_ne!(
            canonical_query(query()).unwrap(),
            canonical_query(second).unwrap()
        );
    }

    #[test]
    fn bounded_cache_evicts_and_invalidates_tokens() {
        let (_dir, path, state) = fixture(1);
        let mut cache = PositionQueryCache::default();
        for i in 0..35 {
            let mut result = snapshot(&path, &state, query());
            result.query.player1 = Some(i);
            result.summary.token = i.to_string();
            cache.insert(Arc::new(result));
        }
        assert_eq!(cache.entries.len(), 32);
        assert!(cache.find(|s| s.summary.token == "0").is_none());
        cache.remove_database(&path);
        assert!(cache.entries.is_empty());
        // Empty archives remain supported, including no chunks at all.
        let empty = path.with_file_name("empty.ecsi");
        SearchIndex::default().write_to(&empty).unwrap();
        assert!(MmapSearchIndex::open(empty).unwrap().is_empty());
    }

    #[test]
    #[ignore = "read-only Gigabase measurement; requires CHESS_LAB_BENCH_DB"]
    fn benchmark_position_snapshot() {
        use sysinfo::{ProcessExt, SystemExt};
        let mut system = sysinfo::System::new();
        system.refresh_memory();
        eprintln!("physical_memory_bytes={}", system.total_memory());
        let path = PathBuf::from(std::env::var("CHESS_LAB_BENCH_DB").unwrap());
        let validate_cancel = Instant::now();
        assert_eq!(
            MmapSearchIndex::open_checked(super::super::get_index_path(&path), &|| validate_cancel
                .elapsed()
                > Duration::from_millis(100))
            .err()
            .unwrap()
            .kind(),
            std::io::ErrorKind::Interrupted
        );
        eprintln!(
            "cancelled_index_validation_total_ms={}",
            validate_cancel.elapsed().as_secs_f64() * 1000.0
        );
        let loaded = Instant::now();
        let index = MmapSearchIndex::open(super::super::get_index_path(&path)).unwrap();
        eprintln!(
            "checked index open_ms={}",
            loaded.elapsed().as_secs_f64() * 1000.0
        );
        let query = GameQuery::new().position(PositionQueryJs {
            fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3".into(),
            type_: "exact".into(),
        });
        let result = scan(
            path.clone(),
            canonical_query(query).unwrap(),
            fingerprint(&path).unwrap(),
            &index,
            &|| false,
            &|_| {},
        )
        .unwrap();
        let mut times = Vec::new();
        for i in 0..20 {
            let now = Instant::now();
            read_page(&result, i * 20, 20).unwrap();
            times.push(now.elapsed().as_secs_f64() * 1000.0);
        }
        times.sort_by(f64::total_cmp);
        eprintln!(
            "games={} matches={} scan_ms={} disk_bytes={} page_p50_ms={} page_p95_ms={}",
            index.len(),
            result.summary.total,
            result.summary.scan_ms,
            result.bytes(),
            times[9],
            times[18]
        );
        for sort in [PositionGameSort::Date, PositionGameSort::AverageElo] {
            let started = Instant::now();
            let order = build_order(
                &result,
                &index,
                sort,
                &SortDirection::Desc,
                &|| false,
                &|_| {},
            )
            .unwrap();
            eprintln!(
                "sort={sort:?} matches={} elapsed_ms={} cached_bytes={}",
                order.len(),
                started.elapsed().as_secs_f64() * 1000.0,
                order.len() * std::mem::size_of::<u32>()
            );
        }
        let mut cache = PositionQueryCache::default();
        let result = Arc::new(result);
        cache.insert(result.clone());
        let mut hits = Vec::new();
        for _ in 0..20 {
            let now = Instant::now();
            let revision = fingerprint(&path).unwrap();
            assert!(cache
                .find(|s| s.query == result.query && s.summary.fingerprint == revision)
                .is_some());
            hits.push(now.elapsed().as_secs_f64() * 1000.0);
        }
        hits.sort_by(f64::total_cmp);
        eprintln!("cache_p50_ms={} cache_p95_ms={}", hits[9], hits[18]);
        let pid = sysinfo::get_current_pid().unwrap();
        system.refresh_process(pid);
        eprintln!(
            "process_resident_after_scan_bytes={}",
            system.process(pid).unwrap().memory()
        );
        // Rough global-position-index cost: count plies on a deterministic sample, not a forecast of compression.
        let positions: usize = (0..index.len())
            .step_by((index.len() / 10000).max(1))
            .take(10000)
            .map(|i| {
                super::super::encoding::iter_mainline_move_bytes(
                    index.get_entry_ref(i).unwrap().moves,
                )
                .count()
                    + 1
            })
            .sum();
        eprintln!(
            "sample_positions={} sample_games={} raw_global_index_16byte_estimate={}",
            positions,
            10000,
            positions as f64 / 10000.0 * index.len() as f64 * 16.0
        );
        // Estimate CPU work only: replay and hash a separate deterministic sample.
        // A real inverted index also needs sorting, writes, collision checks and compression.
        use shakmaty::zobrist::{Zobrist64, ZobristHash};
        let signature_start = Instant::now();
        let mut signature_games = 0;
        let mut signatures = 0;
        for i in (0..index.len())
            .step_by((index.len() / 1000).max(1))
            .take(1000)
        {
            let entry = index.get_entry_ref(i).unwrap();
            let fen: Fen = entry
                .fen
                .unwrap_or(shakmaty::fen::Fen::default().to_string().as_str())
                .parse()
                .unwrap();
            let setup = fen.into_setup();
            let mut chess: shakmaty::Chess = setup
                .clone()
                .position(shakmaty::CastlingMode::detect(&setup))
                .unwrap();
            signature_games += 1;
            std::hint::black_box(chess.zobrist_hash::<Zobrist64>(EnPassantMode::Legal));
            signatures += 1;
            for byte in super::super::encoding::iter_mainline_move_bytes(entry.moves) {
                let Some(m) = super::super::encoding::decode_move(byte, &chess) else {
                    break;
                };
                chess.play_unchecked(&m);
                std::hint::black_box(chess.zobrist_hash::<Zobrist64>(EnPassantMode::Legal));
                signatures += 1;
            }
        }
        let signature_seconds = signature_start.elapsed().as_secs_f64();
        eprintln!("signature_sample_games={signature_games} signatures={signatures} seconds={signature_seconds} extrapolated_single_thread_cpu_seconds={}", signature_seconds / signature_games as f64 * index.len() as f64);
        let cancelled = std::sync::atomic::AtomicBool::new(false);
        std::thread::scope(|scope| {
            scope.spawn(|| {
                std::thread::sleep(Duration::from_millis(100));
                cancelled.store(true, Ordering::Release);
            });
            let now = Instant::now();
            assert!(scan(
                path.clone(),
                result.query.clone(),
                fingerprint(&path).unwrap(),
                &index,
                &|| cancelled.load(Ordering::Acquire),
                &|_| {}
            )
            .is_err());
            eprintln!(
                "cancelled_snapshot_total_ms={}",
                now.elapsed().as_secs_f64() * 1000.0
            );
        });
    }

    #[test]
    fn foreground_preempts_only_background_and_canonical_invalidation_clears_cache() {
        let (_dir, path, state) = fixture(1);
        let background = begin_position_search(
            &state.active_position_searches,
            "coverage:one".into(),
            path.clone(),
            1,
        );
        background
            .cancellation
            .background
            .store(true, Ordering::Release);
        let visible = begin_position_search(
            &state.active_position_searches,
            "board:two".into(),
            path.clone(),
            2,
        );
        preempt_background_searches(&state.active_position_searches);
        assert!(background.is_cancelled());
        assert!(background.cancellation.preempted.load(Ordering::Acquire));
        assert!(!visible.is_cancelled());
        let canonical = path.canonicalize().unwrap();
        let result = Arc::new(snapshot(&canonical, &state, query()));
        state.position_queries.lock().unwrap().insert(result);
        super::super::clear_search_cache_for_db(&state, &path);
        assert!(state.position_queries.lock().unwrap().entries.is_empty());
        assert!(state.db_cache.lock().unwrap().is_none());
    }
}
