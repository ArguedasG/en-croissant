use dashmap::{mapref::entry::Entry, DashMap};
use diesel::prelude::*;
use log::info;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use shakmaty::{
    fen::Fen, san::SanPlus, Bitboard, ByColor, CastlingMode, Chess, FromSetup, Position, Setup,
};
use specta::Type;
use std::{
    cmp::Reverse,
    collections::{BinaryHeap, HashMap, VecDeque},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use tauri::Emitter;

use crate::{
    db::{
        encoding::{decode_move, iter_mainline_move_bytes},
        get_db_or_create, get_material_count, get_pawn_home,
        models::*,
        normalize_games,
        schema::*,
        search_index::{get_index_path, GameResult, MmapSearchIndex, SearchGameEntryRef},
        ConnectionOptions, MaterialCount,
    },
    error::Error,
    AppState,
};

use super::GameQuery;

const POSITION_SEARCH_CACHE_CAPACITY: usize = 64;
type PositionSearchKey = (GameQuery, PathBuf);
type PositionSearchResult = (Vec<PositionStats>, Vec<NormalizedGame>);
type SearchCollisionMap = DashMap<PositionSearchKey, Arc<tokio::sync::Mutex<()>>>;

pub(super) struct SearchCollisionCleanup<'a> {
    pub(super) collisions: &'a SearchCollisionMap,
    pub(super) key: PositionSearchKey,
    pub(super) lock: &'a Arc<tokio::sync::Mutex<()>>,
}

impl Drop for SearchCollisionCleanup<'_> {
    fn drop(&mut self) {
        // The map and this request are the final owners only when no duplicate request is waiting.
        if Arc::strong_count(self.lock) != 2 {
            return;
        }
        if let Entry::Occupied(entry) = self.collisions.entry(self.key.clone()) {
            if Arc::ptr_eq(entry.get(), self.lock) {
                entry.remove();
            }
        }
    }
}

pub struct PositionSearchCache {
    entries: HashMap<PositionSearchKey, PositionSearchResult>,
    order: VecDeque<PositionSearchKey>,
    capacity: usize,
}

impl Default for PositionSearchCache {
    fn default() -> Self {
        Self::with_capacity(POSITION_SEARCH_CACHE_CAPACITY)
    }
}

impl PositionSearchCache {
    fn with_capacity(capacity: usize) -> Self {
        Self {
            entries: HashMap::with_capacity(capacity),
            order: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    fn promote(&mut self, key: &PositionSearchKey) {
        if let Some(index) = self.order.iter().position(|candidate| candidate == key) {
            self.order.remove(index);
        }
        self.order.push_back(key.clone());
    }

    pub fn get(&mut self, key: &PositionSearchKey) -> Option<PositionSearchResult> {
        let result = self.entries.get(key).cloned()?;
        self.promote(key);
        Some(result)
    }

    pub fn insert(&mut self, key: PositionSearchKey, value: PositionSearchResult) {
        if self.capacity == 0 {
            return;
        }
        self.entries.insert(key.clone(), value);
        self.promote(&key);
        while self.entries.len() > self.capacity {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            }
        }
    }

    pub fn remove_database(&mut self, database: &Path) {
        self.entries
            .retain(|(_, cached_path), _| cached_path.as_path() != database);
        self.order
            .retain(|(_, cached_path)| cached_path.as_path() != database);
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[derive(Debug)]
pub struct PositionSearchCancellation {
    request_id: u64,
    database: PathBuf,
    pub(super) cancelled: AtomicBool,
    notify: tokio::sync::Notify,
    pub(super) background: AtomicBool,
    pub(super) preempted: AtomicBool,
}

impl PositionSearchCancellation {
    pub(super) fn cancel(&self) {
        if !self.cancelled.swap(true, Ordering::AcqRel) {
            self.notify.notify_one();
        }
    }

    async fn cancelled(&self) {
        if self.cancelled.load(Ordering::Acquire) {
            return;
        }
        self.notify.notified().await;
    }
}

pub type ActivePositionSearches = DashMap<String, Arc<PositionSearchCancellation>>;

pub(super) struct PositionSearchGuard<'a> {
    searches: &'a ActivePositionSearches,
    tab_id: String,
    pub(super) cancellation: Arc<PositionSearchCancellation>,
}

impl PositionSearchGuard<'_> {
    fn request_id(&self) -> u64 {
        self.cancellation.request_id
    }

    pub(super) fn is_cancelled(&self) -> bool {
        self.cancellation.cancelled.load(Ordering::Acquire)
    }

    pub(super) fn ensure_active(&self, stage: &str) -> Result<(), Error> {
        if self.is_cancelled() {
            info!(
                "cancelled position search request={} tab={} stage={stage}",
                self.request_id(),
                self.tab_id
            );
            Err(Error::SearchCancelled)
        } else {
            Ok(())
        }
    }

    pub(super) async fn cancelled(&self) {
        self.cancellation.cancelled().await;
    }
}

impl Drop for PositionSearchGuard<'_> {
    fn drop(&mut self) {
        if let Entry::Occupied(entry) = self.searches.entry(self.tab_id.clone()) {
            if Arc::ptr_eq(entry.get(), &self.cancellation) {
                entry.remove();
            }
        }
    }
}

