use std::{fmt::Display, path::PathBuf, process::Stdio, time::Duration};

use log::error;
use serde::Serialize;
use specta::Type;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
};
use vampirc_uci::UciMessage;

use crate::error::Error;

use super::{normalize_uci_moves_for_fen, types::GoMode};

#[cfg(target_os = "windows")]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

pub const RANDOM_SEED_PLACEHOLDER: &str = "{{randomSeed}}";
const UCI_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);
const UCI_READY_TIMEOUT: Duration = Duration::from_secs(600);
const UCI_BEST_MOVE_TIMEOUT: Duration = Duration::from_secs(600);

fn resolve_launch_args(args: &[String]) -> (Vec<String>, Option<u32>) {
    let uses_random_seed = args.iter().any(|arg| arg.contains(RANDOM_SEED_PLACEHOLDER));
    let random_seed = rand::random::<u32>();
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

pub struct BaseEngine {
    pub stdin: ChildStdin,
    pub reader: Option<EngineReader>,
    #[allow(dead_code)]
    child: Child,
    logs: Vec<EngineLog>,
}

impl BaseEngine {
    pub async fn spawn(path: PathBuf, args: &[String]) -> Result<Self, Error> {
        let (resolved_args, random_seed) = resolve_launch_args(args);
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

        Ok(Self {
            stdin,
            reader: Some(reader),
            child,
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

    fn log_gui(&mut self, cmd: &str) {
        self.logs.push(EngineLog::Gui(format!("{}\n", cmd)));
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
            if line.starts_with(expected) {
                return Ok(());
            }
        }
    }

    pub async fn set_option<T>(&mut self, name: &str, value: T) -> Result<(), Error>
    where
        T: Display,
    {
        let cmd = format!("setoption name {} value {}", name, value);
        self.send(&cmd).await
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
        let _ = self.child.start_kill();
    }
}

impl Drop for BaseEngine {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_launch_args, RANDOM_SEED_PLACEHOLDER};

    #[test]
    fn resolves_random_seed_argument_without_touching_other_arguments() {
        let args = vec![
            "--use-uci-history".to_string(),
            "--seed".to_string(),
            RANDOM_SEED_PLACEHOLDER.to_string(),
            "--device=cpu".to_string(),
        ];

        let (resolved, random_seed) = resolve_launch_args(&args);

        assert_eq!(resolved[0], "--use-uci-history");
        assert_eq!(resolved[1], "--seed");
        assert_ne!(resolved[2], RANDOM_SEED_PLACEHOLDER);
        assert!(resolved[2].parse::<u32>().is_ok());
        assert_eq!(resolved[3], "--device=cpu");
        assert_eq!(resolved[2], random_seed.unwrap().to_string());
    }
}
