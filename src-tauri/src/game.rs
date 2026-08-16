use std::{
    collections::HashMap,
    fs::File,
    io::{BufRead, BufReader, Cursor, Read, Write},
    path::PathBuf,
    sync::Arc,
    time::Instant,
};

use chrono::{SecondsFormat, Utc};
use dashmap::DashMap;
use log::{error, info};
use pgn_reader::{BufferedReader, RawHeader, Skip, Visitor};
use polyglot_book_rs::PolyglotBook;
use rand::{seq::IteratorRandom, Rng};
use serde::{Deserialize, Serialize};
use shakmaty::{
    fen::Fen, san::SanPlus, uci::UciMove, CastlingMode, Chess, Color, EnPassantMode, Position,
};
use specta::Type;
use tauri::AppHandle;
use tauri_specta::Event;
use tokio::{
    sync::{watch, Mutex, RwLock},
    time::{interval, Duration},
};

use crate::{
    engine::{
        parse_fen_to_position, BaseEngine, EngineLaunchMetadata, EngineLog, EngineOption, GoMode,
        PlayersTime,
    },
    error::Error,
};

pub type GameId = String;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PlayerConfig {
    Human {
        name: String,
    },
    Engine {
        name: String,
        path: String,
        #[serde(default)]
        version: String,
        #[serde(default, rename = "presetCategory")]
        #[specta(rename = "presetCategory")]
        preset_category: PlayerPresetCategory,
        #[serde(default, rename = "targetElo")]
        #[specta(rename = "targetElo")]
        target_elo: Option<u32>,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        options: Vec<EngineOption>,
        #[serde(default, rename = "openingRepertoire")]
        #[specta(rename = "openingRepertoire")]
        opening_repertoire: Option<OpeningRepertoireConfig>,
        #[serde(default, rename = "humanTiming")]
        #[specta(rename = "humanTiming")]
        human_timing: Option<HumanTimingConfig>,
        go: Option<GoMode>,
    },
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlayerPresetCategory {
    #[default]
    Custom,
    HumanLike,
    Limited,
    Strong,
    Reference,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpeningRepertoireConfig {
    pub id: String,
    #[serde(default = "default_repertoire_max_ply")]
    pub max_ply: u32,
    #[serde(default)]
    pub lines: Vec<WeightedOpeningLine>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WeightedOpeningLine {
    pub moves: Vec<String>,
    #[serde(default = "default_repertoire_line_weight")]
    pub weight: u16,
}

fn default_repertoire_max_ply() -> u32 {
    16
}

fn default_repertoire_line_weight() -> u16 {
    1
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HumanTimingConfig {
    pub min_think_time_ms: u32,
    pub average_think_time_ms: u32,
    pub max_think_time_ms: u32,
    pub repertoire_time_percent: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TimeControl {
    pub initial_time: u64,
    pub increment: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameConfig {
    pub white: PlayerConfig,
    pub black: PlayerConfig,
    pub white_time_control: Option<TimeControl>,
    pub black_time_control: Option<TimeControl>,
    pub initial_fen: Option<String>,
    #[serde(default)]
    pub initial_moves: Vec<String>,
    pub opening_book: Option<OpeningBookConfig>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpeningBookConfig {
    pub path: String,
    #[serde(default = "default_opening_book_max_ply")]
    pub max_ply: usize,
}

fn default_opening_book_max_ply() -> usize {
    40
}

#[derive(Clone, Debug, Serialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum GameStatus {
    Playing,
    Finished { result: GameResult },
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GameResult {
    WhiteWins { reason: GameEndReason },
    BlackWins { reason: GameEndReason },
    Draw { reason: DrawReason },
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum GameEndReason {
    Checkmate,
    Timeout,
    Resignation,
    Abandonment,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DrawReason {
    Stalemate,
    InsufficientMaterial,
    ThreefoldRepetition,
    FiftyMoveRule,
    Agreement,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameMove {
    pub uci: String,
    pub san: String,
    pub fen_after: String,
    pub clock: Option<u64>,
    pub white_time: Option<u64>,
    pub black_time: Option<u64>,
    pub color: String,
    pub source: GameMoveSource,
    pub think_time_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GameMoveSource {
    Human,
    Engine,
    ProfileRepertoire,
    Polyglot,
    Initial,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameState {
    pub game_id: GameId,
    pub status: GameStatus,
    pub initial_fen: String,
    pub moves: Vec<GameMove>,
    pub current_fen: String,
    pub ply: u32,
    pub turn: String,
    pub white_time: Option<u64>,
    pub black_time: Option<u64>,
    pub white_player: String,
    pub black_player: String,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameManifest {
    pub schema_version: u32,
    pub application_version: String,
    pub game_id: GameId,
    pub started_at: String,
    pub exported_at: String,
    pub hardware: ManifestHardware,
    pub initial_fen: String,
    pub initial_moves: Vec<String>,
    pub white: PlayerConfig,
    pub black: PlayerConfig,
    pub white_engine_launch: Option<EngineLaunchMetadata>,
    pub black_engine_launch: Option<EngineLaunchMetadata>,
    pub white_time_control: Option<TimeControl>,
    pub black_time_control: Option<TimeControl>,
    pub opening_book: Option<OpeningBookConfig>,
    pub status: GameStatus,
    pub result: Option<GameResult>,
    pub moves: Vec<GameMove>,
    pub current_fen: String,
}

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManifestHardware {
    pub operating_system: String,
    pub architecture: String,
    pub logical_cpus: usize,
}

#[derive(Clone, Debug, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct GameMoveEvent {
    pub game_id: GameId,
    pub moves: Vec<GameMove>,
    pub fen: String,
    pub white_time: Option<u64>,
    pub black_time: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ClockUpdateEvent {
    pub game_id: GameId,
    pub white_time: Option<u64>,
    pub black_time: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct GameOverEvent {
    pub game_id: GameId,
    pub result: GameResult,
    pub moves: Vec<GameMove>,
}

struct ClockState {
    white_time: Option<u64>,
    black_time: Option<u64>,
    white_increment: u64,
    black_increment: u64,
    last_tick: Instant,
}

struct GameController {
    game_id: GameId,
    config: GameConfig,
    initial_fen: String,
    moves: Vec<GameMove>,
    position: Chess,
    position_history: HashMap<String, u32>,
    status: GameStatus,
    clock: Option<ClockState>,
    white_engine: Option<Arc<Mutex<BaseEngine>>>,
    black_engine: Option<Arc<Mutex<BaseEngine>>>,
    white_engine_launch: Option<EngineLaunchMetadata>,
    black_engine_launch: Option<EngineLaunchMetadata>,
    started_at: String,
    shutdown_tx: Option<watch::Sender<bool>>,
    move_notify_tx: Option<tokio::sync::mpsc::Sender<()>>,
    engine_thinking: bool,
    polyglot_book: Option<PolyglotBook>,
    polyglot_max_ply: usize,
}

impl GameController {
    fn new(game_id: GameId, config: GameConfig) -> Result<Self, Error> {
        let initial_fen = config.initial_fen.clone().unwrap_or_else(|| {
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".to_string()
        });

        let position = parse_fen_to_position(&initial_fen)?;

        let clock = if config.white_time_control.is_some() || config.black_time_control.is_some() {
            Some(ClockState {
                white_time: config.white_time_control.as_ref().map(|tc| tc.initial_time),
                black_time: config.black_time_control.as_ref().map(|tc| tc.initial_time),
                white_increment: config
                    .white_time_control
                    .as_ref()
                    .map(|tc| tc.increment)
                    .unwrap_or(0),
                black_increment: config
                    .black_time_control
                    .as_ref()
                    .map(|tc| tc.increment)
                    .unwrap_or(0),
                last_tick: Instant::now(),
            })
        } else {
            None
        };

        let mut position_history = HashMap::new();
        let initial_key = Self::position_key(&position);
        position_history.insert(initial_key, 1);

        let initial_moves = config.initial_moves.clone();

        let mut controller = Self {
            game_id,
            config,
            initial_fen,
            moves: Vec::new(),
            position,
            position_history,
            status: GameStatus::Playing,
            clock,
            white_engine: None,
            black_engine: None,
            white_engine_launch: None,
            black_engine_launch: None,
            started_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            shutdown_tx: None,
            move_notify_tx: None,
            engine_thinking: false,
            polyglot_book: None,
            polyglot_max_ply: 0,
        };

        for uci_str in &initial_moves {
            controller.apply_move_no_clock(uci_str)?;
        }

        Ok(controller)
    }

    fn get_state(&self) -> GameState {
        let turn = if self.position.turn() == Color::White {
            "white"
        } else {
            "black"
        };

        let (white_time, black_time) = self.get_current_times();

        let white_player = match &self.config.white {
            PlayerConfig::Human { name } => name.clone(),
            PlayerConfig::Engine { name, .. } => name.clone(),
        };

        let black_player = match &self.config.black {
            PlayerConfig::Human { name } => name.clone(),
            PlayerConfig::Engine { name, .. } => name.clone(),
        };

        GameState {
            game_id: self.game_id.clone(),
            status: self.status.clone(),
            initial_fen: self.initial_fen.clone(),
            moves: self.moves.clone(),
            current_fen: Fen::from_position(self.position.clone(), EnPassantMode::Legal)
                .to_string(),
            ply: self.moves.len() as u32,
            turn: turn.to_string(),
            white_time,
            black_time,
            white_player,
            black_player,
        }
    }

    fn get_manifest(&self) -> GameManifest {
        let result = match &self.status {
            GameStatus::Playing => None,
            GameStatus::Finished { result } => Some(result.clone()),
        };

        GameManifest {
            schema_version: 1,
            application_version: env!("CARGO_PKG_VERSION").to_string(),
            game_id: self.game_id.clone(),
            started_at: self.started_at.clone(),
            exported_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            hardware: ManifestHardware {
                operating_system: std::env::consts::OS.to_string(),
                architecture: std::env::consts::ARCH.to_string(),
                logical_cpus: std::thread::available_parallelism()
                    .map(|value| value.get())
                    .unwrap_or(1),
            },
            initial_fen: self.initial_fen.clone(),
            initial_moves: self.config.initial_moves.clone(),
            white: self.config.white.clone(),
            black: self.config.black.clone(),
            white_engine_launch: self.white_engine_launch.clone(),
            black_engine_launch: self.black_engine_launch.clone(),
            white_time_control: self.config.white_time_control.clone(),
            black_time_control: self.config.black_time_control.clone(),
            opening_book: self.config.opening_book.clone(),
            status: self.status.clone(),
            result,
            moves: self.moves.clone(),
            current_fen: Fen::from_position(self.position.clone(), EnPassantMode::Legal)
                .to_string(),
        }
    }

    fn position_key(position: &Chess) -> String {
        let fen = Fen::from_position(position.clone(), EnPassantMode::Legal).to_string();
        fen.split_whitespace().take(4).collect::<Vec<_>>().join(" ")
    }

    fn current_turn_player(&self) -> &PlayerConfig {
        if self.position.turn() == Color::White {
            &self.config.white
        } else {
            &self.config.black
        }
    }

    fn is_engine_turn(&self) -> bool {
        matches!(self.current_turn_player(), PlayerConfig::Engine { .. })
    }

    fn apply_move(
        &mut self,
        uci_str: &str,
        source: GameMoveSource,
        think_time_ms: Option<u64>,
    ) -> Result<GameMove, Error> {
        if self.status != GameStatus::Playing {
            return Err(Error::GameNotInProgress);
        }

        let color = if self.position.turn() == Color::White {
            "white"
        } else {
            "black"
        };
        let uci = UciMove::from_ascii(uci_str.as_bytes())?;
        let mv = uci.to_move(&self.position)?;

        let san = SanPlus::from_move_and_play_unchecked(&mut self.position.clone(), &mv);

        let clock = self.clock.as_ref().and_then(|c| {
            if self.position.turn() == Color::White {
                c.white_time
            } else {
                c.black_time
            }
        });

        self.position.play_unchecked(&mv);

        let pos_key = Self::position_key(&self.position);
        *self.position_history.entry(pos_key).or_insert(0) += 1;

        if let Some(ref mut clock_state) = self.clock {
            let elapsed = clock_state.last_tick.elapsed().as_millis() as u64;

            if self.position.turn() == Color::Black {
                if let Some(ref mut wt) = clock_state.white_time {
                    *wt = wt.saturating_sub(elapsed);
                    *wt += clock_state.white_increment;
                }
            } else if let Some(ref mut bt) = clock_state.black_time {
                *bt = bt.saturating_sub(elapsed);
                *bt += clock_state.black_increment;
            }

            clock_state.last_tick = Instant::now();
        }

        let (white_time, black_time) = self
            .clock
            .as_ref()
            .map(|c| (c.white_time, c.black_time))
            .unwrap_or((None, None));

        let fen_after = Fen::from_position(self.position.clone(), EnPassantMode::Legal).to_string();

        let game_move = GameMove {
            uci: uci_str.to_string(),
            san: san.to_string(),
            fen_after,
            clock,
            white_time,
            black_time,
            color: color.to_string(),
            source,
            think_time_ms,
        };

        self.moves.push(game_move.clone());
        self.check_game_end();

        Ok(game_move)
    }

    fn apply_move_no_clock(&mut self, uci_str: &str) -> Result<GameMove, Error> {
        let color = if self.position.turn() == Color::White {
            "white"
        } else {
            "black"
        };
        let uci = UciMove::from_ascii(uci_str.as_bytes())?;
        let mv = uci.to_move(&self.position)?;

        let san = SanPlus::from_move_and_play_unchecked(&mut self.position.clone(), &mv);

        self.position.play_unchecked(&mv);

        let pos_key = Self::position_key(&self.position);
        *self.position_history.entry(pos_key).or_insert(0) += 1;

        let (white_time, black_time) = self
            .clock
            .as_ref()
            .map(|c| (c.white_time, c.black_time))
            .unwrap_or((None, None));

        let fen_after = Fen::from_position(self.position.clone(), EnPassantMode::Legal).to_string();

        let game_move = GameMove {
            uci: uci_str.to_string(),
            san: san.to_string(),
            fen_after,
            clock: None,
            white_time,
            black_time,
            color: color.to_string(),
            source: GameMoveSource::Initial,
            think_time_ms: None,
        };

        self.moves.push(game_move.clone());
        self.check_game_end();

        Ok(game_move)
    }

    fn rebuild_position_from_moves(&mut self) -> Result<(), Error> {
        self.position = parse_fen_to_position(&self.initial_fen)?;

        self.position_history.clear();
        let initial_key = Self::position_key(&self.position);
        self.position_history.insert(initial_key, 1);

        for m in &self.moves {
            let uci = UciMove::from_ascii(m.uci.as_bytes())?;
            let mv = uci.to_move(&self.position)?;
            self.position.play_unchecked(&mv);
            let pos_key = Self::position_key(&self.position);
            *self.position_history.entry(pos_key).or_insert(0) += 1;
        }

        if let Some(ref mut clock) = self.clock {
            clock.white_time = self
                .config
                .white_time_control
                .as_ref()
                .map(|tc| tc.initial_time);
            clock.black_time = self
                .config
                .black_time_control
                .as_ref()
                .map(|tc| tc.initial_time);

            if let Some(last_move) = self.moves.last() {
                if last_move.white_time.is_some() || last_move.black_time.is_some() {
                    clock.white_time = last_move.white_time;
                    clock.black_time = last_move.black_time;
                }
            }

            clock.last_tick = Instant::now();
        }

        Ok(())
    }

    fn check_game_end(&mut self) {
        if self.position.is_checkmate() {
            let result = if self.position.turn() == Color::White {
                GameResult::BlackWins {
                    reason: GameEndReason::Checkmate,
                }
            } else {
                GameResult::WhiteWins {
                    reason: GameEndReason::Checkmate,
                }
            };
            self.status = GameStatus::Finished { result };
            return;
        }

        if self.position.is_stalemate() {
            self.status = GameStatus::Finished {
                result: GameResult::Draw {
                    reason: DrawReason::Stalemate,
                },
            };
            return;
        }

        if self.position.is_insufficient_material() {
            self.status = GameStatus::Finished {
                result: GameResult::Draw {
                    reason: DrawReason::InsufficientMaterial,
                },
            };
            return;
        }

        if self.position.halfmoves() >= 100 {
            self.status = GameStatus::Finished {
                result: GameResult::Draw {
                    reason: DrawReason::FiftyMoveRule,
                },
            };
            return;
        }

        let pos_key = Self::position_key(&self.position);
        if let Some(&count) = self.position_history.get(&pos_key) {
            if count >= 3 {
                self.status = GameStatus::Finished {
                    result: GameResult::Draw {
                        reason: DrawReason::ThreefoldRepetition,
                    },
                };
            }
        }
    }

    fn check_timeout(&mut self) -> Option<GameResult> {
        if let Some(ref clock) = self.clock {
            let elapsed = clock.last_tick.elapsed().as_millis() as u64;

            if self.position.turn() == Color::White {
                if let Some(wt) = clock.white_time {
                    if wt.saturating_sub(elapsed) == 0 {
                        return Some(GameResult::BlackWins {
                            reason: GameEndReason::Timeout,
                        });
                    }
                }
            } else if let Some(bt) = clock.black_time {
                if bt.saturating_sub(elapsed) == 0 {
                    return Some(GameResult::WhiteWins {
                        reason: GameEndReason::Timeout,
                    });
                }
            }
        }
        None
    }

    fn get_current_times(&self) -> (Option<u64>, Option<u64>) {
        if let Some(ref clock) = self.clock {
            let elapsed = clock.last_tick.elapsed().as_millis() as u64;

            let white_time = if self.position.turn() == Color::White {
                clock.white_time.map(|t| t.saturating_sub(elapsed))
            } else {
                clock.white_time
            };

            let black_time = if self.position.turn() == Color::Black {
                clock.black_time.map(|t| t.saturating_sub(elapsed))
            } else {
                clock.black_time
            };

            (white_time, black_time)
        } else {
            (None, None)
        }
    }

    fn end_game(&mut self, result: GameResult) {
        self.status = GameStatus::Finished { result };
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(true);
        }
    }

    fn reset_clock(&mut self) {
        if let Some(ref mut clock) = self.clock {
            clock.last_tick = Instant::now();
        }
    }
}

pub struct GameManager {
    games: DashMap<GameId, Arc<RwLock<GameController>>>,
}

impl GameManager {
    pub fn new() -> Self {
        Self {
            games: DashMap::new(),
        }
    }

    pub async fn start_game(
        &self,
        game_id: GameId,
        config: GameConfig,
        app: AppHandle,
    ) -> Result<GameState, Error> {
        if let Some((_, old_game)) = self.games.remove(&game_id) {
            let mut game = old_game.write().await;
            if let Some(tx) = game.shutdown_tx.take() {
                let _ = tx.send(true);
            }
        }

        let OpeningBookResult {
            mut config,
            polyglot_book,
            polyglot_max_ply,
        } = apply_opening_book(config)?;
        let castling_mode = CastlingMode::detect(
            config
                .clone()
                .initial_fen
                .unwrap_or_default()
                .parse::<Fen>()
                .unwrap_or_default()
                .as_setup(),
        );
        normalize_game_engine_options(&mut config.white, castling_mode.is_chess960());
        normalize_game_engine_options(&mut config.black, castling_mode.is_chess960());

        let mut controller = GameController::new(game_id.clone(), config.clone())?;
        controller.polyglot_book = polyglot_book;
        controller.polyglot_max_ply = polyglot_max_ply;

        if let PlayerConfig::Engine {
            path,
            args,
            options,
            ..
        } = &config.white
        {
            let mut engine = BaseEngine::spawn(PathBuf::from(path), args).await?;
            engine.init_uci().await?;
            for opt in options {
                if opt.name == "UCI_Chess960" || opt.name == "MultiPV" {
                    continue;
                }
                engine.set_option(&opt.name, &opt.value).await?;
            }
            if castling_mode.is_chess960() {
                engine.set_option("UCI_Chess960", "true").await?;
            } else {
                engine.set_option("UCI_Chess960", "false").await?;
            }
            engine.set_option("MultiPV", "1").await?;
            engine.new_game().await?;
            controller.white_engine_launch = Some(engine.launch_metadata());
            controller.white_engine = Some(Arc::new(Mutex::new(engine)));
        }

        if let PlayerConfig::Engine {
            path,
            args,
            options,
            ..
        } = &config.black
        {
            let mut engine = BaseEngine::spawn(PathBuf::from(path), args).await?;
            engine.init_uci().await?;
            for opt in options {
                if opt.name == "UCI_Chess960" || opt.name == "MultiPV" {
                    continue;
                }
                engine.set_option(&opt.name, &opt.value).await?;
            }
            if castling_mode.is_chess960() {
                engine.set_option("UCI_Chess960", "true").await?;
            } else {
                engine.set_option("UCI_Chess960", "false").await?;
            }
            engine.set_option("MultiPV", "1").await?;
            engine.new_game().await?;
            controller.black_engine_launch = Some(engine.launch_metadata());
            controller.black_engine = Some(Arc::new(Mutex::new(engine)));
        }

        controller.reset_clock();

        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        controller.shutdown_tx = Some(shutdown_tx);

        let (move_notify_tx, move_notify_rx) = tokio::sync::mpsc::channel(1);
        controller.move_notify_tx = Some(move_notify_tx);

        let state = controller.get_state();
        let controller = Arc::new(RwLock::new(controller));
        self.games.insert(game_id.clone(), controller.clone());

        tokio::spawn(game_loop(
            game_id,
            controller,
            shutdown_rx,
            move_notify_rx,
            app,
        ));

        Ok(state)
    }

    pub async fn get_game_state(&self, game_id: &str) -> Result<GameState, Error> {
        let game = self
            .games
            .get(game_id)
            .ok_or_else(|| Error::GameNotFound(game_id.to_string()))?;
        let controller = game.read().await;
        Ok(controller.get_state())
    }

    pub async fn get_game_manifest(&self, game_id: &str) -> Result<GameManifest, Error> {
        let game = self
            .games
            .get(game_id)
            .ok_or_else(|| Error::GameNotFound(game_id.to_string()))?;
        let controller = game.read().await;
        Ok(controller.get_manifest())
    }

    pub async fn make_move(
        &self,
        game_id: &str,
        uci: &str,
        app: &AppHandle,
    ) -> Result<GameState, Error> {
        let game = self
            .games
            .get(game_id)
            .ok_or_else(|| Error::GameNotFound(game_id.to_string()))?;

        let mut controller = game.write().await;

        if controller.is_engine_turn() {
            return Err(Error::NotHumanTurn);
        }

        let game_move = controller.apply_move(uci, GameMoveSource::Human, None)?;
        let (white_time, black_time) = controller.get_current_times();

        GameMoveEvent {
            game_id: game_id.to_string(),
            moves: controller.moves.clone(),
            fen: game_move.fen_after,
            white_time,
            black_time,
        }
        .emit(app)?;

        if let GameStatus::Finished { result } = &controller.status {
            GameOverEvent {
                game_id: game_id.to_string(),
                result: result.clone(),
                moves: controller.moves.clone(),
            }
            .emit(app)?;
        } else if let Some(tx) = &controller.move_notify_tx {
            let _ = tx.try_send(());
        }

        Ok(controller.get_state())
    }

    pub async fn take_back_move(&self, game_id: &str, app: &AppHandle) -> Result<GameState, Error> {
        let game = self
            .games
            .get(game_id)
            .ok_or_else(|| Error::GameNotFound(game_id.to_string()))?;

        let mut controller = game.write().await;

        if controller.moves.is_empty() {
            return Err(Error::NoMovesFound);
        }

        let human_color = match (&controller.config.white, &controller.config.black) {
            (PlayerConfig::Human { .. }, PlayerConfig::Engine { .. }) => Some(Color::White),
            (PlayerConfig::Engine { .. }, PlayerConfig::Human { .. }) => Some(Color::Black),
            _ => None,
        };

        let should_pop_two = human_color
            .map(|c| controller.position.turn() == c)
            .unwrap_or(false);

        controller.moves.pop();
        if should_pop_two {
            controller.moves.pop();
        }
        controller.status = GameStatus::Playing;
        controller.engine_thinking = false;

        controller.rebuild_position_from_moves()?;
        controller.check_game_end();

        let (white_time, black_time) = controller.get_current_times();
        let fen = Fen::from_position(controller.position.clone(), EnPassantMode::Legal).to_string();

        GameMoveEvent {
            game_id: game_id.to_string(),
            moves: controller.moves.clone(),
            fen,
            white_time,
            black_time,
        }
        .emit(app)?;

        if let GameStatus::Finished { result } = &controller.status {
            GameOverEvent {
                game_id: game_id.to_string(),
                result: result.clone(),
                moves: controller.moves.clone(),
            }
            .emit(app)?;
        } else if controller.is_engine_turn() {
            if let Some(tx) = &controller.move_notify_tx {
                let _ = tx.try_send(());
            }
        }

        Ok(controller.get_state())
    }

    pub async fn resign(
        &self,
        game_id: &str,
        color: &str,
        app: &AppHandle,
    ) -> Result<GameState, Error> {
        let game = self
            .games
            .get(game_id)
            .ok_or_else(|| Error::GameNotFound(game_id.to_string()))?;

        let mut controller = game.write().await;

        let result = match color {
            "white" => GameResult::BlackWins {
                reason: GameEndReason::Resignation,
            },
            "black" => GameResult::WhiteWins {
                reason: GameEndReason::Resignation,
            },
            _ => return Err(Error::InvalidColor(color.to_string())),
        };

        controller.end_game(result.clone());

        GameOverEvent {
            game_id: game_id.to_string(),
            result,
            moves: controller.moves.clone(),
        }
        .emit(app)?;

        Ok(controller.get_state())
    }

    pub async fn abort_game(&self, game_id: &str) -> Result<(), Error> {
        if let Some((_, game)) = self.games.remove(game_id) {
            let mut controller = game.write().await;
            if let Some(tx) = controller.shutdown_tx.take() {
                let _ = tx.send(true);
            }

            if let Some(engine) = &controller.white_engine {
                let mut proc = engine.lock().await;
                let _ = proc.quit().await;
            }
            if let Some(engine) = &controller.black_engine {
                let mut proc = engine.lock().await;
                let _ = proc.quit().await;
            }
        }
        Ok(())
    }

    pub async fn get_engine_logs(
        &self,
        game_id: &str,
        color: &str,
    ) -> Result<Vec<EngineLog>, Error> {
        let game = self
            .games
            .get(game_id)
            .ok_or_else(|| Error::GameNotFound(game_id.to_string()))?;

        let controller = game.read().await;

        let engine = match color {
            "white" => &controller.white_engine,
            "black" => &controller.black_engine,
            _ => return Err(Error::InvalidColor(color.to_string())),
        };

        if let Some(engine_arc) = engine {
            let engine = engine_arc.lock().await;
            Ok(engine.get_logs())
        } else {
            Ok(Vec::new())
        }
    }
}

fn normalize_game_engine_options(player: &mut PlayerConfig, chess960: bool) {
    let PlayerConfig::Engine { options, .. } = player else {
        return;
    };

    upsert_engine_option(options, "MultiPV", "1");
    upsert_engine_option(
        options,
        "UCI_Chess960",
        if chess960 { "true" } else { "false" },
    );
}

fn upsert_engine_option(options: &mut Vec<EngineOption>, name: &str, value: &str) {
    options.retain(|option| option.name != name);
    options.push(EngineOption {
        name: name.to_string(),
        value: value.to_string(),
    });
}

impl Default for GameManager {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug)]
struct OpeningBookSelection {
    initial_fen: String,
    initial_moves: Vec<String>,
}

struct OpeningBookResult {
    config: GameConfig,
    polyglot_book: Option<PolyglotBook>,
    polyglot_max_ply: usize,
}

fn select_random_epd_entry(reader: impl BufRead) -> Result<OpeningBookSelection, Error> {
    let mut rng = rand::thread_rng();

    let selected_line = reader
        .lines()
        .map_while(Result::ok)
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .choose(&mut rng)
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Opening book EPD has no entries",
            )
        })?;

    Ok(OpeningBookSelection {
        initial_fen: selected_line,
        initial_moves: Vec::new(),
    })
}

struct OpeningBookPgnVisitor {
    selected: Option<OpeningBookSelection>,
    seen: usize,
    current_position: Chess,
    initial_position: Chess,
    castling_mode: CastlingMode,
    initial_fen: Option<String>,
    moves: Vec<String>,
    skip: bool,
}

impl OpeningBookPgnVisitor {
    fn new() -> Self {
        let start = Chess::default();
        Self {
            selected: None,
            seen: 0,
            current_position: start.clone(),
            initial_position: start,
            castling_mode: CastlingMode::Standard,
            initial_fen: None,
            moves: Vec::new(),
            skip: false,
        }
    }
}

impl Visitor for OpeningBookPgnVisitor {
    type Result = Option<OpeningBookSelection>;

    fn begin_game(&mut self) {
        let start = Chess::default();
        self.current_position = start.clone();
        self.initial_position = start;
        self.castling_mode = CastlingMode::Standard;
        self.initial_fen = None;
        self.moves.clear();
        self.skip = false;
    }

    fn header(&mut self, key: &[u8], value: RawHeader<'_>) {
        if key == b"FEN" {
            let fen_text = value.decode_utf8_lossy().into_owned();
            match parse_fen_to_position(&fen_text) {
                Ok(position) => {
                    let parsed_fen: Fen = match fen_text.parse() {
                        Ok(fen) => fen,
                        Err(_) => {
                            self.skip = true;
                            return;
                        }
                    };
                    self.current_position = position.clone();
                    self.initial_position = position;
                    self.castling_mode = CastlingMode::detect(parsed_fen.as_setup());
                    self.initial_fen = Some(fen_text);
                }
                Err(_) => {
                    self.skip = true;
                }
            }
        }
    }

    fn end_headers(&mut self) -> Skip {
        Skip(self.skip)
    }

    fn san(&mut self, san: SanPlus) {
        if self.skip {
            return;
        }

        let mv = match san.san.to_move(&self.current_position) {
            Ok(mv) => mv,
            Err(_) => {
                self.skip = true;
                return;
            }
        };

        let uci = UciMove::from_move(&mv, self.castling_mode).to_string();
        self.moves.push(uci);
        self.current_position.play_unchecked(&mv);
    }

    fn end_game(&mut self) -> Self::Result {
        if self.skip || self.moves.is_empty() {
            return None;
        }

        let initial_fen = self.initial_fen.clone().unwrap_or_else(|| {
            Fen::from_position(self.initial_position.clone(), EnPassantMode::Legal).to_string()
        });

        let candidate = OpeningBookSelection {
            initial_fen,
            initial_moves: self.moves.clone(),
        };

        self.seen += 1;
        let mut rng = rand::thread_rng();
        if rng.gen_range(0..self.seen) == 0 {
            self.selected = Some(candidate.clone());
        }

        Some(candidate)
    }
}

fn select_random_pgn_entry(input: impl Read) -> Result<OpeningBookSelection, Error> {
    let mut reader = BufferedReader::new(input);
    let mut visitor = OpeningBookPgnVisitor::new();

    while reader.read_game(&mut visitor)?.is_some() {}

    visitor.selected.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Opening book PGN has no valid games",
        )
        .into()
    })
}

fn read_zip_inner(path: &str) -> Result<(String, Vec<u8>), Error> {
    let file = File::open(path)?;
    let mut archive = zip::ZipArchive::new(BufReader::new(file))?;
    if archive.len() != 1 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Opening book zip must contain exactly one file",
        )
        .into());
    }
    let mut inner = archive.by_index(0)?;
    let name = inner.name().to_string();
    let mut buf = Vec::new();
    inner.read_to_end(&mut buf)?;
    Ok((name, buf))
}

fn opening_book_ext(name: &str) -> Option<&str> {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".epd") {
        Some("epd")
    } else if lower.ends_with(".pgn") {
        Some("pgn")
    } else if lower.ends_with(".bin") {
        Some("bin")
    } else {
        None
    }
}

fn normalize_polyglot_uci(uci: &str) -> String {
    match uci {
        "e1h1" => "e1g1".to_string(),
        "e1a1" => "e1c1".to_string(),
        "e8h8" => "e8g8".to_string(),
        "e8a8" => "e8c8".to_string(),
        _ => uci.to_string(),
    }
}

fn choose_weighted_index(weights: &[u16], rng: &mut impl Rng) -> usize {
    let total: u64 = weights.iter().map(|w| *w as u64).sum();
    if total == 0 {
        return rng.gen_range(0..weights.len());
    }

    let mut target = rng.gen_range(0..total);
    for (index, weight) in weights.iter().enumerate() {
        let weight = *weight as u64;
        if target < weight {
            return index;
        }
        target -= weight;
    }

    weights.len().saturating_sub(1)
}

fn apply_opening_book(config: GameConfig) -> Result<OpeningBookResult, Error> {
    let Some(opening_book) = &config.opening_book else {
        return Ok(OpeningBookResult {
            config,
            polyglot_book: None,
            polyglot_max_ply: 0,
        });
    };

    let path = &opening_book.path;
    let max_ply = opening_book.max_ply.max(1);
    let ext = PathBuf::from(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());

    let is_human_vs_human = matches!(
        (&config.white, &config.black),
        (PlayerConfig::Human { .. }, PlayerConfig::Human { .. })
    );

    enum BookAction {
        Selection(OpeningBookSelection),
        Polyglot(PolyglotBook),
        Skip,
    }

    let action = match ext.as_deref() {
        Some("epd") => {
            BookAction::Selection(select_random_epd_entry(BufReader::new(File::open(path)?))?)
        }
        Some("pgn") => BookAction::Selection(select_random_pgn_entry(File::open(path)?)?),
        Some("bin") => {
            if is_human_vs_human {
                BookAction::Skip
            } else {
                BookAction::Polyglot(PolyglotBook::load(path)?)
            }
        }
        Some("zip") => {
            let (inner_name, data) = read_zip_inner(path)?;
            match opening_book_ext(&inner_name) {
                Some("epd") => BookAction::Selection(select_random_epd_entry(BufReader::new(
                    Cursor::new(data),
                ))?),
                Some("pgn") => BookAction::Selection(select_random_pgn_entry(Cursor::new(data))?),
                Some("bin") => {
                    if is_human_vs_human {
                        BookAction::Skip
                    } else {
                        let mut temp = tempfile::NamedTempFile::new()?;
                        temp.write_all(&data)?;
                        temp.flush()?;
                        let temp_path = temp.path().to_str().ok_or_else(|| {
                            std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                "Temporary Polyglot book path is not valid UTF-8",
                            )
                        })?;
                        BookAction::Polyglot(PolyglotBook::load(temp_path)?)
                    }
                }
                _ => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "Zip must contain a .pgn, .epd, or .bin file",
                    )
                    .into())
                }
            }
        }
        _ => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Unsupported opening book format. Use .pgn, .epd, .bin, or .zip",
            )
            .into())
        }
    };

    match action {
        BookAction::Selection(selection) => {
            let mut next = config;
            next.initial_fen = Some(selection.initial_fen);
            next.initial_moves = selection.initial_moves;
            Ok(OpeningBookResult {
                config: next,
                polyglot_book: None,
                polyglot_max_ply: 0,
            })
        }
        BookAction::Polyglot(book) => Ok(OpeningBookResult {
            config,
            polyglot_book: Some(book),
            polyglot_max_ply: max_ply,
        }),
        BookAction::Skip => Ok(OpeningBookResult {
            config,
            polyglot_book: None,
            polyglot_max_ply: 0,
        }),
    }
}