pub(super) fn begin_position_search(
    searches: &ActivePositionSearches,
    tab_id: String,
    file: PathBuf,
    request_id: u64,
) -> PositionSearchGuard<'_> {
    let cancellation = Arc::new(PositionSearchCancellation {
        request_id,
        database: file,
        cancelled: AtomicBool::new(false),
        notify: tokio::sync::Notify::new(),
        background: AtomicBool::new(false),
        preempted: AtomicBool::new(false),
    });
    if let Some(previous) = searches.insert(tab_id.clone(), cancellation.clone()) {
        previous.cancel();
        info!(
            "superseded position search request={} database={} by request={} database={} tab={}",
            previous.request_id,
            previous.database.display(),
            request_id,
            cancellation.database.display(),
            tab_id
        );
    }
    PositionSearchGuard {
        searches,
        tab_id,
        cancellation,
    }
}

#[tauri::command]
#[specta::specta]
pub fn cancel_position_search(tab_id: String, state: tauri::State<'_, AppState>) -> bool {
    if let Some(search) = state.active_position_searches.get(&tab_id) {
        search.cancel();
        info!(
            "requested position search cancellation request={} database={} tab={tab_id}",
            search.request_id,
            search.database.display()
        );
        true
    } else {
        false
    }
}

#[derive(Debug, Hash, PartialEq, Eq, Clone)]
pub struct ExactData {
    pawn_home: u16,
    material: MaterialCount,
    position: Chess,
}

#[derive(Debug, Hash, PartialEq, Eq, Clone)]
pub struct PartialData {
    // piece_counts: Vec<(Piece, u8)>,
    piece_positions: Setup,
    material: MaterialCount,
}

#[derive(Debug, Hash, PartialEq, Eq, Clone)]
pub enum PositionQuery {
    Exact(ExactData),
    Partial(PartialData),
}

impl PositionQuery {
    pub fn exact_from_fen(fen: &str) -> Result<PositionQuery, Error> {
        let fen = Fen::from_ascii(fen.as_bytes())?;
        let setup = fen.into_setup();
        let castling_mode = CastlingMode::detect(&setup);
        let position: Chess = setup.position(castling_mode)?;
        let pawn_home = get_pawn_home(position.board());
        let material = get_material_count(position.board());
        Ok(PositionQuery::Exact(ExactData {
            pawn_home,
            material,
            position,
        }))
    }

    pub fn partial_from_fen(fen: &str) -> Result<PositionQuery, Error> {
        let fen = Fen::from_ascii(fen.as_bytes())?;
        let setup = fen.into_setup();
        let material = get_material_count(&setup.board);
        Ok(PositionQuery::Partial(PartialData {
            piece_positions: setup,
            material,
        }))
    }
}

#[derive(Debug, Clone, Deserialize, Type, PartialEq, Eq, Hash)]
pub struct PositionQueryJs {
    pub fen: String,
    pub type_: String,
}

pub(super) fn convert_position_query(query: PositionQueryJs) -> Result<PositionQuery, Error> {
    match query.type_.as_str() {
        "exact" => PositionQuery::exact_from_fen(&query.fen),
        "partial" => PositionQuery::partial_from_fen(&query.fen),
        _ => Err(
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid position query").into(),
        ),
    }
}

impl PositionQuery {
    fn matches(&self, position: &Chess) -> bool {
        match self {
            PositionQuery::Exact(ref data) => data.position == *position,
            PositionQuery::Partial(ref data) => {
                let query_board = &data.piece_positions.board;
                let tested_board = position.board();

                is_contained(tested_board.white(), query_board.white())
                    && is_contained(tested_board.black(), query_board.black())
                    && is_contained(tested_board.pawns(), query_board.pawns())
                    && is_contained(tested_board.knights(), query_board.knights())
                    && is_contained(tested_board.bishops(), query_board.bishops())
                    && is_contained(tested_board.rooks(), query_board.rooks())
                    && is_contained(tested_board.queens(), query_board.queens())
                    && is_contained(tested_board.kings(), query_board.kings())
            }
        }
    }

    fn is_reachable_by(&self, material: &MaterialCount, pawn_home: u16) -> bool {
        match self {
            PositionQuery::Exact(ref data) => {
                is_end_reachable(data.pawn_home, pawn_home)
                    && is_material_reachable(&data.material, material)
            }
            PositionQuery::Partial(ref data) => is_material_reachable(&data.material, material),
        }
    }

