#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod bot_league;
mod chess;
mod db;
mod engine;
mod error;
mod game;

mod fs;
mod lexer;
mod model_game_batch;
mod model_game_experiment;
mod oauth;
mod opening;
mod pgn;
mod progress;
mod puzzle;
mod sound;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use bot_league::BotLeagueManager;
use chess::{BestMovesPayload, EngineProcess};
use dashmap::DashMap;
use db::{DatabaseProgress, GameQuery, NormalizedGame, PositionStats};
use derivative::Derivative;
use game::GameManager;
use model_game_batch::ModelGameBatchManager;
use model_game_experiment::{
    analyze_model_game_experiment, analyze_model_game_experiment_empirical_wdl,
    delete_model_game_experiment, export_model_game_experiment,
    finalize_single_model_game_experiment, finalize_single_model_game_experiments_for_owner,
    get_model_game_experiment, get_model_game_experiment_analysis,
    get_model_game_experiment_empirical_wdl, list_model_game_experiments,
    read_model_game_experiment_game, start_single_model_game_experiment,
};
use progress::{clear_progress, get_progress, ProgressEvent, ProgressStore};

use log::LevelFilter;
use oauth::AuthState;
#[cfg(debug_assertions)]
use specta_typescript::{BigIntExportBehavior, Typescript};
use sysinfo::SystemExt;
use tauri::{Manager, Window};
use tauri_plugin_log::{Target, TargetKind};

use crate::bot_league::{
    cancel_bot_league, cancel_bot_leagues_for_owner, delete_bot_league, dismiss_bot_league,
    export_bot_league, get_bot_league, get_bot_league_detail, list_bot_leagues, pause_bot_league,
    read_bot_league_game, resume_bot_league, start_bot_league, BotLeagueEvent,
};
use crate::chess::{
    analyze_game, cancel_analysis, get_engine_config, get_engine_logs, kill_engine, kill_engines,
    stop_engine,
};
use crate::db::{
    clear_games, convert_pgn, create_indexes, delete_database, delete_db_game, delete_empty_games,
    delete_indexes, export_to_pgn, get_player, get_players_game_info, get_tournaments,
    preload_reference_db, search_position, MmapSearchIndex,
};
use crate::fs::set_file_as_executable;
use crate::game::{
    abort_game, get_game_engine_logs, get_game_manifest, get_game_state, make_game_move,
    resign_game, start_game, take_back_game_move, ClockUpdateEvent, GameMoveEvent, GameOverEvent,
};
use crate::model_game_batch::{
    cancel_model_game_batch, cancel_model_game_batches_for_owner, dismiss_model_game_batch,
    get_model_game_batch, pause_model_game_batch, resume_model_game_batch, start_model_game_batch,
    ModelGameBatchEvent,
};
use crate::lexer::lex_pgn;
use crate::oauth::authenticate;
use crate::pgn::{count_pgn_games, delete_game, read_games, write_game};
use crate::puzzle::{
    delete_puzzle_database, get_puzzle, get_puzzle_db_info, get_puzzle_themes,
    get_themes_for_puzzle,
};
use crate::sound::get_sound_server_port;
use crate::{
    chess::get_best_moves,
    db::{
        delete_duplicated_games, edit_db_info, get_db_info, get_games, get_players, merge_players,
        write_db_game,
    },
    fs::{download_file, file_exists, get_file_metadata},
    opening::{
        get_opening_from_fen, get_opening_from_fens, get_opening_from_name, search_opening_name,
    },
};
use std::sync::atomic::AtomicBool;
use tokio::sync::Semaphore;

#[derive(Derivative)]
#[derivative(Default)]
pub struct AppState {
    connection_pool: DashMap<
        String,
        diesel::r2d2::Pool<diesel::r2d2::ConnectionManager<diesel::SqliteConnection>>,
    >,
    line_cache: DashMap<(GameQuery, PathBuf), (Vec<PositionStats>, Vec<NormalizedGame>)>,
    db_cache: Mutex<Option<(PathBuf, MmapSearchIndex)>>,
    #[derivative(Default(value = "Arc::new(Semaphore::new(2))"))]
    new_request: Arc<Semaphore>,
    #[derivative(Default(value = "DashMap::new()"))]
    search_collisions: DashMap<(GameQuery, PathBuf), Arc<tokio::sync::Mutex<()>>>,
    pgn_offsets: DashMap<String, Vec<u64>>,

    engine_processes: DashMap<(String, String), Arc<tokio::sync::Mutex<EngineProcess>>>,
    analysis_cancel_flags: DashMap<String, Arc<AtomicBool>>,
    auth: AuthState,
    game_manager: Arc<GameManager>,
    model_game_batch_manager: ModelGameBatchManager,
    bot_league_manager: BotLeagueManager,
    progress_state: ProgressStore,
}

#[tauri::command]
#[specta::specta]
async fn close_splashscreen(window: Window) -> Result<(), String> {
    window
        .get_webview_window("main")
        .expect("no window labeled 'main' found")
        .show()
        .unwrap();
    Ok(())
}

