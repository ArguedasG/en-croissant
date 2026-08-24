import {
  ActionIcon,
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Portal,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useToggle } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconArrowsExchange,
  IconArrowLeft,
  IconEdit,
  IconFileExport,
  IconFileText,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconTrophy,
  IconX,
  IconZoomCheck,
} from "@tabler/icons-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { Piece } from "chessops";
import { makeUci, parseUci } from "chessops";
import { INITIAL_FEN } from "chessops/fen";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { match } from "ts-pattern";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "zustand";
import type { GameMove, ModelGameBatchState, Outcome } from "@/bindings";
import {
  commands,
  type EngineLog,
  events,
  type GameConfig,
  type GameResult,
  type PlayerConfig,
} from "@/bindings";
import type { ChessgroundRef } from "@/chessground/Chessground";
import {
  activeTabAtom,
  flipBoardAfterMoveAtom,
  currentGameIdAtom,
  currentGameStateAtom,
  currentModelGameBatchIdAtom,
  currentPlayersAtom,
  gameInputColorAtom,
  gameOpeningBookEnabledAtom,
  gameOpeningBookMaxPlyAtom,
  gameOpeningBookPathAtom,
  gamePlayer1SettingsAtom,
  gamePlayer2SettingsAtom,
  gameSameTimeControlAtom,
  humanBotHistoryAtom,
  humanBotMeasurementsAtom,
  modelGameBlackSettingsAtom,
  modelGameBatchSettingsAtom,
  modelGameWhiteSettingsAtom,
  tabsAtom,
} from "@/state/atoms";
import { trainingAreasAtom } from "@/state/trainingAreas";
import { positionFromFen } from "@/utils/chessops";
import { getPGN } from "@/utils/chess";
import { serializeGameManifest } from "@/utils/gameManifest";
import { buildHumanBotHistoryGame, EMPTY_HUMAN_BOT_HISTORY } from "@/utils/humanBotHistory";
import {
  buildMaiaEngineSettings,
  buildHumanBotEngineArgs,
  buildHumanBotEngineSettings,
  buildHumanBotOpeningRepertoire,
  buildHumanBotTiming,
  buildHumanBotTraceHeaders,
  clampMaiaElo,
  getHumanBotProfile,
  HUMAN_BOT_CONFIG_VERSION,
  isMaiaEngine,
} from "@/utils/humanBots";
import {
  buildHumanBotGameMeasurement,
  buildHumanBotMeasurementHeaders,
  type HumanBotMeasurementPlayer,
} from "@/utils/humanBotMeasurements";
import { getModelGameArtifactPaths, serializeModelGameArtifacts } from "@/utils/modelGame";
import { normalizeEngineGoMode } from "@/utils/enginePresets";
import { createTab } from "@/utils/tabs";
import {
  isEndgameObjectiveMet,
  recordEndgameAttempt,
  type EndgamePosition,
  type TrainingObjective,
} from "@/utils/trainingAreas";
import { defaultTree, type GameHeaders, type TreeState } from "@/utils/treeReducer";
import { unwrap } from "@/utils/unwrap";
import EngineLogsView from "../common/EngineLogsView";
import FileInput from "../common/FileInput";
import GameInfo from "../common/GameInfo";
import GameNotation from "../common/GameNotation";
import MoveControls from "../common/MoveControls";
import { TreeStateContext } from "../common/TreeStateContext";
import Board from "./Board";
import BoardControls from "./BoardControls";
import EditingCard from "./EditingCard";
import HumanBotHistoryPanel from "./HumanBotHistoryPanel";
import HumanBotMeasurementsPanel from "./HumanBotMeasurementsPanel";
import BotLeaguePanel from "./BotLeaguePanel";
import { ModelGameBatchProgress, ModelGameBatchSetup } from "./ModelGameBatchPanel";
import ModelGameExperimentHistory from "./ModelGameExperimentHistory";
import { OpponentForm, type OpponentSettings } from "./OpponentForm";

function gameResultToOutcome(result: GameResult): Outcome {
  if (result.type === "whiteWins") return "1-0";
  if (result.type === "blackWins") return "0-1";
  return "1/2-1/2";
}

type BackendMove = { uci: string; clock: number | null };
type GamePlayers = { white: OpponentSettings; black: OpponentSettings };

type ModelGameRun = {
  config: GameConfig;
  players: GamePlayers;
  source: TreeState;
};

function snapshotTreeState(state: TreeState): TreeState {
  return structuredClone({
    root: state.root,
    headers: state.headers,
    position: state.position,
    dirty: state.dirty,
    report: state.report,
  });
}

function isEngineControlled(settings: OpponentSettings): boolean {
  return settings.type === "engine" || settings.type === "humanBot";
}

function hasConfiguredPlayer(settings: OpponentSettings): boolean {
  if (settings.type === "human") return true;
  if (settings.type === "humanBot") {
    return Boolean(settings.engine && isMaiaEngine(settings.engine));
  }
  return Boolean(settings.engine);
}

function toMeasurementPlayer(
  settings: OpponentSettings,
  humanTimingOverride?: boolean,
): HumanBotMeasurementPlayer | null {
  if (settings.type !== "humanBot") return null;
  return {
    profile: getHumanBotProfile(settings.profileId),
    modelVersion: settings.engine?.version ?? null,
    humanTimingEnabled: humanTimingOverride ?? settings.humanTiming ?? true,
    timeControl: settings.timeControl,
  };
}

function getHumanBotHistoryMatch(players: { white: OpponentSettings; black: OpponentSettings }) {
  if (players.white.type === "human" && players.black.type === "humanBot") {
    return {
      player: players.white,
      playerColor: "white" as const,
      bot: players.black,
      botColor: "black" as const,
    };
  }
  if (players.black.type === "human" && players.white.type === "humanBot") {
    return {
      player: players.black,
      playerColor: "black" as const,
      bot: players.white,
      botColor: "white" as const,
    };
  }
  return null;
}

function mapBackendMoves(moves: { uci: string; clock: bigint | null }[]): BackendMove[] {
  return moves.map((m) => ({
    uci: m.uci,
    clock: m.clock !== null ? Number(m.clock) : null,
  }));
}