fn spawn_engine_task(
    game_id: &GameId,
    controller: &Arc<RwLock<GameController>>,
    app: &AppHandle,
) -> tokio::task::JoinHandle<Result<(), Error>> {
    let game_id_clone = game_id.clone();
    let controller_clone = controller.clone();
    let app_clone = app.clone();
    tokio::spawn(
        async move { request_engine_move(&game_id_clone, &controller_clone, &app_clone).await },
    )
}

async fn maybe_start_engine(
    controller: &Arc<RwLock<GameController>>,
    engine_task: &Option<tokio::task::JoinHandle<Result<(), Error>>>,
) -> bool {
    let mut ctrl = controller.write().await;
    if ctrl.status == GameStatus::Playing
        && ctrl.is_engine_turn()
        && !ctrl.engine_thinking
        && engine_task.is_none()
    {
        ctrl.engine_thinking = true;
        true
    } else {
        false
    }
}

async fn game_loop(
    game_id: GameId,
    controller: Arc<RwLock<GameController>>,
    mut shutdown_rx: watch::Receiver<bool>,
    mut move_notify_rx: tokio::sync::mpsc::Receiver<()>,
    app: AppHandle,
) {
    let mut clock_interval = interval(Duration::from_millis(100));
    let mut engine_task: Option<tokio::task::JoinHandle<Result<(), Error>>> = None;

    if maybe_start_engine(&controller, &engine_task).await {
        engine_task = Some(spawn_engine_task(&game_id, &controller, &app));
    }

    loop {
        tokio::select! {
            biased;

            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() {
                    info!("Game {} shutting down", game_id);
                    if let Some(task) = engine_task.take() {
                        task.abort();
                    }
                    break;
                }
            }

            result = async {
                if let Some(ref mut task) = engine_task {
                    Some(task.await)
                } else {
                    std::future::pending::<Option<Result<Result<(), Error>, tokio::task::JoinError>>>().await
                }
            } => {
                engine_task = None;

                match result {
                    Some(Ok(Ok(()))) => {
                        if maybe_start_engine(&controller, &engine_task).await {
                            engine_task = Some(spawn_engine_task(&game_id, &controller, &app));
                        }
                    }
                    Some(Ok(Err(e))) => {
                        error!("Engine move error: {:?}", e);
                        let mut ctrl = controller.write().await;
                        ctrl.engine_thinking = false;
                        let result = if ctrl.position.turn() == Color::White {
                            GameResult::BlackWins { reason: GameEndReason::Abandonment }
                        } else {
                            GameResult::WhiteWins { reason: GameEndReason::Abandonment }
                        };
                        ctrl.end_game(result.clone());
                        let _ = GameOverEvent { game_id: game_id.clone(), result, moves: ctrl.moves.clone() }.emit(&app);
                        break;
                    }
                    Some(Err(_join_error)) => {
                        let mut ctrl = controller.write().await;
                        ctrl.engine_thinking = false;
                        let result = if ctrl.position.turn() == Color::White {
                            GameResult::BlackWins { reason: GameEndReason::Abandonment }
                        } else {
                            GameResult::WhiteWins { reason: GameEndReason::Abandonment }
                        };
                        ctrl.end_game(result.clone());
                        let _ = GameOverEvent { game_id: game_id.clone(), result, moves: ctrl.moves.clone() }.emit(&app);
                        break;
                    }
                    None => unreachable!(),
                }
            }

            _ = move_notify_rx.recv() => {
                if engine_task.is_none() && maybe_start_engine(&controller, &engine_task).await {
                    engine_task = Some(spawn_engine_task(&game_id, &controller, &app));
                }
            }

            _ = clock_interval.tick() => {
                let is_finished;

                {
                    let mut ctrl = controller.write().await;

                    if ctrl.status != GameStatus::Playing {
                        break;
                    }

                    if let Some(result) = ctrl.check_timeout() {
                        ctrl.end_game(result.clone());
                        let _ = GameOverEvent { game_id: game_id.clone(), result, moves: ctrl.moves.clone() }.emit(&app);
                        break;
                    }

                    let (white_time, black_time) = ctrl.get_current_times();
                    let _ = ClockUpdateEvent {
                        game_id: game_id.clone(),
                        white_time,
                        black_time,
                    }.emit(&app);

                    is_finished = ctrl.status != GameStatus::Playing;
                }

                if is_finished {
                    break;
                }
            }
        }
    }

    if let Some(task) = engine_task.take() {
        task.abort();
    }

    {
        let ctrl = controller.read().await;
        if let Some(engine) = &ctrl.white_engine {
            let mut proc = engine.lock().await;
            let _ = proc.quit().await;
        }
        if let Some(engine) = &ctrl.black_engine {
            let mut proc = engine.lock().await;
            let _ = proc.quit().await;
        }
    }

    info!("Game loop ended for {}", game_id);
}

