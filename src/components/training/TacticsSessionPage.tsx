import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconCheck,
  IconPlayerSkipForward,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { parseUci } from "chessops";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { BestMoves, ScoreValue } from "@/bindings";
import Board from "@/components/boards/Board";
import { TreeStateContext, TreeStateProvider } from "@/components/common/TreeStateContext";
import { activeTabAtom, enginesAtom, tabsAtom } from "@/state/atoms";
import { trainingAreasAtom } from "@/state/trainingAreas";
import { getBestMoves, killEngine, type LocalEngine } from "@/utils/engines";
import { formatTime } from "@/utils/format";
import { isMaiaEngine } from "@/utils/humanBots";
import { launchTrainingPosition } from "@/utils/trainingLaunch";
import {
  getTacticsSetSize,
  recordTacticsAttempt,
  type TacticsExercise,
  type TacticsSet,
} from "@/utils/trainingAreas";
import { loadTacticsFileExercise, type TacticsLoadedExercise } from "@/utils/tacticsTraining";
import { genID } from "@/utils/tabs";
import { defaultTree } from "@/utils/treeReducer";

function scoreForSide(value: ScoreValue, side: "white" | "black"): number {
  const sign = side === "white" ? 1 : -1;
  if (value.type === "cp") return value.value * sign;
  if (value.type === "mate") return value.value * sign * 100000;
  return -value.value * sign;
}

function acceptsMove(
  best: BestMoves,
  candidate: BestMoves,
  side: "white" | "black",
  thresholdCp: number,
): boolean {
  const bestValue = best.score.value;
  const candidateValue = candidate.score.value;
  if (bestValue.type === "mate") {
    return candidateValue.type === "mate" && candidateValue.value === bestValue.value;
  }
  if (candidateValue.type === "mate") {
    return scoreForSide(candidateValue, side) > scoreForSide(bestValue, side);
  }
  return scoreForSide(bestValue, side) - scoreForSide(candidateValue, side) <= thresholdCp;
}

function embeddedExercise(exercise: TacticsExercise, index: number): TacticsLoadedExercise {
  return {
    id: exercise.id,
    recordIndex: index,
    title: exercise.title,
    fen: exercise.fen,
    solutionLines: exercise.solutionMoves.length > 0 ? [exercise.solutionMoves] : [],
    hasVariations: false,
    sourcePgn: exercise.source.pgn ?? "",
  };
}