function BoardGame({ generatorMode = false }: { generatorMode?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeTab = useAtomValue(activeTabAtom);
  const setActiveTab = useSetAtom(activeTabAtom);

  const [editingMode, toggleEditingMode] = useToggle();
  const [selectedPiece, setSelectedPiece] = useState<Piece | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const [batchActionBusy, setBatchActionBusy] = useState(false);

  const [inputColor, setInputColor] = useAtom(gameInputColorAtom);
  function cycleColor() {
    setInputColor((prev) =>
      match(prev)
        .with("white", () => "black" as const)
        .with("black", () => "random" as const)
        .with("random", () => "white" as const)
        .exhaustive(),
    );
  }

  const [player1Settings, setPlayer1Settings] = useAtom(
    generatorMode ? modelGameWhiteSettingsAtom : gamePlayer1SettingsAtom,
  );
  const [player2Settings, setPlayer2Settings] = useAtom(
    generatorMode ? modelGameBlackSettingsAtom : gamePlayer2SettingsAtom,
  );
  const [batchSettings, setBatchSettings] = useAtom(modelGameBatchSettingsAtom);
  const [batchId, setBatchId] = useAtom(currentModelGameBatchIdAtom);
  const [batchState, setBatchState] = useState<ModelGameBatchState | null>(null);
  const [requestedExperimentId, setRequestedExperimentId] = useState<string | null>(null);

  function swapModelGameColors() {
    if (!generatorMode) return;
    const whiteSettings = structuredClone(player1Settings);
    const blackSettings = structuredClone(player2Settings);
    setPlayer1Settings(blackSettings);
    setPlayer2Settings(whiteSettings);
  }

  function getPlayers() {
    if (generatorMode) {
      return { white: player1Settings, black: player2Settings };
    }
    let isPlayer1White = inputColor === "white";

    if (inputColor === "random") {
      isPlayer1White = Math.random() > 0.5;
    }

    return {
      white: isPlayer1White ? player1Settings : player2Settings,
      black: isPlayer1White ? player2Settings : player1Settings,
    };
  }

  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const headers = useStore(store, (s) => s.headers);
  const trainingReturn =
    headers.other?.ChessLabTrainingArea === "tactics"
      ? { to: "/training/tactics" as const, label: "Volver a táctica" }
      : headers.other?.ChessLabTrainingArea === "openings"
        ? { to: "/training/openings" as const, label: "Volver a aperturas" }
        : headers.other?.ChessLabTrainingArea === "endgames"
          ? { to: "/training/endgames" as const, label: "Volver a finales" }
          : null;
  const [trainingAreas, setTrainingAreas] = useAtom(trainingAreasAtom);
  const endgamePositionId = headers.other?.ChessLabEndgamePositionId;
  const endgamePosition = endgamePositionId
    ? trainingAreas.endgames.positions[endgamePositionId]
    : undefined;
  const endgameStudentColor = headers.other?.ChessLabEndgameStudentColor as
    | "white"
    | "black"
    | undefined;
  const endgameObjective = (endgamePosition?.objective ??
    headers.other?.ChessLabEndgameObjective ??
    "unknown") as TrainingObjective;
  const endgameSuccess = endgameStudentColor
    ? isEndgameObjectiveMet(endgameObjective, headers.result, endgameStudentColor)
    : null;
  const setFen = useStore(store, (s) => s.setFen);
  const setHeaders = useStore(store, (s) => s.setHeaders);
  const setResult = useStore(store, (s) => s.setResult);
  const appendMove = useStore(store, (s) => s.appendMove);
  const resetTree = useStore(store, (s) => s.reset);
  const setTreeState = useStore(store, (s) => s.setState);

  const [, setTabs] = useAtom(tabsAtom);
  const autoFlipBoard = useAtomValue(flipBoardAfterMoveAtom);

  const boardRef = useRef(null);
  const cgRef = useRef<ChessgroundRef>(null);
  const [gameState, setGameState] = useAtom(currentGameStateAtom);
  const [players, setPlayers] = useAtom(currentPlayersAtom);

  const [whiteTime, setWhiteTime] = useState<number | null>(null);
  const [blackTime, setBlackTime] = useState<number | null>(null);
  const [gameId, setGameId] = useAtom(currentGameIdAtom);
  const setHistory = useSetAtom(humanBotHistoryAtom);
  const setMeasurements = useSetAtom(humanBotMeasurementsAtom);
  const historySavedRef = useRef(false);
  const modelGameRunRef = useRef<ModelGameRun | null>(null);
  const singleExperimentIdRef = useRef<string | null>(null);
  const singleExperimentFinalizedRef = useRef(false);
  const endgameStartedAtRef = useRef(Date.now());
  const endgameAttemptRecordedRef = useRef(false);
  const endgameAutoStartAttemptedRef = useRef(false);

  const [logsOpened, toggleLogsOpened] = useToggle();
  const [botLeagueOpened, toggleBotLeagueOpened] = useToggle();
  const [logsColor, setLogsColor] = useState<"white" | "black">("white");
  const [engineLogs, setEngineLogs] = useState<EngineLog[]>([]);
  const [openingBookPath, setOpeningBookPath] = useAtom(gameOpeningBookPathAtom);
  const [openingBookEnabled, setOpeningBookEnabled] = useAtom(gameOpeningBookEnabledAtom);
  const [openingBookMaxPly, setOpeningBookMaxPly] = useAtom(gameOpeningBookMaxPlyAtom);

  useEffect(() => {
    if (!generatorMode || !batchId) {
      setBatchState(null);
      return;
    }

    let disposed = false;
    commands
      .getModelGameBatch(batchId)
      .then((result) => {
        if (disposed) return;
        if (result.status === "ok") {
          setBatchState(result.data);
        } else {
          setBatchId(null);
          setBatchState(null);
        }
      })
      .catch(() => {
        if (!disposed) {
          setBatchId(null);
          setBatchState(null);
        }
      });

    const unlisten = events.modelGameBatchEvent.listen(({ payload }) => {
      if (payload.state.batchId === batchId) {
        setBatchState(payload.state);
      }
    });

    return () => {
      disposed = true;
      unlisten.then((stop) => stop());
    };
  }, [batchId, generatorMode, setBatchId]);

  const whiteIsEngineControlled = isEngineControlled(players.white);
  const blackIsEngineControlled = isEngineControlled(players.black);
  const hasEngine = whiteIsEngineControlled || blackIsEngineControlled;

  const isPlayerVsEngine =
    (players.white.type === "human" && blackIsEngineControlled) ||
    (players.black.type === "human" && whiteIsEngineControlled);

  const orientation = headers.orientation || "white";
  const toggleOrientation = useCallback(() => {
    setHeaders({
      ...headers,
      fen: root.fen,
      orientation: orientation === "black" ? "white" : "black",
    });
  }, [headers, orientation, root.fen, setHeaders]);

  const fetchEngineLogs = useCallback(async () => {
    if (!gameId || !hasEngine) return;
    let color = logsColor;
    if (players.white.type === "human" && blackIsEngineControlled) {
      color = "black";
    } else if (players.black.type === "human" && whiteIsEngineControlled) {
      color = "white";
    }
    const result = await commands.getGameEngineLogs(gameId, color);
    if (result.status === "ok") {
      setEngineLogs(result.data);
    }
  }, [
    gameId,
    logsColor,
    hasEngine,
    players.white.type,
    players.black.type,
    whiteIsEngineControlled,
    blackIsEngineControlled,
  ]);

  useEffect(() => {
    if (logsOpened) {
      fetchEngineLogs();
    }
  }, [logsOpened, fetchEngineLogs]);

  const syncTreeWithMoves = useCallback(
    (backendMoves: BackendMove[]) => {
      const treeMoves: string[] = [];
      let node = root;
      while (node.children.length > 0) {
        node = node.children[0];
        if (node.move) {
          treeMoves.push(makeUci(node.move));
        }
      }

      let needsReset = false;
      for (let i = 0; i < treeMoves.length; i++) {
        if (i >= backendMoves.length || treeMoves[i] !== backendMoves[i].uci) {
          needsReset = true;
          break;
        }
      }

      if (needsReset) {
        setFen(root.fen);
        for (const move of backendMoves) {
          const parsed = parseUci(move.uci);
          if (parsed) {
            appendMove({
              payload: parsed,
              clock: move.clock !== null ? Number(move.clock) : undefined,
            });
          }
        }
        return true;
      }

      if (backendMoves.length > treeMoves.length) {
        for (let i = treeMoves.length; i < backendMoves.length; i++) {
          const move = backendMoves[i];
          const parsed = parseUci(move.uci);
          if (parsed) {
            appendMove({
              payload: parsed,
              clock: move.clock !== null ? Number(move.clock) : undefined,
            });
          }
        }
        return true;
      }

      return false;
    },
    [root, setFen, appendMove],
  );

  function changeToAnalysisMode() {
    setTabs((prev) =>
      prev.map((tab) => (tab.value === activeTab ? { ...tab, type: "analysis" } : tab)),
    );
  }

  const [pos, error] = useMemo(() => {
    let node = root;
    while (node.children.length > 0) {
      node = node.children[0];
    }
    return positionFromFen(node.fen);
  }, [root]);

  function toPlayerConfig(
    settings: OpponentSettings,
    opponentSettings: OpponentSettings,
  ): PlayerConfig {
    if (settings.type === "human") {
      return {
        type: "human",
        name: settings.name ?? "Player",
      };
    }

    if (settings.type === "humanBot") {
      const profile = getHumanBotProfile(settings.profileId);
      const opponentElo =
        opponentSettings.type === "humanBot"
          ? getHumanBotProfile(opponentSettings.profileId).elo
          : opponentSettings.type === "engine"
            ? (opponentSettings.engine?.elo ?? profile.elo)
            : profile.elo;
      const engineSettings = buildHumanBotEngineSettings(
        profile,
        opponentElo,
        settings.engine?.settings ?? [],
      );

      return {
        type: "engine",
        name: profile.name,
        path: settings.engine?.path ?? "",
        version: settings.engine?.version ?? "",
        presetCategory: "humanLike",
        targetElo: profile.elo,
        seed: settings.seed ?? null,
        args: buildHumanBotEngineArgs(settings.engine?.args ?? []),
        options: engineSettings.map((setting) => ({
          name: setting.name,
          value: setting.value?.toString() ?? "",
        })),
        openingRepertoire: buildHumanBotOpeningRepertoire(profile),
        humanTiming: generatorMode
          ? null
          : settings.humanTiming === false
            ? null
            : buildHumanBotTiming(profile),
        go: settings.timeControl ? null : { t: "Depth", c: 1 },
      };
    }

    const maia = Boolean(settings.engine && isMaiaEngine(settings.engine));
    const targetElo = clampMaiaElo(settings.targetElo ?? 1500);
    const engineSettings = maia
      ? buildMaiaEngineSettings(
          targetElo,
          settings.engineSettings ?? settings.engine?.settings ?? [],
        )
      : (settings.engineSettings ?? settings.engine?.settings ?? []);

    return {
      type: "engine",
      name: settings.engine?.name ?? "Engine",
      path: settings.engine?.path ?? "",
      version: settings.engine?.version ?? "",
      presetCategory: maia ? "humanLike" : (settings.presetId ?? "custom"),
      targetElo: maia
        ? targetElo
        : settings.presetId === "limited"
          ? (settings.targetElo ?? 1800)
          : null,
      seed: settings.seed ?? null,
      args: maia
        ? buildHumanBotEngineArgs(settings.engine?.args ?? [])
        : (settings.engine?.args ?? []),
      options: engineSettings.map((s) => ({
        name: s.name,
        value: s.name === "MultiPV" ? "1" : (s.value?.toString() ?? ""),
      })),
      go: settings.timeControl
        ? null
        : maia
          ? { t: "Depth", c: 1 }
          : normalizeEngineGoMode(settings.go, settings.engine?.name),
    };
  }

  function getTreeMoves(): string[] {
    const moves: string[] = [];
    let node = root;
    while (node.children.length > 0) {
      node = node.children[0];
      if (node.move) {
        moves.push(makeUci(node.move));
      }
    }
    return moves;
  }

  async function startGame() {
    if (isStarting) return;
    toggleEditingMode(false);
    const playerSettings = getPlayers();
    const initialMoves = getTreeMoves();

    const config: GameConfig = {
      white: toPlayerConfig(playerSettings.white, playerSettings.black),
      black: toPlayerConfig(playerSettings.black, playerSettings.white),
      whiteTimeControl: playerSettings.white.timeControl
        ? {
            initialTime: playerSettings.white.timeControl.seconds,
            increment: playerSettings.white.timeControl.increment ?? 0,
          }
        : null,
      blackTimeControl: playerSettings.black.timeControl
        ? {
            initialTime: playerSettings.black.timeControl.seconds,
            increment: playerSettings.black.timeControl.increment ?? 0,
          }
        : null,
      initialFen: root.fen === INITIAL_FEN ? null : root.fen,
      initialMoves,
      openingBook:
        openingBookEnabled && openingBookPath
          ? { path: openingBookPath, maxPly: Math.max(1, openingBookMaxPly) }
          : null,
    } as GameConfig;

    if (generatorMode) {
      modelGameRunRef.current = {
        config: structuredClone(config),
        players: structuredClone(playerSettings),
        source: snapshotTreeState(store.getState()),
      };
    }

    if (generatorMode && batchSettings.enabled) {
      await launchModelGameBatch(config);
    } else {
      await launchConfiguredGame(config, playerSettings);
    }
  }

  async function launchModelGameBatch(config: GameConfig) {
    if (!activeTab) return;
    setIsStarting(true);
    const newBatchId = `${activeTab}-batch-${Date.now()}`;
    try {
      const state = unwrap(
        await commands.startModelGameBatch(newBatchId, {
          ownerId: activeTab,
          gameConfig: config,
          gameCount: batchSettings.gameCount,
          alternateColors: batchSettings.alternateColors,
          seedStep: batchSettings.seedStep,
          requestedConcurrency: batchSettings.concurrency,
          maxCpuThreads: batchSettings.maxCpuThreads,
          maxMemoryMb: batchSettings.maxMemoryMb,
          maxRetries: batchSettings.maxRetries,
        }),
      );
      setBatchId(newBatchId);
      setBatchState(state);
      setRequestedExperimentId(null);
    } catch (err) {
      notifications.show({
        title: t("ModelGame.Batch.Start.Error", "Could not start the batch"),
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setIsStarting(false);
    }
  }

  async function launchConfiguredGame(config: GameConfig, playerSettings: GamePlayers) {
    setIsStarting(true);
    setPlayers(playerSettings);
    historySavedRef.current = false;
    if (endgamePositionId) {
      endgameStartedAtRef.current = Date.now();
      endgameAttemptRecordedRef.current = false;
    }

    const boardOrientation =
      playerSettings.black.type === "human" && isEngineControlled(playerSettings.white)
        ? "black"
        : "white";

    const newGameId = `${activeTab}-game`;
    setGameId(newGameId);

    try {
      const result = await commands.startGame(newGameId, config);
      const state = unwrap(result);

      if (generatorMode && activeTab) {
        const experimentId = `${activeTab}-single-${Date.now()}`;
        const experimentResult = await commands.startSingleModelGameExperiment(
          experimentId,
          activeTab,
          newGameId,
          config,
        );
        if (experimentResult.status === "ok") {
          singleExperimentIdRef.current = experimentId;
          singleExperimentFinalizedRef.current = false;
        } else {
          singleExperimentIdRef.current = null;
          notifications.show({
            title: t("ModelGame.Experiments.RecordError", "Could not record the experiment"),
            message: experimentResult.error,
            color: "red",
          });
        }
      }

      setWhiteTime(state.whiteTime !== null ? Number(state.whiteTime) : null);
      setBlackTime(state.blackTime !== null ? Number(state.blackTime) : null);

      setGameState("playing");

      setFen(state.initialFen);
      for (const move of mapBackendMoves(state.moves)) {
        const parsed = parseUci(move.uci);
        if (parsed) {
          appendMove({
            payload: parsed,
            clock: move.clock ?? undefined,
          });
        }
      }

      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, ".");
      const timeStr = now.toISOString().slice(11, 19);

      const whiteIsEngine = isEngineControlled(playerSettings.white);
      const blackIsEngine = isEngineControlled(playerSettings.black);
      const hasHumanBot =
        playerSettings.white.type === "humanBot" || playerSettings.black.type === "humanBot";
      let eventStr = "Casual Game";
      if (generatorMode) {
        eventStr = "Model Game";
      } else if (whiteIsEngine && blackIsEngine) {
        eventStr = hasHumanBot ? "Human Bot Match" : "Engine Match";
      } else if (whiteIsEngine || blackIsEngine) {
        eventStr = hasHumanBot ? "Player vs Human Bot" : "Player vs Engine";
      } else {
        eventStr = "Player Match";
      }

      const formatTimeControl = (settings: OpponentSettings): string => {
        if (!settings.timeControl) return "-";
        const seconds = settings.timeControl.seconds / 1000;
        const increment = (settings.timeControl.increment ?? 0) / 1000;
        return increment ? `${seconds}+${increment}` : `${seconds}`;
      };

      const whiteTimeControl = formatTimeControl(playerSettings.white);
      const blackTimeControl = formatTimeControl(playerSettings.black);
      const sameTimeControl = whiteTimeControl === blackTimeControl;
      const retainedOtherHeaders = Object.fromEntries(
        Object.entries(headers.other ?? {}).filter(
          ([key]) =>
            key !== "HumanBotConfigVersion" &&
            !key.startsWith("WhiteBot") &&
            !key.startsWith("BlackBot"),
        ),
      );
      const humanBotHeaders: Record<string, string> = {};

      if (playerSettings.white.type === "humanBot") {
        Object.assign(
          humanBotHeaders,
          buildHumanBotTraceHeaders(
            getHumanBotProfile(playerSettings.white.profileId),
            "White",
            generatorMode ? false : (playerSettings.white.humanTiming ?? true),
            playerSettings.white.engine?.version,
          ),
        );
      }
      if (playerSettings.black.type === "humanBot") {
        Object.assign(
          humanBotHeaders,
          buildHumanBotTraceHeaders(
            getHumanBotProfile(playerSettings.black.profileId),
            "Black",
            generatorMode ? false : (playerSettings.black.humanTiming ?? true),
            playerSettings.black.engine?.version,
          ),
        );
      }

      const newHeaders: Partial<GameHeaders> = {
        white: state.whitePlayer,
        black: state.blackPlayer,
        white_elo:
          playerSettings.white.type === "humanBot"
            ? getHumanBotProfile(playerSettings.white.profileId).elo
            : undefined,
        black_elo:
          playerSettings.black.type === "humanBot"
            ? getHumanBotProfile(playerSettings.black.profileId).elo
            : undefined,
        event: eventStr,
        site: "En Croissant",
        date: dateStr,
        time: timeStr,
        time_control: undefined,
        orientation: boardOrientation,
        other: {
          ...retainedOtherHeaders,
          ...(generatorMode ? { ModelGameSchemaVersion: "1" } : {}),
          ...(generatorMode && playerSettings.white.type !== "human"
            ? { ModelGameWhiteSeed: String(playerSettings.white.seed ?? 1) }
            : {}),
          ...(generatorMode && playerSettings.black.type !== "human"
            ? { ModelGameBlackSeed: String(playerSettings.black.seed ?? 2) }
            : {}),
          ...(hasHumanBot ? { HumanBotConfigVersion: String(HUMAN_BOT_CONFIG_VERSION) } : {}),
          ...humanBotHeaders,
        },
      };

      if (sameTimeControl) {
        if (whiteTimeControl !== "-") {
          newHeaders.time_control = whiteTimeControl;
        }
      } else {
        newHeaders.white_time_control = whiteTimeControl;
        newHeaders.black_time_control = blackTimeControl;
      }

      setHeaders({
        ...headers,
        ...newHeaders,
        fen: state.initialFen,
      });

      setTabs((prev) =>
        prev.map((tab) =>
          tab.value === activeTab
            ? { ...tab, name: `${state.whitePlayer} vs. ${state.blackPlayer}` }
            : tab,
        ),
      );
    } catch (err) {
      console.error("Failed to start game:", err);
      setGameId(null);
      setGameState("settingUp");
      notifications.show({
        title: t("ModelGame.Start.Error", "Could not start the game"),
        message:
          err instanceof Error
            ? err.message
            : t(
                "ModelGame.Start.Error.Desc",
                "Check the engine configuration and its logs, then try again.",
              ),
        color: "red",
      });
    } finally {
      setIsStarting(false);
    }
  }

  const handleHumanMove = useCallback(
    async (uci: string) => {
      if (!gameId || gameState !== "playing") return;
      try {
        await commands.makeGameMove(gameId, uci);
        if (!isPlayerVsEngine && autoFlipBoard) {
          toggleOrientation();
        }
      } catch (err) {
        console.error("Failed to make move:", err);
      }
    },
    [autoFlipBoard, gameId, gameState, isPlayerVsEngine, toggleOrientation],
  );

  const pendingMovesRef = useRef<{ uci: string; clock: number | null }[] | null>(null);
  const pendingTimesRef = useRef<{
    white: number | null;
    black: number | null;
  } | null>(null);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const THROTTLE_MS = 150;

  const syncTreeWithMovesRef = useRef(syncTreeWithMoves);
  syncTreeWithMovesRef.current = syncTreeWithMoves;

  const applyPendingUpdates = useCallback(() => {
    if (pendingMovesRef.current) {
      syncTreeWithMovesRef.current(pendingMovesRef.current);
      pendingMovesRef.current = null;
    }
    if (pendingTimesRef.current) {
      setWhiteTime(pendingTimesRef.current.white);
      setBlackTime(pendingTimesRef.current.black);
      pendingTimesRef.current = null;
    }
    throttleTimerRef.current = null;

    setTimeout(() => {
      cgRef.current?.playPremove();
    }, 0);
  }, []);

  const scheduleUpdate = useCallback(() => {
    if (!throttleTimerRef.current) {
      throttleTimerRef.current = setTimeout(applyPendingUpdates, THROTTLE_MS);
    }
  }, [applyPendingUpdates]);

  const onTakeBack = useCallback(async () => {
    if (!gameId || gameState !== "playing") return;
    await commands.takeBackGameMove(gameId);
  }, [gameId, gameState]);

  useEffect(() => {
    if (gameState !== "playing" || !gameId) return;

    const currentGameId = gameId;

    const unlistenMove = events.gameMoveEvent.listen(({ payload }) => {
      if (payload.gameId !== currentGameId) return;

      pendingMovesRef.current = mapBackendMoves(payload.moves);
      pendingTimesRef.current = {
        white: payload.whiteTime !== null ? Number(payload.whiteTime) : null,
        black: payload.blackTime !== null ? Number(payload.blackTime) : null,
      };
      scheduleUpdate();
    });

    const unlistenClock = events.clockUpdateEvent.listen(({ payload }) => {
      if (payload.gameId !== currentGameId) return;
      setWhiteTime(payload.whiteTime !== null ? Number(payload.whiteTime) : null);
      setBlackTime(payload.blackTime !== null ? Number(payload.blackTime) : null);
    });

    const unlistenGameOver = events.gameOverEvent.listen(({ payload }) => {
      if (payload.gameId !== currentGameId) return;

      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      pendingMovesRef.current = null;
      pendingTimesRef.current = null;

      syncTreeWithMovesRef.current(mapBackendMoves(payload.moves));

      const outcome = gameResultToOutcome(payload.result);
      const recordedAt = new Date().toISOString();
      const completedEndgameId = store.getState().headers.other?.ChessLabEndgamePositionId;
      const completedStudentColor = store.getState().headers.other?.ChessLabEndgameStudentColor as
        | "white"
        | "black"
        | undefined;
      if (completedEndgameId && completedStudentColor && !endgameAttemptRecordedRef.current) {
        endgameAttemptRecordedRef.current = true;
        setTrainingAreas((previous) => {
          const position = previous.endgames.positions[completedEndgameId];
          if (!position) return previous;
          return {
            ...previous,
            endgames: recordEndgameAttempt(previous.endgames, completedEndgameId, {
              outcome,
              success: isEndgameObjectiveMet(position.objective, outcome, completedStudentColor),
              timeMs: Date.now() - endgameStartedAtRef.current,
            }),
          };
        });
      }
      const measurement = buildHumanBotGameMeasurement({
        gameId: payload.gameId,
        recordedAt,
        result: outcome,
        moves: payload.moves as GameMove[],
        players: {
          white: toMeasurementPlayer(players.white, generatorMode ? false : undefined),
          black: toMeasurementPlayer(players.black, generatorMode ? false : undefined),
        },
      });

      let finalHeaders: GameHeaders = {
        ...store.getState().headers,
        result: outcome,
      };
      if (measurement.bots.length > 0) {
        setMeasurements((previous) => [...previous, measurement].slice(-1000));
        finalHeaders = {
          ...finalHeaders,
          other: {
            ...finalHeaders.other,
            ...buildHumanBotMeasurementHeaders(measurement),
          },
        };
      }
      setHeaders(finalHeaders);

      const historyMatch = getHumanBotHistoryMatch(players);
      if (historyMatch && !historySavedRef.current) {
        historySavedRef.current = true;
        const profile = getHumanBotProfile(historyMatch.bot.profileId);
        const pgn = getPGN(store.getState().root, {
          headers: finalHeaders,
          comments: true,
          extraMarkups: true,
          glyphs: true,
          variations: true,
        });
        const timeControl =
          (historyMatch.playerColor === "white"
            ? finalHeaders.white_time_control
            : finalHeaders.black_time_control) ??
          finalHeaders.time_control ??
          null;
        const historyGame = buildHumanBotHistoryGame({
          id: `${payload.gameId}-${recordedAt}`,
          backendGameId: payload.gameId,
          recordedAt,
          profileId: profile.id,
          profileName: profile.name,
          botElo: profile.elo,
          botColor: historyMatch.botColor,
          playerName: historyMatch.player.name ?? "Player",
          result: outcome,
          timeControl,
          plies: payload.moves.length,
          pgn,
        });
        setHistory(async (previous) => {
          const current = (await previous) ?? EMPTY_HUMAN_BOT_HISTORY;
          return {
            ...current,
            games: [historyGame, ...current.games],
          };
        });
      }

      setGameState("gameOver");
      setResult(outcome);
    });

    return () => {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      unlistenMove.then((f) => f());
      unlistenClock.then((f) => f());
      unlistenGameOver.then((f) => f());
    };
  }, [
    generatorMode,
    gameId,
    gameState,
    scheduleUpdate,
    players,
    setGameState,
    setHeaders,
    setHistory,
    setMeasurements,
    setResult,
    setTrainingAreas,
    store,
  ]);

  useEffect(() => {
    if (gameState === "playing" && gameId) {
      commands.getGameState(gameId).then((result) => {
        if (result.status === "ok") {
          const state = result.data;

          syncTreeWithMovesRef.current(mapBackendMoves(state.moves));

          setWhiteTime(state.whiteTime !== null ? Number(state.whiteTime) : null);
          setBlackTime(state.blackTime !== null ? Number(state.blackTime) : null);

          if (state.status !== "playing") {
            setGameState("gameOver");
            if (typeof state.status === "object" && "finished" in state.status) {
              setResult(gameResultToOutcome(state.status.finished.result));
            }
            const experimentId = singleExperimentIdRef.current;
            if (generatorMode && experimentId && !singleExperimentFinalizedRef.current) {
              singleExperimentFinalizedRef.current = true;
              commands
                .finalizeSingleModelGameExperiment(experimentId, gameId, false)
                .then((result) => {
                  if (result.status === "error") {
                    singleExperimentFinalizedRef.current = false;
                    notifications.show({
                      title: t(
                        "ModelGame.Experiments.RecordError",
                        "Could not record the experiment",
                      ),
                      message: result.error,
                      color: "red",
                    });
                  }
                });
            }
          }
        }
      });
    }
  }, [gameId, gameState, generatorMode, setGameState, setResult, t]);

  const movable = useMemo(() => {
    if (players.white.type === "human" && players.black.type === "human") {
      return "turn";
    }
    if (players.white.type === "human") {
      return "white";
    }
    if (players.black.type === "human") {
      return "black";
    }
    return "none";
  }, [players]);

  const [sameTimeControl, setSameTimeControl] = useAtom(gameSameTimeControlAtom);

  const onePlayerIsEngine = isPlayerVsEngine;
  const isEngineVsEngine = whiteIsEngineControlled && blackIsEngineControlled;
  const setupIsValid =
    hasConfiguredPlayer(player1Settings) &&
    hasConfiguredPlayer(player2Settings) &&
    (!generatorMode ||
      (isEngineControlled(player1Settings) && isEngineControlled(player2Settings)));

  const startGameRef = useRef(startGame);
  startGameRef.current = startGame;
  useEffect(() => {
    const shouldStartEndgame =
      !generatorMode &&
      headers.other?.ChessLabTrainingArea === "endgames" &&
      headers.other?.ChessLabEndgameAutoStart === "1";
    if (
      !shouldStartEndgame ||
      gameState !== "settingUp" ||
      !setupIsValid ||
      isStarting ||
      endgameAutoStartAttemptedRef.current
    ) {
      return;
    }
    endgameAutoStartAttemptedRef.current = true;
    void startGameRef.current();
  }, [gameState, generatorMode, headers.other, isStarting, setupIsValid]);

  function getResignationLosingColor(): "white" | "black" {
    if (isPlayerVsEngine) {
      return players.white.type === "human" ? "white" : "black";
    }
    return pos?.turn === "white" ? "white" : "black";
  }

  async function handleAbort() {
    if (!gameId) return;
    setIsAborting(true);
    try {
      const experimentId = singleExperimentIdRef.current;
      if (generatorMode && experimentId && !singleExperimentFinalizedRef.current) {
        singleExperimentFinalizedRef.current = true;
        const recordResult = await commands.finalizeSingleModelGameExperiment(
          experimentId,
          gameId,
          true,
        );
        if (recordResult.status === "error") {
          singleExperimentFinalizedRef.current = false;
          notifications.show({
            title: t("ModelGame.Experiments.RecordError", "Could not record the experiment"),
            message: recordResult.error,
            color: "red",
          });
        }
      }
      unwrap(await commands.abortGame(gameId));
      setGameState("gameOver");
      setResult("*");
    } catch (err) {
      notifications.show({
        title: t("ModelGame.Abort.Error", "Could not abort the game"),
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setIsAborting(false);
    }
  }

  async function updateBatchState(
    action: (
      batchId: string,
    ) => Promise<{ status: "ok"; data: ModelGameBatchState } | { status: "error"; error: string }>,
  ) {
    if (!batchId) return;
    setBatchActionBusy(true);
    try {
      setBatchState(unwrap(await action(batchId)));
    } catch (err) {
      notifications.show({
        title: t("ModelGame.Batch.Action.Error", "Could not update the batch"),
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    } finally {
      setBatchActionBusy(false);
    }
  }

  function handlePauseBatch() {
    return updateBatchState(commands.pauseModelGameBatch);
  }

  function handleResumeBatch() {
    return updateBatchState(commands.resumeModelGameBatch);
  }

  function handleCancelBatch() {
    return updateBatchState(commands.cancelModelGameBatch);
  }

  async function handleEditBatch() {
    if (batchId) {
      await commands.dismissModelGameBatch(batchId);
    }
    setBatchId(null);
    setBatchState(null);
    setRequestedExperimentId(null);
  }

  async function handleAnalyzeBatchGame(index: number) {
    if (!batchId) return;
    try {
      const artifact = unwrap(await commands.readModelGameExperimentGame(batchId, index));
      const result = batchState?.results.find((candidate) => candidate.index === index);
      await createTab({
        tab: {
          name: result
            ? `${result.whitePlayer} - ${result.blackPlayer}`
            : t("ModelGame.Experiments.Game", "Model game"),
          type: "analysis",
        },
        setTabs,
        setActiveTab,
        pgn: artifact.pgn,
      });
    } catch (error) {
      notifications.show({
        title: t("ModelGame.Experiments.OpenGameError", "Could not open the saved game"),
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    }
  }

  async function handleResign() {
    if (!gameId) return;
    const losingColor = getResignationLosingColor();
    await commands.resignGame(gameId, losingColor);
  }

  async function handleNewGame() {
    setGameId(null);
    setGameState("settingUp");
    setWhiteTime(null);
    setBlackTime(null);
    resetTree();
  }

  function prepareEndgamePosition(position: EndgamePosition) {
    const [chessPosition] = positionFromFen(position.fen);
    if (!chessPosition) return;
    const ownerSet = Object.values(trainingAreas.endgames.sets).find((set) =>
      set.positionIds.includes(position.id),
    );
    const nextTree = defaultTree(position.fen);
    nextTree.headers = {
      ...nextTree.headers,
      event: position.title,
      fen: position.fen,
      other: {
        ChessLabTrainingArea: "endgames",
        ChessLabEndgamePositionId: position.id,
        ChessLabEndgameSetId: ownerSet?.id ?? "",
        ChessLabEndgameObjective: position.objective,
        ChessLabEndgameStudentColor: chessPosition.turn,
        ChessLabEndgameAutoStart: "1",
      },
    };
    setInputColor(chessPosition.turn);
    setTreeState(nextTree);
    setTabs((previous) =>
      previous.map((tab) =>
        tab.value === activeTab ? { ...tab, name: position.title, type: "play" } : tab,
      ),
    );
    setGameId(null);
    setGameState("settingUp");
    setWhiteTime(null);
    setBlackTime(null);
    setResult("*");
    endgameAutoStartAttemptedRef.current = false;
    endgameAttemptRecordedRef.current = false;
  }

  function handleRepeatEndgame() {
    if (endgamePosition) prepareEndgamePosition(endgamePosition);
  }

  async function handleReturnToEndgames() {
    if (gameState === "playing" && gameId) {
      setIsAborting(true);
      endgameAttemptRecordedRef.current = true;
      try {
        unwrap(await commands.abortGame(gameId));
        setGameState("gameOver");
        setResult("*");
        setGameId(null);
      } catch (error) {
        endgameAttemptRecordedRef.current = false;
        notifications.show({
          title: "No se pudo cerrar la partida",
          message:
            error instanceof Error
              ? error.message
              : "La partida sigue activa. Intenta volver nuevamente.",
          color: "red",
        });
        return;
      } finally {
        setIsAborting(false);
      }
    }
    await navigate({ to: "/training/endgames" });
  }

  function handleNextEndgame() {
    if (!endgamePosition) return;
    const currentSet = headers.other?.ChessLabEndgameSetId
      ? trainingAreas.endgames.sets[headers.other.ChessLabEndgameSetId]
      : undefined;
    const sourceSets =
      currentSet?.origin === "user"
        ? [currentSet]
        : Object.values(trainingAreas.endgames.sets).filter((set) => set.origin === "bundled");
    const queue = sourceSets.flatMap((set) =>
      set.positionIds.flatMap((positionId) => {
        const position = trainingAreas.endgames.positions[positionId];
        return position?.theme === endgamePosition.theme || currentSet?.origin === "user"
          ? position
            ? [position]
            : []
          : [];
      }),
    );
    const currentIndex = queue.findIndex((position) => position.id === endgamePosition.id);
    const next = queue[(currentIndex + 1) % Math.max(1, queue.length)];
    if (next) prepareEndgamePosition(next);
  }

  function restoreModelGameSource(run: ModelGameRun) {
    setTreeState(snapshotTreeState(run.source));
    setWhiteTime(null);
    setBlackTime(null);
    setResult("*");
  }

  async function handleRepeatModelGame() {
    const run = modelGameRunRef.current;
    if (!run) return;
    restoreModelGameSource(run);
    await launchConfiguredGame(structuredClone(run.config), structuredClone(run.players));
  }

  async function handleEditModelGame() {
    const run = modelGameRunRef.current;
    if (gameId) await commands.abortGame(gameId);
    if (run) restoreModelGameSource(run);
    setGameId(null);
    setGameState("settingUp");
  }

  async function handleSelectOpeningBook() {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Opening Book",
          extensions: ["pgn", "epd", "bin", "zip"],
        },
      ],
    });

    if (typeof selected === "string") {
      setOpeningBookPath(selected);
    }
  }

  async function exportGameManifest() {
    if (!gameId) return;
    const result = await commands.getGameManifest(gameId);
    if (result.status === "error") return;

    const file = await save({
      defaultPath: "chess-lab-game-manifest.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!file) return;

    await writeTextFile(file, serializeGameManifest(result.data));
  }

  async function exportModelGameArtifacts() {
    if (!gameId) return;
    const manifestResult = await commands.getGameManifest(gameId);
    if (manifestResult.status === "error") {
      notifications.show({
        title: t("ModelGame.Export.Error", "Could not export the model game"),
        message: t(
          "ModelGame.Export.Error.Desc",
          "Aborted games are not retained yet. Complete the game before exporting it.",
        ),
        color: "red",
      });
      return;
    }

    const selectedPath = await save({
      defaultPath: "chess-lab-model-game.pgn",
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (!selectedPath) return;

    const paths = getModelGameArtifactPaths(selectedPath);
    const artifacts = serializeModelGameArtifacts(
      getPGN(root, {
        headers,
        comments: true,
        extraMarkups: true,
        glyphs: true,
        variations: false,
      }),
      manifestResult.data,
    );
    await writeTextFile(paths.pgnPath, artifacts.pgn);
    await writeTextFile(paths.manifestPath, artifacts.manifest);
    notifications.show({
      title: t("ModelGame.Export.Success", "Model game exported"),
      message: t(
        "ModelGame.Export.Success.Desc",
        "The PGN and its reproducibility manifest were saved together.",
      ),
      color: "green",
    });
  }

  return (
    <>
      <Portal target="#left" style={{ height: "100%" }}>
        <Board
          editingMode={gameState === "settingUp" && editingMode}
          viewOnly={gameState !== "playing" && !editingMode}
          disableVariations
          boardRef={boardRef}
          movable={gameState === "settingUp" && editingMode ? "none" : movable}
          whiteTime={gameState === "playing" ? (whiteTime ?? undefined) : undefined}
          blackTime={gameState === "playing" ? (blackTime ?? undefined) : undefined}
          onMove={handleHumanMove}
          selectedPiece={selectedPiece}
          cgRef={cgRef}
          enablePremoves={isPlayerVsEngine && gameState === "playing"}
        />
      </Portal>
      <Portal target="#topRight" style={{ height: "100%", overflow: "hidden" }}>
        <Paper withBorder shadow="sm" p="md" h="100%">
          {logsOpened ? (
            <EngineLogsView
              logs={engineLogs}
              onRefresh={fetchEngineLogs}
              additionalControls={
                <>
                  {whiteIsEngineControlled && blackIsEngineControlled ? (
                    <SegmentedControl
                      value={logsColor}
                      onChange={(value) => setLogsColor(value as "white" | "black")}
                      data={[
                        { value: "white", label: "White" },
                        { value: "black", label: "Black" },
                      ]}
                    />
                  ) : (
                    <div />
                  )}
                  <ActionIcon flex={0} onClick={() => toggleLogsOpened()}>
                    <IconX size="1.2rem" />
                  </ActionIcon>
                </>
              }
            />
          ) : generatorMode && batchId && !batchState ? (
            <Stack h="100%" align="center" justify="center">
              <Loader />
              <Text size="sm" c="dimmed">
                {t("ModelGame.Batch.Loading", "Loading batch state...")}
              </Text>
            </Stack>
          ) : batchState ? (
            <ModelGameBatchProgress
              state={batchState}
              busy={batchActionBusy}
              onPause={handlePauseBatch}
              onResume={handleResumeBatch}
              onCancel={handleCancelBatch}
              onEdit={handleEditBatch}
              onOpenExperiment={() => {
                if (batchId) setRequestedExperimentId(batchId);
              }}
              onAnalyze={handleAnalyzeBatchGame}
            />
          ) : (
            <>
              {gameState === "settingUp" && (
                <Stack h="100%" gap={0}>
                  <ScrollArea style={{ flex: 1 }} offsetScrollbars>
                    <Stack>
                      {generatorMode && (
                        <Paper withBorder p="sm">
                          <Stack gap="xs">
                            <Group justify="space-between" align="flex-start" wrap="nowrap">
                              <div>
                                <Text fw={600}>
                                  {t("ModelGame.InitialPosition", "Initial position")}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  {getTreeMoves().length > 0
                                    ? t("ModelGame.InitialPosition.History", {
                                        defaultValue:
                                          "Starts after {{moves}} plies from the source PGN.",
                                        moves: getTreeMoves().length,
                                      })
                                    : t(
                                        "ModelGame.InitialPosition.Fen",
                                        "Starts directly from the FEN shown below.",
                                      )}
                                </Text>
                              </div>
                              <Button
                                variant="light"
                                size="xs"
                                leftSection={<IconEdit size="1rem" />}
                                onClick={() => toggleEditingMode(true)}
                              >
                                {t("ModelGame.InitialPosition.Edit", "Edit board / FEN")}
                              </Button>
                            </Group>
                            <Text size="xs" ff="monospace" truncate title={root.fen}>
                              {root.fen}
                            </Text>
                          </Stack>
                        </Paper>
                      )}
                      {generatorMode && (
                        <ModelGameBatchSetup
                          settings={batchSettings}
                          setSettings={setBatchSettings}
                        />
                      )}
                      {generatorMode && (
                        <Button
                          variant="light"
                          leftSection={<IconTrophy size="1rem" />}
                          onClick={() => toggleBotLeagueOpened(true)}
                        >
                          {t("BotLeague.OpenFromGenerator", "Torneos de bots")}
                        </Button>
                      )}
                      {generatorMode && <ModelGameExperimentHistory />}
                      <Group>
                        <Text flex={1} ta="center" fz="lg" fw="bold">
                          {generatorMode
                            ? t("Fen.White", "White")
                            : match(inputColor)
                                .with("white", () => "White")
                                .with("random", () => "Random")
                                .with("black", () => "Black")
                                .exhaustive()}
                        </Text>
                        {generatorMode ? (
                          <Tooltip label={t("ModelGame.SwapColors", "Cambiar colores")}>
                            <ActionIcon
                              aria-label={t("ModelGame.SwapColors", "Cambiar colores")}
                              onClick={swapModelGameColors}
                            >
                              <IconArrowsExchange />
                            </ActionIcon>
                          </Tooltip>
                        ) : (
                          <Tooltip label={t("Board.Game.CycleColor", "Cambiar color")}>
                            <ActionIcon
                              aria-label={t("Board.Game.CycleColor", "Cambiar color")}
                              onClick={cycleColor}
                            >
                              <IconArrowsExchange />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        <Text flex={1} ta="center" fz="lg" fw="bold">
                          {generatorMode
                            ? t("Fen.Black", "Black")
                            : match(inputColor)
                                .with("white", () => "Black")
                                .with("random", () => "Random")
                                .with("black", () => "White")
                                .exhaustive()}
                        </Text>
                      </Group>
                      <Box flex={1}>
                        <Group style={{ alignItems: "start" }}>
                          <OpponentForm
                            sameTimeControl={sameTimeControl}
                            opponent={player1Settings}
                            setOpponent={setPlayer1Settings}
                            setOtherOpponent={setPlayer2Settings}
                            allowedTypes={generatorMode ? ["engine", "humanBot"] : undefined}
                            showSeed={generatorMode}
                            humanTimingEnabled={!generatorMode}
                          />
                          <Divider orientation="vertical" />
                          <OpponentForm
                            sameTimeControl={sameTimeControl}
                            opponent={player2Settings}
                            setOpponent={setPlayer2Settings}
                            setOtherOpponent={setPlayer1Settings}
                            allowedTypes={generatorMode ? ["engine", "humanBot"] : undefined}
                            showSeed={generatorMode}
                            humanTimingEnabled={!generatorMode}
                          />
                        </Group>
                      </Box>

                      <Paper withBorder p="sm">
                        <Stack>
                          <Checkbox
                            label={t("Board.Opponent.SameTimeControl")}
                            checked={sameTimeControl}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSameTimeControl(checked);
                              if (checked) {
                                setPlayer2Settings((prev) => ({
                                  ...prev,
                                  timeControl: player1Settings.timeControl,
                                  timeUnit: player1Settings.timeUnit,
                                  incrementUnit: player1Settings.incrementUnit,
                                }));
                              }
                            }}
                          />

                          <Divider variant="dashed" />

                          <Checkbox
                            label={t("Board.Opponent.EnableOpeningBook")}
                            checked={openingBookEnabled}
                            onChange={(e) => setOpeningBookEnabled(e.currentTarget.checked)}
                          />

                          {openingBookEnabled && (
                            <>
                              <FileInput
                                label="Opening book (.pgn/.epd/.bin/.zip)"
                                description={t("Import.PGN.ClickToSelect")}
                                filename={openingBookPath}
                                onClick={handleSelectOpeningBook}
                              />
                              {openingBookPath?.includes(".bin") && (
                                <NumberInput
                                  label="Polyglot max plies"
                                  description="Maximum number of plies from the starting position that the opening book will be used for."
                                  min={1}
                                  value={openingBookMaxPly}
                                  onChange={(value) => {
                                    if (typeof value === "number" && Number.isFinite(value)) {
                                      setOpeningBookMaxPly(Math.max(1, Math.trunc(value)));
                                    }
                                  }}
                                />
                              )}
                            </>
                          )}

                          {!generatorMode && (
                            <>
                              <Divider variant="dashed" />
                              <HumanBotHistoryPanel />

                              <Divider variant="dashed" />
                              <HumanBotMeasurementsPanel />
                            </>
                          )}
                        </Stack>
                      </Paper>
                    </Stack>
                  </ScrollArea>

                  <Divider pb="sm" />
                  <Group grow>
                    {trainingReturn && !generatorMode && (
                      <Button
                        variant="subtle"
                        leftSection={<IconArrowLeft size="1rem" />}
                        onClick={() => void navigate({ to: trainingReturn.to })}
                      >
                        {trainingReturn.label}
                      </Button>
                    )}
                    <Button
                      onClick={startGame}
                      variant="light"
                      loading={isStarting}
                      disabled={error !== null || !setupIsValid || isStarting}
                    >
                      {generatorMode
                        ? batchSettings.enabled
                          ? t("ModelGame.Batch.Generate", "Generate batch")
                          : t("ModelGame.Generate", "Generate model game")
                        : t("Board.Opponent.StartGame")}
                    </Button>
                  </Group>
                </Stack>
              )}
              {(gameState === "playing" || gameState === "gameOver") &&
                (gameState === "gameOver" && endgamePosition ? (
                  <Stack h="100%" justify="space-between">
                    <Stack align="center" justify="center" style={{ flex: 1 }} ta="center">
                      {endgameSuccess ? (
                        <IconTrophy size={52} color="var(--mantine-color-teal-6)" />
                      ) : (
                        <IconX size={52} color="var(--mantine-color-orange-6)" />
                      )}
                      <Text fz="xl" fw={700}>
                        {endgameSuccess === true
                          ? "Final completado"
                          : endgameSuccess === false
                            ? "Objetivo no alcanzado"
                            : "Partida finalizada"}
                      </Text>
                      <Text c="dimmed" maw={430}>
                        {endgameSuccess === true
                          ? "Has conseguido al menos el resultado esperado para este ejercicio."
                          : endgameSuccess === false
                            ? "No se pudo conseguir el objetivo de este ejercicio. Puedes intentarlo de nuevo cuando quieras."
                            : "Este final todavía no tiene un objetivo definido, por lo que el resultado no puede marcarse como completado."}
                      </Text>
                      <Paper withBorder p="sm" w="100%" mt="sm">
                        <Group justify="space-between">
                          <Text size="sm">Objetivo</Text>
                          <Text size="sm" fw={600}>
                            {endgameObjective === "win"
                              ? "Ganar"
                              : endgameObjective === "draw"
                                ? "Mantener tablas"
                                : endgameObjective === "loss"
                                  ? "Resistir"
                                  : "Por definir"}
                          </Text>
                        </Group>
                        <Group justify="space-between" mt="xs">
                          <Text size="sm">Resultado</Text>
                          <Text size="sm" fw={600}>
                            {headers.result}
                          </Text>
                        </Group>
                      </Paper>
                    </Stack>
                    <Stack>
                      {endgameSuccess === true && (
                        <Button color="teal" leftSection={<IconPlus />} onClick={handleNextEndgame}>
                          Jugar el siguiente final
                        </Button>
                      )}
                      <Button
                        variant={endgameSuccess === true ? "default" : "light"}
                        leftSection={<IconRefresh />}
                        onClick={handleRepeatEndgame}
                      >
                        Intentar de nuevo
                      </Button>
                      <Button
                        variant="default"
                        leftSection={<IconZoomCheck />}
                        onClick={changeToAnalysisMode}
                      >
                        Analizar la partida
                      </Button>
                      <Button
                        variant="subtle"
                        leftSection={<IconArrowLeft />}
                        onClick={() => void handleReturnToEndgames()}
                      >
                        Volver a la lista de finales
                      </Button>
                    </Stack>
                  </Stack>
                ) : (
                  <Stack h="100%">
                    <Box flex={1}>
                      <GameInfo headers={headers} />
                      {generatorMode && gameState === "playing" && (
                        <Group justify="center" mt="sm" gap="xs">
                          <Loader size="xs" />
                          <Text size="sm" c="dimmed">
                            {t("ModelGame.WaitingForMove", {
                              defaultValue: "Waiting for {{player}}...",
                              player: pos?.turn === "black" ? headers.black : headers.white,
                            })}
                          </Text>
                        </Group>
                      )}
                    </Box>
                    <Group grow>
                      {gameState === "playing" && endgamePosition && trainingReturn && (
                        <Button
                          variant="subtle"
                          onClick={() => void handleReturnToEndgames()}
                          leftSection={<IconArrowLeft />}
                          loading={isAborting}
                        >
                          Volver a la lista de finales
                        </Button>
                      )}
                      {gameState === "playing" && (
                        <Button
                          variant="default"
                          color="red"
                          onClick={isEngineVsEngine ? handleAbort : handleResign}
                          leftSection={<IconX />}
                          loading={isEngineVsEngine && isAborting}
                        >
                          {isEngineVsEngine ? "Abort" : "Resign"}
                        </Button>
                      )}
                      {gameState === "gameOver" && !generatorMode && trainingReturn && (
                        <Button
                          variant="default"
                          onClick={() => void navigate({ to: trainingReturn.to })}
                          leftSection={<IconArrowLeft />}
                        >
                          {trainingReturn.label}
                        </Button>
                      )}
                      {gameState === "gameOver" && !generatorMode && (
                        <Button
                          variant="default"
                          onClick={handleNewGame}
                          leftSection={<IconPlus />}
                        >
                          New Game
                        </Button>
                      )}
                      {gameState === "gameOver" && generatorMode && (
                        <>
                          <Button
                            variant="default"
                            onClick={handleRepeatModelGame}
                            leftSection={<IconRefresh />}
                          >
                            {t("ModelGame.Repeat", "Repeat configuration")}
                          </Button>
                          <Button
                            variant="default"
                            onClick={handleEditModelGame}
                            leftSection={<IconSettings />}
                          >
                            {t("ModelGame.Edit", "Edit setup")}
                          </Button>
                        </>
                      )}
                      <Button
                        variant="default"
                        onClick={() => changeToAnalysisMode()}
                        leftSection={<IconZoomCheck />}
                      >
                        Analyze
                      </Button>

                      {hasEngine && (
                        <>
                          {generatorMode && gameState === "gameOver" ? (
                            <Button
                              variant="default"
                              onClick={exportModelGameArtifacts}
                              leftSection={<IconFileExport size="1rem" />}
                            >
                              {t("ModelGame.Export", "Export PGN + manifest")}
                            </Button>
                          ) : !generatorMode ? (
                            <Button
                              variant="default"
                              onClick={exportGameManifest}
                              leftSection={<IconFileExport size="1rem" />}
                            >
                              {t("GameManifest.Export", "Export manifest")}
                            </Button>
                          ) : null}
                          <Button
                            variant="default"
                            onClick={() => toggleLogsOpened()}
                            leftSection={<IconFileText size="1rem" />}
                          >
                            Engine Logs
                          </Button>
                        </>
                      )}
                    </Group>
                  </Stack>
                ))}
            </>
          )}
          {generatorMode && batchState && (
            <ModelGameExperimentHistory
              requestedExperimentId={requestedExperimentId}
              showPanel={false}
            />
          )}
        </Paper>
      </Portal>
      {generatorMode && (
        <Modal
          opened={botLeagueOpened}
          onClose={() => toggleBotLeagueOpened(false)}
          title={t("BotLeague.Title", "Liga de bots")}
          size="xl"
        >
          <BotLeaguePanel id={activeTab ?? "model-game-generator"} embedded />
        </Modal>
      )}
      <Portal target="#bottomRight" style={{ height: "100%" }}>
        {gameState === "settingUp" && editingMode ? (
          <EditingCard
            boardRef={boardRef}
            setEditingMode={toggleEditingMode}
            selectedPiece={selectedPiece}
            setSelectedPiece={setSelectedPiece}
          />
        ) : (
          <Stack h="100%" gap="xs">
            <GameNotation
              topBar
              controls={
                <BoardControls
                  editingMode={gameState === "settingUp" && editingMode}
                  toggleEditingMode={toggleEditingMode}
                  dirty={false}
                  canTakeBack={onePlayerIsEngine}
                  onTakeBack={onTakeBack}
                  disableVariations
                  allowEditing={gameState === "settingUp"}
                />
              }
            />
            <MoveControls />
          </Stack>
        )}
      </Portal>
    </>
  );
}

export default BoardGame;