fn main() {
    let specta_builder = tauri_specta::Builder::new()
        .commands(tauri_specta::collect_commands!(
            close_splashscreen,
            get_best_moves,
            analyze_game,
            cancel_analysis,
            stop_engine,
            kill_engine,
            kill_engines,
            get_engine_logs,
            memory_size,
            get_puzzle,
            search_opening_name,
            get_opening_from_fen,
            get_opening_from_fens,
            get_opening_from_name,
            get_players_game_info,
            get_engine_config,
            file_exists,
            get_file_metadata,
            merge_players,
            convert_pgn,
            get_player,
            count_pgn_games,
            read_games,
            lex_pgn,
            is_bmi2_compatible,
            delete_game,
            delete_duplicated_games,
            delete_empty_games,
            clear_games,
            set_file_as_executable,
            delete_indexes,
            create_indexes,
            edit_db_info,
            delete_db_game,
            write_db_game,
            delete_database,
            export_to_pgn,
            authenticate,
            write_game,
            download_file,
            get_tournaments,
            get_db_info,
            get_games,
            search_position,
            get_players,
            get_puzzle_db_info,
            get_puzzle_themes,
            get_themes_for_puzzle,
            delete_puzzle_database,
            start_game,
            get_game_state,
            make_game_move,
            take_back_game_move,
            resign_game,
            abort_game,
            get_game_engine_logs,
            get_game_manifest,
            start_model_game_batch,
            get_model_game_batch,
            pause_model_game_batch,
            resume_model_game_batch,
            cancel_model_game_batch,
            cancel_model_game_batches_for_owner,
            dismiss_model_game_batch,
            start_bot_league,
            get_bot_league,
            pause_bot_league,
            resume_bot_league,
            cancel_bot_league,
            cancel_bot_leagues_for_owner,
            dismiss_bot_league,
            list_bot_leagues,
            get_bot_league_detail,
            read_bot_league_game,
            delete_bot_league,
            export_bot_league,
            list_model_game_experiments,
            get_model_game_experiment,
            analyze_model_game_experiment,
            get_model_game_experiment_analysis,
            analyze_model_game_experiment_empirical_wdl,
            get_model_game_experiment_empirical_wdl,
            read_model_game_experiment_game,
            delete_model_game_experiment,
            export_model_game_experiment,
            start_single_model_game_experiment,
            finalize_single_model_game_experiment,
            finalize_single_model_game_experiments_for_owner,
            preload_reference_db,
            get_progress,
            clear_progress,
            get_sound_server_port
        ))
        .events(tauri_specta::collect_events!(
            BestMovesPayload,
            DatabaseProgress,
            ProgressEvent,
            GameMoveEvent,
            ClockUpdateEvent,
            GameOverEvent,
            ModelGameBatchEvent,
            BotLeagueEvent
        ));

    #[cfg(debug_assertions)]
    specta_builder
        .export(
            Typescript::default().bigint(BigIntExportBehavior::BigInt),
            "../src/bindings/generated.ts",
        )
        .expect("Failed to export types");

    #[cfg(debug_assertions)]
    let log_targets = [TargetKind::Stdout, TargetKind::Webview];

    #[cfg(not(debug_assertions))]
    let log_targets = [
        TargetKind::Stdout,
        TargetKind::LogDir {
            file_name: Some(String::from("en-croissant.log")),
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets(log_targets.map(Target::new))
                .level(LevelFilter::Info)
                .build(),
        )
        .invoke_handler(specta_builder.invoke_handler())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .setup(move |app| {
            log::info!("Setting up application");

            if let Err(error) = model_game_experiment::recover_interrupted_experiments(app.handle())
            {
                log::warn!("Could not recover interrupted model game experiments: {error}");
            }
            if let Err(error) = bot_league::recover_interrupted_bot_leagues(app.handle()) {
                log::warn!("Could not recover interrupted bot leagues: {error}");
            }

            // #[cfg(any(windows, target_os = "macos"))]
            // set_shadow(&app.get_webview_window("main").unwrap(), true).unwrap();

            specta_builder.mount_events(app);

            #[cfg(target_os = "linux")]
            {
                let sound_dir = app
                    .path()
                    .resolve("sound", tauri::path::BaseDirectory::Resource)
                    .expect("failed to resolve sound resource directory");
                let port = sound::start_sound_server(sound_dir);
                app.manage(sound::SoundServerPort(port));
            }
            #[cfg(not(target_os = "linux"))]
            app.manage(sound::SoundServerPort(0));

            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_cli::init())?;

            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            log::info!("Finished rust initialization");

            Ok(())
        })
        .manage(AppState::default())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app.state::<AppState>();
                for entry in state.engine_processes.iter() {
                    if let Ok(mut process) = entry.value().try_lock() {
                        process.kill_sync();
                    }
                }
                state.model_game_batch_manager.cancel_all_sync();
                state.bot_league_manager.cancel_all_sync();
                state.game_manager.kill_all_sync();
            }
        });
}

#[tauri::command]
#[specta::specta]
fn is_bmi2_compatible() -> bool {
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    if is_x86_feature_detected!("bmi2") {
        return true;
    }
    false
}

#[tauri::command]
#[specta::specta]
fn memory_size() -> u32 {
    let total_bytes = sysinfo::System::new_all().total_memory();
    (total_bytes / 1024 / 1024) as u32
}