    pub(super) fn can_reach(&self, material: &MaterialCount, pawn_home: u16) -> bool {
        match self {
            PositionQuery::Exact(ref data) => {
                is_end_reachable(pawn_home, data.pawn_home)
                    && is_material_reachable(material, &data.material)
            }
            PositionQuery::Partial(_) => true,
        }
    }
}

/// Returns true if the end pawn structure is reachable
fn is_end_reachable(end: u16, pos: u16) -> bool {
    end & !pos == 0
}

/// Returns true if the end material is reachable
fn is_material_reachable(end: &MaterialCount, pos: &MaterialCount) -> bool {
    end.white <= pos.white && end.black <= pos.black
}

/// Returns true if the subset is contained in the container
fn is_contained(container: Bitboard, subset: Bitboard) -> bool {
    container & subset == subset
}

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
pub struct PositionStats {
    #[serde(rename = "move")]
    pub move_: String,
    pub white: i32,
    pub draw: i32,
    pub black: i32,
    pub unknown: i32,
}

fn get_move_after_match(
    move_blob: &[u8],
    fen: &Option<&str>,
    query: &PositionQuery,
) -> Result<Option<String>, Error> {
    Ok(find_position_match(move_blob, fen, query)?.map(|(_, san)| san))
}

/// First mainline occurrence, retaining the ply independently of FEN counters.
pub(super) fn find_position_match(
    move_blob: &[u8],
    fen: &Option<&str>,
    query: &PositionQuery,
) -> Result<Option<(u32, String)>, Error> {
    find_position_match_cancellable(move_blob, fen, query, &|| false)
}

pub(super) fn find_position_match_cancellable(
    move_blob: &[u8],
    fen: &Option<&str>,
    query: &PositionQuery,
    cancelled: &impl Fn() -> bool,
) -> Result<Option<(u32, String)>, Error> {
    let mut chess = if let Some(fen) = fen {
        let fen = Fen::from_ascii(fen.as_bytes())?;
        let setup = fen.into_setup();
        let castling_mode = CastlingMode::detect(&setup);
        Chess::from_setup(setup, castling_mode)?
    } else {
        Chess::default()
    };

    if query.matches(&chess) {
        let mut mainline = iter_mainline_move_bytes(move_blob).peekable();
        if mainline.peek().is_none() {
            return Ok(Some((0, "*".to_string())));
        }
        let Some(next_byte) = mainline.peek().copied() else {
            return Ok(Some((0, "*".to_string())));
        };
        let Some(next_move) = decode_move(next_byte, &chess) else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Invalid encoded move",
            )
            .into());
        };
        let san = SanPlus::from_move(chess, &next_move);
        return Ok(Some((0, san.to_string())));
    }

    let mut mainline = iter_mainline_move_bytes(move_blob).peekable();

    let mut ply = 0;
    while let Some(byte) = mainline.next() {
        if ply % 64 == 0 && cancelled() {
            return Err(Error::SearchCancelled);
        }
        let Some(m) = decode_move(byte, &chess) else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Invalid encoded move",
            )
            .into());
        };
        chess.play_unchecked(&m);
        ply += 1;

        let is_irreversible =
            m.is_capture() || m.role() == shakmaty::Role::Pawn || m.is_promotion();

        if is_irreversible {
            let board = chess.board();
            if !query.is_reachable_by(&get_material_count(board), get_pawn_home(board)) {
                return Ok(None);
            }
        }
        if query.matches(&chess) {
            if mainline.peek().is_none() {
                return Ok(Some((ply, "*".to_string())));
            }
            let Some(next_byte) = mainline.peek().copied() else {
                return Ok(Some((ply, "*".to_string())));
            };
            let Some(next_move) = decode_move(next_byte, &chess) else {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Invalid encoded move",
                )
                .into());
            };
            let san = SanPlus::from_move(chess, &next_move);
            return Ok(Some((ply, san.to_string())));
        }
    }
    Ok(None)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    pub progress: f64,
    pub id: String,
    pub finished: bool,
    pub request_id: u64,
}

