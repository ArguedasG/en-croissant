import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Menu,
  Modal,
  NumberInput,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconAlertTriangle,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconPlayerSkipForward,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { parseUci } from "chessops";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { BestMoves, ScoreValue } from "@/bindings";
import Board from "@/components/boards/Board";
import { TreeStateContext, TreeStateProvider } from "@/components/common/TreeStateContext";
import { activeTabAtom, enginesAtom, tabsAtom } from "@/state/atoms";
import { trainingAreasAtom } from "@/state/trainingAreas";
import { getBestMovesOnce, type LocalEngine } from "@/utils/engines";
import { formatTime } from "@/utils/format";
import { isMaiaEngine } from "@/utils/humanBots";
import { launchTrainingPosition } from "@/utils/trainingLaunch";
import {
  completeTacticsCycle,
  getTacticsCompletedIndexes,
  getTacticsFirstIncompleteIndex,
  getTacticsSetSize,
  recordTacticsAttempt,
  saveTacticsActiveCycle,
  setTacticsResumeIndex,
  updateTacticsAutoAdvance,
  type TacticsActiveCycle,
  type TacticsCycleSummary,
  type TacticsSet,
} from "@/utils/trainingAreas";
import { loadTacticsExercise, type TacticsLoadedExercise } from "@/utils/tacticsTraining";
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
) {
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

function fullQueue(total: number) {
  return Array.from({ length: total }, (_, index) => index);
}

function validCycle(cycle: TacticsActiveCycle | null, total: number) {
  if (!cycle || cycle.queue.length === 0) return null;
  const previousCurrent = cycle.queue[Math.min(cycle.position, cycle.queue.length - 1)];
  const queue = fullQueue(total);
  if (queue.length === 0) return null;
  return {
    ...cycle,
    queue,
    position:
      previousCurrent !== undefined && previousCurrent < total
        ? previousCurrent
        : Math.min(cycle.position, queue.length - 1),
    failedIndexes: cycle.failedIndexes.filter((index) => queue.includes(index)),
  };
}

export default function TacticsSessionV2Page() {
  const { setId } = useParams({ from: "/training/tactics/practice/$setId" });
  const { problem } = useSearch({ from: "/training/tactics/practice/$setId" });
  const navigate = useNavigate();
  const [areas, setAreas] = useAtom(trainingAreasAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const set = areas.tactics.sets[setId];
  const total = set ? getTacticsSetSize(set) : 0;
  const initialCycle = validCycle(set?.progress.activeCycle ?? null, total);
  const initialCycleNumber = initialCycle?.number ?? (set?.progress.cycles.length ?? 0) + 1;
  const initialCycleResumeIndex = set
    ? getTacticsFirstIncompleteIndex(areas.tactics, setId, initialCycleNumber)
    : 0;

  const [index, setIndex] = useState(() =>
    Math.min(set?.progress.nextExerciseIndex ?? 0, Math.max(0, total - 1)),
  );
  const [browsingIndex, setBrowsingIndex] = useState<number | null>(() =>
    problem === undefined ? null : Math.min(Math.max(0, problem - 1), Math.max(0, total - 1)),
  );
  const [cycleQueue, setCycleQueue] = useState<number[]>(
    () => initialCycle?.queue ?? fullQueue(total),
  );
  const [cyclePosition, setCyclePosition] = useState(() =>
    initialCycle ? Math.max(0, initialCycle.queue.indexOf(initialCycleResumeIndex)) : 0,
  );
  const [cycleNumber, setCycleNumber] = useState(initialCycleNumber);
  const [failedIndexes, setFailedIndexes] = useState<number[]>(
    () => initialCycle?.failedIndexes ?? [],
  );
  const [failures, setFailures] = useState(() => initialCycle?.failures ?? 0);
  const [cycleElapsedBase, setCycleElapsedBase] = useState(() => initialCycle?.timeMs ?? 0);
  const [exercise, setExercise] = useState<TacticsLoadedExercise | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [result, setResult] = useState<"correct" | "unsupported" | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState("");
  const [navigationValue, setNavigationValue] = useState<string | number>(
    () => Math.min(set?.progress.nextExerciseIndex ?? 0, Math.max(0, total - 1)) + 1,
  );
  const [boardAttempt, setBoardAttempt] = useState(0);
  const [finishedSummary, setFinishedSummary] = useState<Omit<
    TacticsCycleSummary,
    "id" | "completedAt"
  > | null>(null);
  const [earlyFinishOpen, setEarlyFinishOpen] = useState(false);
  const startedAt = useRef(Date.now());
  const cycleRunStartedAt = useRef(Date.now());
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setTick] = useState(0);

  const isWoodpecker = set?.config.mode === "woodpecker";
  const resumeIndex = isWoodpecker ? (cycleQueue[cyclePosition] ?? 0) : index;
  const activeIndex = browsingIndex ?? resumeIndex;
  const cycleElapsed =
    cycleElapsedBase + (finishedSummary ? 0 : Date.now() - cycleRunStartedAt.current);
  const currentCycleCompletedIndexes = useMemo(
    () =>
      isWoodpecker
        ? getTacticsCompletedIndexes(areas.tactics, setId, cycleNumber)
        : getTacticsCompletedIndexes(areas.tactics, setId),
    [areas.tactics, cycleNumber, isWoodpecker, setId],
  );
  const cycleCompleted = isWoodpecker ? currentCycleCompletedIndexes.length : activeIndex + 1;

  useEffect(() => {
    const interval = setInterval(() => setTick((value) => value + 1), 250);
    return () => clearInterval(interval);
  }, []);

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!set || !isWoodpecker || set.progress.activeCycle || cycleQueue.length === 0) return;
    const activeCycle: TacticsActiveCycle = {
      number: cycleNumber,
      queue: cycleQueue,
      position: cyclePosition,
      failedIndexes,
      failures,
      timeMs: cycleElapsedBase,
    };
    setAreas((previous) => ({
      ...previous,
      tactics: saveTacticsActiveCycle(previous.tactics, setId, activeCycle),
    }));
  }, [
    cycleElapsedBase,
    cycleNumber,
    cyclePosition,
    cycleQueue,
    failedIndexes,
    failures,
    isWoodpecker,
    set,
    setAreas,
    setId,
  ]);

  const setSource = set?.source;
  const setExerciseIds = set?.exerciseIds;
  const setConfig = set?.config;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setExercise(null);
    setResult(null);
    setRetrying(false);
    setMessage("");
    startedAt.current = Date.now();

    async function load() {
      if (!setConfig || !setExerciseIds) throw new Error("El set ya no existe.");
      const stableSet = { source: setSource, exerciseIds: setExerciseIds, config: setConfig };
      return loadTacticsExercise(stableSet, areas.tactics.exercises, activeIndex);
    }

    void load()
      .then((loaded) => !cancelled && setExercise(loaded))
      .catch((error) => {
        if (!cancelled)
          setLoadError(error instanceof Error ? error.message : "No se pudo cargar el ejercicio.");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeIndex, areas.tactics.exercises, setConfig, setExerciseIds, setId, setSource]);

  const completedIndexes = isWoodpecker
    ? currentCycleCompletedIndexes
    : getTacticsCompletedIndexes(areas.tactics, setId);

  useEffect(() => {
    setNavigationValue(activeIndex + 1);
  }, [activeIndex]);

  function elapsedNow() {
    return cycleElapsedBase + Date.now() - cycleRunStartedAt.current;
  }

  function activeCycleSnapshot(overrides: Partial<TacticsActiveCycle> = {}): TacticsActiveCycle {
    return {
      number: cycleNumber,
      queue: cycleQueue,
      position: cyclePosition,
      failedIndexes,
      failures,
      timeMs: elapsedNow(),
      ...overrides,
    };
  }

  function persistAttempt(
    outcome: "correct" | "incorrect" | "unsupported",
    playedMove: string | null,
    timeMs: number,
    cycle?: TacticsActiveCycle,
  ) {
    if (!exercise) return;
    setAreas((previous) => {
      let tactics = recordTacticsAttempt(previous.tactics, {
        setId,
        exerciseId: exercise.id,
        playedMove,
        outcome,
        timeMs,
        cycleNumber: isWoodpecker ? cycleNumber : null,
      });
      let cycleSnapshot = cycle;
      if (outcome === "correct") {
        const nextResumeIndex = isWoodpecker
          ? getTacticsFirstIncompleteIndex(tactics, setId, cycleNumber)
          : getTacticsFirstIncompleteIndex(tactics, setId);
        tactics = setTacticsResumeIndex(tactics, setId, nextResumeIndex);
        if (cycleSnapshot && isWoodpecker) {
          const nextPosition = Math.max(0, cycleQueue.indexOf(nextResumeIndex));
          cycleSnapshot = { ...cycleSnapshot, position: nextPosition };
        }
      }
      if (cycleSnapshot) tactics = saveTacticsActiveCycle(tactics, setId, cycleSnapshot);
      return { ...previous, tactics };
    });
  }

  function finishAttempt(
    outcome: "correct" | "incorrect" | "unsupported",
    playedMove: string | null,
    feedback: string,
  ) {
    if (!exercise || !set || result || retrying) return;
    const timeMs = Date.now() - startedAt.current;
    if (outcome === "incorrect") {
      const nextFailures = failures + 1;
      const nextFailed = failedIndexes.includes(activeIndex)
        ? failedIndexes
        : [...failedIndexes, activeIndex];
      setFailures(nextFailures);
      setFailedIndexes(nextFailed);
      setRetrying(true);
      setMessage("Jugada incorrecta. Inténtalo de nuevo.");
      persistAttempt(
        outcome,
        playedMove,
        timeMs,
        isWoodpecker
          ? activeCycleSnapshot({ failedIndexes: nextFailed, failures: nextFailures })
          : undefined,
      );
      retryTimer.current = setTimeout(() => {
        setBoardAttempt((value) => value + 1);
        setRetrying(false);
        startedAt.current = Date.now();
      }, 700);
      return;
    }

    setResult(outcome);
    setMessage(feedback);
    persistAttempt(outcome, playedMove, timeMs, isWoodpecker ? activeCycleSnapshot() : undefined);
  }

  function resetExerciseState() {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    setResult(null);
    setRetrying(false);
    setMessage("");
    setBoardAttempt((value) => value + 1);
    startedAt.current = Date.now();
  }

  function jumpTo(target: number) {
    if (!set || total === 0) return;
    const safeTarget = Math.min(total - 1, Math.max(0, Math.floor(target)));
    resetExerciseState();
    setBrowsingIndex(safeTarget === resumeIndex ? null : safeTarget);
  }

  function returnToResume() {
    resetExerciseState();
    setBrowsingIndex(null);
  }

  function finishCycle(
    completedCount = new Set([
      ...currentCycleCompletedIndexes,
      ...(result === "correct" ? [activeIndex] : []),
    ]).size,
  ) {
    if (!set || !isWoodpecker || finishedSummary) return;
    const summary = {
      number: cycleNumber,
      exerciseCount: total,
      completedCount: Math.min(completedCount, total),
      failures,
      timeMs: elapsedNow(),
    };
    setCycleElapsedBase(summary.timeMs);
    setFinishedSummary(summary);
    setAreas((previous) => ({
      ...previous,
      tactics: completeTacticsCycle(previous.tactics, setId, summary),
    }));
  }

  const finishCycleRef = useRef(finishCycle);
  finishCycleRef.current = finishCycle;
  useEffect(() => {
    if (
      !isWoodpecker ||
      finishedSummary ||
      total === 0 ||
      currentCycleCompletedIndexes.length < total
    ) {
      return;
    }
    finishCycleRef.current(total);
  }, [currentCycleCompletedIndexes.length, finishedSummary, isWoodpecker, total]);

  function nextExercise() {
    if (!set || total === 0 || result !== "correct") return;
    if (isWoodpecker) {
      const completed = new Set([...currentCycleCompletedIndexes, activeIndex]);
      if (completed.size >= total) {
        finishCycle(total);
        return;
      }
      if (browsingIndex !== null && browsingIndex !== resumeIndex) {
        returnToResume();
        return;
      }
      let nextPosition = cyclePosition + 1;
      while (nextPosition < cycleQueue.length && completed.has(cycleQueue[nextPosition])) {
        nextPosition += 1;
      }
      if (nextPosition >= cycleQueue.length) {
        nextPosition = cycleQueue.findIndex((exerciseIndex) => !completed.has(exerciseIndex));
      }
      if (nextPosition < 0) {
        finishCycle(total);
        return;
      }
      setCyclePosition(nextPosition);
      setBrowsingIndex(null);
      resetExerciseState();
      setAreas((previous) => ({
        ...previous,
        tactics: saveTacticsActiveCycle(
          setTacticsResumeIndex(previous.tactics, setId, cycleQueue[nextPosition]),
          setId,
          activeCycleSnapshot({ position: nextPosition }),
        ),
      }));
      return;
    }
    const nextIndex = getTacticsFirstIncompleteIndex(areas.tactics, setId);
    setIndex(nextIndex);
    setBrowsingIndex(null);
    resetExerciseState();
  }

  const nextExerciseRef = useRef(nextExercise);
  nextExerciseRef.current = nextExercise;

  useEffect(() => {
    if (result !== "correct" || finishedSummary) return;
    const completesCycle =
      isWoodpecker && new Set([...currentCycleCompletedIndexes, activeIndex]).size >= total;
    if (!set?.progress.autoAdvance && !completesCycle) return;
    const timer = setTimeout(() => nextExerciseRef.current(), 650);
    return () => clearTimeout(timer);
  }, [
    activeIndex,
    currentCycleCompletedIndexes,
    finishedSummary,
    isWoodpecker,
    result,
    set,
    total,
  ]);

  function startNextCycle() {
    if (!set || !finishedSummary) return;
    const nextNumber = cycleNumber + 1;
    const queue = fullQueue(total);
    setCycleNumber(nextNumber);
    setCycleQueue(queue);
    setCyclePosition(0);
    setFailedIndexes([]);
    setFailures(0);
    setCycleElapsedBase(0);
    setFinishedSummary(null);
    cycleRunStartedAt.current = Date.now();
    resetExerciseState();
    setAreas((previous) => ({
      ...previous,
      tactics: saveTacticsActiveCycle(
        setTacticsResumeIndex(previous.tactics, setId, queue[0] ?? 0),
        setId,
        { number: nextNumber, queue, position: 0, failedIndexes: [], failures: 0, timeMs: 0 },
      ),
    }));
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

  if (!set || total === 0) return <MissingSet />;

  if (finishedSummary) {
    const previousCycle = set.progress.cycles.at(-2);
    return (
      <Container size="md" py="xl">
        <Card withBorder>
          <Stack align="center" py="xl">
            <IconCheck size={44} color="var(--mantine-color-teal-6)" />
            <Title order={2}>Ciclo {finishedSummary.number} guardado</Title>
            <Text c="dimmed" ta="center">
              {finishedSummary.completedCount} de {finishedSummary.exerciseCount} problemas ·{" "}
              {finishedSummary.failures} fallos · {formatTime(finishedSummary.timeMs)}
            </Text>
            {previousCycle && (
              <Alert color="blue" w="100%">
                Ciclo anterior: {previousCycle.failures} fallos en{" "}
                {formatTime(previousCycle.timeMs)}.
              </Alert>
            )}
            <Alert color="orange" w="100%">
              El ciclo {cycleNumber + 1} volverá a recorrer los {total} problemas del set completo.
            </Alert>
            <Group>
              <Button component={Link} to="/training/tactics" variant="default">
                Volver a Táctica
              </Button>
              <Button
                color="orange"
                leftSection={<IconRefresh size={16} />}
                onClick={startNextCycle}
              >
                Iniciar ciclo {cycleNumber + 1}
              </Button>
            </Group>
          </Stack>
        </Card>
      </Container>
    );
  }

  const cyclePercent = isWoodpecker
    ? Math.round((Math.min(cycleCompleted, total) / Math.max(1, total)) * 100)
    : Math.round(((activeIndex + 1) / total) * 100);
  const completedOptions = completedIndexes.map((value) => ({
    value: String(value),
    label: `Problema ${value + 1} ✓`,
  }));

  return (
    <Container size="xl" py="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
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
                {browsingIndex !== null
                  ? `Explorando el problema ${activeIndex + 1} · reanudación en ${resumeIndex + 1}`
                  : isWoodpecker
                    ? `Ciclo ${cycleNumber} · problema ${activeIndex + 1} de ${total}`
                    : `Problema ${activeIndex + 1} de ${total}`}
              </Text>
            </div>
          </Group>
          <Group>
            {isWoodpecker && (
              <Badge color="orange" variant="light">
                {formatTime(cycleElapsed)} · {failures} fallos
              </Badge>
            )}
            <Badge variant="light">{isWoodpecker ? "Woodpecker" : "Guiado"}</Badge>
            {isWoodpecker && (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="default" aria-label="Configuración del ciclo">
                    <IconSettings size={17} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Opciones avanzadas</Menu.Label>
                  <Menu.Item
                    color="red"
                    leftSection={<IconAlertTriangle size={15} />}
                    onClick={() => setEarlyFinishOpen(true)}
                  >
                    Terminar ciclo antes de tiempo
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        </Group>

        <Progress value={cyclePercent} color="orange" />

        <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
          <Card withBorder style={{ gridColumn: "span 2", minHeight: 520 }}>
            {loading ? (
              <Stack align="center" py="xl">
                <Loader />
                <Text c="dimmed">Cargando problema…</Text>
              </Stack>
            ) : loadError || !exercise ? (
              <Alert color="red" title="No se pudo cargar el problema">
                {loadError}
              </Alert>
            ) : set.config.validationMode !== "engine" && exercise.solutionLines.length > 0 ? (
              <GuidedTacticsBoard
                key={`${exercise.id}-${activeIndex}-${boardAttempt}`}
                exercise={exercise}
                set={set}
                disabled={result !== null || retrying}
                variationSeed={
                  areas.tactics.attempts.filter((attempt) => attempt.exerciseId === exercise.id)
                    .length
                }
                onCorrect={(move) =>
                  finishAttempt("correct", move, "Problema resuelto correctamente.")
                }
                onIncorrect={(move) => finishAttempt("incorrect", move, "")}
              />
            ) : set.config.validationMode === "prepared" ? (
              <Alert color="yellow">
                Este registro no contiene una solución preparada. Cambia la validación a automática
                o por motor.
              </Alert>
            ) : (
              <EngineTacticsBoard
                key={`${exercise.id}-${activeIndex}-${boardAttempt}`}
                exercise={exercise}
                set={set}
                disabled={result !== null || retrying}
                onResult={finishAttempt}
              />
            )}
          </Card>

          <Stack>
            <Card withBorder>
              <Stack>
                <div>
                  <Text fw={600}>{exercise?.title ?? `Problema ${activeIndex + 1}`}</Text>
                  <Text size="sm" c="dimmed" mt="xs">
                    {exercise?.solutionLines.length
                      ? "Encuentra y completa la continuación preparada."
                      : "La jugada se validará con un motor local."}
                  </Text>
                </div>
                {message && (
                  <Alert
                    color={
                      result === "correct" ? "teal" : result === "unsupported" ? "yellow" : "red"
                    }
                    icon={result === "correct" ? <IconCheck size={16} /> : <IconX size={16} />}
                  >
                    {message}
                  </Alert>
                )}
                <Button
                  variant="default"
                  leftSection={<IconSearch size={16} />}
                  onClick={analyzePosition}
                >
                  Analizar posición
                </Button>
                {result === "unsupported" && (
                  <Button
                    variant="light"
                    leftSection={<IconRefresh size={16} />}
                    onClick={resetExerciseState}
                  >
                    Reintentar
                  </Button>
                )}
                <Button
                  disabled={result !== "correct"}
                  leftSection={<IconPlayerSkipForward size={16} />}
                  onClick={nextExercise}
                >
                  {isWoodpecker &&
                  new Set([...currentCycleCompletedIndexes, activeIndex]).size >= total
                    ? "Completando ciclo…"
                    : browsingIndex !== null && browsingIndex !== resumeIndex
                      ? "Volver al punto de reanudación"
                      : "Siguiente problema"}
                </Button>
              </Stack>
            </Card>

            <Card withBorder>
              <Stack>
                <Text fw={600}>Navegación</Text>
                {browsingIndex !== null && browsingIndex !== resumeIndex && (
                  <Alert color="blue" variant="light">
                    Estás explorando otro problema. Tu reanudación sigue guardada en el problema{" "}
                    {resumeIndex + 1}.
                  </Alert>
                )}
                <Button variant="light" onClick={returnToResume} disabled={browsingIndex === null}>
                  Volver al primer ejercicio sin completar · {resumeIndex + 1}
                </Button>
                <Group grow>
                  <Button
                    variant="default"
                    leftSection={<IconChevronLeft size={16} />}
                    disabled={activeIndex === 0}
                    onClick={() => jumpTo(activeIndex - 1)}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="default"
                    rightSection={<IconChevronRight size={16} />}
                    disabled={activeIndex + 1 >= total}
                    onClick={() => jumpTo(activeIndex + 1)}
                  >
                    Siguiente
                  </Button>
                </Group>
                <Group align="flex-end" wrap="nowrap">
                  <NumberInput
                    label="Ir al problema"
                    min={1}
                    max={total}
                    value={navigationValue}
                    onChange={setNavigationValue}
                    style={{ flex: 1 }}
                  />
                  <Button
                    variant="default"
                    onClick={() => jumpTo(Number(navigationValue || 1) - 1)}
                  >
                    Ir
                  </Button>
                </Group>
                <Select
                  label="Problemas completados"
                  placeholder={completedOptions.length ? "Elegir problema" : "Todavía ninguno"}
                  data={completedOptions}
                  disabled={completedOptions.length === 0}
                  searchable
                  clearable
                  onChange={(value) => value !== null && jumpTo(Number(value))}
                />
                <Switch
                  label="Avanzar automáticamente al acertar"
                  checked={set.progress.autoAdvance}
                  onChange={(event) =>
                    setAreas((previous) => ({
                      ...previous,
                      tactics: updateTacticsAutoAdvance(
                        previous.tactics,
                        setId,
                        event.currentTarget.checked,
                      ),
                    }))
                  }
                />
              </Stack>
            </Card>

            {isWoodpecker && (
              <Card withBorder>
                <Stack>
                  <Group justify="space-between">
                    <Text fw={600}>Ciclo {cycleNumber}</Text>
                    <Badge>{failures} fallos</Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    El tiempo y los fallos se registran, pero no detienen el entrenamiento.
                  </Text>
                  {set.progress.cycles
                    .slice(-3)
                    .reverse()
                    .map((cycle) => (
                      <Group key={cycle.id} justify="space-between">
                        <Text size="xs">Ciclo {cycle.number}</Text>
                        <Text size="xs" c="dimmed">
                          {cycle.failures} fallos · {formatTime(cycle.timeMs)}
                        </Text>
                      </Group>
                    ))}
                </Stack>
              </Card>
            )}
          </Stack>
        </SimpleGrid>

        <Modal
          opened={earlyFinishOpen}
          onClose={() => setEarlyFinishOpen(false)}
          title="Terminar el ciclo antes de completar el set"
          size="sm"
        >
          <Stack>
            <Alert color="red" icon={<IconAlertTriangle size={18} />}>
              Esta es una acción excepcional. El ciclo se guardará incompleto con el progreso y los
              fallos actuales; el próximo ciclo volverá a incluir el set completo.
            </Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEarlyFinishOpen(false)}>
                Seguir entrenando
              </Button>
              <Button
                color="red"
                onClick={() => {
                  setEarlyFinishOpen(false);
                  finishCycle();
                }}
              >
                Terminar de todos modos
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </Container>
  );
}

function MissingSet() {
  return (
    <Container size="md" py="xl">
      <Alert color="red" title="Set no encontrado">
        El set de Táctica ya no existe o no contiene problemas.
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
  onIncorrect: (move: string) => void;
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
  onIncorrect: (move: string) => void;
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
      onIncorrect(uci);
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
        "Configura Stockfish u otro motor local para validar este problema.",
      );
      return;
    }

    setBusy(true);
    try {
      const bestMoves = await getBestMovesOnce(
        localEngine,
        { t: "Depth", c: 18 },
        { fen: exercise.fen, moves: [], extraOptions: [{ name: "MultiPV", value: "8" }] },
      );
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
        correct ? "Jugada aceptada por el motor." : "",
      );
    } catch (error) {
      onResult(
        "unsupported",
        playedMove,
        error instanceof Error ? error.message : "No se pudo consultar el motor.",
      );
    } finally {
      setBusy(false);
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
