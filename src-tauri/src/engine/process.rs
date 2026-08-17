use std::{
    collections::HashSet,
    fmt::Display,
    path::PathBuf,
    process::Stdio,
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};

use log::error;
use serde::Serialize;
use specta::Type;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
};
use vampirc_uci::UciMessage;

use crate::error::Error;

use super::{normalize_uci_moves_for_fen, types::GoMode, EngineOption};

#[cfg(target_os = "windows")]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

pub const RANDOM_SEED_PLACEHOLDER: &str = "{{randomSeed}}";
const UCI_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);
const UCI_READY_TIMEOUT: Duration = Duration::from_secs(600);
const UCI_BEST_MOVE_TIMEOUT: Duration = Duration::from_secs(600);

fn resolve_launch_args(args: &[String], requested_seed: Option<u32>) -> (Vec<String>, Option<u32>) {
    let uses_random_seed = args.iter().any(|arg| arg.contains(RANDOM_SEED_PLACEHOLDER));
    let random_seed = requested_seed.unwrap_or_else(rand::random::<u32>);
    let random_seed_text = random_seed.to_string();
    let resolved_args = args
        .iter()
        .map(|arg| arg.replace(RANDOM_SEED_PLACEHOLDER, &random_seed_text))
        .collect();

    (resolved_args, uses_random_seed.then_some(random_seed))
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum EngineLog {
    Gui(String),
    Engine(String),
}

pub type EngineReader = Lines<BufReader<ChildStdout>>;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EngineLaunchMetadata {
    pub path: String,
    pub resolved_args: Vec<String>,
    pub random_seed: Option<u32>,
    pub applied_options: Vec<EngineOption>,
    pub skipped_unsupported_options: Vec<String>,
}

#[derive(Clone)]
pub struct EngineKillHandle {
    child: Arc<StdMutex<Child>>,
}

impl EngineKillHandle {
    pub fn kill_sync(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.start_kill();
        }
    }
}

pub struct BaseEngine {
    pub stdin: ChildStdin,
    pub reader: Option<EngineReader>,
    #[allow(dead_code)]
    kill_handle: EngineKillHandle,
    logs: Vec<EngineLog>,
    launch_metadata: EngineLaunchMetadata,
    supported_options: HashSet<String>,
}

impl BaseEngine {
    pub async fn spawn(path: PathBuf, args: &[String]) -> Result<Self, Error> {
        Self::spawn_with_seed(path, args, None).await
    }

