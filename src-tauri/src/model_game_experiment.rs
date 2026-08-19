use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use chrono::{SecondsFormat, Utc};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use shakmaty::{fen::Fen, uci::UciMove, CastlingMode, Chess, Color, Position};
use specta::Type;
use tauri::{AppHandle, Manager};
use vampirc_uci::uci::ScoreValue;

use crate::{
    chess::{evaluate_position_score, evaluate_position_wdl},
    engine::{parse_fen_and_apply_moves, BaseEngine, EngineOption, EngineReader, GoMode},
    error::Error,
    game::{GameConfig, GameManager, GameManifest, GameResult, PlayerConfig},
    model_game_batch::{
        ModelGameBatchConfig, ModelGameBatchGameStatus, ModelGameBatchState, ModelGameBatchStatus,
    },
    progress::update_progress,
};

const EXPERIMENT_SCHEMA_VERSION: u32 = 1;
const EXPERIMENTS_DIRECTORY: &str = "model-game-experiments-v1";
const STANDARD_INITIAL_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModelGameExperimentKind {
    Single,
    Batch,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModelGameExperimentStatus {
    Running,
    Completed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelGameExperimentGame {
    pub index: u32,
    pub game_id: String,
    pub white_player: String,
    pub black_player: String,
    pub white_seed: Option<u32>,
    pub black_seed: Option<u32>,
    pub attempts: u32,
    pub status: String,
    pub result: Option<GameResult>,
    pub plies: u32,
    pub error: Option<String>,
    pub artifact_available: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelGameExperimentSummary {
    pub experiment_id: String,
    pub owner_id: String,
    pub kind: ModelGameExperimentKind,
    pub status: ModelGameExperimentStatus,
    pub created_at: String,
    pub updated_at: String,
    pub white_player: String,
    pub black_player: String,
    pub initial_fen: String,
    pub total_games: u32,
    pub completed_games: u32,
    pub failed_games: u32,
    pub recorded_games: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelGameExperimentDetail {
    pub summary: ModelGameExperimentSummary,
    pub games: Vec<ModelGameExperimentGame>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelGameExperimentGameArtifact {
    pub experiment_id: String,
    pub index: u32,
    pub pgn: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredExperimentManifest {
    schema_version: u32,
    application_version: String,
    summary: ModelGameExperimentSummary,
    games: Vec<ModelGameExperimentGame>,
    #[serde(default)]
    batch_config: Option<ModelGameBatchConfig>,
    #[serde(default)]
    single_config: Option<GameConfig>,
    #[serde(default)]
    single_game_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredExperimentMetrics {
    schema_version: u32,
    sample_size: u32,
    white_wins: u32,
    black_wins: u32,
    draws: u32,
    failed_games: u32,
    average_plies: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentAnalysisEvaluator {
    pub engine: String,
    pub engine_args: Vec<String>,
    pub go_mode: GoMode,
    pub uci_options: Vec<EngineOption>,
    pub inaccuracy_threshold_cp: u32,
    pub mistake_threshold_cp: u32,
    pub blunder_threshold_cp: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentAnalysisSideMetrics {
    pub moves: u32,
    pub acpl: Option<f64>,
    pub inaccuracies: u32,
    pub mistakes: u32,
    pub blunders: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentAnalysisPlayerMetrics {
    pub name: String,
    pub games: u32,
    pub white_games: u32,
    pub black_games: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    pub moves: u32,
    pub acpl: Option<f64>,
    pub inaccuracies: u32,
    pub mistakes: u32,
    pub blunders: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentAnalysisPhaseMetrics {
    pub phase: String,
    pub moves: u32,
    pub acpl: Option<f64>,
    pub inaccuracies: u32,
    pub mistakes: u32,
    pub blunders: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentAnalysisGame {
    pub index: u32,
    pub game_id: String,
    pub white_player: String,
    pub black_player: String,
    pub result: Option<GameResult>,
    pub analyzed_plies: u32,
    pub white: ExperimentAnalysisSideMetrics,
    pub black: ExperimentAnalysisSideMetrics,
    pub phases: Vec<ExperimentAnalysisPhaseMetrics>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentAnalysisSummary {
    pub sample_size: u32,
    pub skipped_games: u32,
    pub analyzed_plies: u32,
    pub white_wins: u32,
    pub black_wins: u32,
    pub draws: u32,
    pub average_plies: Option<f64>,
    pub white: ExperimentAnalysisSideMetrics,
    pub black: ExperimentAnalysisSideMetrics,
    pub players: Vec<ExperimentAnalysisPlayerMetrics>,
    pub phases: Vec<ExperimentAnalysisPhaseMetrics>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentAnalysisResult {
    pub schema_version: u32,
    pub experiment_id: String,
    pub analyzed_at: String,
    pub evaluator: ExperimentAnalysisEvaluator,
    pub summary: ExperimentAnalysisSummary,
    pub games: Vec<ExperimentAnalysisGame>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EmpiricalWdlPrediction {
    pub white_win: f64,
    pub draw: f64,
    pub black_win: f64,
    pub raw_white_win: u32,
    pub raw_draw: u32,
    pub raw_black_win: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EmpiricalWdlInterval {
    pub lower: f64,
    pub upper: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EmpiricalWdlObserved {
    pub sample_size: u32,
    pub white_wins: u32,
    pub draws: u32,
    pub black_wins: u32,
    pub white_win: f64,
    pub draw: f64,
    pub black_win: f64,
    pub white_win_interval: EmpiricalWdlInterval,
    pub draw_interval: EmpiricalWdlInterval,
    pub black_win_interval: EmpiricalWdlInterval,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EmpiricalWdlCalibration {
    pub mean_absolute_error: f64,
    pub brier_score: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EmpiricalWdlEvaluator {
    pub engine: String,
    pub engine_args: Vec<String>,
    pub go_mode: GoMode,
    pub uci_options: Vec<EngineOption>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EmpiricalWdlResult {
    pub schema_version: u32,
    pub experiment_id: String,
    pub analyzed_at: String,
    pub initial_fen: String,
    pub initial_moves: Vec<String>,
    pub evaluator: EmpiricalWdlEvaluator,
    pub prediction: EmpiricalWdlPrediction,
    pub observed: EmpiricalWdlObserved,
    pub calibration: EmpiricalWdlCalibration,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredGameMoveForAnalysis {
    uci: String,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredGameForAnalysis {
    initial_fen: String,
    #[serde(default)]
    initial_moves: Vec<String>,
    #[serde(default)]
    moves: Vec<StoredGameMoveForAnalysis>,
    result: Option<GameResult>,
}

#[derive(Clone, Copy, Debug, Ord, PartialOrd, Eq, PartialEq)]
enum AnalysisPhase {
    Opening,
    Middlegame,
    Endgame,
}

#[derive(Clone, Debug, Default)]
struct MetricAccumulator {
    moves: u32,
    loss_sum: f64,
    inaccuracies: u32,
    mistakes: u32,
    blunders: u32,
}

impl MetricAccumulator {
    fn add_loss(
        &mut self,
        loss_cp: i32,
        inaccuracy_threshold_cp: u32,
        mistake_threshold_cp: u32,
        blunder_threshold_cp: u32,
    ) {
        let loss_cp = loss_cp.max(0);
        self.moves += 1;
        self.loss_sum += loss_cp as f64;
        if loss_cp > blunder_threshold_cp as i32 {
            self.blunders += 1;
        } else if loss_cp > mistake_threshold_cp as i32 {
            self.mistakes += 1;
        } else if loss_cp > inaccuracy_threshold_cp as i32 {
            self.inaccuracies += 1;
        }
    }

    fn merge(&mut self, other: &Self) {
        self.moves += other.moves;
        self.loss_sum += other.loss_sum;
        self.inaccuracies += other.inaccuracies;
        self.mistakes += other.mistakes;
        self.blunders += other.blunders;
    }

    fn into_public(&self) -> ExperimentAnalysisSideMetrics {
        ExperimentAnalysisSideMetrics {
            moves: self.moves,
            acpl: (self.moves > 0).then(|| self.loss_sum / self.moves as f64),
            inaccuracies: self.inaccuracies,
            mistakes: self.mistakes,
            blunders: self.blunders,
        }
    }
}

#[derive(Clone, Debug, Default)]
struct PlayerAccumulator {
    games: u32,
    white_games: u32,
    black_games: u32,
    wins: u32,
    draws: u32,
    losses: u32,
    metrics: MetricAccumulator,
}

impl PlayerAccumulator {
    fn into_public(&self, name: String) -> ExperimentAnalysisPlayerMetrics {
        let metrics = self.metrics.into_public();
        ExperimentAnalysisPlayerMetrics {
            name,
            games: self.games,
            white_games: self.white_games,
            black_games: self.black_games,
            wins: self.wins,
            draws: self.draws,
            losses: self.losses,
            moves: metrics.moves,
            acpl: metrics.acpl,
            inaccuracies: metrics.inaccuracies,
            mistakes: metrics.mistakes,
            blunders: metrics.blunders,
        }
    }
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
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

fn validate_identifier(value: &str) -> Result<(), Error> {
    if value.is_empty()
        || value.len() > 200
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(Error::InvalidModelGameExperiment(
            "experiment identifiers may only contain letters, numbers, hyphens, and underscores"
                .to_string(),
        ));
    }
    Ok(())
}

fn experiments_root(app: &AppHandle) -> Result<PathBuf, Error> {
    Ok(app.path().app_data_dir()?.join(EXPERIMENTS_DIRECTORY))
}

fn experiment_directory(app: &AppHandle, experiment_id: &str) -> Result<PathBuf, Error> {
    validate_identifier(experiment_id)?;
    Ok(experiments_root(app)?.join(experiment_id))
}

fn manifest_path(directory: &Path) -> PathBuf {
    directory.join("experiment.manifest.json")
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

fn read_manifest(app: &AppHandle, experiment_id: &str) -> Result<StoredExperimentManifest, Error> {
    let directory = experiment_directory(app, experiment_id)?;
    let path = manifest_path(&directory);
    if !path.exists() {
        return Err(Error::ModelGameExperimentNotFound(
            experiment_id.to_string(),
        ));
    }
    read_json(&path)
}

fn write_manifest(app: &AppHandle, manifest: &StoredExperimentManifest) -> Result<(), Error> {
    let directory = experiment_directory(app, &manifest.summary.experiment_id)?;
    write_json(&manifest_path(&directory), manifest)?;
    write_json(&directory.join("results.json"), &manifest.games)?;
    write_json(&directory.join("metrics.json"), &metrics(manifest))?;
    Ok(())
}

fn metrics(manifest: &StoredExperimentManifest) -> StoredExperimentMetrics {
    let completed: Vec<&ModelGameExperimentGame> = manifest
        .games
        .iter()
        .filter(|game| game.status == "completed")
        .collect();
    let white_wins = completed
        .iter()
        .filter(|game| matches!(game.result, Some(GameResult::WhiteWins { .. })))
        .count() as u32;
    let black_wins = completed
        .iter()
        .filter(|game| matches!(game.result, Some(GameResult::BlackWins { .. })))
        .count() as u32;
    let draws = completed
        .iter()
        .filter(|game| matches!(game.result, Some(GameResult::Draw { .. })))
        .count() as u32;
    let average_plies = (!completed.is_empty()).then(|| {
        completed.iter().map(|game| game.plies as f64).sum::<f64>() / completed.len() as f64
    });

    StoredExperimentMetrics {
        schema_version: EXPERIMENT_SCHEMA_VERSION,
        sample_size: completed.len() as u32,
        white_wins,
        black_wins,
        draws,
        failed_games: manifest.summary.failed_games,
        average_plies,
    }
}

pub fn create_batch_experiment(
    app: &AppHandle,
    config: &ModelGameBatchConfig,
    state: &ModelGameBatchState,
) -> Result<(), Error> {
    let directory = experiment_directory(app, &state.batch_id)?;
    fs::create_dir_all(directory.join("games"))?;
    fs::create_dir_all(directory.join("logs"))?;
    fs::create_dir_all(directory.join("attempts"))?;
    let timestamp = now();
    let manifest = StoredExperimentManifest {
        schema_version: EXPERIMENT_SCHEMA_VERSION,
        application_version: env!("CARGO_PKG_VERSION").to_string(),
        summary: ModelGameExperimentSummary {
            experiment_id: state.batch_id.clone(),
            owner_id: state.owner_id.clone(),
            kind: ModelGameExperimentKind::Batch,
            status: ModelGameExperimentStatus::Running,
            created_at: timestamp.clone(),
            updated_at: timestamp,
            white_player: player_name(&config.game_config.white),
            black_player: player_name(&config.game_config.black),
            initial_fen: config
                .game_config
                .initial_fen
                .clone()
                .unwrap_or_else(|| STANDARD_INITIAL_FEN.to_string()),
            total_games: state.total_games,
            completed_games: 0,
            failed_games: 0,
            recorded_games: 0,
        },
        games: Vec::new(),
        batch_config: Some(config.clone()),
        single_config: None,
        single_game_id: None,
    };
    write_manifest(app, &manifest)
}

pub fn update_batch_experiment(app: &AppHandle, state: &ModelGameBatchState) -> Result<(), Error> {
    let mut manifest = read_manifest(app, &state.batch_id)?;
    manifest.summary.status = match state.status {
        ModelGameBatchStatus::Running | ModelGameBatchStatus::Paused => {
            ModelGameExperimentStatus::Running
        }
        ModelGameBatchStatus::Cancelling | ModelGameBatchStatus::Cancelled => {
            ModelGameExperimentStatus::Cancelled
        }
        ModelGameBatchStatus::Completed => ModelGameExperimentStatus::Completed,
    };
    manifest.summary.updated_at = now();
    manifest.summary.completed_games = state.completed_games;
    manifest.summary.failed_games = state.failed_games;
    manifest.games = state
        .results
        .iter()
        .map(|game| {
            Ok(ModelGameExperimentGame {
                index: game.index,
                game_id: game.game_id.clone(),
                white_player: game.white_player.clone(),
                black_player: game.black_player.clone(),
                white_seed: game.white_seed,
                black_seed: game.black_seed,
                attempts: game.attempts,
                status: match game.status {
                    ModelGameBatchGameStatus::Completed => "completed",
                    ModelGameBatchGameStatus::Failed => "failed",
                }
                .to_string(),
                result: game.result.clone(),
                plies: game.plies,
                error: game.error.clone(),
                artifact_available: directory_game_path(app, &state.batch_id, game.index)?.exists(),
            })
        })
        .collect::<Result<Vec<_>, Error>>()?;
    manifest.summary.recorded_games = manifest
        .games
        .iter()
        .filter(|game| game.artifact_available)
        .count() as u32;
    write_manifest(app, &manifest)
}

fn directory_game_path(app: &AppHandle, experiment_id: &str, index: u32) -> Result<PathBuf, Error> {
    Ok(experiment_directory(app, experiment_id)?
        .join("games")
        .join(format!("game-{:04}.pgn", index + 1)))
}

fn directory_game_manifest_path(
    app: &AppHandle,
    experiment_id: &str,
    index: u32,
) -> Result<PathBuf, Error> {
    Ok(experiment_directory(app, experiment_id)?
        .join("games")
        .join(format!("game-{:04}.manifest.json", index + 1)))
}

fn analysis_path(directory: &Path) -> PathBuf {
    directory.join("analysis-v2.json")
}

fn empirical_wdl_path(directory: &Path) -> PathBuf {
    directory.join("empirical-wdl-v1.json")
}

fn wilson_interval(successes: u32, sample_size: u32) -> EmpiricalWdlInterval {
    if sample_size == 0 {
        return EmpiricalWdlInterval {
            lower: 0.0,
            upper: 0.0,
        };
    }

    let n = sample_size as f64;
    let p = successes as f64 / n;
    let z = 1.96;
    let denominator = 1.0 + z * z / n;
    let center = (p + z * z / (2.0 * n)) / denominator;
    let spread = z * ((p * (1.0 - p) / n + z * z / (4.0 * n * n)).sqrt()) / denominator;

    EmpiricalWdlInterval {
        lower: (center - spread).max(0.0),
        upper: (center + spread).min(1.0),
    }
}

fn empirical_calibration(
    predicted: [f64; 3],
    white_wins: u32,
    draws: u32,
    black_wins: u32,
) -> EmpiricalWdlCalibration {
    let sample_size = white_wins + draws + black_wins;
    let observed = [
        white_wins as f64 / sample_size as f64,
        draws as f64 / sample_size as f64,
        black_wins as f64 / sample_size as f64,
    ];
    let mean_absolute_error = predicted
        .iter()
        .zip(observed)
        .map(|(prediction, actual)| (prediction - actual).abs())
        .sum::<f64>()
        / 2.0;
    let outcomes = [white_wins, draws, black_wins];
    let brier_sum = outcomes
        .iter()
        .enumerate()
        .map(|(outcome, count)| {
            let score = predicted
                .iter()
                .enumerate()
                .map(|(index, probability)| {
                    let target = f64::from(index == outcome);
                    (probability - target).powi(2)
                })
                .sum::<f64>();
            f64::from(*count) * score
        })
        .sum::<f64>();

    EmpiricalWdlCalibration {
        mean_absolute_error: mean_absolute_error * 100.0,
        brier_score: brier_sum / f64::from(sample_size),
    }
}

fn score_to_white_cp(score: &ScoreValue) -> i32 {
    let cp = match score {
        ScoreValue::Cp(value) => *value,
        ScoreValue::Mate(value) => 1000 * value.signum(),
    };
    cp.clamp(-1000, 1000)
}

fn terminal_score(position: &Chess) -> i32 {
    if position.is_checkmate() {
        match position.turn() {
            Color::White => -1000,
            Color::Black => 1000,
        }
    } else {
        0
    }
}

fn cp_loss(before: i32, after: i32, color: Color) -> i32 {
    let (before, after) = match color {
        Color::White => (before, after),
        Color::Black => (-before, -after),
    };
    (before - after).max(0)
}

fn classify_phase(position: &Chess, ply: usize) -> AnalysisPhase {
    if ply < 20 {
        return AnalysisPhase::Opening;
    }

    let material = position.board().material();
    let pieces = material.white.pawn as u32
        + material.white.knight as u32
        + material.white.bishop as u32
        + material.white.rook as u32
        + material.white.queen as u32
        + material.black.pawn as u32
        + material.black.knight as u32
        + material.black.bishop as u32
        + material.black.rook as u32
        + material.black.queen as u32;
    let queens = material.white.queen as u32 + material.black.queen as u32;

    if queens == 0 || pieces <= 10 {
        AnalysisPhase::Endgame
    } else {
        AnalysisPhase::Middlegame
    }
}

fn phase_label(phase: AnalysisPhase) -> &'static str {
    match phase {
        AnalysisPhase::Opening => "opening",
        AnalysisPhase::Middlegame => "middlegame",
        AnalysisPhase::Endgame => "endgame",
    }
}

fn phase_metrics(
    metrics: &BTreeMap<AnalysisPhase, MetricAccumulator>,
) -> Vec<ExperimentAnalysisPhaseMetrics> {
    metrics
        .iter()
        .map(|(phase, accumulator)| {
            let side = accumulator.into_public();
            ExperimentAnalysisPhaseMetrics {
                phase: phase_label(*phase).to_string(),
                moves: side.moves,
                acpl: side.acpl,
                inaccuracies: side.inaccuracies,
                mistakes: side.mistakes,
                blunders: side.blunders,
            }
        })
        .collect()
}

fn update_player(
    players: &mut BTreeMap<String, PlayerAccumulator>,
    name: &str,
    color: Color,
    metrics: &MetricAccumulator,
    result: &Option<GameResult>,
) {
    let player = players.entry(name.to_string()).or_default();
    player.games += 1;
    match color {
        Color::White => player.white_games += 1,
        Color::Black => player.black_games += 1,
    }
    player.metrics.merge(metrics);

    match result {
        Some(GameResult::Draw { .. }) => player.draws += 1,
        Some(GameResult::WhiteWins { .. }) if color == Color::White => player.wins += 1,
        Some(GameResult::BlackWins { .. }) if color == Color::Black => player.wins += 1,
        Some(GameResult::WhiteWins { .. }) | Some(GameResult::BlackWins { .. }) => {
            player.losses += 1
        }
        None => {}
    }
}

async fn reset_analysis_engine(
    base: &mut BaseEngine,
    reader: &mut EngineReader,
) -> Result<(), Error> {
    base.send("ucinewgame").await?;
    base.send("isready").await?;
    while let Some(line) = reader.next_line().await? {
        base.log_engine(&line);
        if line.starts_with("readyok") {
            return Ok(());
        }
    }
    Err(Error::EngineDisconnected)
}

fn has_inline_initial_moves(game: &StoredGameForAnalysis) -> bool {
    !game.initial_moves.is_empty()
        && game.moves.len() >= game.initial_moves.len()
        && game
            .initial_moves
            .iter()
            .zip(game.moves.iter())
            .all(|(expected, actual)| expected == &actual.uci)
}

fn is_initial_move(game: &StoredGameForAnalysis, index: usize, inline_initial: bool) -> bool {
    game.moves[index].source.as_deref() == Some("initial")
        || (!game
            .moves
            .iter()
            .any(|m| m.source.as_deref() == Some("initial"))
            && inline_initial
            && index < game.initial_moves.len())
}

fn generated_move_count(game: &StoredGameForAnalysis) -> usize {
    let inline_initial = has_inline_initial_moves(game);
    game.moves
        .iter()
        .enumerate()
        .filter(|(index, _)| !is_initial_move(game, *index, inline_initial))
        .count()
}

async fn analyze_game_artifact(
    base: &mut BaseEngine,
    reader: &mut EngineReader,
    game_summary: &ModelGameExperimentGame,
    game: &StoredGameForAnalysis,
    go_mode: &GoMode,
    inaccuracy_threshold_cp: u32,
    mistake_threshold_cp: u32,
    blunder_threshold_cp: u32,
    progress_id: &str,
    completed_plies: &mut usize,
    total_plies: usize,
    app: &AppHandle,
    state: &crate::AppState,
    cancel_flag: &AtomicBool,
) -> Result<Option<ExperimentAnalysisGame>, Error> {
    let mut position = parse_fen_and_apply_moves(&game.initial_fen, &[])?;
    let mut history = Vec::new();
    let inline_initial = has_inline_initial_moves(game);
    let has_initial_source = game
        .moves
        .iter()
        .any(|move_| move_.source.as_deref() == Some("initial"));

    if !inline_initial && !has_initial_source {
        for initial_move in &game.initial_moves {
            let uci = UciMove::from_ascii(initial_move.as_bytes())?;
            let chess_move = uci.to_move(&position)?;
            position.play_unchecked(&chess_move);
            history.push(initial_move.clone());
        }
    }

    let mut previous_score = None;
    let mut white_metrics = MetricAccumulator::default();
    let mut black_metrics = MetricAccumulator::default();
    let mut phase_accumulators: BTreeMap<AnalysisPhase, MetricAccumulator> = BTreeMap::new();
    let mut analyzed_plies = 0;

    for (index, game_move) in game.moves.iter().enumerate() {
        if cancel_flag.load(Ordering::SeqCst) {
            return Err(Error::AnalysisCancelled);
        }

        let uci = UciMove::from_ascii(game_move.uci.as_bytes())?;
        let chess_move = uci.to_move(&position)?;
        let color = position.turn();
        let initial = is_initial_move(game, index, inline_initial);

        if initial {
            position.play_unchecked(&chess_move);
            history.push(game_move.uci.clone());
            continue;
        }

        if previous_score.is_none() {
            let score =
                evaluate_position_score(base, reader, &game.initial_fen, &history, go_mode).await?;
            previous_score = Some(score_to_white_cp(&score));
        }

        let phase = classify_phase(&position, analyzed_plies as usize);
        position.play_unchecked(&chess_move);
        history.push(game_move.uci.clone());

        let next_score = if position.is_game_over() {
            terminal_score(&position)
        } else {
            let score =
                evaluate_position_score(base, reader, &game.initial_fen, &history, go_mode).await?;
            score_to_white_cp(&score)
        };
        let loss = cp_loss(previous_score.unwrap_or(0), next_score, color);
        let phase_accumulator = phase_accumulators.entry(phase).or_default();
        phase_accumulator.add_loss(
            loss,
            inaccuracy_threshold_cp,
            mistake_threshold_cp,
            blunder_threshold_cp,
        );
        match color {
            Color::White => white_metrics.add_loss(
                loss,
                inaccuracy_threshold_cp,
                mistake_threshold_cp,
                blunder_threshold_cp,
            ),
            Color::Black => black_metrics.add_loss(
                loss,
                inaccuracy_threshold_cp,
                mistake_threshold_cp,
                blunder_threshold_cp,
            ),
        }
        previous_score = Some(next_score);
        analyzed_plies += 1;
        *completed_plies += 1;
        update_progress(
            &state.progress_state,
            app,
            progress_id.to_string(),
            (*completed_plies as f32 / total_plies.max(1) as f32) * 100.0,
            false,
        )?;
    }

    if analyzed_plies == 0 {
        return Ok(None);
    }

    Ok(Some(ExperimentAnalysisGame {
        index: game_summary.index,
        game_id: game_summary.game_id.clone(),
        white_player: game_summary.white_player.clone(),
        black_player: game_summary.black_player.clone(),
        result: game.result.clone().or_else(|| game_summary.result.clone()),
        analyzed_plies,
        white: white_metrics.into_public(),
        black: black_metrics.into_public(),
        phases: phase_metrics(&phase_accumulators),
    }))
}

fn merge_public_metrics(
    accumulator: &mut MetricAccumulator,
    metrics: &ExperimentAnalysisSideMetrics,
) {
    accumulator.moves += metrics.moves;
    accumulator.loss_sum += metrics.acpl.unwrap_or(0.0) * metrics.moves as f64;
    accumulator.inaccuracies += metrics.inaccuracies;
    accumulator.mistakes += metrics.mistakes;
    accumulator.blunders += metrics.blunders;
}

fn merge_phase_metrics(
    accumulators: &mut BTreeMap<AnalysisPhase, MetricAccumulator>,
    metrics: &[ExperimentAnalysisPhaseMetrics],
) {
    for metric in metrics {
        let phase = match metric.phase.as_str() {
            "opening" => AnalysisPhase::Opening,
            "middlegame" => AnalysisPhase::Middlegame,
            "endgame" => AnalysisPhase::Endgame,
            _ => continue,
        };
        let accumulator = accumulators.entry(phase).or_default();
        accumulator.moves += metric.moves;
        accumulator.loss_sum += metric.acpl.unwrap_or(0.0) * metric.moves as f64;
        accumulator.inaccuracies += metric.inaccuracies;
        accumulator.mistakes += metric.mistakes;
        accumulator.blunders += metric.blunders;
    }
}

async fn analyze_model_game_experiment_inner(
    analysis_id: &str,
    experiment_id: &str,
    engine: String,
    engine_args: Vec<String>,
    go_mode: GoMode,
    uci_options: Vec<EngineOption>,
    app: &AppHandle,
    state: &crate::AppState,
    cancel_flag: &AtomicBool,
) -> Result<ExperimentAnalysisResult, Error> {
    if matches!(go_mode, GoMode::Infinite) {
        return Err(Error::InvalidModelGameExperiment(
            "experiment analysis requires a bounded engine limit".to_string(),
        ));
    }

    const INACCURACY_THRESHOLD_CP: u32 = 40;
    const MISTAKE_THRESHOLD_CP: u32 = 100;
    const BLUNDER_THRESHOLD_CP: u32 = 200;

    let manifest = read_manifest(app, experiment_id)?;
    let mut candidates = Vec::new();
    for game in &manifest.games {
        if game.status != "completed" || !game.artifact_available {
            continue;
        }
        let path = directory_game_manifest_path(app, experiment_id, game.index)?;
        let Ok(stored_game) = read_json::<StoredGameForAnalysis>(&path) else {
            continue;
        };
        candidates.push((game.clone(), stored_game));
    }

    let total_plies: usize = candidates
        .iter()
        .map(|(_, game)| generated_move_count(game))
        .sum();
    if total_plies == 0 {
        return Err(Error::InvalidModelGameExperiment(
            "the experiment has no analyzable completed moves".to_string(),
        ));
    }

    let mut base = BaseEngine::spawn(PathBuf::from(&engine), &engine_args).await?;
    base.init_uci().await?;

    let initial_fen: Fen = manifest.summary.initial_fen.parse()?;
    let castling_mode = CastlingMode::detect(initial_fen.as_setup());
    base.set_option_if_supported("UCI_Chess960", castling_mode.is_chess960())
        .await?;

    let mut effective_options = uci_options;
    let mut has_multipv = false;
    for option in &mut effective_options {
        if option.name == "MultiPV" {
            option.value = "1".to_string();
            has_multipv = true;
        }
        base.set_option(&option.name, &option.value).await?;
    }
    if !has_multipv {
        base.set_option("MultiPV", 1).await?;
        effective_options.push(EngineOption {
            name: "MultiPV".to_string(),
            value: "1".to_string(),
        });
    }

    let mut reader = base.take_reader().ok_or(Error::EngineDisconnected)?;
    let mut completed_plies = 0;
    let mut games = Vec::new();
    let mut white_metrics = MetricAccumulator::default();
    let mut black_metrics = MetricAccumulator::default();
    let mut phase_accumulators = BTreeMap::new();
    let mut players = BTreeMap::new();
    let mut white_wins = 0;
    let mut black_wins = 0;
    let mut draws = 0;

    for (game_summary, stored_game) in &candidates {
        reset_analysis_engine(&mut base, &mut reader).await?;
        let analyzed = analyze_game_artifact(
            &mut base,
            &mut reader,
            game_summary,
            stored_game,
            &go_mode,
            INACCURACY_THRESHOLD_CP,
            MISTAKE_THRESHOLD_CP,
            BLUNDER_THRESHOLD_CP,
            analysis_id,
            &mut completed_plies,
            total_plies,
            app,
            state,
            cancel_flag,
        )
        .await?;

        let Some(analyzed) = analyzed else {
            continue;
        };

        match analyzed.result {
            Some(GameResult::WhiteWins { .. }) => white_wins += 1,
            Some(GameResult::BlackWins { .. }) => black_wins += 1,
            Some(GameResult::Draw { .. }) => draws += 1,
            None => {}
        }

        merge_public_metrics(&mut white_metrics, &analyzed.white);
        merge_public_metrics(&mut black_metrics, &analyzed.black);
        merge_phase_metrics(&mut phase_accumulators, &analyzed.phases);

        let result = &analyzed.result;
        let white_side = accumulator_from_public(&analyzed.white);
        let black_side = accumulator_from_public(&analyzed.black);
        update_player(
            &mut players,
            &analyzed.white_player,
            Color::White,
            &white_side,
            result,
        );
        update_player(
            &mut players,
            &analyzed.black_player,
            Color::Black,
            &black_side,
            result,
        );
        games.push(analyzed);
    }

    let summary = ExperimentAnalysisSummary {
        sample_size: games.len() as u32,
        skipped_games: (manifest.games.len() as u32).saturating_sub(games.len() as u32),
        analyzed_plies: completed_plies as u32,
        white_wins,
        black_wins,
        draws,
        average_plies: (!games.is_empty()).then(|| {
            games
                .iter()
                .map(|game| game.analyzed_plies as f64)
                .sum::<f64>()
                / games.len() as f64
        }),
        white: white_metrics.into_public(),
        black: black_metrics.into_public(),
        players: players
            .into_iter()
            .map(|(name, metrics)| metrics.into_public(name))
            .collect(),
        phases: phase_metrics(&phase_accumulators),
    };

    let result = ExperimentAnalysisResult {
        schema_version: 2,
        experiment_id: experiment_id.to_string(),
        analyzed_at: now(),
        evaluator: ExperimentAnalysisEvaluator {
            engine,
            engine_args,
            go_mode,
            uci_options: effective_options,
            inaccuracy_threshold_cp: INACCURACY_THRESHOLD_CP,
            mistake_threshold_cp: MISTAKE_THRESHOLD_CP,
            blunder_threshold_cp: BLUNDER_THRESHOLD_CP,
        },
        summary,
        games,
    };

    let directory = experiment_directory(app, experiment_id)?;
    write_json(&analysis_path(&directory), &result)?;
    update_progress(
        &state.progress_state,
        app,
        analysis_id.to_string(),
        100.0,
        true,
    )?;
    base.quit().await?;
    Ok(result)
}

fn experiment_initial_moves(manifest: &StoredExperimentManifest) -> Vec<String> {
    manifest
        .batch_config
        .as_ref()
        .map(|config| config.game_config.initial_moves.clone())
        .or_else(|| {
            manifest
                .single_config
                .as_ref()
                .map(|config| config.initial_moves.clone())
        })
        .unwrap_or_default()
}

async fn analyze_empirical_wdl_inner(
    experiment_id: &str,
    engine: String,
    engine_args: Vec<String>,
    go_mode: GoMode,
    uci_options: Vec<EngineOption>,
    app: &AppHandle,
) -> Result<EmpiricalWdlResult, Error> {
    if matches!(go_mode, GoMode::Infinite) {
        return Err(Error::InvalidModelGameExperiment(
            "empirical W/D/L analysis requires a bounded engine limit".to_string(),
        ));
    }

    let manifest = read_manifest(app, experiment_id)?;
    let completed: Vec<&ModelGameExperimentGame> = manifest
        .games
        .iter()
        .filter(|game| game.status == "completed" && game.result.is_some())
        .collect();
    if completed.is_empty() {
        return Err(Error::InvalidModelGameExperiment(
            "the experiment has no completed games with results".to_string(),
        ));
    }

    let initial_fen = manifest.summary.initial_fen.clone();
    let initial_moves = experiment_initial_moves(&manifest);
    let parsed_fen: Fen = initial_fen.parse()?;
    let mut base = BaseEngine::spawn(PathBuf::from(&engine), &engine_args).await?;
    base.init_uci().await?;
    let castling_mode = CastlingMode::detect(parsed_fen.as_setup());
    base.set_option_if_supported("UCI_Chess960", castling_mode.is_chess960())
        .await?;

    let mut effective_options = uci_options;
    let mut has_multipv = false;
    for option in &mut effective_options {
        if option.name == "MultiPV" {
            option.value = "1".to_string();
            has_multipv = true;
        }
        base.set_option(&option.name, &option.value).await?;
    }
    if !has_multipv {
        base.set_option("MultiPV", 1).await?;
        effective_options.push(EngineOption {
            name: "MultiPV".to_string(),
            value: "1".to_string(),
        });
    }

    let mut reader = base.take_reader().ok_or(Error::EngineDisconnected)?;
    reset_analysis_engine(&mut base, &mut reader).await?;
    let Some((raw_white_win, raw_draw, raw_black_win)) = evaluate_position_wdl(
        &mut base,
        &mut reader,
        &initial_fen,
        &initial_moves,
        &go_mode,
    )
    .await?
    else {
        return Err(Error::InvalidModelGameExperiment(
            "the selected engine did not return UCI W/D/L data".to_string(),
        ));
    };

    let raw_total = raw_white_win as f64 + raw_draw as f64 + raw_black_win as f64;
    if raw_total <= 0.0 {
        return Err(Error::InvalidModelGameExperiment(
            "the selected engine returned empty UCI W/D/L data".to_string(),
        ));
    }

    let white_wins = completed
        .iter()
        .filter(|game| matches!(game.result, Some(GameResult::WhiteWins { .. })))
        .count() as u32;
    let draws = completed
        .iter()
        .filter(|game| matches!(game.result, Some(GameResult::Draw { .. })))
        .count() as u32;
    let black_wins = completed
        .iter()
        .filter(|game| matches!(game.result, Some(GameResult::BlackWins { .. })))
        .count() as u32;
    let sample_size = white_wins + draws + black_wins;
    let observed_white = white_wins as f64 / sample_size as f64;
    let observed_draw = draws as f64 / sample_size as f64;
    let observed_black = black_wins as f64 / sample_size as f64;
    let predicted_white = raw_white_win as f64 / raw_total;
    let predicted_draw = raw_draw as f64 / raw_total;
    let predicted_black = raw_black_win as f64 / raw_total;
    let calibration = empirical_calibration(
        [predicted_white, predicted_draw, predicted_black],
        white_wins,
        draws,
        black_wins,
    );

    let result = EmpiricalWdlResult {
        schema_version: 1,
        experiment_id: experiment_id.to_string(),
        analyzed_at: now(),
        initial_fen,
        initial_moves,
        evaluator: EmpiricalWdlEvaluator {
            engine,
            engine_args,
            go_mode,
            uci_options: effective_options,
        },
        prediction: EmpiricalWdlPrediction {
            white_win: predicted_white * 100.0,
            draw: predicted_draw * 100.0,
            black_win: predicted_black * 100.0,
            raw_white_win,
            raw_draw,
            raw_black_win,
        },
        observed: EmpiricalWdlObserved {
            sample_size,
            white_wins,
            draws,
            black_wins,
            white_win: observed_white * 100.0,
            draw: observed_draw * 100.0,
            black_win: observed_black * 100.0,
            white_win_interval: wilson_interval(white_wins, sample_size),
            draw_interval: wilson_interval(draws, sample_size),
            black_win_interval: wilson_interval(black_wins, sample_size),
        },
        calibration,
    };

    let directory = experiment_directory(app, experiment_id)?;
    write_json(&empirical_wdl_path(&directory), &result)?;
    base.quit().await?;
    Ok(result)
}

fn accumulator_from_public(metrics: &ExperimentAnalysisSideMetrics) -> MetricAccumulator {
    MetricAccumulator {
        moves: metrics.moves,
        loss_sum: metrics.acpl.unwrap_or(0.0) * metrics.moves as f64,
        inaccuracies: metrics.inaccuracies,
        mistakes: metrics.mistakes,
        blunders: metrics.blunders,
    }
}

pub async fn persist_game_artifacts(
    app: &AppHandle,
    experiment_id: &str,
    index: u32,
    attempt: u32,
    game_id: &str,
    game_manager: &GameManager,
    primary: bool,
    wait_for_logs: bool,
) -> Result<GameManifest, Error> {
    let manifest = game_manager.get_game_manifest(game_id).await?;
    let white_logs = if wait_for_logs {
        game_manager.get_engine_logs(game_id, "white").await
    } else {
        game_manager.try_get_engine_logs(game_id, "white").await
    }
    .unwrap_or_default();
    let black_logs = if wait_for_logs {
        game_manager.get_engine_logs(game_id, "black").await
    } else {
        game_manager.try_get_engine_logs(game_id, "black").await
    }
    .unwrap_or_default();
    let directory = experiment_directory(app, experiment_id)?;
    let prefix = format!("game-{:04}", index + 1);

    if primary {
        fs::create_dir_all(directory.join("games"))?;
        fs::create_dir_all(directory.join("logs"))?;
        fs::write(
            directory.join("games").join(format!("{prefix}.pgn")),
            build_pgn(experiment_id, index, &manifest),
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

pub fn create_single_experiment(
    app: &AppHandle,
    experiment_id: &str,
    owner_id: &str,
    game_id: &str,
    config: &GameConfig,
) -> Result<(), Error> {
    let directory = experiment_directory(app, experiment_id)?;
    fs::create_dir_all(directory.join("games"))?;
    fs::create_dir_all(directory.join("logs"))?;
    let timestamp = now();
    let manifest = StoredExperimentManifest {
        schema_version: EXPERIMENT_SCHEMA_VERSION,
        application_version: env!("CARGO_PKG_VERSION").to_string(),
        summary: ModelGameExperimentSummary {
            experiment_id: experiment_id.to_string(),
            owner_id: owner_id.to_string(),
            kind: ModelGameExperimentKind::Single,
            status: ModelGameExperimentStatus::Running,
            created_at: timestamp.clone(),
            updated_at: timestamp,
            white_player: player_name(&config.white),
            black_player: player_name(&config.black),
            initial_fen: config
                .initial_fen
                .clone()
                .unwrap_or_else(|| STANDARD_INITIAL_FEN.to_string()),
            total_games: 1,
            completed_games: 0,
            failed_games: 0,
            recorded_games: 0,
        },
        games: Vec::new(),
        batch_config: None,
        single_config: Some(config.clone()),
        single_game_id: Some(game_id.to_string()),
    };
    write_manifest(app, &manifest)
}

pub async fn finalize_single_experiment(
    app: &AppHandle,
    experiment_id: &str,
    game_id: &str,
    game_manager: &GameManager,
    cancelled: bool,
) -> Result<ModelGameExperimentDetail, Error> {
    let game_manifest = persist_game_artifacts(
        app,
        experiment_id,
        0,
        1,
        game_id,
        game_manager,
        true,
        !cancelled,
    )
    .await?;
    let mut manifest = read_manifest(app, experiment_id)?;
    let result = game_manifest.result.clone();
    let completed = !cancelled && result.is_some();
    manifest.summary.status = if cancelled {
        ModelGameExperimentStatus::Cancelled
    } else {
        ModelGameExperimentStatus::Completed
    };
    manifest.summary.updated_at = now();
    manifest.summary.completed_games = u32::from(completed);
    manifest.summary.recorded_games = 1;
    manifest.games = vec![ModelGameExperimentGame {
        index: 0,
        game_id: game_id.to_string(),
        white_player: player_name(&game_manifest.white),
        black_player: player_name(&game_manifest.black),
        white_seed: player_seed(&game_manifest.white),
        black_seed: player_seed(&game_manifest.black),
        attempts: 1,
        status: if cancelled { "cancelled" } else { "completed" }.to_string(),
        result,
        plies: game_manifest.moves.len() as u32,
        error: None,
        artifact_available: true,
    }];
    write_manifest(app, &manifest)?;
    Ok(ModelGameExperimentDetail {
        summary: manifest.summary,
        games: manifest.games,
    })
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

fn build_pgn(experiment_id: &str, index: u32, manifest: &GameManifest) -> String {
    let result = result_text(&manifest.result);
    let date = manifest
        .started_at
        .get(0..10)
        .unwrap_or("????-??-??")
        .replace('-', ".");
    let mut headers = vec![
        ("Event", "Chess Lab Model Game".to_string()),
        ("Site", "Chess Lab".to_string()),
        ("Date", date),
        ("Round", (index + 1).to_string()),
        ("White", player_name(&manifest.white)),
        ("Black", player_name(&manifest.black)),
        ("Result", result.to_string()),
        ("ChessLabExperiment", experiment_id.to_string()),
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
        let move_number = first_move_number + (absolute_ply as u32 / 2);
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

#[tauri::command]
#[specta::specta]
pub async fn list_model_game_experiments(
    app: AppHandle,
) -> Result<Vec<ModelGameExperimentSummary>, Error> {
    let root = experiments_root(&app)?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut summaries = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let path = manifest_path(&entry.path());
        if let Ok(manifest) = read_json::<StoredExperimentManifest>(&path) {
            summaries.push(manifest.summary);
        }
    }
    summaries.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(summaries)
}

pub fn recover_interrupted_experiments(app: &AppHandle) -> Result<(), Error> {
    let root = experiments_root(app)?;
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = manifest_path(&entry.path());
        let Ok(mut manifest) = read_json::<StoredExperimentManifest>(&path) else {
            continue;
        };
        if manifest.summary.status == ModelGameExperimentStatus::Running {
            manifest.summary.status = ModelGameExperimentStatus::Cancelled;
            manifest.summary.updated_at = now();
            write_manifest(app, &manifest)?;
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_model_game_experiment(
    experiment_id: String,
    app: AppHandle,
) -> Result<ModelGameExperimentDetail, Error> {
    let manifest = read_manifest(&app, &experiment_id)?;
    Ok(ModelGameExperimentDetail {
        summary: manifest.summary,
        games: manifest.games,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn analyze_model_game_experiment(
    analysis_id: String,
    experiment_id: String,
    engine: String,
    engine_args: Vec<String>,
    go_mode: GoMode,
    uci_options: Vec<EngineOption>,
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ExperimentAnalysisResult, Error> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    state
        .analysis_cancel_flags
        .insert(analysis_id.clone(), cancel_flag.clone());

    let result = analyze_model_game_experiment_inner(
        &analysis_id,
        &experiment_id,
        engine,
        engine_args,
        go_mode,
        uci_options,
        &app,
        &state,
        &cancel_flag,
    )
    .await;

    state.analysis_cancel_flags.remove(&analysis_id);
    result
}

#[tauri::command]
#[specta::specta]
pub fn get_model_game_experiment_analysis(
    experiment_id: String,
    app: AppHandle,
) -> Result<Option<ExperimentAnalysisResult>, Error> {
    let directory = experiment_directory(&app, &experiment_id)?;
    let path = analysis_path(&directory);
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(read_json(&path)?))
}

#[tauri::command]
#[specta::specta]
pub async fn analyze_model_game_experiment_empirical_wdl(
    experiment_id: String,
    engine: String,
    engine_args: Vec<String>,
    go_mode: GoMode,
    uci_options: Vec<EngineOption>,
    app: AppHandle,
) -> Result<EmpiricalWdlResult, Error> {
    analyze_empirical_wdl_inner(
        &experiment_id,
        engine,
        engine_args,
        go_mode,
        uci_options,
        &app,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub fn get_model_game_experiment_empirical_wdl(
    experiment_id: String,
    app: AppHandle,
) -> Result<Option<EmpiricalWdlResult>, Error> {
    let directory = experiment_directory(&app, &experiment_id)?;
    let path = empirical_wdl_path(&directory);
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(read_json(&path)?))
}

#[tauri::command]
#[specta::specta]
pub async fn read_model_game_experiment_game(
    experiment_id: String,
    index: u32,
    app: AppHandle,
) -> Result<ModelGameExperimentGameArtifact, Error> {
    let path = directory_game_path(&app, &experiment_id, index)?;
    if !path.exists() {
        return Err(Error::ModelGameExperimentGameNotFound {
            experiment_id,
            index,
        });
    }
    Ok(ModelGameExperimentGameArtifact {
        experiment_id,
        index,
        pgn: fs::read_to_string(path)?,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn delete_model_game_experiment(
    experiment_id: String,
    app: AppHandle,
) -> Result<(), Error> {
    let directory = experiment_directory(&app, &experiment_id)?;
    if !directory.exists() {
        return Err(Error::ModelGameExperimentNotFound(experiment_id));
    }
    let manifest: StoredExperimentManifest = read_json(&manifest_path(&directory))?;
    if manifest.summary.status == ModelGameExperimentStatus::Running {
        return Err(Error::InvalidModelGameExperiment(
            "a running experiment cannot be deleted".to_string(),
        ));
    }
    fs::remove_dir_all(directory)?;
    Ok(())
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
        return Err(Error::InvalidModelGameExperiment(
            "the export folder name contains invalid characters".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn export_model_game_experiment(
    experiment_id: String,
    destination_directory: String,
    folder_name: String,
    app: AppHandle,
) -> Result<String, Error> {
    let source = experiment_directory(&app, &experiment_id)?;
    if !source.exists() {
        return Err(Error::ModelGameExperimentNotFound(experiment_id.clone()));
    }
    let manifest: StoredExperimentManifest = read_json(&manifest_path(&source))?;
    if manifest.summary.status == ModelGameExperimentStatus::Running {
        return Err(Error::InvalidModelGameExperiment(
            "a running experiment cannot be exported".to_string(),
        ));
    }
    let folder_name = validate_export_folder_name(&folder_name)?;
    let destination = PathBuf::from(destination_directory).join(folder_name);
    if destination.exists() {
        return Err(Error::InvalidModelGameExperiment(format!(
            "export destination already exists: {}",
            destination.display()
        )));
    }
    copy_directory(&source, &destination)?;
    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn start_single_model_game_experiment(
    experiment_id: String,
    owner_id: String,
    game_id: String,
    config: GameConfig,
    app: AppHandle,
) -> Result<(), Error> {
    create_single_experiment(&app, &experiment_id, &owner_id, &game_id, &config)
}

#[tauri::command]
#[specta::specta]
pub async fn finalize_single_model_game_experiment(
    experiment_id: String,
    game_id: String,
    cancelled: bool,
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ModelGameExperimentDetail, Error> {
    finalize_single_experiment(
        &app,
        &experiment_id,
        &game_id,
        &state.game_manager,
        cancelled,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn finalize_single_model_game_experiments_for_owner(
    owner_id: String,
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), Error> {
    let root = experiments_root(&app)?;
    if !root.exists() {
        return Ok(());
    }
    let mut pending = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = manifest_path(&entry.path());
        let Ok(manifest) = read_json::<StoredExperimentManifest>(&path) else {
            continue;
        };
        if manifest.summary.kind == ModelGameExperimentKind::Single
            && manifest.summary.status == ModelGameExperimentStatus::Running
            && manifest.summary.owner_id == owner_id
        {
            if let Some(game_id) = manifest.single_game_id {
                pending.push((manifest.summary.experiment_id, game_id));
            }
        }
    }
    for (experiment_id, game_id) in pending {
        if let Err(error) =
            finalize_single_experiment(&app, &experiment_id, &game_id, &state.game_manager, true)
                .await
        {
            log::warn!(
                "Could not finalize experiment {experiment_id} while closing its tab: {error}"
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::{GameEndReason, GameMove, GameMoveSource, GameStatus, ManifestHardware};

    fn player(name: &str) -> PlayerConfig {
        PlayerConfig::Human {
            name: name.to_string(),
        }
    }

    #[test]
    fn pgn_from_initial_position_is_parseable_movetext() {
        let manifest = GameManifest {
            schema_version: 1,
            application_version: "test".to_string(),
            game_id: "game".to_string(),
            started_at: "2026-08-16T12:00:00.000Z".to_string(),
            exported_at: "2026-08-16T12:01:00.000Z".to_string(),
            hardware: ManifestHardware {
                operating_system: "test".to_string(),
                architecture: "test".to_string(),
                logical_cpus: 1,
            },
            initial_fen: STANDARD_INITIAL_FEN.to_string(),
            initial_moves: Vec::new(),
            white: player("White"),
            black: player("Black"),
            white_engine_launch: None,
            black_engine_launch: None,
            white_time_control: None,
            black_time_control: None,
            opening_book: None,
            status: GameStatus::Finished {
                result: GameResult::WhiteWins {
                    reason: GameEndReason::Checkmate,
                },
            },
            result: Some(GameResult::WhiteWins {
                reason: GameEndReason::Checkmate,
            }),
            moves: vec![
                GameMove {
                    uci: "e2e4".to_string(),
                    san: "e4".to_string(),
                    fen_after: String::new(),
                    clock: None,
                    white_time: None,
                    black_time: None,
                    color: "white".to_string(),
                    source: GameMoveSource::Engine,
                    think_time_ms: None,
                },
                GameMove {
                    uci: "e7e5".to_string(),
                    san: "e5".to_string(),
                    fen_after: String::new(),
                    clock: None,
                    white_time: None,
                    black_time: None,
                    color: "black".to_string(),
                    source: GameMoveSource::Engine,
                    think_time_ms: None,
                },
            ],
            current_fen: String::new(),
        };

        let pgn = build_pgn("experiment", 0, &manifest);
        assert!(pgn.contains("1. e4 e5 1-0"));
        assert!(!pgn.contains("[FEN"));
    }

    #[test]
    fn pgn_preserves_black_to_move_numbering_and_fen() {
        let mut manifest = GameManifest {
            schema_version: 1,
            application_version: "test".to_string(),
            game_id: "game".to_string(),
            started_at: "2026-08-16T12:00:00.000Z".to_string(),
            exported_at: "2026-08-16T12:01:00.000Z".to_string(),
            hardware: ManifestHardware {
                operating_system: "test".to_string(),
                architecture: "test".to_string(),
                logical_cpus: 1,
            },
            initial_fen: "8/8/8/8/8/8/4k3/6K1 b - - 0 42".to_string(),
            initial_moves: Vec::new(),
            white: player("White"),
            black: player("Black"),
            white_engine_launch: None,
            black_engine_launch: None,
            white_time_control: None,
            black_time_control: None,
            opening_book: None,
            status: GameStatus::Playing,
            result: None,
            moves: Vec::new(),
            current_fen: String::new(),
        };
        manifest.moves.push(GameMove {
            uci: "e2e1".to_string(),
            san: "Ke1".to_string(),
            fen_after: String::new(),
            clock: None,
            white_time: None,
            black_time: None,
            color: "black".to_string(),
            source: GameMoveSource::Engine,
            think_time_ms: None,
        });

        let pgn = build_pgn("experiment", 0, &manifest);
        assert!(pgn.contains("[SetUp \"1\"]"));
        assert!(pgn.contains("42... Ke1 *"));
    }

    #[test]
    fn analysis_loss_is_from_the_moving_side_perspective() {
        assert_eq!(cp_loss(80, 20, Color::White), 60);
        assert_eq!(cp_loss(80, 20, Color::Black), 0);
        assert_eq!(cp_loss(-80, -20, Color::Black), 60);
    }

    #[test]
    fn analysis_metric_uses_strict_inaccuracy_mistake_and_blunder_thresholds() {
        let mut metrics = MetricAccumulator::default();
        metrics.add_loss(40, 40, 100, 200);
        metrics.add_loss(41, 40, 100, 200);
        metrics.add_loss(101, 40, 100, 200);
        metrics.add_loss(201, 40, 100, 200);

        assert_eq!(metrics.moves, 4);
        assert_eq!(metrics.inaccuracies, 1);
        assert_eq!(metrics.mistakes, 1);
        assert_eq!(metrics.blunders, 1);
        assert_eq!(metrics.into_public().acpl, Some(383.0 / 4.0));
    }

    #[test]
    fn analysis_score_caps_mate_and_large_centipawn_values() {
        assert_eq!(score_to_white_cp(&ScoreValue::Cp(2500)), 1000);
        assert_eq!(score_to_white_cp(&ScoreValue::Cp(-2500)), -1000);
        assert_eq!(score_to_white_cp(&ScoreValue::Mate(1)), 1000);
        assert_eq!(score_to_white_cp(&ScoreValue::Mate(-1)), -1000);
    }

    #[test]
    fn empirical_calibration_is_zero_when_prediction_matches_observed_results() {
        let calibration = empirical_calibration([0.5, 0.25, 0.25], 2, 1, 1);

        assert_eq!(calibration.mean_absolute_error, 0.0);
        assert_eq!(calibration.brier_score, 0.625);
    }

    #[test]
    fn export_folder_name_rejects_path_separators() {
        assert_eq!(
            validate_export_folder_name("maia-1600").unwrap(),
            "maia-1600"
        );
        assert!(validate_export_folder_name("nested\\folder").is_err());
        assert!(validate_export_folder_name(".").is_err());
    }

    #[test]
    fn wilson_interval_stays_inside_probability_bounds() {
        let interval = wilson_interval(1, 2);

        assert!(interval.lower >= 0.0);
        assert!(interval.upper <= 1.0);
        assert!(interval.lower <= 0.5);
        assert!(interval.upper >= 0.5);
    }
}