fn try_polyglot_book_move(controller: &GameController) -> Option<String> {
    let book = controller.polyglot_book.as_ref()?;

    if controller.moves.len() >= controller.polyglot_max_ply {
        return None;
    }

    let fen = Fen::from_position(controller.position.clone(), EnPassantMode::Legal).to_string();
    let entries = book.get_all_moves_from_fen(&fen);

    if entries.is_empty() {
        return None;
    }

    let mut rng = rand::thread_rng();
    let legal_moves = entries
        .into_iter()
        .filter_map(|entry| {
            let uci = normalize_polyglot_uci(&entry.move_string);
            let parsed = UciMove::from_ascii(uci.as_bytes()).ok()?;
            parsed.to_move(&controller.position).ok()?;
            Some((uci, entry.weight))
        })
        .collect::<Vec<_>>();

    if legal_moves.is_empty() {
        return None;
    }

    let weights = legal_moves.iter().map(|(_, w)| *w).collect::<Vec<_>>();
    let selected = choose_weighted_index(&weights, &mut rng);
    Some(legal_moves[selected].0.clone())
}

fn select_repertoire_move(
    repertoire: &OpeningRepertoireConfig,
    played_moves: &[String],
    position: &Chess,
    rng: &mut impl Rng,
) -> Option<String> {
    if played_moves.len() as u32 >= repertoire.max_ply {
        return None;
    }

    let legal_moves = repertoire
        .lines
        .iter()
        .filter(|line| {
            line.moves.len() > played_moves.len()
                && line
                    .moves
                    .iter()
                    .zip(played_moves)
                    .all(|(expected, played)| expected == played)
        })
        .filter_map(|line| {
            let uci = line.moves.get(played_moves.len())?;
            let parsed = UciMove::from_ascii(uci.as_bytes()).ok()?;
            parsed.to_move(position).ok()?;
            Some((uci.clone(), line.weight))
        })
        .collect::<Vec<_>>();

    if legal_moves.is_empty() {
        return None;
    }

    let weights = legal_moves
        .iter()
        .map(|(_, weight)| *weight)
        .collect::<Vec<_>>();
    let selected = choose_weighted_index(&weights, rng);
    Some(legal_moves[selected].0.clone())
}