    pub async fn spawn_with_seed(
        path: PathBuf,
        args: &[String],
        requested_seed: Option<u32>,
    ) -> Result<Self, Error> {
        let (resolved_args, random_seed) = resolve_launch_args(args, requested_seed);
        let mut command = Command::new(&path);
        command.current_dir(path.parent().unwrap_or(&path));
        command.args(&resolved_args);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command.spawn()?;

        let stdin = child.stdin.take().ok_or(Error::NoStdin)?;
        let stdout = child.stdout.take().ok_or(Error::NoStdout)?;
        let reader = BufReader::new(stdout).lines();

        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut stderr_reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = stderr_reader.next_line().await {
                    error!("Engine stderr: {}", line);
                }
            });
        }

        let kill_handle = EngineKillHandle {
            child: Arc::new(StdMutex::new(child)),
        };

        Ok(Self {
            stdin,
            reader: Some(reader),
            kill_handle,
            logs: vec![EngineLog::Gui(match random_seed {
                Some(seed) => format!(
                    "launch: {} ({} arguments, randomSeed={})\n",
                    path.display(),
                    resolved_args.len(),
                    seed
                ),
                None => format!(
                    "launch: {} ({} arguments)\n",
                    path.display(),
                    resolved_args.len()
                ),
            })],
            launch_metadata: EngineLaunchMetadata {
                path: path.display().to_string(),
                resolved_args,
                random_seed,
                applied_options: Vec::new(),
                skipped_unsupported_options: Vec::new(),
            },
            supported_options: HashSet::new(),
        })
    }

    pub fn take_reader(&mut self) -> Option<EngineReader> {
        self.reader.take()
    }

    pub fn reader_mut(&mut self) -> Option<&mut EngineReader> {
        self.reader.as_mut()
    }

    pub fn get_logs(&self) -> Vec<EngineLog> {
        self.logs.clone()
    }

    pub fn launch_metadata(&self) -> EngineLaunchMetadata {
        self.launch_metadata.clone()
    }

    pub fn kill_handle(&self) -> EngineKillHandle {
        self.kill_handle.clone()
    }

    fn log_gui(&mut self, cmd: &str) {
        self.logs.push(EngineLog::Gui(format!("{}\n", cmd)));
    }

    pub fn log_gui_message(&mut self, message: &str) {
        self.log_gui(message);
    }

    pub fn log_engine(&mut self, line: &str) {
        self.logs.push(EngineLog::Engine(line.to_string()));
    }

    pub async fn init_uci(&mut self) -> Result<(), Error> {
        self.send("uci").await?;
        tokio::time::timeout(UCI_HANDSHAKE_TIMEOUT, self.wait_for("uciok"))
            .await
            .map_err(|_| Error::EngineTimeout("uciok".to_string()))??;
        self.send("isready").await?;
        tokio::time::timeout(UCI_READY_TIMEOUT, self.wait_for("readyok"))
            .await
            .map_err(|_| Error::EngineTimeout("readyok".to_string()))??;
        Ok(())
    }

    pub async fn new_game(&mut self) -> Result<(), Error> {
        self.send("ucinewgame").await?;
        self.send("isready").await?;
        tokio::time::timeout(UCI_READY_TIMEOUT, self.wait_for("readyok"))
            .await
            .map_err(|_| Error::EngineTimeout("readyok".to_string()))??;
        Ok(())
    }

    pub async fn send(&mut self, cmd: &str) -> Result<(), Error> {
        self.log_gui(cmd);
        let msg = format!("{}\n", cmd);
        self.stdin.write_all(msg.as_bytes()).await?;
        Ok(())
    }

    pub async fn wait_for(&mut self, expected: &str) -> Result<(), Error> {
        loop {
            let line = {
                let reader = self.reader.as_mut().ok_or(Error::EngineDisconnected)?;
                reader.next_line().await?
            };
            let Some(line) = line else {
                return Err(Error::EngineDisconnected);
            };
            self.logs.push(EngineLog::Engine(line.clone()));
            if let Some(option) = line
                .strip_prefix("option name ")
                .and_then(|value| value.split_once(" type "))
                .map(|(name, _)| name.trim().to_lowercase())
            {
                self.supported_options.insert(option);
            }
            if line.starts_with(expected) {
                return Ok(());
            }
        }
    }

    pub async fn set_option<T>(&mut self, name: &str, value: T) -> Result<(), Error>
    where
        T: Display,
    {
        let value = value.to_string();
        self.launch_metadata.applied_options.push(EngineOption {
            name: name.to_string(),
            value: value.clone(),
        });
        let cmd = format!("setoption name {} value {}", name, value);
        self.send(&cmd).await
    }

    pub async fn set_option_if_supported<T>(&mut self, name: &str, value: T) -> Result<bool, Error>
    where
        T: Display,
    {
        if !self.supported_options.contains(&name.to_lowercase()) {
            self.launch_metadata
                .skipped_unsupported_options
                .push(name.to_string());
            self.log_gui_message(&format!("skipped unsupported option: {name}"));
            return Ok(false);
        }

        self.set_option(name, value).await?;
        Ok(true)
    }

    pub async fn set_position(&mut self, fen: &str, moves: &[String]) -> Result<(), Error> {
        let normalized_moves = normalize_uci_moves_for_fen(fen, moves)?;
        let cmd = if moves.is_empty() {
            format!("position fen {}", fen)
        } else {
            format!("position fen {} moves {}", fen, normalized_moves.join(" "))
        };
        self.send(&cmd).await
    }

    pub async fn go(&mut self, mode: &GoMode) -> Result<(), Error> {
        let cmd = mode.to_uci_string();
        self.send(&cmd).await
    }

    pub async fn stop(&mut self) -> Result<(), Error> {
        self.send("stop").await
    }

    pub async fn quit(&mut self) -> Result<(), Error> {
        self.send("quit").await
    }

    pub async fn wait_for_bestmove(&mut self) -> Result<String, Error> {
        tokio::time::timeout(UCI_BEST_MOVE_TIMEOUT, async {
            let reader = self.reader.as_mut().ok_or(Error::EngineDisconnected)?;
            while let Some(line) = reader.next_line().await? {
                self.logs.push(EngineLog::Engine(line.clone()));
                if let UciMessage::BestMove { best_move, .. } = vampirc_uci::parse_one(&line) {
                    return Ok(best_move.to_string());
                }
            }
            Err(Error::EngineDisconnected)
        })
        .await
        .map_err(|_| Error::EngineTimeout("bestmove".to_string()))?
    }

    pub fn kill_sync(&mut self) {
        self.kill_handle.kill_sync();
    }
}

impl Drop for BaseEngine {
    fn drop(&mut self) {
        self.kill_handle.kill_sync();
    }
}

#[cfg(test)]
mod tests {
    use std::{
        env,
        io::{self, BufRead, Write},
        time::Duration,
    };

    use shakmaty::{uci::UciMove, Position, Role};
    use tokio::sync::Mutex;

