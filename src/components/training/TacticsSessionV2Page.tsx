import { useTranslation as useTrainingTranslation } from "react-i18next";
import TacticsAdvanceControl from "./TacticsAdvanceControl";
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
  const { t: trainingT } = useTrainingTranslation();

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
      if (!setConfig || !setExerciseIds)
        throw new Error(
          trainingT("Training.Copy.Thesetnolongerexists.39d26ccd", "The set no longer exists."),
        );
      const stableSet = { source: setSource, exerciseIds: setExerciseIds, config: setConfig };
      return loadTacticsExercise(stableSet, areas.tactics.exercises, activeIndex);
    }

    void load()
      .then((loaded) => !cancelled && setExercise(loaded))
      .catch((error) => {
        if (!cancelled)
          setLoadError(
            error instanceof Error
              ? error.message
              : trainingT(
                  "Training.Copy.Couldnotloadtheexercise.06c7cf47",
                  "Could not load the exercise.",
                ),
          );
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [
    activeIndex,
    areas.tactics.exercises,
    setConfig,
    setExerciseIds,
    setId,
    setSource,
    trainingT,
  ]);

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
      setMessage(
        trainingT("Training.Copy.IncorrectmoveTryagain.b114a07a", "Incorrect move. Try again."),
      );
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
      name: trainingT("Training.Copy.Analysisv0.b7ffacfd", "Analysis · {{v0}}", {
        v0: exercise.title,
      }),
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
            <Title order={2}>
              {trainingT("Training.Copy.Cycle.4b8c1a8a", "Cycle")} {finishedSummary.number}{" "}
              {trainingT("Training.Copy.saved.0344b48c", "saved")}
            </Title>
            <Text c="dimmed" ta="center">
              {finishedSummary.completedCount} {trainingT("Training.Copy.of.959a45d4", "of")}{" "}
              {finishedSummary.exerciseCount}{" "}
              {trainingT("Training.Copy.puzzles.6cfdb9ec", "puzzles ·")} {finishedSummary.failures}{" "}
              {trainingT("Training.Copy.mistakes.5c65c76e", "mistakes ·")}{" "}
              {formatTime(finishedSummary.timeMs)}
            </Text>
            {previousCycle && (
              <Alert color="blue" w="100%">
                {" "}
                {trainingT("Training.Copy.Previouscycle.35411be3", "Previous cycle:")}{" "}
                {previousCycle.failures}{" "}
                {trainingT("Training.Copy.mistakesin.64106f51", "mistakes in")}{" "}
                {formatTime(previousCycle.timeMs)}.
              </Alert>
            )}
            <Alert color="orange" w="100%">
              {" "}
              {trainingT("Training.Copy.Cycle.be150316", "Cycle")} {cycleNumber + 1}{" "}
              {trainingT("Training.Copy.willgothroughall.7c725a8e", "will go through all")} {total}{" "}
              {trainingT(
                "Training.Copy.puzzlesinthecompleteset.6f63ef8d",
                "puzzles in the complete set.",
              )}{" "}
            </Alert>
            <Group>
              <Button component={Link} to="/training/tactics" variant="default">
                {" "}
                {trainingT("Training.Copy.Backtotactics.8239d676", "Back to tactics")}{" "}
              </Button>
              <Button
                color="orange"
                leftSection={<IconRefresh size={16} />}
                onClick={startNextCycle}
              >
                {" "}
                {trainingT("Training.Copy.Startcycle.c6434792", "Start cycle")} {cycleNumber + 1}
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
    label: trainingT("Training.Copy.Puzzlev0.76f70f4a", "Puzzle {{v0}} ✓", { v0: value + 1 }),
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
              aria-label={trainingT("Training.Copy.Back.ab26ae7b", "Back")}
            >
              <IconArrowLeft size={20} />
            </Button>
            <div>
              <Title order={2}>{set.name}</Title>
              <Text size="sm" c="dimmed">
                {browsingIndex !== null
                  ? trainingT(
                      "Training.Copy.Exploringpuzzlev0resumeat.ec21e9ea",
                      "Exploring puzzle {{v0}} · resume at {{v1}}",
                      { v0: activeIndex + 1, v1: resumeIndex + 1 },
                    )
                  : isWoodpecker
                    ? trainingT(
                        "Training.Copy.Cyclev0puzzlev1of.a2d5bda7",
                        "Cycle {{v0}} · puzzle {{v1}} of {{v2}}",
                        { v0: cycleNumber, v1: activeIndex + 1, v2: total },
                      )
                    : trainingT("Training.Copy.Puzzlev0ofv1.2278f01a", "Puzzle {{v0}} of {{v1}}", {
                        v0: activeIndex + 1,
                        v1: total,
                      })}
              </Text>
            </div>
          </Group>
          <Group>
            {isWoodpecker && (
              <Badge color="orange" variant="light">
                {formatTime(cycleElapsed)} · {failures}{" "}
                {trainingT("Training.Copy.mistakes.5fb1604c", "mistakes")}{" "}
              </Badge>
            )}
            <Badge variant="light">
              {isWoodpecker ? "Woodpecker" : trainingT("Training.Copy.Guided.57bd258f", "Guided")}
            </Badge>
            {isWoodpecker && (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon
                    variant="default"
                    aria-label={trainingT("Training.Copy.Cyclesettings.56a17ec9", "Cycle settings")}
                  >
                    <IconSettings size={17} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>
                    {trainingT("Training.Copy.Advancedoptions.abd17408", "Advanced options")}
                  </Menu.Label>
                  <Menu.Item
                    color="red"
                    leftSection={<IconAlertTriangle size={15} />}
                    onClick={() => setEarlyFinishOpen(true)}
                  >
                    {" "}
                    {trainingT("Training.Copy.Endcycleearly.d3cc4e59", "End cycle early")}{" "}
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
                <Text c="dimmed">
                  {trainingT("Training.Copy.Loadingpuzzle.f51a73af", "Loading puzzle…")}
                </Text>
              </Stack>
            ) : loadError || !exercise ? (
              <Alert
                color="red"
                title={trainingT(
                  "Training.Copy.Couldnotloadthepuzzle.1fbadbba",
                  "Could not load the puzzle",
                )}
              >
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
                  finishAttempt(
                    "correct",
                    move,
                    trainingT(
                      "Training.Copy.Puzzlesolvedcorrectly.aa4b0cbe",
                      "Puzzle solved correctly.",
                    ),
                  )
                }
                onIncorrect={(move) => finishAttempt("incorrect", move, "")}
              />
            ) : set.config.validationMode === "prepared" ? (
              <Alert color="yellow">
                {" "}
                {trainingT(
                  "Training.Copy.Thisrecordhasnoprepared.9e18dd59",
                  "This record has no prepared solution. Switch validation to automatic or engine.",
                )}{" "}
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
                  <Text fw={600}>
                    {exercise?.title ??
                      trainingT("Training.Copy.Puzzlev0.c9ca2375", "Puzzle {{v0}}", {
                        v0: activeIndex + 1,
                      })}
                  </Text>
                  <Text size="sm" c="dimmed" mt="xs">
                    {exercise?.solutionLines.length
                      ? trainingT(
                          "Training.Copy.Findandcompletetheprepared.14fd71f2",
                          "Find and complete the prepared continuation.",
                        )
                      : trainingT(
                          "Training.Copy.Themovewillbevalidated.da46d52c",
                          "The move will be validated by a local engine.",
                        )}
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
                  {" "}
                  {trainingT("Training.Copy.Analyzeposition.7cd475fb", "Analyze position")}{" "}
                </Button>
                {result === "unsupported" && (
                  <Button
                    variant="light"
                    leftSection={<IconRefresh size={16} />}
                    onClick={resetExerciseState}
                  >
                    {" "}
                    {trainingT("Training.Copy.Retry.a9254c5f", "Retry")}{" "}
                  </Button>
                )}
                <TacticsAdvanceControl
                  autoAdvance={set.progress.autoAdvance}
                  solved={result === "correct"}
                  completesCycle={
                    isWoodpecker &&
                    new Set([...currentCycleCompletedIndexes, activeIndex]).size >= total
                  }
                  browsing={browsingIndex !== null && browsingIndex !== resumeIndex}
                  exerciseKey={`${setId}:${activeIndex}:${boardAttempt}`}
                  onNext={nextExercise}
                />
              </Stack>
            </Card>

            <Card withBorder>
              <Stack>
                <Text fw={600}>{trainingT("Training.Copy.Navigation.6d4ca0e8", "Navigation")}</Text>
                {browsingIndex !== null && browsingIndex !== resumeIndex && (
                  <Alert color="blue" variant="light">
                    {" "}
                    {trainingT(
                      "Training.Copy.Youareexploringanotherpuzzle.350787db",
                      "You are exploring another puzzle. Your resume point is still saved at puzzle",
                    )}{" "}
                    {resumeIndex + 1}.
                  </Alert>
                )}
                <Button variant="light" onClick={returnToResume} disabled={browsingIndex === null}>
                  {" "}
                  {trainingT(
                    "Training.Copy.Returntothefirstincomplete.30ef6874",
                    "Return to the first incomplete exercise ·",
                  )}{" "}
                  {resumeIndex + 1}
                </Button>
                <Group grow>
                  <Button
                    variant="default"
                    leftSection={<IconChevronLeft size={16} />}
                    disabled={activeIndex === 0}
                    onClick={() => jumpTo(activeIndex - 1)}
                  >
                    {" "}
                    {trainingT("Training.Copy.Previous.e4ce7c09", "Previous")}{" "}
                  </Button>
                  <Button
                    variant="default"
                    rightSection={<IconChevronRight size={16} />}
                    disabled={activeIndex + 1 >= total}
                    onClick={() => jumpTo(activeIndex + 1)}
                  >
                    {" "}
                    {trainingT("Training.Copy.Next.49683b71", "Next")}{" "}
                  </Button>
                </Group>
                <Group align="flex-end" wrap="nowrap">
                  <NumberInput
                    label={trainingT("Training.Copy.Gotopuzzle.a6b5d4e1", "Go to puzzle")}
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
                    {" "}
                    {trainingT("Training.Copy.Go.460edadf", "Go")}{" "}
                  </Button>
                </Group>
                <Select
                  label={trainingT("Training.Copy.Completedpuzzles.da5ea6b6", "Completed puzzles")}
                  placeholder={
                    completedOptions.length
                      ? trainingT("Training.Copy.Choosepuzzle.5bdb94e5", "Choose puzzle")
                      : trainingT("Training.Copy.Noneyet.91ed3180", "None yet")
                  }
                  data={completedOptions}
                  disabled={completedOptions.length === 0}
                  searchable
                  clearable
                  onChange={(value) => value !== null && jumpTo(Number(value))}
                />
                <Switch
                  label={trainingT(
                    "Training.Copy.Advanceautomaticallyaftersolving.db958dbf",
                    "Advance automatically after solving",
                  )}
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
                    <Text fw={600}>
                      {trainingT("Training.Copy.Cycle.4b8c1a8a", "Cycle")} {cycleNumber}
                    </Text>
                    <Badge>
                      {failures} {trainingT("Training.Copy.mistakes.5fb1604c", "mistakes")}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {" "}
                    {trainingT(
                      "Training.Copy.Timeandmistakesarerecorded.8687b811",
                      "Time and mistakes are recorded but do not stop training.",
                    )}{" "}
                  </Text>
                  {set.progress.cycles
                    .slice(-3)
                    .reverse()
                    .map((cycle) => (
                      <Group key={cycle.id} justify="space-between">
                        <Text size="xs">
                          {trainingT("Training.Copy.Cycle.4b8c1a8a", "Cycle")} {cycle.number}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {cycle.failures}{" "}
                          {trainingT("Training.Copy.mistakes.5c65c76e", "mistakes ·")}{" "}
                          {formatTime(cycle.timeMs)}
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
          title={trainingT(
            "Training.Copy.Endthecyclebeforecompleting.c2e29d9c",
            "End the cycle before completing the set",
          )}
          size="sm"
        >
          <Stack>
            <Alert color="red" icon={<IconAlertTriangle size={18} />}>
              {" "}
              {trainingT(
                "Training.Copy.Thecyclewillbesaved.47fad844",
                "The cycle will be saved as incomplete with its current progress and mistakes. The next cycle will include the entire set again.",
              )}{" "}
            </Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEarlyFinishOpen(false)}>
                {" "}
                {trainingT("Training.Copy.Keeptraining.533691ba", "Keep training")}{" "}
              </Button>
              <Button
                color="red"
                onClick={() => {
                  setEarlyFinishOpen(false);
                  finishCycle();
                }}
              >
                {" "}
                {trainingT("Training.Copy.Endanyway.3b347291", "End anyway")}{" "}
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </Container>
  );
}

function MissingSet() {
  const { t: trainingT } = useTrainingTranslation();

  return (
    <Container size="md" py="xl">
      <Alert color="red" title={trainingT("Training.Copy.Setnotfound.63b73336", "Set not found")}>
        {" "}
        {trainingT(
          "Training.Copy.Thetacticssetnolonger.55f1a175",
          "The tactics set no longer exists or contains no puzzles.",
        )}{" "}
      </Alert>
      <Button
        component={Link}
        to="/training/tactics"
        mt="md"
        leftSection={<IconArrowLeft size={16} />}
      >
        {" "}
        {trainingT("Training.Copy.Backtotactics.8239d676", "Back to tactics")}{" "}
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
  const { t: trainingT } = useTrainingTranslation();

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
        trainingT(
          "Training.Copy.SetupStockfishoranother.cb95b179",
          "Set up Stockfish or another local engine to validate this puzzle.",
        ),
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
        correct
          ? trainingT(
              "Training.Copy.Moveacceptedbytheengine.e7c93b94",
              "Move accepted by the engine.",
            )
          : "",
      );
    } catch (error) {
      onResult(
        "unsupported",
        playedMove,
        error instanceof Error
          ? error.message
          : trainingT(
              "Training.Copy.Couldnotquerytheengine.de1b61cd",
              "Could not query the engine.",
            ),
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