export default function TacticsSessionPage() {
  const { setId } = useParams({ from: "/training/tactics/practice/$setId" });
  const navigate = useNavigate();
  const [areas, setAreas] = useAtom(trainingAreasAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const set = areas.tactics.sets[setId];
  const total = set ? getTacticsSetSize(set) : 0;
  const [index, setIndex] = useState(0);
  const [cycleQueue, setCycleQueue] = useState<number[]>([]);
  const [cyclePosition, setCyclePosition] = useState(0);
  const [cycleNumber, setCycleNumber] = useState(1);
  const [failedIndexes, setFailedIndexes] = useState<number[]>([]);
  const [exercise, setExercise] = useState<TacticsLoadedExercise | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [result, setResult] = useState<"correct" | "incorrect" | "unsupported" | null>(null);
  const [message, setMessage] = useState("");
  const [finished, setFinished] = useState(false);
  const [failures, setFailures] = useState(0);
  const startedAt = useRef(Date.now());
  const sessionStartedAt = useRef(Date.now());
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!set || set.config.mode !== "woodpecker") return;
    setCycleQueue(Array.from({ length: total }, (_, position) => position));
    setCyclePosition(0);
    setCycleNumber(1);
    setFailedIndexes([]);
  }, [set, total]);

  const activeIndex = set?.config.mode === "woodpecker" ? (cycleQueue[cyclePosition] ?? 0) : index;
  const cycleTotal = set?.config.mode === "woodpecker" ? cycleQueue.length : total;
  const cycleCompleted =
    set?.config.mode === "woodpecker"
      ? Math.min(cyclePosition + (result === null ? 0 : 1), cycleTotal)
      : index + 1;
  const pendingIndexes = Array.from(
    new Set([
      ...failedIndexes,
      ...(result === null && cycleQueue[cyclePosition] !== undefined
        ? [cycleQueue[cyclePosition]]
        : []),
      ...cycleQueue.slice(cyclePosition + 1),
    ]),
  );

  useEffect(() => {
    const interval = setInterval(() => setTick((value) => value + 1), 250);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setExercise(null);
    setResult(null);
    setMessage("");
    startedAt.current = Date.now();

    async function loadExercise() {
      if (!set) throw new Error("El set ya no existe.");
      if (set.source?.kind === "pgnFile") {
        return loadTacticsFileExercise(set, activeIndex);
      }
      const id = set.exerciseIds[activeIndex];
      const stored = areas.tactics.exercises[id];
      if (!stored) throw new Error("El ejercicio ya no existe.");
      return embeddedExercise(stored, activeIndex);
    }

    void loadExercise()
      .then((loaded) => {
        if (!cancelled) setExercise(loaded);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "No se pudo cargar el ejercicio.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeIndex, areas.tactics.exercises, set]);

  const sessionElapsed = Date.now() - sessionStartedAt.current;
  const timedOut = Boolean(
    set?.config.timeLimitSeconds && sessionElapsed >= set.config.timeLimitSeconds * 1000,
  );

  useEffect(() => {
    if (timedOut && !finished) {
      setFinished(true);
      setMessage("Terminó el tiempo configurado para este ciclo.");
    }
  }, [finished, timedOut]);

  function finishAttempt(
    outcome: "correct" | "incorrect" | "unsupported",
    playedMove: string | null,
    feedback: string,
  ) {
    if (!exercise || !set || result) return;
    const timeMs = Date.now() - startedAt.current;
    setResult(outcome);
    setMessage(feedback);
    if (outcome === "incorrect") {
      setFailures((value) => value + 1);
      if (set.config.mode === "woodpecker") {
        setFailedIndexes((current) =>
          current.includes(activeIndex) ? current : [...current, activeIndex],
        );
      }
    }
    setAreas((previous) => ({
      ...previous,
      tactics: recordTacticsAttempt(previous.tactics, {
        setId,
        exerciseId: exercise.id,
        playedMove,
        outcome,
        timeMs,
      }),
    }));
  }

  function nextExercise() {
    if (!set || total === 0) return;
    const reachedFailureLimit =
      set.config.mode === "woodpecker" && failures >= set.config.maxFailuresPerCycle;
    const isLast =
      set.config.mode === "woodpecker"
        ? cyclePosition + 1 >= cycleQueue.length
        : index + 1 >= total;
    if (isLast || reachedFailureLimit || timedOut) {
      setFinished(true);
      return;
    }
    if (set.config.mode === "woodpecker") {
      setCyclePosition((value) => value + 1);
    } else {
      setIndex((value) => value + 1);
    }
  }

  async function analyzePosition() {
    if (!exercise) return;
    await navigate({ to: "/" });
    await launchTrainingPosition({
      fen: exercise.fen,
      name: `Análisis · ${exercise.title}`,
      type: "analysis",
      setTabs,
      setActiveTab,
      trainingArea: "tactics",
    });
  }

  if (!set) {
    return <MissingSet />;
  }

  if (finished) {
    return (
      <Container size="sm" py="xl">
        <Card withBorder>
          <Stack align="center" py="xl">
            <IconCheck size={44} color="var(--mantine-color-teal-6)" />
            <Title order={2}>Ciclo terminado</Title>
            <Text c="dimmed" ta="center">
              Completaste {cycleCompleted} de {cycleTotal} ejercicios con {failures} fallos en{" "}
              {formatTime(sessionElapsed)}.
            </Text>
            {set.config.mode === "woodpecker" && pendingIndexes.length > 0 && (
              <Alert color="orange">
                El siguiente ciclo conservará {pendingIndexes.length} ejercicios pendientes: los
                fallados y los que no alcanzaste a resolver.
              </Alert>
            )}
            {message && <Alert color="yellow">{message}</Alert>}
            <Group>
              <Button component={Link} to="/training/tactics" variant="default">
                Volver a Táctica
              </Button>
              <Button
                color="orange"
                onClick={() => {
                  if (set.config.mode === "woodpecker") {
                    const nextQueue = pendingIndexes.length > 0 ? pendingIndexes : cycleQueue;
                    setCycleQueue(nextQueue);
                    setCyclePosition(0);
                    setCycleNumber((value) => value + 1);
                    setFailedIndexes([]);
                  } else {
                    setIndex(0);
                  }
                  setFailures(0);
                  setFinished(false);
                  setMessage("");
                  sessionStartedAt.current = Date.now();
                }}
              >
                {set.config.mode === "woodpecker" && pendingIndexes.length > 0
                  ? `Repetir ${pendingIndexes.length} pendientes`
                  : "Iniciar otro ciclo"}
              </Button>
            </Group>
          </Stack>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="xl" py="md">
      <Stack gap="md">
        <Group justify="space-between">
          <Group>
            <Button
              component={Link}
              to="/training/tactics"
              variant="subtle"
              p="xs"
              aria-label="Volver"
            >
              <IconArrowLeft size={20} />
            </Button>
            <div>
              <Title order={2}>{set.name}</Title>
              <Text size="sm" c="dimmed">
                {set.config.mode === "woodpecker" ? `Ciclo ${cycleNumber} · ` : ""}Ejercicio{" "}
                {cycleCompleted} de {cycleTotal} · quedan {Math.max(0, cycleTotal - cycleCompleted)}
              </Text>
            </div>
          </Group>
          <Group>
            {set.config.mode === "woodpecker" && (
              <Badge color="orange" variant="light">
                {formatTime(sessionElapsed)} · {failures}/{set.config.maxFailuresPerCycle} fallos
              </Badge>
            )}
            <Badge variant="light">
              {set.config.mode === "woodpecker" ? "Woodpecker" : "Guiado"}
            </Badge>
          </Group>
        </Group>

        {loading ? (
          <Card withBorder>
            <Stack align="center" py="xl">
              <Loader />
              <Text c="dimmed">Cargando ejercicio…</Text>
            </Stack>
          </Card>
        ) : loadError || !exercise ? (
          <Alert color="red" title="No se pudo cargar el ejercicio">
            {loadError}
          </Alert>
        ) : (
          <Group align="stretch" wrap="wrap">
            <Card withBorder style={{ flex: "1 1 560px", minHeight: 520 }}>
              {set.config.validationMode !== "engine" && exercise.solutionLines.length > 0 ? (
                <GuidedTacticsBoard
                  key={`${exercise.id}-${activeIndex}`}
                  exercise={exercise}
                  set={set}
                  disabled={result !== null}
                  variationSeed={
                    areas.tactics.attempts.filter((attempt) => attempt.exerciseId === exercise.id)
                      .length
                  }
                  onCorrect={(move) =>
                    finishAttempt("correct", move, "Ejercicio resuelto correctamente.")
                  }
                  onIncorrect={(move, expected) =>
                    finishAttempt("incorrect", move, `Jugada incorrecta. Se esperaba ${expected}.`)
                  }
                />
              ) : set.config.validationMode === "prepared" ? (
                <Alert color="yellow">
                  Este registro no contiene una solución preparada. Cambia la validación a
                  automática o por motor.
                </Alert>
              ) : (
                <EngineTacticsBoard
                  key={`${exercise.id}-${activeIndex}`}
                  exercise={exercise}
                  set={set}
                  disabled={result !== null}
                  onResult={finishAttempt}
                />
              )}
            </Card>
            <Card withBorder style={{ flex: "1 1 290px" }}>
              <Stack justify="space-between" h="100%">
                <div>
                  <Text fw={600}>{exercise.title}</Text>
                  <Text size="sm" c="dimmed" mt="xs">
                    {exercise.solutionLines.length > 0
                      ? "Encuentra y completa la continuación preparada."
                      : "La jugada se validará bajo demanda con un motor local."}
                  </Text>
                  {exercise.hasVariations && (
                    <Badge mt="sm" variant="outline">
                      Incluye variantes
                    </Badge>
                  )}
                  {message && (
                    <Alert
                      mt="md"
                      color={
                        result === "correct" ? "teal" : result === "unsupported" ? "yellow" : "red"
                      }
                      icon={result === "correct" ? <IconCheck size={16} /> : <IconX size={16} />}
                    >
                      {message}
                    </Alert>
                  )}
                </div>
                <Stack>
                  <Button
                    variant="default"
                    leftSection={<IconSearch size={16} />}
                    onClick={analyzePosition}
                  >
                    Analizar posición
                  </Button>
                  <Button
                    disabled={!result}
                    leftSection={<IconPlayerSkipForward size={16} />}
                    onClick={nextExercise}
                  >
                    {cycleCompleted >= cycleTotal ? "Terminar ciclo" : "Siguiente ejercicio"}
                  </Button>
                </Stack>
              </Stack>
            </Card>
          </Group>
        )}
      </Stack>
    </Container>
  );
}

function MissingSet() {
  return (
    <Container size="md" py="xl">
      <Alert color="red" title="Set no encontrado">
        El set de Táctica ya no existe o no contiene ejercicios.
      </Alert>
      <Button
        component={Link}
        to="/training/tactics"
        mt="md"
        leftSection={<IconArrowLeft size={16} />}
      >
        Volver a Táctica
      </Button>
    </Container>
  );
}

function GuidedTacticsBoard({
  exercise,
  set,
  disabled,
  variationSeed,
  onCorrect,
  onIncorrect,
}: {
  exercise: TacticsLoadedExercise;
  set: TacticsSet;
  disabled: boolean;
  variationSeed: number;
  onCorrect: (lastMove: string) => void;
  onIncorrect: (move: string, expected: string) => void;
}) {
  const initial = useMemo(() => {
    const tree = defaultTree(exercise.fen);
    const sideToMove = exercise.fen.split(" ")[1] === "b" ? "black" : "white";
    tree.headers.orientation =
      set.config.startingActor === "student"
        ? sideToMove
        : sideToMove === "white"
          ? "black"
          : "white";
    return tree;
  }, [exercise.fen, set.config.startingActor]);

  return (
    <TreeStateProvider initial={initial}>
      <GuidedTacticsBoardInner
        lines={exercise.solutionLines}
        startingActor={set.config.startingActor}
        disabled={disabled}
        variationSeed={variationSeed}
        onCorrect={onCorrect}
        onIncorrect={onIncorrect}
      />
    </TreeStateProvider>
  );
}

function GuidedTacticsBoardInner({
  lines,
  startingActor,
  disabled,
  variationSeed,
  onCorrect,
  onIncorrect,
}: {
  lines: string[][];
  startingActor: TacticsSet["config"]["startingActor"];
  disabled: boolean;
  variationSeed: number;
  onCorrect: (lastMove: string) => void;
  onIncorrect: (move: string, expected: string) => void;
}) {
  const store = useContext(TreeStateContext)!;
  const makeMove = useStore(store, (state) => state.makeMove);
  const boardRef = useRef<HTMLDivElement>(null);
  const candidates = useRef(lines);
  const ply = useRef(0);
  const [autoMoving, setAutoMoving] = useState(false);
  const completed = useRef(false);

  const playOpponent = useCallback(async () => {
    if (completed.current || disabled) return;
    const replies = Array.from(
      new Set(candidates.current.map((line) => line[ply.current]).filter(Boolean)),
    );
    if (replies.length === 0) {
      completed.current = true;
      onCorrect(candidates.current[0]?.[ply.current - 1] ?? "");
      return;
    }
    const reply = replies[variationSeed % replies.length];
    const move = parseUci(reply);
    if (!move) return;
    setAutoMoving(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    candidates.current = candidates.current.filter((line) => line[ply.current] === reply);
    makeMove({ payload: move, mainline: true, changeHeaders: false });
    ply.current += 1;
    setAutoMoving(false);
    if (candidates.current.some((line) => line.length === ply.current)) {
      completed.current = true;
      onCorrect(reply);
    }
  }, [disabled, makeMove, onCorrect, variationSeed]);

  useEffect(() => {
    if (startingActor === "opponent") void playOpponent();
  }, [playOpponent, startingActor]);

  function handleMove(uci: string) {
    if (completed.current || disabled || autoMoving) return;
    const matching = candidates.current.filter((line) => line[ply.current] === uci);
    if (matching.length === 0) {
      completed.current = true;
      onIncorrect(uci, candidates.current[0]?.[ply.current] ?? "la continuación preparada");
      return;
    }
    candidates.current = matching;
    ply.current += 1;
    if (matching.some((line) => line.length === ply.current)) {
      completed.current = true;
      onCorrect(uci);
      return;
    }
    void playOpponent();
  }

  return (
    <Board
      editingMode={false}
      movable={disabled || autoMoving ? "none" : "turn"}
      boardRef={boardRef}
      onMove={handleMove}
    />
  );
}

function EngineTacticsBoard({
  exercise,
  set,
  disabled,
  onResult,
}: {
  exercise: TacticsLoadedExercise;
  set: TacticsSet;
  disabled: boolean;
  onResult: (
    outcome: "correct" | "incorrect" | "unsupported",
    playedMove: string | null,
    feedback: string,
  ) => void;
}) {
  const storedEngines = useAtomValue(enginesAtom);
  const engines = useMemo(() => storedEngines ?? [], [storedEngines]);
  const [busy, setBusy] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const evaluatorTabId = useState(() => genID())[0];

  async function evaluateMove(playedMove: string) {
    if (busy || disabled) return;
    const localEngines = engines.filter(
      (engine): engine is LocalEngine =>
        engine.type === "local" && Boolean(engine.path) && !isMaiaEngine(engine),
    );
    const localEngine =
      localEngines.find((engine) => /stockfish/i.test(engine.name)) ?? localEngines[0];
    if (!localEngine) {
      onResult(
        "unsupported",
        playedMove,
        "Configura Stockfish u otro motor de referencia local para validar este ejercicio.",
      );
      return;
    }

    setBusy(true);
    try {
      const evaluated = await getBestMoves(
        localEngine,
        evaluatorTabId,
        { t: "Depth", c: 18 },
        { fen: exercise.fen, moves: [], extraOptions: [{ name: "MultiPV", value: "8" }] },
      );
      const bestMoves = evaluated?.[1] ?? [];
      const candidate = bestMoves.find((line) => line.uciMoves[0] === playedMove);
      const side = exercise.fen.split(" ")[1] === "b" ? "black" : "white";
      const correct = Boolean(
        candidate &&
        bestMoves[0] &&
        acceptsMove(bestMoves[0], candidate, side, set.config.acceptanceThresholdCp),
      );
      onResult(
        correct ? "correct" : "incorrect",
        playedMove,
        correct ? "Jugada aceptada por el motor." : "La jugada queda fuera del umbral configurado.",
      );
    } catch (error) {
      onResult(
        "unsupported",
        playedMove,
        error instanceof Error ? error.message : "No se pudo consultar el motor.",
      );
    } finally {
      setBusy(false);
      void killEngine(localEngine, evaluatorTabId).catch(() => undefined);
    }
  }

  const initial = useMemo(() => defaultTree(exercise.fen), [exercise.fen]);
  return (
    <TreeStateProvider initial={initial}>
      <Board
        editingMode={false}
        movable={busy || disabled ? "none" : "turn"}
        boardRef={boardRef}
        onMove={(move) => void evaluateMove(move)}
      />
    </TreeStateProvider>
  );
}