    use super::{resolve_launch_args, BaseEngine, EngineLog, RANDOM_SEED_PLACEHOLDER};
    use crate::engine::{parse_fen_to_position, EngineOption, GoMode};

    static MOCK_ENGINE_LOCK: Mutex<()> = Mutex::const_new(());

    const TACTICAL_CASES: [(&str, &str, &[&str]); 3] = [
        (
            "Fool's mate",
            "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2",
            &["d8h4"],
        ),
        (
            "Back-rank mate",
            "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1",
            &["d1d8"],
        ),
        (
            "Hanging queen",
            "4k3/8/8/8/8/8/4q3/4R1K1 w - - 0 1",
            &["e1e2"],
        ),
    ];

    #[test]
    fn resolves_random_seed_argument_without_touching_other_arguments() {
        let args = vec![
            "--use-uci-history".to_string(),
            "--seed".to_string(),
            RANDOM_SEED_PLACEHOLDER.to_string(),
            "--device=cpu".to_string(),
        ];

        let (resolved, random_seed) = resolve_launch_args(&args, Some(12345));

        assert_eq!(resolved[0], "--use-uci-history");
        assert_eq!(resolved[1], "--seed");
        assert_ne!(resolved[2], RANDOM_SEED_PLACEHOLDER);
        assert!(resolved[2].parse::<u32>().is_ok());
        assert_eq!(resolved[3], "--device=cpu");
        assert_eq!(resolved[2], random_seed.unwrap().to_string());
        assert_eq!(random_seed, Some(12345));
    }

    #[test]
    fn tactical_suite_positions_and_expected_moves_are_valid() {
        for (name, fen, expected_moves) in TACTICAL_CASES {
            let position = parse_fen_to_position(fen).unwrap();
            for expected_move in expected_moves {
                let uci = UciMove::from_ascii(expected_move.as_bytes()).unwrap();
                let mv = uci.to_move(&position).unwrap();

                if name == "Hanging queen" {
                    assert_eq!(mv.capture(), Some(Role::Queen));
                } else {
                    let mut result = position.clone();
                    result.play_unchecked(&mv);
                    assert!(result.is_checkmate(), "{name}: {expected_move} is not mate");
                }
            }
        }
    }

    #[test]
    #[ignore = "helper process for the UCI protocol regression test"]
    fn mock_uci_engine() {
        if env::var_os("CHESS_LAB_MOCK_UCI").is_none() {
            return;
        }

        let stdin = io::stdin();
        let mut stdout = io::stdout();

        for line in stdin.lock().lines() {
            let line = line.expect("mock engine must read stdin");
            match line.as_str() {
                "uci" => {
                    writeln!(stdout, "id name Chess Lab mock engine").unwrap();
                    writeln!(
                        stdout,
                        "option name MultiPV type spin default 1 min 1 max 4"
                    )
                    .unwrap();
                    writeln!(
                        stdout,
                        "option name Threads type spin default 1 min 1 max 8"
                    )
                    .unwrap();
                    writeln!(
                        stdout,
                        "option name Hash type spin default 16 min 1 max 1024"
                    )
                    .unwrap();
                    writeln!(stdout, "option name UCI_Chess960 type check default false").unwrap();
                    writeln!(stdout, "uciok").unwrap();
                }
                "isready" => {
                    writeln!(stdout, "readyok").unwrap();
                }
                "go infinite" => {}
                command if command.starts_with("go ") => {
                    writeln!(stdout, "info depth 1 score cp 0 nodes 1 nps 1 pv e7e5").unwrap();
                    writeln!(stdout, "bestmove e7e5").unwrap();
                }
                "quit" => break,
                _ => {}
            }
            stdout.flush().unwrap();
        }
    }

    #[tokio::test]
    async fn game_protocol_initializes_resets_and_searches_in_order() {
        let _guard = MOCK_ENGINE_LOCK.lock().await;
        let path = env::current_exe().expect("test executable path must be available");
        let args = vec![
            "--ignored".to_string(),
            "--exact".to_string(),
            "engine::process::tests::mock_uci_engine".to_string(),
            "--nocapture".to_string(),
        ];
        env::set_var("CHESS_LAB_MOCK_UCI", "1");
        let mut engine = BaseEngine::spawn(path, &args).await.unwrap();
        env::remove_var("CHESS_LAB_MOCK_UCI");

        engine.init_uci().await.unwrap();
        engine.set_option("Threads", 1).await.unwrap();
        engine.set_option("Hash", 16).await.unwrap();
        engine.set_option("MultiPV", 1).await.unwrap();
        engine.new_game().await.unwrap();
        engine
            .set_position(
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                &["e2e4".to_string()],
            )
            .await
            .unwrap();
        engine.go(&GoMode::Depth(24)).await.unwrap();

        assert_eq!(engine.wait_for_bestmove().await.unwrap(), "e7e5");

        let gui_commands = engine
            .get_logs()
            .into_iter()
            .filter_map(|log| match log {
                EngineLog::Gui(command) => Some(command.trim().to_string()),
                EngineLog::Engine(_) => None,
            })
            .collect::<Vec<_>>();
        let expected = [
            "uci",
            "isready",
            "setoption name Threads value 1",
            "setoption name Hash value 16",
            "setoption name MultiPV value 1",
            "ucinewgame",
            "isready",
            "position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 moves e2e4",
            "go depth 24",
        ];

        assert!(
            gui_commands
                .windows(expected.len())
                .any(|commands| commands == expected),
            "unexpected UCI command order: {gui_commands:?}"
        );

        engine.quit().await.unwrap();
    }