fn try_profile_repertoire_move(controller: &GameController) -> Option<(String, String)> {
    const INITIAL_POSITION_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    if controller.initial_fen != INITIAL_POSITION_FEN {
        return None;
    }

    let repertoire = match controller.current_turn_player() {
        PlayerConfig::Engine {
            opening_repertoire: Some(repertoire),
            ..
        } => repertoire,
        _ => return None,
    };
    let played_moves = controller
        .moves
        .iter()
        .map(|game_move| game_move.uci.clone())
        .collect::<Vec<_>>();
    let mut rng = rand::thread_rng();
    let selected =
        select_repertoire_move(repertoire, &played_moves, &controller.position, &mut rng)?;

    Some((selected, repertoire.id.clone()))
}

enum EngineBookMove {
    Profile { uci: String, repertoire_id: String },
    Polyglot { uci: String },
}

impl EngineBookMove {
    fn uci(&self) -> &str {
        match self {
            Self::Profile { uci, .. } | Self::Polyglot { uci } => uci,
        }
    }

    fn log_message(&self) -> String {
        match self {
            Self::Profile { uci, repertoire_id } => {
                format!("profile repertoire {}: {}", repertoire_id, uci)
            }
            Self::Polyglot { uci } => format!("polyglot opening book: {}", uci),
        }
    }