#[tauri::command]
#[specta::specta]
pub async fn search_position(
    file: PathBuf,
    query: GameQuery,
    app: tauri::AppHandle,
    tab_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(Vec<PositionStats>, Vec<NormalizedGame>), Error> {
    let requested_at = Instant::now();
    let request_id = state
        .position_search_sequence
        .fetch_add(1, Ordering::Relaxed)
        + 1;
    let request = begin_position_search(
        &state.active_position_searches,
        tab_id.clone(),
        file.clone(),
        request_id,
    );
    info!("queued position search request={request_id} tab={tab_id}");
    let _ = app.emit(
        "search_progress",
        ProgressPayload {
            progress: 0.0,
            id: tab_id.clone(),
            finished: false,
            request_id,
        },
    );

    let collision_key = (query.clone(), file.clone());
    let collision_lock = {
        let entry = state
            .search_collisions
            .entry(collision_key.clone())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())));
        entry.value().clone()
    };
    let _collision_cleanup = SearchCollisionCleanup {
        collisions: &state.search_collisions,
        key: collision_key.clone(),
        lock: &collision_lock,
    };

    let collision_wait_started = Instant::now();
    let _guard = tokio::select! {
        guard = collision_lock.lock() => guard,
        _ = request.cancelled() => {
            request.ensure_active("collision-wait")?;
            return Err(Error::SearchCancelled);
        }
    };
    info!(
        "acquired collision lock request={request_id} tab={tab_id} wait={:?}",
        collision_wait_started.elapsed()
    );
    request.ensure_active("collision-lock")?;

    if !MmapSearchIndex::is_up_to_date(&file) {
        super::clear_search_cache_for_db(&state, &file);
    }

    if let Some(pos) = state.line_cache.lock().unwrap().get(&collision_key) {
        request.ensure_active("cache-hit")?;
        info!(
            "completed position search request={request_id} tab={tab_id} source=cache total={:?}",
            requested_at.elapsed()
        );
        return Ok(pos);
    }

    let start = Instant::now();
    info!("start loading games request={request_id} tab={tab_id}");

    let semaphore_wait_started = Instant::now();
    let permit = tokio::select! {
        permit = state.new_request.acquire() => permit.unwrap(),
        _ = request.cancelled() => {
            request.ensure_active("semaphore-wait")?;
            return Err(Error::SearchCancelled);
        }
    };
    info!(
        "acquired search permit request={request_id} tab={tab_id} wait={:?}",
        semaphore_wait_started.elapsed()
    );
    request.ensure_active("semaphore")?;

    let mmap_index = {
        let mut cache = state.db_cache.lock().unwrap();
        let cache_is_current = cache.as_ref().is_some_and(|(cached_path, _)| {
            cached_path == &file && MmapSearchIndex::is_up_to_date(&file)
        });
        if !cache_is_current {
            *cache = None;
            let index_path = get_index_path(&file);

            if !MmapSearchIndex::is_up_to_date(&file) {
                info!("Search index not found, generating automatically...");
                drop(cache);
                if let Err(e) = super::generate_search_index(&file, &state) {
                    return Err(Error::from(std::io::Error::other(format!(
                        "Failed to generate search index: {}",
                        e
                    ))));
                }
                cache = state.db_cache.lock().unwrap();
            }

            info!("Loading games from mmap binary search index");
            match MmapSearchIndex::open(&index_path) {
                Ok(index) => {
                    info!(
                        "Opened mmap index with {} games request={request_id}: {:?}",
                        index.len(),
                        start.elapsed()
                    );
                    *cache = Some((file.clone(), index));
                }
                Err(e) => {
                    return Err(Error::from(e));
                }
            }
        }
        cache.as_ref().unwrap().1.clone()
    };

    let game_count = mmap_index.len();

    info!(
        "Ready to search {} games request={request_id} tab={tab_id}: {:?}",
        game_count,
        start.elapsed()
    );
    request.ensure_active("mmap-ready")?;

    let openings: DashMap<String, PositionStats> = DashMap::new();
    const MAX_SAMPLES: usize = 500;
    // Min-heap of (elo_key, game_id) to track top-rated sample games.
    // Using Reverse so peek() returns the entry with the lowest ELO,
    // which we can evict when a higher-rated game is found.
    let top_games: Mutex<BinaryHeap<Reverse<(i16, i32)>>> =
        Mutex::new(BinaryHeap::with_capacity(MAX_SAMPLES + 1));

    let processed = AtomicUsize::new(0);

    let parsed_position_query: Option<PositionQuery> = if let Some(pq) = &query.position {
        Some(convert_position_query(pq.clone())?)
    } else {
        None
    };

    let wanted_result = query.wanted_result.as_ref().and_then(|r| match r.as_str() {
        "whitewon" => Some(GameResult::WhiteWin),
        "blackwon" => Some(GameResult::BlackWin),
        "draw" => Some(GameResult::Draw),
        _ => None,
    });

    let scan_started = Instant::now();
    info!("start search request={request_id} tab={tab_id}");

    let process_entry = |entry: SearchGameEntryRef<'_>| -> Result<(), ()> {
        if request.is_cancelled() {
            return Err(());
        }
        if let Some(white) = query.player1 {
            if white != entry.white_id {
                return Ok(());
            }
        }

        if let Some(black) = query.player2 {
            if black != entry.black_id {
                return Ok(());
            }
        }

        if let Some(wanted) = wanted_result {
            if entry.result != wanted {
                return Ok(());
            }
        }

        if let Some(start_date) = &query.start_date {
            if let Some(date) = entry.date {
                if date < start_date.as_str() {
                    return Ok(());
                }
            }
        }

        if let Some(end_date) = &query.end_date {
            if let Some(date) = entry.date {
                if date > end_date.as_str() {
                    return Ok(());
                }
            }
        }

        if let Some(position_query) = &parsed_position_query {
            let end_material: MaterialCount = ByColor {
                white: entry.white_material,
                black: entry.black_material,
            };
            if position_query.can_reach(&end_material, entry.pawn_home) {
                if let Ok(Some(m)) = get_move_after_match(entry.moves, &entry.fen, position_query) {
                    let elo_key = entry.white_elo.max(entry.black_elo);
                    let mut heap = top_games.lock().unwrap();
                    if heap.len() < MAX_SAMPLES {
                        heap.push(Reverse((elo_key, entry.id)));
                    } else if let Some(&Reverse((min_elo, _))) = heap.peek() {
                        if elo_key > min_elo {
                            heap.pop();
                            heap.push(Reverse((elo_key, entry.id)));
                        }
                    }
                    drop(heap);

                    openings
                        .entry(m)
                        .and_modify(|opening| match entry.result {
                            GameResult::WhiteWin => opening.white += 1,
                            GameResult::BlackWin => opening.black += 1,
                            GameResult::Draw => opening.draw += 1,
                            GameResult::Other | GameResult::None => opening.unknown += 1,
                        })
                        .or_insert_with(|| PositionStats {
                            black: i32::from(entry.result == GameResult::BlackWin),
                            white: i32::from(entry.result == GameResult::WhiteWin),
                            draw: i32::from(entry.result == GameResult::Draw),
                            unknown: i32::from(matches!(
                                entry.result,
                                GameResult::Other | GameResult::None
                            )),
                            move_: String::new(),
                        });
                }
            }
        }
        Ok(())
    };

    const PROGRESS_BATCH_SIZE: usize = 2048;
    const PROGRESS_EMIT_INTERVAL: usize = 50000;
    let scan_result: Result<(), ()> = mmap_index
        .par_iter()
        .map_init(
            || 0usize,
            |local_processed, entry| {
                *local_processed += 1;
                if *local_processed >= PROGRESS_BATCH_SIZE {
                    *local_processed = 0;
                    if request.is_cancelled() {
                        return Err(());
                    }
                    let previous = processed.fetch_add(PROGRESS_BATCH_SIZE, Ordering::Relaxed);
                    let completed = (previous + PROGRESS_BATCH_SIZE).min(game_count);
                    if previous / PROGRESS_EMIT_INTERVAL != completed / PROGRESS_EMIT_INTERVAL {
                        let _ = app.emit(
                            "search_progress",
                            ProgressPayload {
                                progress: (completed as f64 / game_count as f64) * 100.0,
                                id: tab_id.clone(),
                                finished: false,
                                request_id,
                            },
                        );
                    }
                }
                process_entry(entry)
            },
        )
        .try_for_each(|result| result);

    if scan_result.is_err() {
        let _ = app.emit(
            "search_progress",
            ProgressPayload {
                progress: 0.0,
                id: tab_id.clone(),
                finished: true,
                request_id,
            },
        );
        request.ensure_active("mmap-scan")?;
        return Err(Error::SearchCancelled);
    }
    request.ensure_active("mmap-scan-complete")?;
    info!(
        "finished mmap scan request={request_id} tab={tab_id} processed={} elapsed={:?}",
        game_count,
        scan_started.elapsed()
    );

    let openings: Vec<PositionStats> = openings
        .into_iter()
        .map(|(k, mut v)| {
            v.move_ = k;
            v
        })
        .collect();
    let ids: Vec<i32> = top_games
        .into_inner()
        .unwrap()
        .into_iter()
        .map(|Reverse((_, id))| id)
        .collect();

    info!(
        "finished search aggregation request={request_id} tab={tab_id} elapsed={:?}",
        start.elapsed()
    );

    // Keep pooled SQLite connections available while the mmap scan runs and while duplicate
    // requests wait on the collision lock. The database is only needed for this final lookup.
    request.ensure_active("sqlite-start")?;
    let sqlite_started = Instant::now();
    let db = &mut get_db_or_create(&state, file.to_str().unwrap(), ConnectionOptions::default())?;
    let (white_players, black_players) = diesel::alias!(players as white, players as black);
    let games: Vec<(Game, Player, Player, Event, Site)> = games::table
        .inner_join(white_players.on(games::white_id.eq(white_players.field(players::id))))
        .inner_join(black_players.on(games::black_id.eq(black_players.field(players::id))))
        .inner_join(events::table.on(games::event_id.eq(events::id)))
        .inner_join(sites::table.on(games::site_id.eq(sites::id)))
        .filter(games::id.eq_any(ids))
        .order((games::white_elo.desc(), games::black_elo.desc()))
        .load(db)?;
    let normalized_games = normalize_games(games);
    request.ensure_active("sqlite-complete")?;
    info!(
        "finished sqlite hydration request={request_id} tab={tab_id} games={} elapsed={:?}",
        normalized_games.len(),
        sqlite_started.elapsed()
    );

    state.line_cache.lock().unwrap().insert(
        collision_key.clone(),
        (openings.clone(), normalized_games.clone()),
    );

    drop(permit);

    let _ = app.emit(
        "search_progress",
        ProgressPayload {
            progress: 100.0,
            id: tab_id.clone(),
            finished: true,
            request_id,
        },
    );

    info!(
        "completed position search request={request_id} tab={tab_id} source=scan total={:?}",
        requested_at.elapsed()
    );

    Ok((openings, normalized_games))
}

