use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering as AtomicOrdering},
        Arc,
    },
};

use chrono::{SecondsFormat, Utc};
use dashmap::DashMap;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;
use tokio::{
    sync::RwLock,
    task::JoinSet,
    time::{sleep, Duration},
};

use crate::{
    error::Error,
    game::{
        GameConfig, GameEndReason, GameManager, GameManifest, GameResult, GameStatus,
        OpeningBookConfig, PlayerConfig, PlayerPresetCategory, TimeControl,
    },
};

const BOT_LEAGUE_SCHEMA_VERSION: u32 = 1;
const BOT_LEAGUES_DIRECTORY: &str = "bot-leagues-v1";
const STANDARD_INITIAL_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MAX_LEAGUE_PLAYERS: usize = 15;
const MAX_GAMES_PER_PAIR: u32 = 20;
const MAX_LEAGUE_GAMES: u32 = 1_000;
const MAX_LEAGUE_CONCURRENCY: u32 = 16;
const MAX_LEAGUE_RETRIES: u32 = 5;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BotLeaguePlayer {
    pub profile_id: String,
    pub name: String,
    pub target_elo: u32,
    pub profile_version: u32,
    pub catalog_version: String,
    pub config: PlayerConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BotLeagueConfig {
    pub owner_id: String,
    pub players: Vec<BotLeaguePlayer>,
    pub games_per_pair: u32,
    pub alternate_colors: bool,
    pub base_seed: u32,
    pub seed_step: u32,
    pub requested_concurrency: u32,
    pub max_cpu_threads: u32,
    pub max_memory_mb: u32,
    pub max_retries: u32,
    pub time_control: Option<TimeControl>,
    pub opening_book: Option<OpeningBookConfig>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BotLeagueStatus {
    Running,
    Paused,
    Cancelling,
    Completed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BotLeagueGameStatus {
    Completed,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BotLeagueGameResult {
    pub index: u32,
    pub pair_index: u32,
    pub round: u32,
    pub game_id: String,
    pub white_profile_id: String,
    pub black_profile_id: String,
    pub white_player: String,
    pub black_player: String,
    pub white_seed: Option<u32>,
    pub black_seed: Option<u32>,
    pub attempts: u32,
    pub status: BotLeagueGameStatus,
    pub result: Option<GameResult>,
    pub plies: u32,
    pub error: Option<String>,
    pub artifact_available: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BotLeagueStanding {
    pub profile_id: String,
    pub name: String,
    pub target_elo: u32,
    pub games: u32,
    pub white_games: u32,
    pub black_games: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    pub points: f64,
    pub score_percent: f64,
    pub estimated_elo: Option<i32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BotLeagueState {
    pub league_id: String,
    pub owner_id: String,
    pub status: BotLeagueStatus,
    pub total_games: u32,
    pub completed_games: u32,
    pub failed_games: u32,
    pub active_games: Vec<String>,
    pub queued_games: u32,
    pub effective_concurrency: u32,
    pub estimated_threads_per_game: u32,
    pub estimated_hash_mb_per_game: u32,
    pub results: Vec<BotLeagueGameResult>,
    pub standings: Vec<BotLeagueStanding>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BotLeaguePlayerSummary {
    pub profile_id: String,
    pub name: String,
    pub target_elo: u32,
    pub profile_version: u32,
    pub catalog_version: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BotLeagueSummary {
    pub league_id: String,
    pub owner_id: String,
    pub status: BotLeagueStatus,
    pub created_at: String,
    pub updated_at: String,
    pub players: Vec<BotLeaguePlayerSummary>,
    pub games_per_pair: u32,
    pub total_games: u32,
    pub completed_games: u32,
    pub failed_games: u32,
    pub recorded_games: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BotLeagueDetail {
    pub summary: BotLeagueSummary,
    pub config: BotLeagueConfig,
    pub results: Vec<BotLeagueGameResult>,
    pub standings: Vec<BotLeagueStanding>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BotLeagueGameArtifact {
    pub league_id: String,
    pub index: u32,
    pub pgn: String,
}

#[derive(Clone, Debug, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct BotLeagueEvent {
    pub state: BotLeagueState,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredBotLeagueManifest {
    schema_version: u32,
    application_version: String,
    summary: BotLeagueSummary,
    config: BotLeagueConfig,
    results: Vec<BotLeagueGameResult>,
    standings: Vec<BotLeagueStanding>,
}

#[derive(Clone)]
struct LeagueFixture {
    index: u32,
    pair_index: u32,
    round: u32,
    white: BotLeaguePlayer,
    black: BotLeaguePlayer,
}

struct LeagueEntry {
    config: BotLeagueConfig,
    fixtures: Vec<LeagueFixture>,
    created_at: String,
    state: RwLock<BotLeagueState>,
    paused: AtomicBool,
    cancelled: AtomicBool,
}

pub struct BotLeagueManager {
    leagues: DashMap<String, Arc<LeagueEntry>>,
}

impl BotLeagueManager {
    pub fn new() -> Self {
        Self {
            leagues: DashMap::new(),
        }
    }

    pub async fn start_league(
        &self,
        league_id: String,
        config: BotLeagueConfig,
        game_manager: Arc<GameManager>,
        app: AppHandle,
    ) -> Result<BotLeagueState, Error> {
        validate_league_config(&config)?;
        let fixtures = build_fixtures(&config);
        let resources = calculate_resource_plan(&config)?;
        let state = BotLeagueState {
            league_id: league_id.clone(),
            owner_id: config.owner_id.clone(),
            status: BotLeagueStatus::Running,
            total_games: fixtures.len() as u32,
            completed_games: 0,
            failed_games: 0,
            active_games: Vec::new(),
            queued_games: fixtures.len() as u32,
            effective_concurrency: resources.effective_concurrency,
            estimated_threads_per_game: resources.threads_per_game,
            estimated_hash_mb_per_game: resources.hash_mb_per_game,
            results: Vec::new(),
            standings: calculate_standings(&config.players, &[]),
        };
        let created_at = now();
        create_league(&app, &league_id, &config, &state, &created_at)?;

        let entry = Arc::new(LeagueEntry {
            config,
            fixtures,
            created_at,
            state: RwLock::new(state.clone()),
            paused: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
        });
        if let Some(previous) = self.leagues.insert(league_id, entry.clone()) {
            previous.cancelled.store(true, AtomicOrdering::SeqCst);
        }
        tokio::spawn(run_league(entry, game_manager, app));
        Ok(state)
    }

    pub async fn get_league(&self, league_id: &str) -> Result<BotLeagueState, Error> {
        let entry = self
            .leagues
            .get(league_id)
            .ok_or_else(|| Error::BotLeagueNotFound(league_id.to_string()))?
            .clone();
        let state = entry.state.read().await.clone();
        Ok(state)
    }

    pub async fn pause_league(&self, league_id: &str) -> Result<BotLeagueState, Error> {
        let entry = self.get_entry(league_id)?;
        entry.paused.store(true, AtomicOrdering::SeqCst);
        let mut state = entry.state.write().await;
        if state.status == BotLeagueStatus::Running {
            state.status = BotLeagueStatus::Paused;
        }
        Ok(state.clone())
    }

    pub async fn resume_league(&self, league_id: &str) -> Result<BotLeagueState, Error> {
        let entry = self.get_entry(league_id)?;
        entry.paused.store(false, AtomicOrdering::SeqCst);
        let mut state = entry.state.write().await;
        if state.status == BotLeagueStatus::Paused {
            state.status = BotLeagueStatus::Running;
        }
        Ok(state.clone())
    }

    pub async fn cancel_league(
        &self,
        league_id: &str,
        game_manager: &GameManager,
    ) -> Result<BotLeagueState, Error> {
        let entry = self.get_entry(league_id)?;
        entry.cancelled.store(true, AtomicOrdering::SeqCst);
        let active_games = {
            let mut state = entry.state.write().await;
            if matches!(
                state.status,
                BotLeagueStatus::Running | BotLeagueStatus::Paused
            ) {
                state.status = BotLeagueStatus::Cancelling;
            }
            state.active_games.clone()
        };
        for game_id in active_games {
            let _ = game_manager.abort_game(&game_id).await;
        }
        let state = entry.state.read().await.clone();
        Ok(state)
    }

    pub async fn cancel_owner_leagues(
        &self,
        owner_id: &str,
        game_manager: &GameManager,
    ) -> Result<(), Error> {
        let league_ids: Vec<String> = self
            .leagues
            .iter()
            .filter_map(|league| {
                (league.value().config.owner_id == owner_id).then(|| league.key().clone())
            })
            .collect();
        for league_id in league_ids {
            let state = self.get_league(&league_id).await?;
            if matches!(
                state.status,
                BotLeagueStatus::Running | BotLeagueStatus::Paused | BotLeagueStatus::Cancelling
            ) {
                self.cancel_league(&league_id, game_manager).await?;
            }
            self.leagues.remove(&league_id);
        }
        Ok(())
    }

    pub async fn dismiss_league(&self, league_id: &str) -> Result<(), Error> {
        let state = self.get_league(league_id).await?;
        if !matches!(
            state.status,
            BotLeagueStatus::Completed | BotLeagueStatus::Cancelled
        ) {
            return Err(Error::InvalidBotLeague(
                "only a completed or cancelled league can be dismissed".to_string(),
            ));
        }
        self.leagues.remove(league_id);
        Ok(())
    }

    pub fn cancel_all_sync(&self) {
        for league in self.leagues.iter() {
            league.value().cancelled.store(true, AtomicOrdering::SeqCst);
        }
    }

    fn get_entry(&self, league_id: &str) -> Result<Arc<LeagueEntry>, Error> {
        self.leagues
            .get(league_id)
            .map(|entry| entry.clone())
            .ok_or_else(|| Error::BotLeagueNotFound(league_id.to_string()))
    }
}

impl Default for BotLeagueManager {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy)]
struct ResourcePlan {
    threads_per_game: u32,
    hash_mb_per_game: u32,
    effective_concurrency: u32,
}

fn validate_league_config(config: &BotLeagueConfig) -> Result<(), Error> {
    if !(2..=MAX_LEAGUE_PLAYERS).contains(&config.players.len()) {
        return Err(Error::InvalidBotLeague(format!(
            "league must contain between 2 and {MAX_LEAGUE_PLAYERS} players"
        )));
    }
    if !(1..=MAX_GAMES_PER_PAIR).contains(&config.games_per_pair) {
        return Err(Error::InvalidBotLeague(format!(
            "games per pair must be between 1 and {MAX_GAMES_PER_PAIR}"
        )));
    }
    let total_games =
        (config.players.len() * (config.players.len() - 1) / 2) as u32 * config.games_per_pair;
    if total_games > MAX_LEAGUE_GAMES {
        return Err(Error::InvalidBotLeague(format!(
            "league would contain {total_games} games; the limit is {MAX_LEAGUE_GAMES}"
        )));
    }
    if !(1..=MAX_LEAGUE_CONCURRENCY).contains(&config.requested_concurrency) {
        return Err(Error::InvalidBotLeague(format!(
            "concurrency must be between 1 and {MAX_LEAGUE_CONCURRENCY}"
        )));
    }
    if config.max_retries > MAX_LEAGUE_RETRIES {
        return Err(Error::InvalidBotLeague(format!(
            "retries cannot exceed {MAX_LEAGUE_RETRIES}"
        )));
    }
    if config.max_cpu_threads == 0 || config.max_memory_mb == 0 {
        return Err(Error::InvalidBotLeague(
            "CPU and memory budgets must be greater than zero".to_string(),
        ));
    }

    let mut ids = HashSet::new();
    for player in &config.players {
        if player.profile_id.trim().is_empty()
            || !ids.insert(player.profile_id.clone())
            || player.name.trim().is_empty()
            || player.catalog_version.trim().is_empty()
        {
            return Err(Error::InvalidBotLeague(
                "players must have unique profile IDs, names, and catalog versions".to_string(),
            ));
        }
        match &player.config {
            PlayerConfig::Engine {
                name,
                path,
                preset_category,
                ..
            } if !name.trim().is_empty()
                && !path.trim().is_empty()
                && *preset_category == PlayerPresetCategory::HumanLike => {}
            _ => {
                return Err(Error::InvalidBotLeague(
                    "all league participants must be human-like engine configurations".to_string(),
                ));
            }
        }
    }
    Ok(())
}

fn calculate_resource_plan(config: &BotLeagueConfig) -> Result<ResourcePlan, Error> {
    let threads_per_game = config
        .players
        .iter()
        .map(|player| player_option_u32(&player.config, "Threads", 1))
        .max()
        .unwrap_or(1)
        .saturating_mul(2)
        .max(1);
    let hash_mb_per_game = config
        .players
        .iter()
        .map(|player| player_option_u32(&player.config, "Hash", 16))
        .max()
        .unwrap_or(16)
        .saturating_mul(2)
        .max(1);

    if config.max_cpu_threads < threads_per_game {
        return Err(Error::InvalidBotLeague(format!(
            "one game requests {threads_per_game} CPU threads, above the league budget of {}",
            config.max_cpu_threads
        )));
    }
    if config.max_memory_mb < hash_mb_per_game {
        return Err(Error::InvalidBotLeague(format!(
            "one game requests {hash_mb_per_game} MB of Hash, above the league budget of {} MB",
            config.max_memory_mb
        )));
    }

    let cpu_slots = config.max_cpu_threads / threads_per_game;
    let memory_slots = config.max_memory_mb / hash_mb_per_game;
    let effective_concurrency = config
        .requested_concurrency
        .min(cpu_slots)
        .min(memory_slots)
        .max(1);
    Ok(ResourcePlan {
        threads_per_game,
        hash_mb_per_game,
        effective_concurrency,
    })
}

fn player_option_u32(player: &PlayerConfig, name: &str, default: u32) -> u32 {
    let PlayerConfig::Engine { options, .. } = player else {
        return default;
    };
    options
        .iter()
        .find(|option| option.name.eq_ignore_ascii_case(name))
        .and_then(|option| option.value.parse::<u32>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

fn player_name(player: &PlayerConfig) -> String {
    match player {
        PlayerConfig::Human { name } | PlayerConfig::Engine { name, .. } => name.clone(),
    }
}

fn player_seed(player: &PlayerConfig) -> Option<u32> {
    match player {
        PlayerConfig::Engine { seed, .. } => *seed,
        PlayerConfig::Human { .. } => None,
    }
}

fn set_game_seed(player: &mut PlayerConfig, offset: u32, slot: u32) {
    if let PlayerConfig::Engine { seed, .. } = player {
        *seed = Some(seed.unwrap_or(0).wrapping_add(offset).wrapping_add(slot));
    }
}

fn build_fixtures(config: &BotLeagueConfig) -> Vec<LeagueFixture> {
    let mut fixtures = Vec::new();
    let mut index = 0;
    let mut pair_index = 0;
    for white_index in 0..config.players.len() {
        for black_index in (white_index + 1)..config.players.len() {
            for round in 0..config.games_per_pair {
                let (white, black) = if config.alternate_colors && round % 2 == 1 {
                    (
                        config.players[black_index].clone(),
                        config.players[white_index].clone(),
                    )
                } else {
                    (
                        config.players[white_index].clone(),
                        config.players[black_index].clone(),
                    )
                };
                fixtures.push(LeagueFixture {
                    index,
                    pair_index,
                    round: round + 1,
                    white,
                    black,
                });
                index += 1;
            }
            pair_index += 1;
        }
    }
    fixtures
}

fn game_config_for_fixture(config: &BotLeagueConfig, fixture: &LeagueFixture) -> GameConfig {
    let offset = config
        .base_seed
        .wrapping_add(fixture.index.wrapping_mul(config.seed_step));
    let mut white = fixture.white.config.clone();
    let mut black = fixture.black.config.clone();
    set_game_seed(&mut white, offset, 0);
    set_game_seed(&mut black, offset, 1);
    GameConfig {
        white,
        black,
        white_time_control: config.time_control.clone(),
        black_time_control: config.time_control.clone(),
        initial_fen: None,
        initial_moves: Vec::new(),
        opening_book: config.opening_book.clone(),
    }
}

enum TaskOutcome {
    Completed(BotLeagueGameResult),
    Failed(BotLeagueGameResult),
    Cancelled { game_id: String },
}

async fn run_league(entry: Arc<LeagueEntry>, game_manager: Arc<GameManager>, app: AppHandle) {
    let concurrency = entry.state.read().await.effective_concurrency as usize;
    let mut next_index = 0_usize;
    let mut tasks = JoinSet::new();

    loop {
        if entry.cancelled.load(AtomicOrdering::SeqCst) {
            let active = entry.state.read().await.active_games.clone();
            for game_id in active {
                let _ = game_manager.abort_game(&game_id).await;
            }
        }

        while !entry.cancelled.load(AtomicOrdering::SeqCst)
            && !entry.paused.load(AtomicOrdering::SeqCst)
            && tasks.len() < concurrency
            && next_index < entry.fixtures.len()
        {
            let fixture = entry.fixtures[next_index].clone();
            next_index += 1;
            let game_id = format!(
                "{}-game-{}",
                entry.state.read().await.league_id,
                fixture.index + 1
            );
            {
                let mut state = entry.state.write().await;
                state.active_games.push(game_id.clone());
                state.queued_games = state.total_games.saturating_sub(next_index as u32);
            }
            emit_state(&entry, &app).await;

            let task_entry = entry.clone();
            let task_manager = game_manager.clone();
            let task_app = app.clone();
            tasks.spawn(async move {
                run_league_game(fixture, game_id, task_entry, task_manager, task_app).await
            });
        }

        if tasks.is_empty() {
            if entry.cancelled.load(AtomicOrdering::SeqCst) || next_index >= entry.fixtures.len() {
                break;
            }
            sleep(Duration::from_millis(100)).await;
            continue;
        }

        tokio::select! {
            outcome = tasks.join_next() => {
                if let Some(Ok(outcome)) = outcome {
                    record_task_outcome(&entry, outcome).await;
                    if let Err(error) = update_league(&app, &entry).await {
                        log::error!("Could not update bot league: {error}");
                    }
                    emit_state(&entry, &app).await;
                }
            }
            _ = sleep(Duration::from_millis(100)) => {}
        }
    }

    let mut state = entry.state.write().await;
    state.active_games.clear();
    state.queued_games = 0;
    state.status = if entry.cancelled.load(AtomicOrdering::SeqCst) {
        BotLeagueStatus::Cancelled
    } else {
        BotLeagueStatus::Completed
    };
    drop(state);
    if let Err(error) = update_league(&app, &entry).await {
        log::error!("Could not finalize bot league: {error}");
    }
    emit_state(&entry, &app).await;
}

async fn run_league_game(
    fixture: LeagueFixture,
    game_id: String,
    entry: Arc<LeagueEntry>,
    game_manager: Arc<GameManager>,
    app: AppHandle,
) -> TaskOutcome {
    let config = game_config_for_fixture(&entry.config, &fixture);
    let white_player = player_name(&config.white);
    let black_player = player_name(&config.black);
    let white_seed = player_seed(&config.white);
    let black_seed = player_seed(&config.black);
    let mut last_error = None;

    for attempt in 1..=entry.config.max_retries + 1 {
        if entry.cancelled.load(AtomicOrdering::SeqCst) {
            return TaskOutcome::Cancelled { game_id };
        }

        match game_manager
            .start_game(game_id.clone(), config.clone(), app.clone())
            .await
        {
            Ok(_) => loop {
                if entry.cancelled.load(AtomicOrdering::SeqCst) {
                    let _ = game_manager.abort_game(&game_id).await;
                    return TaskOutcome::Cancelled { game_id };
                }
                match game_manager.get_game_state(&game_id).await {
                    Ok(state) => {
                        if let GameStatus::Finished { result } = state.status {
                            let retryable = is_retryable_result(&result);
                            let primary = !retryable || attempt > entry.config.max_retries;
                            let manifest = persist_game_artifact(
                                &app,
                                &entry.state.read().await.league_id,
                                fixture.index,
                                attempt,
                                &game_id,
                                &game_manager,
                                primary,
                            )
                            .await;
                            let _ = game_manager.abort_game(&game_id).await;
                            let artifact_available = manifest.is_ok() && primary;
                            if let Err(error) = manifest {
                                log::error!("Could not persist bot league game {game_id}: {error}");
                            }
                            if retryable {
                                last_error = Some("engine abandoned the game".to_string());
                                if attempt <= entry.config.max_retries {
                                    break;
                                }
                                return TaskOutcome::Failed(BotLeagueGameResult {
                                    index: fixture.index,
                                    pair_index: fixture.pair_index,
                                    round: fixture.round,
                                    game_id,
                                    white_profile_id: fixture.white.profile_id,
                                    black_profile_id: fixture.black.profile_id,
                                    white_player,
                                    black_player,
                                    white_seed,
                                    black_seed,
                                    attempts: attempt,
                                    status: BotLeagueGameStatus::Failed,
                                    result: Some(result),
                                    plies: state.ply,
                                    error: last_error,
                                    artifact_available,
                                });
                            }
                            return TaskOutcome::Completed(BotLeagueGameResult {
                                index: fixture.index,
                                pair_index: fixture.pair_index,
                                round: fixture.round,
                                game_id,
                                white_profile_id: fixture.white.profile_id,
                                black_profile_id: fixture.black.profile_id,
                                white_player,
                                black_player,
                                white_seed,
                                black_seed,
                                attempts: attempt,
                                status: BotLeagueGameStatus::Completed,
                                result: Some(result),
                                plies: state.ply,
                                error: None,
                                artifact_available,
                            });
                        }
                    }
                    Err(error) => {
                        last_error = Some(error.to_string());
                        break;
                    }
                }
                sleep(Duration::from_millis(100)).await;
            },
            Err(error) => {
                last_error = Some(error.to_string());
            }
        }
        let _ = game_manager.abort_game(&game_id).await;
    }

    TaskOutcome::Failed(BotLeagueGameResult {
        index: fixture.index,
        pair_index: fixture.pair_index,
        round: fixture.round,
        game_id,
        white_profile_id: fixture.white.profile_id,
        black_profile_id: fixture.black.profile_id,
        white_player,
        black_player,
        white_seed,
        black_seed,
        attempts: entry.config.max_retries + 1,
        status: BotLeagueGameStatus::Failed,
        result: None,
        plies: 0,
        error: last_error,
        artifact_available: false,
    })
}

fn is_retryable_result(result: &GameResult) -> bool {
    matches!(
        result,
        GameResult::WhiteWins {
            reason: GameEndReason::Abandonment
        } | GameResult::BlackWins {
            reason: GameEndReason::Abandonment
        }
    )
}

async fn record_task_outcome(entry: &LeagueEntry, outcome: TaskOutcome) {
    let mut state = entry.state.write().await;
    match outcome {
        TaskOutcome::Completed(result) => {
            state.active_games.retain(|id| id != &result.game_id);
            state.completed_games += 1;
            state.results.push(result);
        }
        TaskOutcome::Failed(result) => {
            state.active_games.retain(|id| id != &result.game_id);
            state.failed_games += 1;
            state.results.push(result);
        }
        TaskOutcome::Cancelled { game_id } => {
            state.active_games.retain(|id| id != &game_id);
        }
    }
    state.results.sort_by_key(|result| result.index);
    state.standings = calculate_standings_from_results(&entry.config.players, &state.results);
}

async fn emit_state(entry: &LeagueEntry, app: &AppHandle) {
    let state = entry.state.read().await.clone();
    let _ = BotLeagueEvent { state }.emit(app);
}

#[derive(Default)]
struct StandingAccumulator {
    games: u32,
    white_games: u32,
    black_games: u32,
    wins: u32,
    draws: u32,
    losses: u32,
    points: f64,
    opponent_elo_sum: u64,
}

fn calculate_standings(
    players: &[BotLeaguePlayer],
    results: &[BotLeagueGameResult],
) -> Vec<BotLeagueStanding> {
    calculate_standings_from_results(players, results)
}

fn calculate_standings_from_results(
    players: &[BotLeaguePlayer],
    results: &[BotLeagueGameResult],
) -> Vec<BotLeagueStanding> {
    let mut by_id = HashMap::new();
    for player in players {
        by_id.insert(player.profile_id.clone(), StandingAccumulator::default());
    }
    let player_by_id: HashMap<&str, &BotLeaguePlayer> = players
        .iter()
        .map(|player| (player.profile_id.as_str(), player))
        .collect();

    for result in results
        .iter()
        .filter(|result| result.status == BotLeagueGameStatus::Completed)
    {
        if !by_id.contains_key(&result.white_profile_id)
            || !by_id.contains_key(&result.black_profile_id)
        {
            continue;
        }
        let black_elo = player_by_id
            .get(result.black_profile_id.as_str())
            .map(|player| player.target_elo as u64)
            .unwrap_or_default();
        let white_elo = player_by_id
            .get(result.white_profile_id.as_str())
            .map(|player| player.target_elo as u64)
            .unwrap_or_default();
        if let Some(white) = by_id.get_mut(&result.white_profile_id) {
            white.games += 1;
            white.white_games += 1;
            white.opponent_elo_sum += black_elo;
        }
        if let Some(black) = by_id.get_mut(&result.black_profile_id) {
            black.games += 1;
            black.black_games += 1;
            black.opponent_elo_sum += white_elo;
        }
        match result.result {
            Some(GameResult::WhiteWins { .. }) => {
                if let Some(white) = by_id.get_mut(&result.white_profile_id) {
                    white.wins += 1;
                    white.points += 1.0;
                }
                if let Some(black) = by_id.get_mut(&result.black_profile_id) {
                    black.losses += 1;
                }
            }
            Some(GameResult::BlackWins { .. }) => {
                if let Some(white) = by_id.get_mut(&result.white_profile_id) {
                    white.losses += 1;
                }
                if let Some(black) = by_id.get_mut(&result.black_profile_id) {
                    black.wins += 1;
                    black.points += 1.0;
                }
            }
            Some(GameResult::Draw { .. }) => {
                if let Some(white) = by_id.get_mut(&result.white_profile_id) {
                    white.draws += 1;
                    white.points += 0.5;
                }
                if let Some(black) = by_id.get_mut(&result.black_profile_id) {
                    black.draws += 1;
                    black.points += 0.5;
                }
            }
            None => {}
        }
    }

    let mut standings: Vec<_> = players
        .iter()
        .map(|player| {
            let accumulator = by_id.remove(&player.profile_id).unwrap_or_default();
            let score_percent = if accumulator.games == 0 {
                0.0
            } else {
                accumulator.points / accumulator.games as f64 * 100.0
            };
            let estimated_elo = if accumulator.games == 0 {
                None
            } else {
                let score = (accumulator.points / accumulator.games as f64).clamp(0.05, 0.95);
                let average_opponent =
                    accumulator.opponent_elo_sum as f64 / accumulator.games as f64;
                Some((average_opponent + 400.0 * (score / (1.0 - score)).log10()).round() as i32)
            };
            BotLeagueStanding {
                profile_id: player.profile_id.clone(),
                name: player.name.clone(),
                target_elo: player.target_elo,
                games: accumulator.games,
                white_games: accumulator.white_games,
                black_games: accumulator.black_games,
                wins: accumulator.wins,
                draws: accumulator.draws,
                losses: accumulator.losses,
                points: accumulator.points,
                score_percent,
                estimated_elo,
            }
        })
        .collect();
    standings.sort_by(|left, right| {
        right
            .points
            .partial_cmp(&left.points)
            .unwrap_or(Ordering::Equal)
            .then_with(|| {
                right
                    .score_percent
                    .partial_cmp(&left.score_percent)
                    .unwrap_or(Ordering::Equal)
            })
            .then_with(|| right.target_elo.cmp(&left.target_elo))
    });
    standings
}

async fn update_league(app: &AppHandle, entry: &LeagueEntry) -> Result<(), Error> {
    let state = entry.state.read().await.clone();
    let manifest = stored_manifest(&entry.config, &state, &entry.created_at);
    write_manifest(app, &manifest)
}

fn player_summaries(players: &[BotLeaguePlayer]) -> Vec<BotLeaguePlayerSummary> {
    players
        .iter()
        .map(|player| BotLeaguePlayerSummary {
            profile_id: player.profile_id.clone(),
            name: player.name.clone(),
            target_elo: player.target_elo,
            profile_version: player.profile_version,
            catalog_version: player.catalog_version.clone(),
        })
        .collect()
}

fn stored_manifest(
    config: &BotLeagueConfig,
    state: &BotLeagueState,
    created_at: &str,
) -> StoredBotLeagueManifest {
    let recorded_games = state
        .results
        .iter()
        .filter(|result| result.artifact_available)
        .count() as u32;
    StoredBotLeagueManifest {
        schema_version: BOT_LEAGUE_SCHEMA_VERSION,
        application_version: env!("CARGO_PKG_VERSION").to_string(),
        summary: BotLeagueSummary {
            league_id: state.league_id.clone(),
            owner_id: state.owner_id.clone(),
            status: state.status,
            created_at: created_at.to_string(),
            updated_at: now(),
            players: player_summaries(&config.players),
            games_per_pair: config.games_per_pair,
            total_games: state.total_games,
            completed_games: state.completed_games,
            failed_games: state.failed_games,
            recorded_games,
        },
        config: config.clone(),
        results: state.results.clone(),
        standings: state.standings.clone(),
    }
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn validate_identifier(value: &str) -> Result<(), Error> {
    if value.is_empty()
        || value.len() > 200
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(Error::InvalidBotLeague(
            "league identifiers may only contain letters, numbers, hyphens, and underscores"
                .to_string(),
        ));
    }
    Ok(())
}

fn leagues_root(app: &AppHandle) -> Result<PathBuf, Error> {
    Ok(app.path().app_data_dir()?.join(BOT_LEAGUES_DIRECTORY))
}

fn league_directory(app: &AppHandle, league_id: &str) -> Result<PathBuf, Error> {
    validate_identifier(league_id)?;
    Ok(leagues_root(app)?.join(league_id))
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, Error> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(value)?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(temporary, path)?;
    Ok(())
}

fn manifest_path(directory: &Path) -> PathBuf {
    directory.join("league.manifest.json")
}

fn read_manifest(app: &AppHandle, league_id: &str) -> Result<StoredBotLeagueManifest, Error> {
    let directory = league_directory(app, league_id)?;
    if !directory.exists() {
        return Err(Error::BotLeagueNotFound(league_id.to_string()));
    }
    read_json(&manifest_path(&directory))
}

fn write_manifest(app: &AppHandle, manifest: &StoredBotLeagueManifest) -> Result<(), Error> {
    let directory = league_directory(app, &manifest.summary.league_id)?;
    write_json(&manifest_path(&directory), manifest)?;
    write_json(&directory.join("results.json"), &manifest.results)?;
    write_json(&directory.join("standings.json"), &manifest.standings)?;
    Ok(())
}

fn create_league(
    app: &AppHandle,
    league_id: &str,
    config: &BotLeagueConfig,
    state: &BotLeagueState,
    created_at: &str,
) -> Result<(), Error> {
    let directory = league_directory(app, league_id)?;
    if directory.exists() {
        return Err(Error::InvalidBotLeague(format!(
            "league already exists: {league_id}"
        )));
    }
    fs::create_dir_all(directory.join("games"))?;
    fs::create_dir_all(directory.join("logs"))?;
    fs::create_dir_all(directory.join("attempts"))?;
    write_manifest(app, &stored_manifest(config, state, created_at))
}

fn result_text(result: &Option<GameResult>) -> &'static str {
    match result {
        Some(GameResult::WhiteWins { .. }) => "1-0",
        Some(GameResult::BlackWins { .. }) => "0-1",
        Some(GameResult::Draw { .. }) => "1/2-1/2",
        None => "*",
    }
}

fn escape_header(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn build_pgn(league_id: &str, index: u32, manifest: &GameManifest) -> String {
    let result = result_text(&manifest.result);
    let date = manifest
        .started_at
        .get(0..10)
        .unwrap_or("????-??-??")
        .replace('-', ".");
    let mut headers = vec![
        ("Event", "Chess Lab Bot League".to_string()),
        ("Site", "Chess Lab".to_string()),
        ("Date", date),
        ("Round", (index + 1).to_string()),
        ("White", player_name(&manifest.white)),
        ("Black", player_name(&manifest.black)),
        ("Result", result.to_string()),
        ("ChessLabLeague", league_id.to_string()),
    ];
    if manifest.initial_fen != STANDARD_INITIAL_FEN {
        headers.push(("SetUp", "1".to_string()));
        headers.push(("FEN", manifest.initial_fen.clone()));
    }
    let mut pgn = headers
        .into_iter()
        .map(|(key, value)| format!("[{key} \"{}\"]", escape_header(&value)))
        .collect::<Vec<_>>()
        .join("\n");
    pgn.push_str("\n\n");

    let fen_parts: Vec<&str> = manifest.initial_fen.split_whitespace().collect();
    let starts_with_black = fen_parts.get(1).copied() == Some("b");
    let first_move_number = fen_parts
        .get(5)
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(1);
    let mut tokens = Vec::new();
    for (offset, game_move) in manifest.moves.iter().enumerate() {
        let absolute_ply = offset + usize::from(starts_with_black);
        let move_number = first_move_number + absolute_ply as u32 / 2;
        if absolute_ply % 2 == 0 {
            tokens.push(format!("{move_number}."));
        } else if offset == 0 {
            tokens.push(format!("{move_number}..."));
        }
        tokens.push(game_move.san.clone());
    }
    tokens.push(result.to_string());
    pgn.push_str(&tokens.join(" "));
    pgn.push('\n');
    pgn
}

async fn persist_game_artifact(
    app: &AppHandle,
    league_id: &str,
    index: u32,
    attempt: u32,
    game_id: &str,
    game_manager: &GameManager,
    primary: bool,
) -> Result<GameManifest, Error> {
    let manifest = game_manager.get_game_manifest(game_id).await?;
    let white_logs = game_manager
        .get_engine_logs(game_id, "white")
        .await
        .unwrap_or_default();
    let black_logs = game_manager
        .get_engine_logs(game_id, "black")
        .await
        .unwrap_or_default();
    let directory = league_directory(app, league_id)?;
    let prefix = format!("game-{:04}", index + 1);
    if primary {
        fs::write(
            directory.join("games").join(format!("{prefix}.pgn")),
            build_pgn(league_id, index, &manifest),
        )?;
        write_json(
            &directory
                .join("games")
                .join(format!("{prefix}.manifest.json")),
            &manifest,
        )?;
        write_json(
            &directory.join("logs").join(format!("{prefix}-white.json")),
            &white_logs,
        )?;
        write_json(
            &directory.join("logs").join(format!("{prefix}-black.json")),
            &black_logs,
        )?;
    } else {
        let attempt_directory = directory
            .join("attempts")
            .join(format!("{prefix}-attempt-{attempt}"));
        fs::create_dir_all(&attempt_directory)?;
        write_json(&attempt_directory.join("manifest.json"), &manifest)?;
        write_json(&attempt_directory.join("white.log.json"), &white_logs)?;
        write_json(&attempt_directory.join("black.log.json"), &black_logs)?;
    }
    Ok(manifest)
}

fn game_path(app: &AppHandle, league_id: &str, index: u32) -> Result<PathBuf, Error> {
    Ok(league_directory(app, league_id)?
        .join("games")
        .join(format!("game-{:04}.pgn", index + 1)))
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), Error> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_directory(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn validate_export_folder_name(folder_name: &str) -> Result<String, Error> {
    let trimmed = folder_name.trim();
    let invalid = trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.ends_with('.')
        || trimmed.ends_with(' ')
        || trimmed.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        });
    if invalid {
        return Err(Error::InvalidBotLeague(
            "the export folder name contains invalid characters".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn start_bot_league(
    league_id: String,
    config: BotLeagueConfig,
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<BotLeagueState, Error> {
    state
        .bot_league_manager
        .start_league(league_id, config, state.game_manager.clone(), app)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_bot_league(
    league_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<BotLeagueState, Error> {
    state.bot_league_manager.get_league(&league_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn pause_bot_league(
    league_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<BotLeagueState, Error> {
    state.bot_league_manager.pause_league(&league_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn resume_bot_league(
    league_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<BotLeagueState, Error> {
    state.bot_league_manager.resume_league(&league_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_bot_league(
    league_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<BotLeagueState, Error> {
    state
        .bot_league_manager
        .cancel_league(&league_id, &state.game_manager)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_bot_leagues_for_owner(
    owner_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), Error> {
    state
        .bot_league_manager
        .cancel_owner_leagues(&owner_id, &state.game_manager)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn dismiss_bot_league(
    league_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), Error> {
    state.bot_league_manager.dismiss_league(&league_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn list_bot_leagues(app: AppHandle) -> Result<Vec<BotLeagueSummary>, Error> {
    let root = leagues_root(&app)?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut summaries = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        if let Ok(manifest) = read_json::<StoredBotLeagueManifest>(&manifest_path(&entry.path())) {
            summaries.push(manifest.summary);
        }
    }
    summaries.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(summaries)
}

#[tauri::command]
#[specta::specta]
pub async fn get_bot_league_detail(
    league_id: String,
    app: AppHandle,
) -> Result<BotLeagueDetail, Error> {
    let manifest = read_manifest(&app, &league_id)?;
    Ok(BotLeagueDetail {
        summary: manifest.summary,
        config: manifest.config,
        results: manifest.results,
        standings: manifest.standings,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn read_bot_league_game(
    league_id: String,
    index: u32,
    app: AppHandle,
) -> Result<BotLeagueGameArtifact, Error> {
    let path = game_path(&app, &league_id, index)?;
    if !path.exists() {
        return Err(Error::BotLeagueGameNotFound { league_id, index });
    }
    Ok(BotLeagueGameArtifact {
        league_id: league_id.clone(),
        index,
        pgn: fs::read_to_string(path)?,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn delete_bot_league(league_id: String, app: AppHandle) -> Result<(), Error> {
    let directory = league_directory(&app, &league_id)?;
    if !directory.exists() {
        return Err(Error::BotLeagueNotFound(league_id));
    }
    let manifest = read_json::<StoredBotLeagueManifest>(&manifest_path(&directory))?;
    if matches!(
        manifest.summary.status,
        BotLeagueStatus::Running | BotLeagueStatus::Paused | BotLeagueStatus::Cancelling
    ) {
        return Err(Error::InvalidBotLeague(
            "a running league cannot be deleted".to_string(),
        ));
    }
    fs::remove_dir_all(directory)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn export_bot_league(
    league_id: String,
    destination_directory: String,
    folder_name: String,
    app: AppHandle,
) -> Result<String, Error> {
    let source = league_directory(&app, &league_id)?;
    if !source.exists() {
        return Err(Error::BotLeagueNotFound(league_id));
    }
    let manifest = read_json::<StoredBotLeagueManifest>(&manifest_path(&source))?;
    if matches!(
        manifest.summary.status,
        BotLeagueStatus::Running | BotLeagueStatus::Paused | BotLeagueStatus::Cancelling
    ) {
        return Err(Error::InvalidBotLeague(
            "a running league cannot be exported".to_string(),
        ));
    }
    let folder_name = validate_export_folder_name(&folder_name)?;
    let destination = PathBuf::from(destination_directory).join(folder_name);
    if destination.exists() {
        return Err(Error::InvalidBotLeague(format!(
            "export destination already exists: {}",
            destination.display()
        )));
    }
    copy_directory(&source, &destination)?;
    Ok(destination.to_string_lossy().to_string())
}

pub fn recover_interrupted_bot_leagues(app: &AppHandle) -> Result<(), Error> {
    let root = leagues_root(app)?;
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = manifest_path(&entry.path());
        let Ok(mut manifest) = read_json::<StoredBotLeagueManifest>(&path) else {
            continue;
        };
        if matches!(
            manifest.summary.status,
            BotLeagueStatus::Running | BotLeagueStatus::Paused | BotLeagueStatus::Cancelling
        ) {
            manifest.summary.status = BotLeagueStatus::Cancelled;
            manifest.summary.updated_at = now();
            write_json(&path, &manifest)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::EngineOption;

    fn player(id: &str, name: &str, elo: u32) -> BotLeaguePlayer {
        BotLeaguePlayer {
            profile_id: id.to_string(),
            name: name.to_string(),
            target_elo: elo,
            profile_version: 3,
            catalog_version: "4.4.0".to_string(),
            config: PlayerConfig::Engine {
                name: name.to_string(),
                path: format!("{name}.exe"),
                version: "test".to_string(),
                preset_category: PlayerPresetCategory::HumanLike,
                target_elo: Some(elo),
                seed: Some(1),
                args: Vec::new(),
                options: vec![
                    EngineOption {
                        name: "Threads".to_string(),
                        value: "1".to_string(),
                    },
                    EngineOption {
                        name: "Hash".to_string(),
                        value: "16".to_string(),
                    },
                ],
                opening_repertoire: None,
                human_timing: None,
                go: None,
            },
        }
    }

    #[test]
    fn round_robin_fixtures_alternate_colors_and_count_games() {
        let config = BotLeagueConfig {
            owner_id: "owner".to_string(),
            players: vec![
                player("a", "A", 1000),
                player("b", "B", 1100),
                player("c", "C", 1200),
            ],
            games_per_pair: 2,
            alternate_colors: true,
            base_seed: 1,
            seed_step: 1,
            requested_concurrency: 1,
            max_cpu_threads: 2,
            max_memory_mb: 32,
            max_retries: 0,
            time_control: None,
            opening_book: None,
        };
        let fixtures = build_fixtures(&config);
        assert_eq!(fixtures.len(), 6);
        assert_eq!(fixtures[0].white.profile_id, "a");
        assert_eq!(fixtures[0].black.profile_id, "b");
        assert_eq!(fixtures[1].white.profile_id, "b");
        assert_eq!(fixtures[1].black.profile_id, "a");
        assert_eq!(fixtures[4].pair_index, 2);
    }

    #[test]
    fn standings_calculate_scores_and_relative_estimates() {
        let players = vec![player("a", "A", 1000), player("b", "B", 1200)];
        let results = vec![BotLeagueGameResult {
            index: 0,
            pair_index: 0,
            round: 1,
            game_id: "game".to_string(),
            white_profile_id: "a".to_string(),
            black_profile_id: "b".to_string(),
            white_player: "A".to_string(),
            black_player: "B".to_string(),
            white_seed: Some(1),
            black_seed: Some(2),
            attempts: 1,
            status: BotLeagueGameStatus::Completed,
            result: Some(GameResult::WhiteWins {
                reason: GameEndReason::Checkmate,
            }),
            plies: 20,
            error: None,
            artifact_available: true,
        }];
        let standings = calculate_standings(&players, &results);
        assert_eq!(standings[0].profile_id, "a");
        assert_eq!(standings[0].points, 1.0);
        assert_eq!(standings[1].losses, 1);
        assert!(standings
            .iter()
            .all(|standing| standing.estimated_elo.is_some()));
    }
}
