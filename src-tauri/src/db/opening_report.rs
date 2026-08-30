//! Local opening reports reuse a complete position snapshot. Global statistics are exact;
//! theory and move orders use an explicitly ranked, bounded cohort (as in classical reports).
use super::{
    encoding::{decode_move, iter_mainline_move_bytes},
    position_query::{
        canonical_query, open_index, preempt_background_searches, read_page, snapshot_for,
        MatchRecord, PositionGameMetadata, PositionSummary, Snapshot,
    },
    search::begin_position_search,
    search_index::{GameResult, MmapSearchIndex, SearchGameEntryRef},
    PositionQueryJs,
};
use crate::{error::Error, AppState};
use serde::{Deserialize, Serialize};
use shakmaty::{fen::Fen, san::SanPlus, CastlingMode, Chess, EnPassantMode, Move, Position};
use specta::Type;
use std::{
    cmp::{Ordering as CmpOrdering, Reverse},
    collections::{BTreeMap, BTreeSet, BinaryHeap, HashMap},
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const BATCH: u32 = 4096;
const MAX_THEORY_GAMES: u32 = 10_000;
const MAX_DEPTH: u32 = 16;
const MAX_INITIAL_PLY: u32 = 512;
const MAX_REPORT_PLAYERS: usize = 2_000_000;
const PLAYER_TABLE_SIZE: usize = 20;
const ELO_BANDS: &[(i32, i32)] = &[
    (1, 1599),
    (1600, 1799),
    (1800, 1999),
    (2000, 2199),
    (2200, 2399),
    (2400, 2599),
    (2600, 32767),
];

fn invalid(message: &str) -> Error {
    std::io::Error::other(message).into()
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpeningReportOptions {
    pub depth: u32,
    pub theory_games: u32,
    pub max_lines: u32,
    pub display_fen: String,
}

#[derive(Clone, Default, Serialize, Type)]
pub struct ReportResults {
    pub white: u32,
    pub draw: u32,
    pub black: u32,
    pub unknown: u32,
}
impl ReportResults {
    fn add(&mut self, result: GameResult) {
        match result {
            GameResult::WhiteWin => self.white += 1,
            GameResult::Draw => self.draw += 1,
            GameResult::BlackWin => self.black += 1,
            _ => self.unknown += 1,
        }
    }
    pub fn total(&self) -> u32 {
        self.white + self.draw + self.black + self.unknown
    }
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReportStatistics {
    pub results: ReportResults,
    pub average_white_elo: Option<f64>,
    pub average_black_elo: Option<f64>,
    pub rated_white: u32,
    pub rated_black: u32,
}

#[derive(Clone, Default)]
struct Statistics {
    results: ReportResults,
    white_sum: u64,
    black_sum: u64,
    rated_white: u32,
    rated_black: u32,
}
impl Statistics {
    fn add(&mut self, game: &SearchGameEntryRef<'_>) {
        self.results.add(game.result);
        if game.white_elo > 0 {
            self.white_sum += game.white_elo as u64;
            self.rated_white += 1;
        }
        if game.black_elo > 0 {
            self.black_sum += game.black_elo as u64;
            self.rated_black += 1;
        }
    }
    fn finish(&self) -> ReportStatistics {
        ReportStatistics {
            results: self.results.clone(),
            average_white_elo: (self.rated_white > 0)
                .then(|| self.white_sum as f64 / self.rated_white as f64),
            average_black_elo: (self.rated_black > 0)
                .then(|| self.black_sum as f64 / self.rated_black as f64),
            rated_white: self.rated_white,
            rated_black: self.rated_black,
        }
    }
}

#[derive(Clone, Serialize, Type)]
pub struct ReportYear {
    pub year: u32,
    pub results: ReportResults,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReportFilters {
    pub white_player: Option<i32>,
    pub black_player: Option<i32>,
    pub any_player: Option<i32>,
    pub white_elo: Option<(i32, i32)>,
    pub black_elo: Option<(i32, i32)>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub result: Option<String>,
}

#[derive(Clone, Default)]
struct PlayerAggregate {
    games: u32,
    white_games: u32,
    black_games: u32,
    wins: u32,
    draws: u32,
    losses: u32,
    unknown: u32,
    elo_sum: u64,
    rated_games: u32,
    peak_elo: i32,
}

impl PlayerAggregate {
    fn add(&mut self, game: &SearchGameEntryRef<'_>, white: bool) {
        self.games += 1;
        if white {
            self.white_games += 1;
        } else {
            self.black_games += 1;
        }
        match (game.result, white) {
            (GameResult::WhiteWin, true) | (GameResult::BlackWin, false) => self.wins += 1,
            (GameResult::WhiteWin, false) | (GameResult::BlackWin, true) => self.losses += 1,
            (GameResult::Draw, _) => self.draws += 1,
            _ => self.unknown += 1,
        }
        let elo = (if white {
            game.white_elo
        } else {
            game.black_elo
        }) as i32;
        if elo > 0 {
            self.elo_sum += elo as u64;
            self.rated_games += 1;
            self.peak_elo = self.peak_elo.max(elo);
        }
    }
}

fn top_player_ids(players: &HashMap<i32, PlayerAggregate>, strongest: bool) -> Vec<i32> {
    let mut top: BinaryHeap<Reverse<(u64, u64, Reverse<i32>)>> = BinaryHeap::new();
    for (&id, player) in players {
        if strongest && player.peak_elo <= 0 {
            continue;
        }
        let rank = if strongest {
            (player.peak_elo as u64, player.games as u64, Reverse(id))
        } else {
            (
                player.games as u64,
                player.peak_elo.max(0) as u64,
                Reverse(id),
            )
        };
        if top.len() < PLAYER_TABLE_SIZE {
            top.push(Reverse(rank));
        } else if top.peek().is_some_and(|smallest| rank > smallest.0) {
            top.pop();
            top.push(Reverse(rank));
        }
    }
    let mut ranked: Vec<_> = top.into_iter().map(|item| item.0).collect();
    ranked.sort_by(|a, b| b.cmp(a));
    ranked.into_iter().map(|(_, _, Reverse(id))| id).collect()
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReportPlayer {
    pub id: i32,
    pub name: String,
    pub games: u32,
    pub white_games: u32,
    pub black_games: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    pub unknown: u32,
    pub average_elo: Option<f64>,
    pub peak_elo: Option<i32>,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReportEloBand {
    pub min_elo: i32,
    pub max_elo: i32,
    pub results: ReportResults,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReportLine {
    pub moves: Vec<String>,
    pub fen: String,
    pub statistics: ReportStatistics,
    pub example_offset: u32,
    pub example: PositionGameMetadata,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReportMoveOrder {
    pub start_fen: String,
    pub moves: Vec<String>,
    pub statistics: ReportStatistics,
    pub example_offset: u32,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReportRoute {
    pub moves: Vec<String>,
    pub results: ReportResults,
    pub example_offset: u32,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReportTransposition {
    pub fen: String,
    pub ply: u32,
    pub games: u32,
    pub route_count: u32,
    pub routes: Vec<ReportRoute>,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpeningReport {
    pub version: u32,
    pub generated_at: String,
    pub database_name: String,
    pub database_games: u32,
    pub position: PositionSummary,
    pub options: OpeningReportOptions,
    pub filters: ReportFilters,
    pub statistics: ReportStatistics,
    pub years: Vec<ReportYear>,
    pub unknown_year_games: u32,
    pub elo_bands: Vec<ReportEloBand>,
    pub unknown_elo_games: u32,
    pub most_played_players: Vec<ReportPlayer>,
    pub strongest_players: Vec<ReportPlayer>,
    pub player_count: u32,
    pub cohort: ReportStatistics,
    pub excluded_theory_games: u32,
    pub theory: Vec<ReportLine>,
    pub theory_line_count: u32,
    pub displayed_theory_games: u32,
    pub move_orders: Vec<ReportMoveOrder>,
    pub move_order_count: u32,
    pub transpositions: Vec<ReportTransposition>,
    pub transposition_count: u32,
    pub elapsed_ms: f64,
    pub cache_hit: bool,
}

#[derive(Clone)]
struct Candidate {
    rank: (i32, u32, Reverse<i32>),
    record: MatchRecord,
    offset: u32,
}
impl PartialEq for Candidate {
    fn eq(&self, other: &Self) -> bool {
        self.rank == other.rank
    }
}
impl Eq for Candidate {}
impl PartialOrd for Candidate {
    fn partial_cmp(&self, other: &Self) -> Option<CmpOrdering> {
        Some(self.cmp(other))
    }
}
impl Ord for Candidate {
    fn cmp(&self, other: &Self) -> CmpOrdering {
        self.rank.cmp(&other.rank)
    }
}

struct TheoryNode {
    parent: usize,
    depth: u32,
    san: String,
    fen: String,
    children: BTreeMap<u8, usize>,
    statistics: Statistics,
    terminal: Statistics,
    example: u32,
    terminal_example: u32,
}
impl TheoryNode {
    fn new(parent: usize, depth: u32, san: String, fen: String, example: u32) -> Self {
        Self {
            parent,
            depth,
            san,
            fen,
            children: BTreeMap::new(),
            statistics: Statistics::default(),
            terminal: Statistics::default(),
            example,
            terminal_example: example,
        }
    }
}

fn position_fen(chess: &Chess) -> String {
    let mut setup = chess.clone().into_setup(EnPassantMode::Legal);
    setup.halfmoves = 0;
    setup.fullmoves = std::num::NonZeroU32::new(1).unwrap();
    Fen::from_setup(setup).to_string()
}

fn chess_from_fen(fen: Option<&str>) -> Result<Chess, Error> {
    let setup = fen
        .map(|s| s.parse::<Fen>())
        .transpose()?
        .unwrap_or_default()
        .into_setup();
    let mode = CastlingMode::detect(&setup);
    Ok(setup.position(mode)?)
}

struct DecodedLine {
    start_fen: String,
    arrival: Vec<u8>,
    root: Chess,
    moves: Vec<(u8, Move, Chess)>,
}
fn decode_line(
    entry: &SearchGameEntryRef<'_>,
    record: &MatchRecord,
    depth: u32,
    cancelled: &dyn Fn() -> bool,
) -> Result<DecodedLine, Error> {
    if record.ply > MAX_INITIAL_PLY {
        return Err(invalid("Opening report position exceeds 512 plies"));
    }
    let mut chess = chess_from_fen(entry.fen)?;
    let start_fen = Fen::from_position(chess.clone(), EnPassantMode::Legal).to_string();
    let mut iterator = iter_mainline_move_bytes(entry.moves);
    let mut arrival = Vec::with_capacity(record.ply as usize);
    for ply in 0..record.ply {
        if ply % 64 == 0 && cancelled() {
            return Err(Error::SearchCancelled);
        }
        let byte = iterator
            .next()
            .ok_or_else(|| invalid("Truncated report game"))?;
        let movement = decode_move(byte, &chess).ok_or_else(|| invalid("Invalid report move"))?;
        chess.play_unchecked(&movement);
        arrival.push(byte);
    }
    let root = chess.clone();
    let mut moves = Vec::with_capacity(depth as usize);
    for byte in iterator.take(depth as usize) {
        if cancelled() {
            return Err(Error::SearchCancelled);
        }
        let movement =
            decode_move(byte, &chess).ok_or_else(|| invalid("Invalid report continuation"))?;
        chess.play_unchecked(&movement);
        moves.push((byte, movement, chess.clone()));
    }
    Ok(DecodedLine {
        start_fen,
        arrival,
        root,
        moves,
    })
}

fn path(nodes: &[TheoryNode], mut index: usize) -> Vec<String> {
    let mut moves = Vec::new();
    while index != 0 {
        moves.push(nodes[index].san.clone());
        index = nodes[index].parent;
    }
    moves.reverse();
    moves
}

fn validate_options(snapshot: &Snapshot, options: &OpeningReportOptions) -> Result<(), Error> {
    if !(1..=MAX_DEPTH).contains(&options.depth)
        || !(1..=MAX_THEORY_GAMES).contains(&options.theory_games)
        || !(1..=64).contains(&options.max_lines)
    {
        return Err(invalid("Invalid opening report limits"));
    }
    if snapshot
        .query
        .position
        .as_ref()
        .is_none_or(|p| p.type_ != "exact")
    {
        return Err(invalid("Opening reports require an exact position"));
    }
    let mut query = snapshot.query.clone();
    query.position = Some(PositionQueryJs {
        fen: options.display_fen.clone(),
        type_: "exact".into(),
    });
    if canonical_query(query)? != snapshot.query {
        return Err(invalid("Opening report position changed"));
    }
    Ok(())
}

fn build_report(
    snapshot: &Snapshot,
    index: &MmapSearchIndex,
    options: OpeningReportOptions,
    cancelled: &dyn Fn() -> bool,
    progress: &dyn Fn(f64),
) -> Result<OpeningReport, Error> {
    validate_options(snapshot, &options)?;
    snapshot.check_revision()?;
    let started = Instant::now();
    let check = || -> Result<(), Error> {
        if cancelled() {
            return Err(Error::SearchCancelled);
        }
        if started.elapsed() > Duration::from_secs(180) {
            return Err(invalid("Opening report timed out"));
        }
        Ok(())
    };
    let mut statistics = Statistics::default();
    let mut years: BTreeMap<u32, ReportResults> = BTreeMap::new();
    let mut unknown_year_games = 0;
    let mut elo_bands: Vec<ReportResults> =
        ELO_BANDS.iter().map(|_| ReportResults::default()).collect();
    let mut unknown_elo_games = 0;
    let mut players: HashMap<i32, PlayerAggregate> = HashMap::new();
    let mut selected: BinaryHeap<Reverse<Candidate>> = BinaryHeap::new();
    for offset in (0..snapshot.summary.total).step_by(BATCH as usize) {
        check()?;
        for (i, record) in snapshot.records(offset, BATCH)?.into_iter().enumerate() {
            let entry = index
                .get_entry_ref(record.index_offset as usize)
                .filter(|entry| entry.id == record.id)
                .ok_or_else(|| invalid("Position query expired"))?;
            statistics.add(&entry);
            if entry.white_id != 0 {
                players.entry(entry.white_id).or_default().add(&entry, true);
            }
            if entry.black_id != 0 && entry.black_id != entry.white_id {
                players
                    .entry(entry.black_id)
                    .or_default()
                    .add(&entry, false);
            }
            if players.len() > MAX_REPORT_PLAYERS {
                return Err(invalid(
                    "Opening report contains more than 2,000,000 distinct players",
                ));
            }
            if entry.white_elo > 0 && entry.black_elo > 0 {
                let mean = (entry.white_elo as i32 + entry.black_elo as i32) / 2;
                if let Some((band, _)) = ELO_BANDS
                    .iter()
                    .enumerate()
                    .find(|(_, (lo, hi))| (*lo..=*hi).contains(&mean))
                {
                    elo_bands[band].add(entry.result);
                } else {
                    unknown_elo_games += 1;
                }
            } else {
                unknown_elo_games += 1;
            }
            let year = entry
                .date
                .and_then(|date| date.get(..4))
                .and_then(|year| year.parse::<u32>().ok())
                .filter(|year| (1..=9999).contains(year));
            if let Some(year) = year {
                years.entry(year).or_default().add(entry.result);
            } else {
                unknown_year_games += 1;
            }
            // Both ratings are required to rank a game by mean Elo; incomplete ratings rank last.
            let elo = if entry.white_elo > 0 && entry.black_elo > 0 {
                entry.white_elo as i32 + entry.black_elo as i32
            } else {
                -1
            };
            let candidate = Candidate {
                rank: (elo, year.unwrap_or(0), Reverse(record.id)),
                record,
                offset: offset + i as u32,
            };
            if selected.len() < options.theory_games as usize {
                selected.push(Reverse(candidate));
            } else if selected
                .peek()
                .is_some_and(|smallest| candidate > smallest.0)
            {
                selected.pop();
                selected.push(Reverse(candidate));
            }
        }
        progress(
            (offset + BATCH).min(snapshot.summary.total) as f64
                / snapshot.summary.total.max(1) as f64
                * 50.0,
        );
    }
    let mut selected: Vec<_> = selected.into_iter().map(|item| item.0).collect();
    selected.sort_by(|a, b| b.cmp(a));
    let player_count = players.len() as u32;
    // Keep only the best 20 candidates in each heap instead of sorting every player.
    let most_played_ids = top_player_ids(&players, false);
    let strongest_ids = top_player_ids(&players, true);
    let wanted_names: BTreeSet<i32> = most_played_ids
        .iter()
        .chain(&strongest_ids)
        .copied()
        .collect();
    let connection = rusqlite::Connection::open_with_flags(
        &snapshot.database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    connection.busy_timeout(Duration::from_millis(500))?;
    let mut names = HashMap::new();
    let mut name_statement =
        connection.prepare("SELECT COALESCE(Name,'?') FROM Players WHERE ID=?1")?;
    for id in wanted_names {
        let name = name_statement
            .query_row([id], |row| row.get::<_, String>(0))
            .unwrap_or_else(|_| format!("#{id}"));
        names.insert(id, name);
    }
    let public_player = |id: i32| {
        let player = &players[&id];
        ReportPlayer {
            id,
            name: names.get(&id).cloned().unwrap_or_else(|| format!("#{id}")),
            games: player.games,
            white_games: player.white_games,
            black_games: player.black_games,
            wins: player.wins,
            draws: player.draws,
            losses: player.losses,
            unknown: player.unknown,
            average_elo: (player.rated_games > 0)
                .then(|| player.elo_sum as f64 / player.rated_games as f64),
            peak_elo: (player.peak_elo > 0).then_some(player.peak_elo),
        }
    };
    let most_played_players = most_played_ids.into_iter().map(&public_player).collect();
    let strongest_players = strongest_ids.into_iter().map(&public_player).collect();
    drop(players);
    drop(names);
    let mut cohort = Statistics::default();
    let mut excluded = 0;
    let mut nodes = vec![TheoryNode::new(
        0,
        0,
        String::new(),
        snapshot.summary.fen.clone(),
        0,
    )];
    let mut orders: BTreeMap<(String, Vec<u8>), (Statistics, u32)> = BTreeMap::new();
    for (i, candidate) in selected.iter().enumerate() {
        check()?;
        let entry = index
            .get_entry_ref(candidate.record.index_offset as usize)
            .unwrap();
        let line = match decode_line(&entry, &candidate.record, options.depth, cancelled) {
            Ok(line) => line,
            Err(Error::SearchCancelled) => return Err(Error::SearchCancelled),
            Err(_) => {
                excluded += 1;
                continue;
            }
        };
        if position_fen(&line.root) != snapshot.summary.fen {
            return Err(invalid("Position query expired"));
        }
        cohort.add(&entry);
        nodes[0].statistics.add(&entry);
        orders
            .entry((line.start_fen, line.arrival))
            .or_insert_with(|| (Statistics::default(), candidate.offset))
            .0
            .add(&entry);
        let mut current = 0;
        let mut before = line.root;
        for (byte, movement, after) in line.moves {
            let child = if let Some(child) = nodes[current].children.get(&byte) {
                *child
            } else {
                let child = nodes.len();
                nodes.push(TheoryNode::new(
                    current,
                    nodes[current].depth + 1,
                    SanPlus::from_move(before, &movement).to_string(),
                    position_fen(&after),
                    candidate.offset,
                ));
                nodes[current].children.insert(byte, child);
                child
            };
            nodes[child].statistics.add(&entry);
            current = child;
            before = after;
        }
        if nodes[current].terminal.results.total() == 0 {
            nodes[current].terminal_example = candidate.offset;
        }
        nodes[current].terminal.add(&entry);
        if i % 64 == 0 {
            progress(50.0 + i as f64 / selected.len().max(1) as f64 * 45.0);
        }
    }
    check()?;
    // Terminal paths partition the cohort, including games ending before the horizon.
    let mut leaves: Vec<usize> = (0..nodes.len())
        .filter(|i| nodes[*i].terminal.results.total() > 0)
        .collect();
    leaves.sort_by(|a, b| {
        nodes[*b]
            .terminal
            .results
            .total()
            .cmp(&nodes[*a].terminal.results.total())
            .then_with(|| path(&nodes, *a).cmp(&path(&nodes, *b)))
    });
    let theory_line_count = leaves.len() as u32;
    let mut metadata: HashMap<u32, PositionGameMetadata> = HashMap::new();
    let mut theory = Vec::new();
    for index in leaves.into_iter().take(options.max_lines as usize) {
        check()?;
        let node = &nodes[index];
        let example = if let Some(example) = metadata.get(&node.terminal_example) {
            example.clone()
        } else {
            let example = read_page(snapshot, node.terminal_example, 1)?
                .pop()
                .ok_or_else(|| invalid("Missing report example"))?;
            metadata.insert(node.terminal_example, example.clone());
            example
        };
        theory.push(ReportLine {
            moves: path(&nodes, index),
            fen: node.fen.clone(),
            statistics: node.terminal.finish(),
            example_offset: node.terminal_example,
            example,
        });
    }
    let displayed_theory_games = theory
        .iter()
        .map(|line| line.statistics.results.total())
        .sum();
    let move_order_count = orders.len() as u32;
    let mut orders: Vec<_> = orders.into_iter().collect();
    orders.sort_by(|a, b| {
        b.1 .0
            .results
            .total()
            .cmp(&a.1 .0.results.total())
            .then_with(|| a.0.cmp(&b.0))
    });
    let mut move_orders = Vec::new();
    for ((start_fen, bytes), (statistics, example_offset)) in orders.into_iter().take(12) {
        let mut chess = chess_from_fen(Some(&start_fen))?;
        let mut moves = Vec::new();
        for byte in bytes {
            let movement =
                decode_move(byte, &chess).ok_or_else(|| invalid("Invalid move order"))?;
            moves.push(SanPlus::from_move(chess.clone(), &movement).to_string());
            chess.play_unchecked(&movement);
        }
        move_orders.push(ReportMoveOrder {
            start_fen,
            moves,
            statistics: statistics.finish(),
            example_offset,
        });
    }
    // Equal-depth convergence avoids mislabelling repetition along one path as a transposition.
    let mut groups: BTreeMap<(u32, String), Vec<usize>> = BTreeMap::new();
    for (i, node) in nodes.iter().enumerate().skip(1) {
        if i % BATCH as usize == 0 {
            check()?;
        }
        groups
            .entry((node.depth, node.fen.clone()))
            .or_default()
            .push(i);
    }
    let mut groups: Vec<_> = groups
        .into_iter()
        .filter(|(_, routes)| routes.len() > 1)
        .collect();
    let transposition_count = groups.len() as u32;
    groups.sort_by(|a, b| {
        let count = |routes: &[usize]| {
            routes
                .iter()
                .map(|i| nodes[*i].statistics.results.total())
                .sum::<u32>()
        };
        count(&b.1).cmp(&count(&a.1)).then_with(|| a.0.cmp(&b.0))
    });
    let transpositions = groups
        .into_iter()
        .take(20)
        .map(|((ply, fen), mut routes)| {
            let games = routes
                .iter()
                .map(|i| nodes[*i].statistics.results.total())
                .sum();
            let route_count = routes.len() as u32;
            routes.sort_by(|a, b| {
                nodes[*b]
                    .statistics
                    .results
                    .total()
                    .cmp(&nodes[*a].statistics.results.total())
                    .then_with(|| path(&nodes, *a).cmp(&path(&nodes, *b)))
            });
            ReportTransposition {
                fen,
                ply,
                games,
                route_count,
                routes: routes
                    .into_iter()
                    .take(4)
                    .map(|i| ReportRoute {
                        moves: path(&nodes, i),
                        results: nodes[i].statistics.results.clone(),
                        example_offset: nodes[i].example,
                    })
                    .collect(),
            }
        })
        .collect();
    check()?;
    snapshot.check_revision()?;
    let query = &snapshot.query;
    Ok(OpeningReport {
        version: 2,
        generated_at: chrono::Utc::now().to_rfc3339(),
        database_name: snapshot
            .database
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        database_games: index.len() as u32,
        position: snapshot.summary.clone(),
        options,
        filters: ReportFilters {
            white_player: query.player1,
            black_player: query.player2,
            any_player: query.any_player,
            white_elo: query.range1,
            black_elo: query.range2,
            start_date: query.start_date.clone(),
            end_date: query.end_date.clone(),
            result: query.wanted_result.clone(),
        },
        statistics: statistics.finish(),
        years: years
            .into_iter()
            .map(|(year, results)| ReportYear { year, results })
            .collect(),
        unknown_year_games,
        elo_bands: ELO_BANDS
            .iter()
            .zip(elo_bands)
            .map(|(&(min_elo, max_elo), results)| ReportEloBand {
                min_elo,
                max_elo,
                results,
            })
            .collect(),
        unknown_elo_games,
        most_played_players,
        strongest_players,
        player_count,
        cohort: cohort.finish(),
        excluded_theory_games: excluded,
        theory,
        theory_line_count,
        displayed_theory_games,
        move_orders,
        move_order_count,
        transpositions,
        transposition_count,
        elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
        cache_hit: false,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn generate_opening_report(
    token: String,
    options: OpeningReportOptions,
    tab_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<OpeningReport, Error> {
    let snapshot = snapshot_for(&token, &state)?;
    validate_options(&snapshot, &options)?;
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
    preempt_background_searches(&state.active_position_searches);
    let run = async {
        let _report_permit = tokio::select! { guard=state.opening_report_request.lock()=>guard, _=request.cancelled()=>return Err(Error::SearchCancelled) };
        request.ensure_active("report-cache")?;
        if let Some(cached) = snapshot.report.lock().unwrap().as_ref().filter(|report|report.options==options) {
            snapshot.check_revision()?; let mut report=cached.clone(); report.cache_hit=true; return Ok(report);
        }
        let _permit = tokio::select! { permit=state.new_request.acquire()=>permit.unwrap(), _=request.cancelled()=>return Err(Error::SearchCancelled) };
        let build_lock = tokio::select! { lock=state.position_index_build.lock()=>lock, _=request.cancelled()=>return Err(Error::SearchCancelled) };
        let index_app=app.clone(); let database=snapshot.database.clone(); let flag=request.cancellation.clone();
        let index=tauri::async_runtime::spawn_blocking(move||open_index(&database,&index_app.state::<AppState>(),&||flag.cancelled.load(Ordering::Acquire),&|_|{})).await.map_err(|e|invalid(&e.to_string()))??;
        drop(build_lock); request.ensure_active("report-index")?; snapshot.check_revision()?;
        let report_snapshot=snapshot.clone(); let report_app=app.clone(); let owner=tab_id.clone(); let flag=request.cancellation.clone();
        let report=tauri::async_runtime::spawn_blocking(move||build_report(&report_snapshot,&index,options,&||flag.cancelled.load(Ordering::Acquire),&|progress| {
            let _=report_app.emit("search_progress",serde_json::json!({"id":owner,"requestId":sequence,"progress":progress,"finished":false}));
        })).await.map_err(|e|invalid(&e.to_string()))??;
        request.ensure_active("report-publication")?; snapshot.check_revision()?;
        *snapshot.report.lock().unwrap()=Some(report.clone()); Ok(report)
    }.await;
    let _ = app.emit(
        "search_progress",
        serde_json::json!({"id":tab_id,"requestId":sequence,"progress":100,"finished":true}),
    );
    run
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{encoding::encode_move, position_query::tests::snapshot, GameQuery};

    fn fixture() -> (tempfile::TempDir, std::path::PathBuf, AppState) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("report.db3");
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch(include_str!("create.sql")).unwrap();
        for (id, name) in [
            (1, "Ana"),
            (2, "Boris"),
            (3, "Clara"),
            (4, "Diego"),
            (5, "Eva"),
            (6, "Fabio"),
        ] {
            db.execute(
                "INSERT INTO Players (ID,Name) VALUES (?1,?2)",
                rusqlite::params![id, name],
            )
            .unwrap();
        }
        let games = [
            ("d4 d5 Nf3 Nf6 c4 e6", 2500, "1-0", Some("2022.01.01"), 1, 2),
            (
                "Nf3 d5 d4 Nf6 c4 e6",
                2600,
                "1/2-1/2",
                Some("2024.??.??"),
                1,
                3,
            ),
            ("d4 Nf6 Nf3 d5 c4 e6", 2450, "0-1", None, 4, 1),
            ("e4 e5 Nf3 Nc6 Bc4 Nf6", 1000, "*", Some("????.??.??"), 5, 6),
        ];
        for (i, (moves, elo, result, date, white_id, black_id)) in games.into_iter().enumerate() {
            let mut chess = Chess::default();
            let mut bytes = Vec::new();
            for san in moves.split_whitespace() {
                let movement = san
                    .parse::<shakmaty::san::San>()
                    .unwrap()
                    .to_move(&chess)
                    .unwrap();
                bytes.push(encode_move(&movement, &chess).unwrap());
                chess.play_unchecked(&movement);
            }
            let material = super::super::get_material_count(chess.board());
            db.execute("INSERT INTO Games (ID,EventID,SiteID,WhiteID,BlackID,Date,WhiteElo,BlackElo,WhiteMaterial,BlackMaterial,Result,PlyCount,Moves,PawnHome) VALUES (?1,0,0,?2,?3,?4,?5,?5,?6,?7,?8,6,?9,?10)",rusqlite::params![i as i32+1,white_id,black_id,date,elo,material.white,material.black,result,bytes,super::super::get_pawn_home(chess.board())]).unwrap();
        }
        drop(db);
        (dir, path, AppState::default())
    }
    fn query(fen: &str) -> GameQuery {
        GameQuery::new().position(PositionQueryJs {
            fen: fen.into(),
            type_: "exact".into(),
        })
    }
    fn options(fen: &str) -> OpeningReportOptions {
        OpeningReportOptions {
            depth: 6,
            theory_games: 3,
            max_lines: 64,
            display_fen: fen.into(),
        }
    }
    fn run(
        path: &std::path::Path,
        state: &AppState,
        query: GameQuery,
        options: OpeningReportOptions,
    ) -> OpeningReport {
        let snapshot = snapshot(path, state, query);
        let index = open_index(path, state, &|| false, &|_| {}).unwrap();
        build_report(&snapshot, &index, options, &|| false, &|_| {}).unwrap()
    }

    #[test]
    fn all_statistics_are_separate_from_ranked_theory_and_convergences() {
        let (_dir, path, state) = fixture();
        let fen = Fen::default().to_string();
        let report = run(&path, &state, query(&fen), options(&fen));
        assert_eq!(report.position.total, 4);
        assert_eq!(report.statistics.results.unknown, 1);
        assert_eq!(report.cohort.results.total(), 3);
        assert_eq!(report.cohort.results.unknown, 0);
        assert_eq!(report.theory_line_count, 3);
        assert_eq!(report.displayed_theory_games, 3);
        assert_eq!(report.unknown_year_games, 2);
        assert_eq!(report.player_count, 6);
        let ana = &report.most_played_players[0];
        assert_eq!((ana.name.as_str(), ana.games), ("Ana", 3));
        assert_eq!((ana.white_games, ana.black_games), (2, 1));
        assert_eq!((ana.wins, ana.draws, ana.losses, ana.unknown), (2, 1, 0, 0));
        assert_eq!(ana.peak_elo, Some(2600));
        assert!((ana.average_elo.unwrap() - 2516.666).abs() < 0.01);
        assert_eq!(report.strongest_players[0].name, "Ana");
        assert_eq!(
            report
                .elo_bands
                .iter()
                .map(|band| band.results.total())
                .sum::<u32>(),
            4
        );
        assert_eq!(report.unknown_elo_games, 0);
        assert_eq!(
            report.years.iter().map(|y| y.year).collect::<Vec<_>>(),
            vec![2022, 2024]
        );
        let convergence = report
            .transpositions
            .iter()
            .find(|group| group.ply == 4)
            .unwrap();
        assert_eq!(convergence.route_count, 3);
        assert_eq!(convergence.games, 3);
        assert!(report.theory.iter().all(|line| line.example.id != 4));
        assert_eq!(report.move_order_count, 1);
        assert!(report.move_orders[0].moves.is_empty());
    }

    #[test]
    fn arrival_orders_keep_transpositions_before_the_root_and_respect_filters() {
        let (_dir, path, state) = fixture();
        let fen = "rnbqkb1r/ppp1pppp/5n2/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R w KQkq - 2 3";
        let report = run(&path, &state, query(fen), options(fen));
        assert_eq!(report.position.total, 3);
        assert_eq!(report.move_order_count, 3);
        assert_eq!(report.theory.len(), 1);
        assert_eq!(report.theory[0].moves, vec!["c4", "e6"]);
        assert_eq!(report.theory[0].example.id, 2); // Highest mean Elo, independent of query order.
        let mut filtered = query(fen);
        filtered.wanted_result = Some("whitewon".into());
        assert_eq!(run(&path, &state, filtered, options(fen)).position.total, 1);
        let mut filtered = query(fen);
        filtered.any_player = Some(1);
        assert_eq!(run(&path, &state, filtered, options(fen)).position.total, 3);
        let mut filtered = query(fen);
        filtered.range1 = Some((2500, 2600));
        filtered.range2 = Some((2500, 2600));
        assert_eq!(run(&path, &state, filtered, options(fen)).position.total, 2);
    }

    #[test]
    fn theory_limits_are_explicit_and_selection_is_deterministic() {
        let (_dir, path, state) = fixture();
        let fen = Fen::default().to_string();
        let mut limits = options(&fen);
        limits.max_lines = 1;
        let report = run(&path, &state, query(&fen), limits.clone());
        let repeated = run(&path, &state, query(&fen), limits);
        assert_eq!(report.theory.len(), 1);
        assert_eq!(report.theory_line_count, 3);
        assert_eq!(report.displayed_theory_games, 1);
        assert_eq!(report.theory[0].moves, repeated.theory[0].moves);
        let mut limits = options(&fen);
        limits.theory_games = 1;
        assert_eq!(
            run(&path, &state, query(&fen), limits).theory[0].example.id,
            2
        );
    }

    #[test]
    fn cancellation_expired_sources_and_mismatched_positions_do_not_publish_reports() {
        let (_dir, path, state) = fixture();
        let fen = Fen::default().to_string();
        let snapshot = snapshot(&path, &state, query(&fen));
        let index = open_index(&path, &state, &|| false, &|_| {}).unwrap();
        assert!(matches!(
            build_report(&snapshot, &index, options(&fen), &|| true, &|_| {}),
            Err(Error::SearchCancelled)
        ));
        assert!(snapshot.report.lock().unwrap().is_none());
        let mut invalid = options(&fen);
        invalid.depth = 17;
        assert!(build_report(&snapshot, &index, invalid, &|| false, &|_| {}).is_err());
        let mut invalid = options(&fen);
        invalid.display_fen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1".into();
        assert!(build_report(&snapshot, &index, invalid, &|| false, &|_| {}).is_err());
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute("UPDATE Games SET WhiteElo=2700 WHERE ID=1", [])
            .unwrap();
        assert!(build_report(&snapshot, &index, options(&fen), &|| false, &|_| {}).is_err());
    }

    #[test]
    fn corrupt_continuations_are_excluded_only_from_theory_and_empty_reports_are_valid() {
        let (_dir, path, state) = fixture();
        let fen = Fen::default().to_string();
        let db = rusqlite::Connection::open(&path).unwrap();
        // Preserve the first valid move so the root query includes the game; corrupt only its continuation.
        let mut bytes: Vec<u8> = db
            .query_row("SELECT Moves FROM Games WHERE ID=2", [], |row| row.get(0))
            .unwrap();
        bytes[2] = 240;
        db.execute("UPDATE Games SET Moves=?1 WHERE ID=2", [bytes])
            .unwrap();
        drop(db);
        let report = run(&path, &state, query(&fen), options(&fen));
        assert_eq!(report.position.total, 4);
        assert_eq!(report.excluded_theory_games, 1);
        assert_eq!(report.cohort.results.total(), 2);
        let mut empty = query(&fen);
        empty.player1 = Some(999);
        let report = run(&path, &state, empty, options(&fen));
        assert_eq!(report.position.total, 0);
        assert!(report.theory.is_empty());
        assert!(report.statistics.average_white_elo.is_none());
    }

    #[test]
    #[ignore = "read-only report benchmark; requires CHESS_LAB_BENCH_DB"]
    fn benchmark_real_opening_report() {
        let path = std::path::PathBuf::from(std::env::var("CHESS_LAB_BENCH_DB").unwrap());
        let state = AppState::default();
        let fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
        // Read the existing index only. Never regenerate or modify a user's database for a benchmark.
        let index = MmapSearchIndex::open(super::super::get_index_path(&path)).unwrap();
        let snapshot = super::super::position_query::benchmark_snapshot(&path, query(fen), &index);
        let mut options = options(fen);
        options.depth = 12;
        options.theory_games = 5000;
        let report = build_report(&snapshot, &index, options.clone(), &|| false, &|_| {}).unwrap();
        eprintln!("report matches={} players={} frequent={} strongest={} elo_bands={} cohort={} lines={} orders={} transpositions={} excluded={} elapsed_ms={} json_bytes={}",report.position.total,report.player_count,report.most_played_players.len(),report.strongest_players.len(),report.elo_bands.len(),report.cohort.results.total(),report.theory_line_count,report.move_order_count,report.transposition_count,report.excluded_theory_games,report.elapsed_ms,serde_json::to_vec(&report).unwrap().len());
        let mut timings = vec![report.elapsed_ms];
        for _ in 0..4 {
            timings.push(
                build_report(&snapshot, &index, options.clone(), &|| false, &|_| {})
                    .unwrap()
                    .elapsed_ms,
            );
        }
        timings.sort_by(f64::total_cmp);
        eprintln!(
            "report_n=5 p50_ms={} p95_ms={} all_ms={:?}",
            timings[2], timings[4], timings
        );
        let started = Instant::now();
        assert!(matches!(
            build_report(
                &snapshot,
                &index,
                options,
                &|| started.elapsed() > Duration::from_millis(100),
                &|_| {}
            ),
            Err(Error::SearchCancelled)
        ));
        eprintln!(
            "report_cancel_total_ms={}",
            started.elapsed().as_secs_f64() * 1000.0
        );
        drop(state);
    }
}