    fn source(&self) -> GameMoveSource {
        match self {
            Self::Profile { .. } => GameMoveSource::ProfileRepertoire,
            Self::Polyglot { .. } => GameMoveSource::Polyglot,
        }
    }
}

fn calculate_human_think_time(
    config: &HumanTimingConfig,
    source: GameMoveSource,
    legal_move_count: usize,
    in_check: bool,
    ply: usize,
    remaining_time_ms: Option<u64>,
    increment_ms: u64,
    rng: &mut impl Rng,
) -> u64 {
    let min_time = u64::from(config.min_think_time_ms.min(config.max_think_time_ms));
    let max_time = u64::from(config.max_think_time_ms.max(config.min_think_time_ms));
    let average_time = u64::from(config.average_think_time_ms).clamp(min_time, max_time);
    let jitter_percent = rng.gen_range(70_u64..=130);
    let mut target = average_time.saturating_mul(jitter_percent) / 100;

    if ply < 10 {
        target = target.saturating_mul(80) / 100;
    }
    if in_check || legal_move_count <= 8 {
        target = target.saturating_mul(70) / 100;
    } else if legal_move_count >= 30 {
        target = target.saturating_mul(120) / 100;
    }

    if matches!(
        source,
        GameMoveSource::ProfileRepertoire | GameMoveSource::Polyglot
    ) {
        target = target.saturating_mul(u64::from(config.repertoire_time_percent)) / 100;
    } else if rng.gen_ratio(1, 10) {
        target = target.saturating_mul(160) / 100;
    }

    target = target.clamp(min_time, max_time);

    if let Some(remaining) = remaining_time_ms {
        if remaining <= 150 {
            return 0;
        }
        let expected_moves_left = ((80_usize.saturating_sub(ply)) / 2).clamp(10, 35) as u64;
        let sustainable_time = remaining / expected_moves_left + increment_ms.saturating_mul(3) / 4;
        let clock_cap = sustainable_time.saturating_mul(2).max(100);
        target = target.min(clock_cap).min(remaining.saturating_sub(150));
    }

    target
}

