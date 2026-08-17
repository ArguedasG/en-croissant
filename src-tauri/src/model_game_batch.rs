use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;
use tauri_specta::Event;
use tokio::{
    sync::RwLock,
    task::JoinSet,
    time::{sleep, Duration},
};

use crate::{
    error::Error,
    game::{GameConfig, GameEndReason, GameManager, GameResult, GameStatus, PlayerConfig},
    model_game_experiment::{
        create_batch_experiment, persist_game_artifacts, update_batch_experiment,
    },
};

const MAX_BATCH_GAMES: u32 = 1_000;
const MAX_BATCH_CONCURRENCY: u32 = 32;
const MAX_BATCH_RETRIES: u32 = 5;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelGameBatchConfig {
    pub owner_id: String,
    pub game_config: GameConfig,
    pub game_count: u32,
    pub alternate_colors: bool,
    pub seed_step: u32,
    pub requested_concurrency: u32,
    pub max_cpu_threads: u32,
    pub max_memory_mb: u32,
    pub max_retries: u32,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModelGameBatchStatus {
    Running,
    Paused,
    Cancelling,
    Completed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModelGameBatchGameStatus {
    Completed,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelGameBatchGameResult {
    pub index: u32,
    pub game_id: String,
    pub white_player: String,
    pub black_player: String,
    pub white_seed: Option<u32>,
    pub black_seed: Option<u32>,
    pub attempts: u32,
    pub status: ModelGameBatchGameStatus,
    pub result: Option<GameResult>,
    pub plies: u32,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelGameBatchState {
    pub batch_id: String,
    pub owner_id: String,
    pub status: ModelGameBatchStatus,
    pub total_games: u32,
    pub completed_games: u32,
    pub failed_games: u32,
    pub active_games: Vec<String>,
    pub queued_games: u32,
    pub effective_concurrency: u32,
    pub estimated_threads_per_game: u32,
    pub estimated_hash_mb_per_game: u32,
    pub results: Vec<ModelGameBatchGameResult>,
}

#[derive(Clone, Debug, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ModelGameBatchEvent {
    pub state: ModelGameBatchState,
}

struct BatchEntry {
    config: ModelGameBatchConfig,
    state: RwLock<ModelGameBatchState>,
    paused: AtomicBool,
    cancelled: AtomicBool,
}

pub struct ModelGameBatchManager {
    batches: DashMap<String, Arc<BatchEntry>>,
}

impl ModelGameBatchManager {
    pub fn new() -> Self {
        Self {
            batches: DashMap::new(),
        }
    }

    pub async fn start_batch(
        &self,
        batch_id: String,
        config: ModelGameBatchConfig,
        game_manager: Arc<GameManager>,
        app: AppHandle,
    ) -> Result<ModelGameBatchState, Error> {
        validate_batch_config(&config)?;
        let resources = calculate_resource_plan(&config)?;
        let state = ModelGameBatchState {
            batch_id: batch_id.clone(),
            owner_id: config.owner_id.clone(),
            status: ModelGameBatchStatus::Running,
            total_games: config.game_count,
            completed_games: 0,
            failed_games: 0,
            active_games: Vec::new(),
            queued_games: config.game_count,
            effective_concurrency: resources.effective_concurrency,
            estimated_threads_per_game: resources.threads_per_game,
            estimated_hash_mb_per_game: resources.hash_mb_per_game,
            results: Vec::new(),
        };
        create_batch_experiment(&app, &config, &state)?;
        let entry = Arc::new(BatchEntry {
            config,
            state: RwLock::new(state.clone()),
            paused: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
        });

        if let Some(previous) = self.batches.insert(batch_id.clone(), entry.clone()) {
            previous.cancelled.store(true, Ordering::SeqCst);
        }

        tokio::spawn(run_batch(entry, game_manager, app));
        Ok(state)
    }

    pub async fn get_batch(&self, batch_id: &str) -> Result<ModelGameBatchState, Error> {
        let entry = self
            .batches
            .get(batch_id)
            .ok_or_else(|| Error::ModelGameBatchNotFound(batch_id.to_string()))?
            .clone();
        let state = entry.state.read().await.clone();
        Ok(state)
    }

    pub async fn pause_batch(&self, batch_id: &str) -> Result<ModelGameBatchState, Error> {
        let entry = self.get_entry(batch_id)?;
        entry.paused.store(true, Ordering::SeqCst);
        let mut state = entry.state.write().await;
        if state.status == ModelGameBatchStatus::Running {
            state.status = ModelGameBatchStatus::Paused;
        }
        Ok(state.clone())
    }

    pub async fn resume_batch(&self, batch_id: &str) -> Result<ModelGameBatchState, Error> {
        let entry = self.get_entry(batch_id)?;
        entry.paused.store(false, Ordering::SeqCst);
        let mut state = entry.state.write().await;
        if state.status == ModelGameBatchStatus::Paused {
            state.status = ModelGameBatchStatus::Running;
        }
        Ok(state.clone())
    }

    pub async fn cancel_batch(
        &self,
        batch_id: &str,
        game_manager: &GameManager,
    ) -> Result<ModelGameBatchState, Error> {
        let entry = self.get_entry(batch_id)?;
        entry.cancelled.store(true, Ordering::SeqCst);
        let active_games = {
            let mut state = entry.state.write().await;
            if matches!(
                state.status,
                ModelGameBatchStatus::Running | ModelGameBatchStatus::Paused
            ) {
                state.status = ModelGameBatchStatus::Cancelling;
            }
            state.active_games.clone()
        };
        for game_id in active_games {
            game_manager.abort_game(&game_id).await?;
        }
        let state = entry.state.read().await.clone();
        Ok(state)
    }

    pub async fn cancel_owner_batches(
        &self,
        owner_id: &str,
        game_manager: &GameManager,
    ) -> Result<(), Error> {
        let batch_ids: Vec<String> = self
            .batches
            .iter()
            .filter_map(|batch| {
                (batch.value().config.owner_id == owner_id).then(|| batch.key().clone())
            })
            .collect();
        for batch_id in batch_ids {
            let state = self.get_batch(&batch_id).await?;
            if matches!(
                state.status,
                ModelGameBatchStatus::Running
                    | ModelGameBatchStatus::Paused
                    | ModelGameBatchStatus::Cancelling
            ) {
                self.cancel_batch(&batch_id, game_manager).await?;
            }
            self.batches.remove(&batch_id);
        }
        Ok(())
    }

    pub async fn dismiss_batch(&self, batch_id: &str) -> Result<(), Error> {
        let state = self.get_batch(batch_id).await?;
        if !matches!(
            state.status,
            ModelGameBatchStatus::Completed | ModelGameBatchStatus::Cancelled
        ) {
            return Err(Error::InvalidModelGameBatch(
                "only a completed or cancelled batch can be dismissed".to_string(),
            ));
        }
        self.batches.remove(batch_id);
        Ok(())
    }

    pub fn cancel_all_sync(&self) {
        for batch in self.batches.iter() {
            batch.value().cancelled.store(true, Ordering::SeqCst);
        }
    }

    fn get_entry(&self, batch_id: &str) -> Result<Arc<BatchEntry>, Error> {
        self.batches
            .get(batch_id)
            .map(|entry| entry.clone())
            .ok_or_else(|| Error::ModelGameBatchNotFound(batch_id.to_string()))
    }
}

impl Default for ModelGameBatchManager {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ResourcePlan {
    threads_per_game: u32,
    hash_mb_per_game: u32,
    effective_concurrency: u32,
}

fn validate_batch_config(config: &ModelGameBatchConfig) -> Result<(), Error> {
    if !(1..=MAX_BATCH_GAMES).contains(&config.game_count) {
        return Err(Error::InvalidModelGameBatch(format!(
            "game count must be between 1 and {MAX_BATCH_GAMES}"
        )));
    }
    if !(1..=MAX_BATCH_CONCURRENCY).contains(&config.requested_concurrency) {
        return Err(Error::InvalidModelGameBatch(format!(
            "concurrency must be between 1 and {MAX_BATCH_CONCURRENCY}"
        )));
    }
    if config.max_retries > MAX_BATCH_RETRIES {
        return Err(Error::InvalidModelGameBatch(format!(
            "retries cannot exceed {MAX_BATCH_RETRIES}"
        )));
    }
    if config.max_cpu_threads == 0 || config.max_memory_mb == 0 {
        return Err(Error::InvalidModelGameBatch(
            "CPU and memory budgets must be greater than zero".to_string(),
        ));
    }
    if !matches!(config.game_config.white, PlayerConfig::Engine { .. })
        || !matches!(config.game_config.black, PlayerConfig::Engine { .. })
    {
        return Err(Error::InvalidModelGameBatch(
            "both batch players must be engines".to_string(),
        ));
    }
    Ok(())
}

fn calculate_resource_plan(config: &ModelGameBatchConfig) -> Result<ResourcePlan, Error> {
    let threads_per_game = player_option_u32(&config.game_config.white, "Threads", 1)
        .saturating_add(player_option_u32(&config.game_config.black, "Threads", 1))
        .max(1);
    let hash_mb_per_game = player_option_u32(&config.game_config.white, "Hash", 16)
        .saturating_add(player_option_u32(&config.game_config.black, "Hash", 16))
        .max(1);

    if config.max_cpu_threads < threads_per_game {
        return Err(Error::InvalidModelGameBatch(format!(
            "one game requests {threads_per_game} CPU threads, above the batch budget of {}",
            config.max_cpu_threads
        )));
    }
    if config.max_memory_mb < hash_mb_per_game {
        return Err(Error::InvalidModelGameBatch(format!(
            "one game requests {hash_mb_per_game} MB of Hash, above the batch budget of {} MB",
            config.max_memory_mb
        )));
    }

    let cpu_slots = config.max_cpu_threads / threads_per_game;
    let memory_slots = config.max_memory_mb / hash_mb_per_game;
    let effective_concurrency = config
        .requested_concurrency
        .min(config.game_count)
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

fn increment_player_seed(player: &mut PlayerConfig, increment: u32) {
    if let PlayerConfig::Engine { seed, .. } = player {
        if let Some(value) = seed {
            *value = value.wrapping_add(increment);
        }
    }
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

fn game_config_for_index(config: &ModelGameBatchConfig, index: u32) -> GameConfig {
    let mut game_config = config.game_config.clone();
    let increment = index.wrapping_mul(config.seed_step);
    increment_player_seed(&mut game_config.white, increment);
    increment_player_seed(&mut game_config.black, increment);

    if config.alternate_colors && index % 2 == 1 {
        std::mem::swap(&mut game_config.white, &mut game_config.black);
        std::mem::swap(
            &mut game_config.white_time_control,
            &mut game_config.black_time_control,
        );
    }
    game_config
}

enum TaskOutcome {
    Completed(ModelGameBatchGameResult),
    Failed(ModelGameBatchGameResult),
    Cancelled { game_id: String },
}

async fn run_batch(entry: Arc<BatchEntry>, game_manager: Arc<GameManager>, app: AppHandle) {
    let concurrency = entry.state.read().await.effective_concurrency as usize;
    let mut next_index = 0_u32;
    let mut tasks = JoinSet::new();

    loop {
        if entry.cancelled.load(Ordering::SeqCst) {
            let active = entry.state.read().await.active_games.clone();
            for game_id in active {
                let _ = game_manager.abort_game(&game_id).await;
            }
        }

        while !entry.cancelled.load(Ordering::SeqCst)
            && !entry.paused.load(Ordering::SeqCst)
            && tasks.len() < concurrency
            && next_index < entry.config.game_count
        {
            let index = next_index;
            next_index += 1;
            let game_id = format!("{}-game-{}", entry.state.read().await.batch_id, index + 1);
            {
                let mut state = entry.state.write().await;
                state.active_games.push(game_id.clone());
                state.queued_games = state.total_games.saturating_sub(next_index);
            }
            emit_state(&entry, &app).await;

            let task_entry = entry.clone();
            let task_manager = game_manager.clone();
            let task_app = app.clone();
            tasks.spawn(async move {
                run_batch_game(index, game_id, task_entry, task_manager, task_app).await
            });
        }

        if tasks.is_empty() {
            if entry.cancelled.load(Ordering::SeqCst) || next_index >= entry.config.game_count {
                break;
            }
            sleep(Duration::from_millis(100)).await;
            continue;
        }

        tokio::select! {
            outcome = tasks.join_next() => {
                if let Some(Ok(outcome)) = outcome {
                    record_task_outcome(&entry, outcome).await;
                    let state = entry.state.read().await.clone();
                    if let Err(error) = update_batch_experiment(&app, &state) {
                        log::error!("Could not update model game experiment: {error}");
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
    state.status = if entry.cancelled.load(Ordering::SeqCst) {
        ModelGameBatchStatus::Cancelled
    } else {
        ModelGameBatchStatus::Completed
    };
    drop(state);
    let state = entry.state.read().await.clone();
    if let Err(error) = update_batch_experiment(&app, &state) {
        log::error!("Could not finalize model game experiment: {error}");
    }
    emit_state(&entry, &app).await;
}

async fn run_batch_game(
    index: u32,
    game_id: String,
    entry: Arc<BatchEntry>,
    game_manager: Arc<GameManager>,
    app: AppHandle,
) -> TaskOutcome {
    let config = game_config_for_index(&entry.config, index);
    let white_player = player_name(&config.white);
    let black_player = player_name(&config.black);
    let white_seed = player_seed(&config.white);
    let black_seed = player_seed(&config.black);
    let mut last_error = None;

    for attempt in 1..=entry.config.max_retries + 1 {
        if entry.cancelled.load(Ordering::SeqCst) {
            return TaskOutcome::Cancelled { game_id };
        }

        match game_manager
            .start_game(game_id.clone(), config.clone(), app.clone())
            .await
        {
            Ok(_) => loop {
                if entry.cancelled.load(Ordering::SeqCst) {
                    let _ = game_manager.abort_game(&game_id).await;
                    return TaskOutcome::Cancelled { game_id };
                }

                match game_manager.get_game_state(&game_id).await {
                    Ok(state) => {
                        if let GameStatus::Finished { result } = state.status {
                            let plies = state.ply;
                            let retryable = is_retryable_result(&result);
                            let primary = !retryable || attempt > entry.config.max_retries;
                            let experiment_id = entry.state.read().await.batch_id.clone();
                            if let Err(error) = persist_game_artifacts(
                                &app,
                                &experiment_id,
                                index,
                                attempt,
                                &game_id,
                                &game_manager,
                                primary,
                                true,
                            )
                            .await
                            {
                                log::error!(
                                    "Could not persist model game {game_id} attempt {attempt}: {error}"
                                );
                            }
                            let _ = game_manager.abort_game(&game_id).await;
                            if retryable {
                                last_error = Some("engine abandoned the game".to_string());
                                if attempt <= entry.config.max_retries {
                                    break;
                                }
                                return TaskOutcome::Failed(ModelGameBatchGameResult {
                                    index,
                                    game_id,
                                    white_player,
                                    black_player,
                                    white_seed,
                                    black_seed,
                                    attempts: attempt,
                                    status: ModelGameBatchGameStatus::Failed,
                                    result: Some(result),
                                    plies,
                                    error: last_error,
                                });
                            }
                            return TaskOutcome::Completed(ModelGameBatchGameResult {
                                index,
                                game_id,
                                white_player,
                                black_player,
                                white_seed,
                                black_seed,
                                attempts: attempt,
                                status: ModelGameBatchGameStatus::Completed,
                                result: Some(result),
                                plies,
                                error: None,
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

    TaskOutcome::Failed(ModelGameBatchGameResult {
        index,
        game_id,
        white_player,
        black_player,
        white_seed,
        black_seed,
        attempts: entry.config.max_retries + 1,
        status: ModelGameBatchGameStatus::Failed,
        result: None,
        plies: 0,
        error: last_error,
    })
}

async fn record_task_outcome(entry: &BatchEntry, outcome: TaskOutcome) {
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
}

async fn emit_state(entry: &BatchEntry, app: &AppHandle) {
    let state = entry.state.read().await.clone();
    let _ = ModelGameBatchEvent { state }.emit(app);
}

#[tauri::command]
#[specta::specta]
pub async fn start_model_game_batch(
    batch_id: String,
    config: ModelGameBatchConfig,
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ModelGameBatchState, Error> {
    state
        .model_game_batch_manager
        .start_batch(batch_id, config, state.game_manager.clone(), app)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_model_game_batch(
    batch_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ModelGameBatchState, Error> {
    state.model_game_batch_manager.get_batch(&batch_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn pause_model_game_batch(
    batch_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ModelGameBatchState, Error> {
    state.model_game_batch_manager.pause_batch(&batch_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn resume_model_game_batch(
    batch_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ModelGameBatchState, Error> {
    state.model_game_batch_manager.resume_batch(&batch_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_model_game_batch(
    batch_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ModelGameBatchState, Error> {
    state
        .model_game_batch_manager
        .cancel_batch(&batch_id, &state.game_manager)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_model_game_batches_for_owner(
    owner_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), Error> {
    state
        .model_game_batch_manager
        .cancel_owner_batches(&owner_id, &state.game_manager)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn dismiss_model_game_batch(
    batch_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), Error> {
    state
        .model_game_batch_manager
        .dismiss_batch(&batch_id)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{EngineOption, GoMode};

    fn player(name: &str, seed: u32, threads: u32, hash: u32) -> PlayerConfig {
        PlayerConfig::Engine {
            name: name.to_string(),
            path: format!("{name}.exe"),
            version: "test".to_string(),
            preset_category: Default::default(),
            target_elo: None,
            seed: Some(seed),
            args: Vec::new(),
            options: vec![
                EngineOption {
                    name: "Threads".to_string(),
                    value: threads.to_string(),
                },
                EngineOption {
                    name: "Hash".to_string(),
                    value: hash.to_string(),
                },
            ],
            opening_repertoire: None,
            human_timing: None,
            go: Some(GoMode::Depth(1)),
        }
    }

    fn batch_config() -> ModelGameBatchConfig {
        ModelGameBatchConfig {
            owner_id: "tab".to_string(),
            game_config: GameConfig {
                white: player("A", 10, 2, 64),
                black: player("B", 20, 2, 64),
                white_time_control: None,
                black_time_control: None,
                initial_fen: None,
                initial_moves: Vec::new(),
                opening_book: None,
            },
            game_count: 8,
            alternate_colors: true,
            seed_step: 3,
            requested_concurrency: 4,
            max_cpu_threads: 8,
            max_memory_mb: 512,
            max_retries: 1,
        }
    }

    #[test]
    fn alternates_players_and_advances_reproducible_seeds() {
        let config = batch_config();
        let first = game_config_for_index(&config, 0);
        let second = game_config_for_index(&config, 1);

        assert_eq!(player_name(&first.white), "A");
        assert_eq!(player_seed(&first.white), Some(10));
        assert_eq!(player_name(&second.white), "B");
        assert_eq!(player_seed(&second.white), Some(23));
        assert_eq!(player_name(&second.black), "A");
        assert_eq!(player_seed(&second.black), Some(13));
    }

    #[test]
    fn clamps_concurrency_to_cpu_and_hash_budgets() {
        let config = batch_config();
        let plan = calculate_resource_plan(&config).unwrap();

        assert_eq!(plan.threads_per_game, 4);
        assert_eq!(plan.hash_mb_per_game, 128);
        assert_eq!(plan.effective_concurrency, 2);
    }

    #[test]
    fn rejects_a_budget_that_cannot_fit_one_game() {
        let mut config = batch_config();
        config.max_memory_mb = 64;

        assert!(matches!(
            calculate_resource_plan(&config),
            Err(Error::InvalidModelGameBatch(_))
        ));
    }

    #[test]
    fn retries_only_engine_abandonments() {
        assert!(is_retryable_result(&GameResult::BlackWins {
            reason: GameEndReason::Abandonment,
        }));
        assert!(!is_retryable_result(&GameResult::BlackWins {
            reason: GameEndReason::Checkmate,
        }));
    }
}