    #[tokio::test]
    async fn skips_options_not_advertised_by_the_engine() {
        let _guard = MOCK_ENGINE_LOCK.lock().await;
        let path = env::current_exe().expect("test executable path must be available");
        let args = vec![
            "--ignored".to_string(),
            "--exact".to_string(),
            "engine::process::tests::mock_uci_engine".to_string(),
            "--nocapture".to_string(),
        ];
        env::set_var("CHESS_LAB_MOCK_UCI", "1");
        let mut engine = BaseEngine::spawn(path, &args).await.unwrap();
        env::remove_var("CHESS_LAB_MOCK_UCI");

        engine.init_uci().await.unwrap();
        assert!(!engine
            .set_option_if_supported("Skill Level", 20)
            .await
            .unwrap());
        assert!(engine.set_option_if_supported("Threads", 1).await.unwrap());

        let metadata = engine.launch_metadata();
        assert_eq!(metadata.skipped_unsupported_options, ["Skill Level"]);
        assert_eq!(
            metadata.applied_options,
            [EngineOption {
                name: "Threads".to_string(),
                value: "1".to_string(),
            }]
        );
        engine.quit().await.unwrap();
    }

    #[tokio::test]
    async fn kill_handle_terminates_an_engine_while_its_reader_is_locked() {
        let _guard = MOCK_ENGINE_LOCK.lock().await;
        let path = env::current_exe().expect("test executable path must be available");
        let args = vec![
            "--ignored".to_string(),
            "--exact".to_string(),
            "engine::process::tests::mock_uci_engine".to_string(),
            "--nocapture".to_string(),
        ];
        env::set_var("CHESS_LAB_MOCK_UCI", "1");
        let mut engine = BaseEngine::spawn(path, &args).await.unwrap();
        env::remove_var("CHESS_LAB_MOCK_UCI");

        engine.init_uci().await.unwrap();
        engine.go(&GoMode::Infinite).await.unwrap();
        let kill_handle = engine.kill_handle();
        let engine = std::sync::Arc::new(Mutex::new(engine));
        let waiting_engine = engine.clone();
        let wait_task =
            tokio::spawn(async move { waiting_engine.lock().await.wait_for_bestmove().await });

        tokio::time::sleep(Duration::from_millis(25)).await;
        kill_handle.kill_sync();

        let result = tokio::time::timeout(Duration::from_secs(2), wait_task)
            .await
            .expect("killing the process must release the blocked UCI reader")
            .expect("the reader task must not panic");
        assert!(result.is_err());
    }

    #[tokio::test]
    #[ignore = "requires CHESS_LAB_REFERENCE_ENGINE pointing to a strong UCI engine"]
    async fn reference_engine_solves_elementary_tactical_suite() {
        let Some(path) = env::var_os("CHESS_LAB_REFERENCE_ENGINE") else {
            eprintln!("CHESS_LAB_REFERENCE_ENGINE is not configured; skipping external audit");
            return;
        };
        let mut engine = BaseEngine::spawn(path.into(), &[]).await.unwrap();

        engine.init_uci().await.unwrap();
        engine.set_option("Threads", 1).await.unwrap();
        engine.set_option("Hash", 16).await.unwrap();
        engine.set_option("MultiPV", 1).await.unwrap();
        engine
            .set_option("UCI_LimitStrength", "false")
            .await
            .unwrap();
        engine.set_option("Skill Level", 20).await.unwrap();

        for (name, fen, expected_moves) in TACTICAL_CASES {
            engine.new_game().await.unwrap();
            engine.set_position(fen, &[]).await.unwrap();
            engine.go(&GoMode::Depth(12)).await.unwrap();
            let best_move = engine.wait_for_bestmove().await.unwrap();
            assert!(
                expected_moves.contains(&best_move.as_str()),
                "{name}: expected one of {expected_moves:?}, got {best_move}"
            );
        }

        engine.quit().await.unwrap();
    }
}