fn sample_human_think_time(controller: &GameController, source: GameMoveSource) -> Option<u64> {
    let config = match controller.current_turn_player() {
        PlayerConfig::Engine {
            human_timing: Some(config),
            ..
        } => config,
        _ => return None,
    };
    let (white_time, black_time) = controller.get_current_times();
    let (remaining_time, increment) = match (&controller.clock, controller.position.turn()) {
        (Some(clock), Color::White) => (white_time, clock.white_increment),
        (Some(clock), Color::Black) => (black_time, clock.black_increment),
        (None, _) => (None, 0),
    };
    let mut rng = rand::thread_rng();

    Some(calculate_human_think_time(
        config,
        source,
        controller.position.legal_moves().len(),
        controller.position.is_check(),
        controller.moves.len(),
        remaining_time,
        increment,
        &mut rng,
    ))
}

async fn wait_for_human_think_time(started_at: Instant, target_ms: Option<u64>) {
    let Some(target_ms) = target_ms else {
        return;
    };
    let elapsed_ms = started_at.elapsed().as_millis() as u64;
    if target_ms > elapsed_ms {
        tokio::time::sleep(Duration::from_millis(target_ms - elapsed_ms)).await;
    }
}

async fn request_engine_move(
    game_id: &str,
    controller: &Arc<RwLock<GameController>>,
    app: &AppHandle,
) -> Result<(), Error> {
    let decision_started_at = Instant::now();

    // A bot's profile repertoire takes priority over the optional shared Polyglot book.
    {
        let ctrl = controller.read().await;
        let book_move = try_profile_repertoire_move(&ctrl)
            .map(|(uci, repertoire_id)| EngineBookMove::Profile { uci, repertoire_id })
            .or_else(|| try_polyglot_book_move(&ctrl).map(|uci| EngineBookMove::Polyglot { uci }));
        let human_think_time_ms = book_move
            .as_ref()
            .and_then(|book_move| sample_human_think_time(&ctrl, book_move.source()));
        let turn = ctrl.position.turn();
        let engine_arc = if turn == Color::White {
            ctrl.white_engine.clone()
        } else {
            ctrl.black_engine.clone()
        };
        drop(ctrl);

        if let Some(book_move) = book_move {
            wait_for_human_think_time(decision_started_at, human_think_time_ms).await;
            let mut ctrl = controller.write().await;
            ctrl.engine_thinking = false;

            if ctrl.status != GameStatus::Playing || ctrl.position.turn() != turn {
                return Ok(());
            }

            let game_move = ctrl.apply_move(
                book_move.uci(),
                book_move.source(),
                Some(decision_started_at.elapsed().as_millis() as u64),
            )?;
            let (white_time, black_time) = ctrl.get_current_times();

            GameMoveEvent {
                game_id: game_id.to_string(),
                moves: ctrl.moves.clone(),
                fen: game_move.fen_after,
                white_time,
                black_time,
            }
            .emit(app)?;

            if let GameStatus::Finished { result } = &ctrl.status {
                GameOverEvent {
                    game_id: game_id.to_string(),
                    result: result.clone(),
                    moves: ctrl.moves.clone(),
                }
                .emit(app)?;
            }

            drop(ctrl);
            if let Some(engine) = engine_arc {
                engine
                    .lock()
                    .await
                    .log_gui_message(&book_move.log_message());
            }

            return Ok(());
        }
    }

    let (engine_arc, go_mode, initial_fen, moves, turn, human_think_time_ms) = {
        let ctrl = controller.read().await;

        if ctrl.status != GameStatus::Playing {
            return Ok(());
        }

        let turn = ctrl.position.turn();
        let (engine_arc, player_config) = if turn == Color::White {
            (ctrl.white_engine.clone(), ctrl.config.white.clone())
        } else {
            (ctrl.black_engine.clone(), ctrl.config.black.clone())
        };

        let engine = match engine_arc {
            Some(e) => e,
            None => return Err(Error::EngineNotInitialized),
        };

        let go = match player_config {
            PlayerConfig::Engine { go, .. } => go,
            _ => return Err(Error::NotEngineTurn),
        };

        let initial_fen = ctrl.initial_fen.clone();
        let moves: Vec<String> = ctrl.moves.iter().map(|m| m.uci.clone()).collect();
        let (white_time, black_time) = ctrl.get_current_times();

        let current_time = if turn == Color::White {
            white_time
        } else {
            black_time
        };

        let go_mode = if current_time.is_some() {
            let (winc, binc) = ctrl
                .clock
                .as_ref()
                .map(|c| {
                    (
                        clock_millis_to_uci(c.white_increment),
                        clock_millis_to_uci(c.black_increment),
                    )
                })
                .unwrap_or((0, 0));

            let wt = white_time.map(clock_millis_to_uci).unwrap_or(u32::MAX);
            let bt = black_time.map(clock_millis_to_uci).unwrap_or(u32::MAX);
            GoMode::PlayersTime(PlayersTime::new(wt, bt, winc, binc))
        } else {
            go.unwrap_or(GoMode::Depth(20))
        };

        let human_think_time_ms = sample_human_think_time(&ctrl, GameMoveSource::Engine);

        (
            engine,
            go_mode,
            initial_fen,
            moves,
            turn,
            human_think_time_ms,
        )
    };

    let best_move = {
        let mut engine = engine_arc.lock().await;
        engine.set_position(&initial_fen, &moves).await?;
        engine.go(&go_mode).await?;
        engine.wait_for_bestmove().await?
    };

    wait_for_human_think_time(decision_started_at, human_think_time_ms).await;

    let mut ctrl = controller.write().await;
    ctrl.engine_thinking = false;

    if ctrl.status != GameStatus::Playing {
        return Ok(());
    }

    if ctrl.position.turn() != turn {
        return Ok(());
    }

    let game_move = ctrl.apply_move(
        &best_move,
        GameMoveSource::Engine,
        Some(decision_started_at.elapsed().as_millis() as u64),
    )?;
    let (white_time, black_time) = ctrl.get_current_times();

    GameMoveEvent {
        game_id: game_id.to_string(),
        moves: ctrl.moves.clone(),
        fen: game_move.fen_after,
        white_time,
        black_time,
    }
    .emit(app)?;

    if let GameStatus::Finished { result } = &ctrl.status {
        GameOverEvent {
            game_id: game_id.to_string(),
            result: result.clone(),
            moves: ctrl.moves.clone(),
        }
        .emit(app)?;
    }

    Ok(())
}

