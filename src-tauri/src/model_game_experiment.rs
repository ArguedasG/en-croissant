use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{SecondsFormat, Utc};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};

use crate::{
    error::Error,
    game::{GameConfig, GameManager, GameManifest, GameResult, PlayerConfig},
    model_game_batch::{
        ModelGameBatchConfig, ModelGameBatchGameStatus, ModelGameBatchState, ModelGameBatchStatus,
    },
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

#[tauri::command]
#[specta::specta]
pub async fn export_model_game_experiment(
    experiment_id: String,
    destination_directory: String,
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
    let destination =
        PathBuf::from(destination_directory).join(format!("chess-lab-experiment-{experiment_id}"));
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
}