pub async fn is_position_in_db(
    file: PathBuf,
    query: GameQuery,
    state: tauri::State<'_, AppState>,
) -> Result<bool, Error> {
    let collision_lock = {
        let entry = state
            .search_collisions
            .entry((query.clone(), file.clone()))
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())));
        entry.value().clone()
    };
    let collision_key = (query.clone(), file.clone());
    let _collision_cleanup = SearchCollisionCleanup {
        collisions: &state.search_collisions,
        key: collision_key,
        lock: &collision_lock,
    };

    let _guard = collision_lock.lock().await;

    if !MmapSearchIndex::is_up_to_date(&file) {
        super::clear_search_cache_for_db(&state, &file);
    }

    if let Some(pos) = state
        .line_cache
        .lock()
        .unwrap()
        .get(&(query.clone(), file.clone()))
    {
        return Ok(!pos.0.is_empty());
    }

    let parsed_position_query: Option<PositionQuery> = if let Some(pq) = &query.position {
        Some(convert_position_query(pq.clone())?)
    } else {
        None
    };

    let start = Instant::now();
    info!("start loading games for is_position_in_db");

    let permit = state.new_request.acquire().await.unwrap();

    let mmap_index = {
        let mut cache = state.db_cache.lock().unwrap();
        let cache_is_current = cache.as_ref().is_some_and(|(cached_path, _)| {
            cached_path == &file && MmapSearchIndex::is_up_to_date(&file)
        });
        if !cache_is_current {
            *cache = None;
            let index_path = get_index_path(&file);

            if !MmapSearchIndex::is_up_to_date(&file) {
                info!("Search index not found, generating automatically...");
                drop(cache);
                if let Err(e) = super::generate_search_index(&file, &state) {
                    return Err(Error::from(std::io::Error::other(format!(
                        "Failed to generate search index: {}",
                        e
                    ))));
                }
                cache = state.db_cache.lock().unwrap();
            }

            info!("Loading games from mmap binary search index");
            match MmapSearchIndex::open(&index_path) {
                Ok(index) => {
                    info!(
                        "Opened mmap index with {} games: {:?}",
                        index.len(),
                        start.elapsed()
                    );
                    *cache = Some((file.clone(), index));
                }
                Err(e) => {
                    return Err(Error::from(e));
                }
            }
        }
        cache.as_ref().unwrap().1.clone()
    };

    let check_entry = |entry: SearchGameEntryRef<'_>| -> bool {
        let end_material: MaterialCount = ByColor {
            white: entry.white_material,
            black: entry.black_material,
        };
        if let Some(position_query) = &parsed_position_query {
            position_query.can_reach(&end_material, entry.pawn_home)
                && get_move_after_match(entry.moves, &entry.fen, position_query)
                    .unwrap_or(None)
                    .is_some()
        } else {
            false
        }
    };

    let exists = mmap_index.par_iter().any(check_entry);

    info!("finished search in {:?}", start.elapsed());

    if !exists {
        state
            .line_cache
            .lock()
            .unwrap()
            .insert((query.clone(), file.clone()), (vec![], vec![]));
    }

    drop(permit);

    Ok(exists)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache_key(id: i32, database: &str) -> PositionSearchKey {
        (
            GameQuery {
                player1: Some(id),
                ..GameQuery::default()
            },
            PathBuf::from(database),
        )
    }

    #[test]
    fn newer_position_search_cancels_previous_request_for_same_tab_and_database() {
        let searches = ActivePositionSearches::new();
        let first = begin_position_search(
            &searches,
            "analysis-tab".to_string(),
            PathBuf::from("games.db3"),
            1,
        );
        assert!(!first.is_cancelled());

        let second = begin_position_search(
            &searches,
            "analysis-tab".to_string(),
            PathBuf::from("games.db3"),
            2,
        );
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());

        drop(first);
        assert_eq!(searches.len(), 1);
        drop(second);
        assert!(searches.is_empty());
    }

    #[test]
    fn position_searches_in_other_tabs_do_not_cancel_each_other() {
        let searches = ActivePositionSearches::new();
        let first = begin_position_search(
            &searches,
            "first-tab".to_string(),
            PathBuf::from("games.db3"),
            1,
        );
        let other_tab = begin_position_search(
            &searches,
            "second-tab".to_string(),
            PathBuf::from("games.db3"),
            2,
        );
        assert!(!first.is_cancelled());
        assert!(!other_tab.is_cancelled());
    }

    #[test]
    fn changing_database_cancels_previous_request_in_same_tab() {
        let searches = ActivePositionSearches::new();
        let first = begin_position_search(
            &searches,
            "analysis-tab".to_string(),
            PathBuf::from("games.db3"),
            1,
        );
        let second = begin_position_search(
            &searches,
            "analysis-tab".to_string(),
            PathBuf::from("other.db3"),
            2,
        );

        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());
    }

    #[tokio::test]
    async fn cancelled_position_search_wakes_without_waiting_for_a_permit() {
        let searches = ActivePositionSearches::new();
        let first = begin_position_search(
            &searches,
            "analysis-tab".to_string(),
            PathBuf::from("games.db3"),
            1,
        );
        let second = begin_position_search(
            &searches,
            "analysis-tab".to_string(),
            PathBuf::from("games.db3"),
            2,
        );

        tokio::time::timeout(std::time::Duration::from_millis(100), first.cancelled())
            .await
            .expect("superseded request should wake immediately");
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());
    }

    #[test]
    fn position_search_cache_evicts_least_recently_used_entry() {
        let mut cache = PositionSearchCache::with_capacity(2);
        let first = cache_key(1, "games.db3");
        let second = cache_key(2, "games.db3");
        let third = cache_key(3, "games.db3");

        cache.insert(first.clone(), (vec![], vec![]));
        cache.insert(second.clone(), (vec![], vec![]));
        assert!(cache.get(&first).is_some());
        cache.insert(third.clone(), (vec![], vec![]));

        assert!(cache.get(&first).is_some());
        assert!(cache.get(&second).is_none());
        assert!(cache.get(&third).is_some());
    }

    #[test]
    fn position_search_cache_can_invalidate_one_database() {
        let mut cache = PositionSearchCache::with_capacity(3);
        let first_database = cache_key(1, "games.db3");
        let second_database = cache_key(2, "other.db3");
        cache.insert(first_database.clone(), (vec![], vec![]));
        cache.insert(second_database.clone(), (vec![], vec![]));

        cache.remove_database(Path::new("games.db3"));

        assert!(cache.get(&first_database).is_none());
        assert!(cache.get(&second_database).is_some());
    }

    #[test]
    #[ignore = "requires CHESS_LAB_BENCH_DB pointing to a real indexed database"]
    fn benchmark_real_position_index_scan() {
        let database = PathBuf::from(
            std::env::var("CHESS_LAB_BENCH_DB")
                .expect("set CHESS_LAB_BENCH_DB to an indexed .db3 file"),
        );
        let index = MmapSearchIndex::open(get_index_path(&database)).unwrap();
        let query = PositionQuery::exact_from_fen(
            "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
        )
        .unwrap();
        let matches = AtomicUsize::new(0);
        let started = Instant::now();

        index.par_iter().for_each(|entry| {
            let end_material: MaterialCount = ByColor {
                white: entry.white_material,
                black: entry.black_material,
            };
            if query.can_reach(&end_material, entry.pawn_home)
                && get_move_after_match(entry.moves, &entry.fen, &query)
                    .unwrap_or(None)
                    .is_some()
            {
                matches.fetch_add(1, Ordering::Relaxed);
            }
        });

        let elapsed = started.elapsed();
        eprintln!(
            "scanned {} games in {:?}; matches={}",
            index.len(),
            elapsed,
            matches.load(Ordering::Relaxed)
        );
        assert!(matches.load(Ordering::Relaxed) > 0);
    }

    #[test]
    #[ignore = "requires CHESS_LAB_BENCH_DB pointing to a real indexed database"]
    fn benchmark_real_position_index_cancellation() {
        let database = PathBuf::from(
            std::env::var("CHESS_LAB_BENCH_DB")
                .expect("set CHESS_LAB_BENCH_DB to an indexed .db3 file"),
        );
        let index = MmapSearchIndex::open(get_index_path(&database)).unwrap();
        let query = PositionQuery::exact_from_fen(
            "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
        )
        .unwrap();
        let searches = ActivePositionSearches::new();
        let first =
            begin_position_search(&searches, "benchmark-tab".to_string(), database.clone(), 1);
        let scan_started = Instant::now();

        let (scan_result, scan_finished, cancelled_at) = std::thread::scope(|scope| {
            let canceller = scope.spawn(|| {
                std::thread::sleep(std::time::Duration::from_millis(100));
                let cancelled_at = Instant::now();
                let _latest =
                    begin_position_search(&searches, "benchmark-tab".to_string(), database, 2);
                cancelled_at
            });
            let scan_result: Result<(), ()> = index.par_iter().try_for_each(|entry| {
                if first.is_cancelled() {
                    return Err(());
                }
                let end_material: MaterialCount = ByColor {
                    white: entry.white_material,
                    black: entry.black_material,
                };
                if query.can_reach(&end_material, entry.pawn_home) {
                    let _ = get_move_after_match(entry.moves, &entry.fen, &query);
                }
                Ok(())
            });
            let scan_finished = Instant::now();
            (scan_result, scan_finished, canceller.join().unwrap())
        });

        let cancellation_latency = scan_finished.saturating_duration_since(cancelled_at);
        eprintln!(
            "cancelled real scan after {:?}; cancellation latency={:?}",
            scan_finished.duration_since(scan_started),
            cancellation_latency
        );
        assert!(scan_result.is_err());
        assert!(cancellation_latency < std::time::Duration::from_secs(2));
    }

    fn assert_partial_match(fen1: &str, fen2: &str) {
        let query = PositionQuery::partial_from_fen(fen1).unwrap();
        let fen = Fen::from_ascii(fen2.as_bytes()).unwrap();
        let chess = Chess::from_setup(fen.into_setup(), shakmaty::CastlingMode::Chess960).unwrap();
        assert!(query.matches(&chess));
    }

    #[test]
    fn exact_matches() {
        let query = PositionQuery::exact_from_fen(
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        )
        .unwrap();
        let chess = Chess::default();
        assert!(query.matches(&chess));
    }

    #[test]
    fn empty_matches_anything() {
        assert_partial_match(
            "8/8/8/8/8/8/8/8 w - - 0 1",
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        );
    }

    #[test]
    fn correct_partial_match() {
        assert_partial_match(
            "8/8/8/8/8/8/8/6N1 w - - 0 1",
            "3k4/8/8/8/8/4P3/3PKP2/6N1 w - - 0 1",
        );
    }

    #[test]
    #[should_panic]
    fn fail_partial_match() {
        assert_partial_match(
            "8/8/8/8/8/8/8/6N1 w - - 0 1",
            "3k4/8/8/8/8/4P3/3PKP2/7N w - - 0 1",
        );
        assert_partial_match(
            "8/8/8/8/8/8/8/6N1 w - - 0 1",
            "3k4/8/8/8/8/4P3/3PKP2/6n1 w - - 0 1",
        );
    }

    #[test]
    fn correct_exact_is_reachable() {
        let query =
            PositionQuery::exact_from_fen("rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR")
                .unwrap();
        let chess = Chess::default();
        assert!(query.is_reachable_by(
            &get_material_count(chess.board()),
            get_pawn_home(chess.board())
        ));
    }

    #[test]
    fn correct_partial_is_reachable() {
        let query = PositionQuery::partial_from_fen("8/8/8/8/8/8/8/8").unwrap();
        let chess = Chess::default();
        assert!(query.is_reachable_by(
            &get_material_count(chess.board()),
            get_pawn_home(chess.board())
        ));
    }

    #[test]
    fn correct_partial_can_reach() {
        let query = PositionQuery::partial_from_fen("8/8/8/8/8/8/8/8").unwrap();
        let chess = Chess::default();
        assert!(query.can_reach(
            &get_material_count(chess.board()),
            get_pawn_home(chess.board())
        ));
    }

    #[test]
    fn get_move_after_exact_match_test() {
        let game = vec![12, 12]; // 1. e4 e5

        let query = PositionQuery::exact_from_fen(
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        )
        .unwrap();
        let result = get_move_after_match(&game, &None, &query).unwrap();
        assert_eq!(result, Some("e4".to_string()));

        let query = PositionQuery::exact_from_fen(
            "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
        )
        .unwrap();
        let result = get_move_after_match(&game, &None, &query).unwrap();
        assert_eq!(result, Some("e5".to_string()));

        let query = PositionQuery::exact_from_fen(
            "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
        )
        .unwrap();
        let result = get_move_after_match(&game, &None, &query).unwrap();
        assert_eq!(result, Some("*".to_string()));
    }

    #[test]
    fn get_move_after_partial_match_test() {
        let game = vec![12, 12]; // 1. e4 e5

        let query = PositionQuery::partial_from_fen("8/pppppppp/8/8/8/8/PPPPPPPP/8").unwrap();
        let result = get_move_after_match(&game, &None, &query).unwrap();
        assert_eq!(result, Some("e4".to_string()));
    }

    #[test]
    fn exact_match_preserves_castling_and_legal_en_passant() {
        let initial = Chess::default();
        let without =
            PositionQuery::exact_from_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1")
                .unwrap();
        assert!(!without.matches(&initial));
        let with_ep = PositionQuery::exact_from_fen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1").unwrap();
        let no_ep: Chess = Fen::from_ascii(b"4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1")
            .unwrap()
            .into_position(CastlingMode::Standard)
            .unwrap();
        assert!(!with_ep.matches(&no_ep));
    }

    #[test]
    fn position_match_returns_first_ply_and_handles_final_position() {
        let query = PositionQuery::exact_from_fen(
            "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 37 80",
        )
        .unwrap();
        assert_eq!(
            find_position_match(&[12, 12], &None, &query).unwrap(),
            Some((2, "*".into()))
        );
    }
}