fn clock_millis_to_uci(value: u64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

#[tauri::command]
#[specta::specta]
pub async fn start_game(
    game_id: String,
    config: GameConfig,
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GameState, Error> {
    info!("Starting game with ID {}", game_id);
    state.game_manager.start_game(game_id, config, app).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_game_state(
    game_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GameState, Error> {
    state.game_manager.get_game_state(&game_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn make_game_move(
    game_id: String,
    uci: String,
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GameState, Error> {
    state.game_manager.make_move(&game_id, &uci, &app).await
}

#[tauri::command]
#[specta::specta]
pub async fn take_back_game_move(
    game_id: String,
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GameState, Error> {
    state.game_manager.take_back_move(&game_id, &app).await
}

#[tauri::command]
#[specta::specta]
pub async fn resign_game(
    game_id: String,
    color: String,
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GameState, Error> {
    state.game_manager.resign(&game_id, &color, &app).await
}

#[tauri::command]
#[specta::specta]
pub async fn abort_game(
    game_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), Error> {
    state.game_manager.abort_game(&game_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_game_engine_logs(
    game_id: String,
    color: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<EngineLog>, Error> {
    state.game_manager.get_engine_logs(&game_id, &color).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_game_manifest(
    game_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<GameManifest, Error> {
    state.game_manager.get_game_manifest(&game_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{rngs::StdRng, SeedableRng};
    use serde_json::json;

    fn opening_line(moves: &[&str], weight: u16) -> WeightedOpeningLine {
        WeightedOpeningLine {
            moves: moves.iter().map(|value| (*value).to_string()).collect(),
            weight,
        }
    }

    fn initial_position() -> Chess {
        parse_fen_to_position("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
            .expect("initial position must be valid")
    }

    #[test]
    fn player_config_deserializes_camel_case_opening_repertoire() {
        let config: PlayerConfig = serde_json::from_value(json!({
            "type": "engine",
            "name": "Luna",
            "path": "maia3.exe",
            "version": "3.0",
            "presetCategory": "humanLike",
            "targetElo": 900,
            "openingRepertoire": {
                "id": "luna-variety",
                "maxPly": 12,
                "lines": [{
                    "moves": ["e2e4", "e7e5"],
                    "weight": 5
                }]
            },
            "humanTiming": {
                "minThinkTimeMs": 450,
                "averageThinkTimeMs": 1200,
                "maxThinkTimeMs": 3500,
                "repertoireTimePercent": 45
            },
            "go": null
        }))
        .expect("frontend player config must deserialize");

        match &config {
            PlayerConfig::Engine {
                opening_repertoire: Some(repertoire),
                human_timing: Some(timing),
                version,
                preset_category,
                target_elo,
                ..
            } => {
                assert_eq!(repertoire.id, "luna-variety");
                assert_eq!(repertoire.max_ply, 12);
                assert_eq!(repertoire.lines.len(), 1);
                assert_eq!(repertoire.lines[0].moves, ["e2e4", "e7e5"]);
                assert_eq!(repertoire.lines[0].weight, 5);
                assert_eq!(timing.average_think_time_ms, 1200);
                assert_eq!(timing.repertoire_time_percent, 45);
                assert_eq!(version, "3.0");
                assert_eq!(*preset_category, PlayerPresetCategory::HumanLike);
                assert_eq!(*target_elo, Some(900));
            }
            _ => panic!("openingRepertoire was silently discarded"),
        }

        let serialized = serde_json::to_value(config).expect("player config must serialize");
        assert!(serialized.get("openingRepertoire").is_some());
        assert!(serialized.get("opening_repertoire").is_none());
        assert!(serialized.get("humanTiming").is_some());
        assert!(serialized.get("human_timing").is_none());
    }

    #[test]
    fn manifest_preserves_reproducible_position_player_and_resource_inputs() {
        let config = GameConfig {
            white: PlayerConfig::Human {
                name: "Player".to_string(),
            },
            black: PlayerConfig::Engine {
                name: "Stockfish 18".to_string(),
                path: "stockfish.exe".to_string(),
                version: "18".to_string(),
                preset_category: PlayerPresetCategory::Reference,
                target_elo: None,
                args: Vec::new(),
                options: vec![
                    EngineOption {
                        name: "Threads".to_string(),
                        value: "1".to_string(),
                    },
                    EngineOption {
                        name: "Hash".to_string(),
                        value: "256".to_string(),
                    },
                ],
                opening_repertoire: None,
                human_timing: None,
                go: Some(GoMode::Depth(24)),
            },
            white_time_control: None,
            black_time_control: None,
            initial_fen: None,
            initial_moves: vec!["e2e4".to_string()],
            opening_book: None,
        };
        let controller = GameController::new("manifest-test".to_string(), config).unwrap();
        let manifest = controller.get_manifest();

        assert_eq!(manifest.schema_version, 1);
        assert_eq!(manifest.initial_moves, ["e2e4"]);
        assert_eq!(manifest.moves.len(), 1);
        assert_eq!(manifest.moves[0].source, GameMoveSource::Initial);
        assert!(manifest.result.is_none());
        assert!(manifest.hardware.logical_cpus >= 1);
        match manifest.black {
            PlayerConfig::Engine {
                version,
                preset_category,
                options,
                go,
                ..
            } => {
                assert_eq!(version, "18");
                assert_eq!(preset_category, PlayerPresetCategory::Reference);
                assert!(options.iter().any(|option| option.name == "Threads"));
                assert_eq!(go, Some(GoMode::Depth(24)));
            }
            _ => panic!("black player must remain an engine"),
        }
    }

    #[test]
    fn normalized_game_options_record_effective_multipv_and_variant() {
        let mut player = PlayerConfig::Engine {
            name: "Engine".to_string(),
            path: "engine".to_string(),
            version: String::new(),
            preset_category: PlayerPresetCategory::Custom,
            target_elo: None,
            args: Vec::new(),
            options: vec![
                EngineOption {
                    name: "MultiPV".to_string(),
                    value: "8".to_string(),
                },
                EngineOption {
                    name: "MultiPV".to_string(),
                    value: "4".to_string(),
                },
            ],
            opening_repertoire: None,
            human_timing: None,
            go: Some(GoMode::Depth(12)),
        };

        normalize_game_engine_options(&mut player, true);

        let PlayerConfig::Engine { options, .. } = player else {
            panic!("player must remain an engine");
        };
        let multipv = options
            .iter()
            .filter(|option| option.name == "MultiPV")
            .collect::<Vec<_>>();
        assert_eq!(multipv.len(), 1);
        assert_eq!(multipv[0].value, "1");
        assert!(options
            .iter()
            .any(|option| { option.name == "UCI_Chess960" && option.value == "true" }));
    }

    #[test]
    fn profile_repertoire_moves_are_faster_than_maia_moves() {
        let timing = HumanTimingConfig {
            min_think_time_ms: 0,
            average_think_time_ms: 2000,
            max_think_time_ms: 10_000,
            repertoire_time_percent: 35,
        };
        let mut repertoire_rng = StdRng::seed_from_u64(9);
        let mut engine_rng = StdRng::seed_from_u64(9);

        let repertoire_time = calculate_human_think_time(
            &timing,
            GameMoveSource::ProfileRepertoire,
            20,
            false,
            20,
            None,
            0,
            &mut repertoire_rng,
        );
        let engine_time = calculate_human_think_time(
            &timing,
            GameMoveSource::Engine,
            20,
            false,
            20,
            None,
            0,
            &mut engine_rng,
        );

        assert!(repertoire_time < engine_time);
    }

    #[test]
    fn human_think_time_preserves_a_clock_reserve() {
        let timing = HumanTimingConfig {
            min_think_time_ms: 500,
            average_think_time_ms: 10_000,
            max_think_time_ms: 20_000,
            repertoire_time_percent: 100,
        };
        let mut rng = StdRng::seed_from_u64(9);

        let target = calculate_human_think_time(
            &timing,
            GameMoveSource::Engine,
            30,
            false,
            0,
            Some(1000),
            0,
            &mut rng,
        );

        assert!(target < 500);
        assert!(target <= 850);
    }

    #[test]
    fn uci_clock_conversion_saturates_instead_of_wrapping() {
        assert_eq!(clock_millis_to_uci(180_000), 180_000);
        assert_eq!(clock_millis_to_uci(u32::MAX as u64), u32::MAX);
        assert_eq!(clock_millis_to_uci(u32::MAX as u64 + 1), u32::MAX);
        assert_eq!(clock_millis_to_uci(u64::MAX), u32::MAX);
    }

    #[test]
    fn repertoire_uses_only_matching_legal_continuations() {
        let mut position = initial_position();
        let first_move = UciMove::from_ascii(b"e2e4")
            .expect("valid UCI")
            .to_move(&position)
            .expect("legal move");
        position.play_unchecked(&first_move);

        let repertoire = OpeningRepertoireConfig {
            id: "test".to_string(),
            max_ply: 8,
            lines: vec![
                opening_line(&["d2d4", "d7d5"], 100),
                opening_line(&["e2e4", "e2e5"], 100),
                opening_line(&["e2e4", "e7e5"], 1),
            ],
        };
        let mut rng = StdRng::seed_from_u64(7);

        assert_eq!(
            select_repertoire_move(&repertoire, &["e2e4".to_string()], &position, &mut rng,),
            Some("e7e5".to_string())
        );
    }

    #[test]
    fn repertoire_respects_max_ply() {
        let repertoire = OpeningRepertoireConfig {
            id: "test".to_string(),
            max_ply: 0,
            lines: vec![opening_line(&["e2e4"], 1)],
        };
        let mut rng = StdRng::seed_from_u64(7);

        assert_eq!(
            select_repertoire_move(&repertoire, &[], &initial_position(), &mut rng),
            None
        );
    }

    #[test]
    fn repertoire_weights_control_candidate_selection() {
        let repertoire = OpeningRepertoireConfig {
            id: "test".to_string(),
            max_ply: 8,
            lines: vec![opening_line(&["e2e4"], 0), opening_line(&["d2d4"], 5)],
        };
        let mut rng = StdRng::seed_from_u64(7);

        assert_eq!(
            select_repertoire_move(&repertoire, &[], &initial_position(), &mut rng),
            Some("d2d4".to_string())
        );
    }
}
