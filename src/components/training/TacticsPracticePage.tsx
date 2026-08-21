import { Alert, Badge, Button, Card, Container, Group, Stack, Text, Title } from "@mantine/core";
import { IconArrowLeft, IconCheck, IconPlayerSkipForward, IconX } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { Link, useParams } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import type { BestMoves, ScoreValue } from "@/bindings";
import Board from "@/components/boards/Board";
import { TreeStateProvider } from "@/components/common/TreeStateContext";
import { enginesAtom } from "@/state/atoms";
import { trainingAreasAtom } from "@/state/trainingAreas";
import { getBestMoves as getLocalBestMoves, type LocalEngine } from "@/utils/engines";
import { genID } from "@/utils/tabs";
import { defaultTree } from "@/utils/treeReducer";
import { recordTacticsAttempt } from "@/utils/trainingAreas";

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

export default function TacticsPracticePage() {
  const { setId } = useParams({ from: "/training/tactics/practice/$setId" });
  const [areas, setAreas] = useAtom(trainingAreasAtom);
  const storedEngines = useAtomValue(enginesAtom);
  const engines = useMemo(() => storedEngines ?? [], [storedEngines]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"correct" | "incorrect" | "unsupported" | null>(null);
  const [message, setMessage] = useState("");
  const boardRef = useRef<HTMLDivElement>(null);
  const evaluatorTabId = useState(() => genID())[0];
  const set = areas.tactics.sets[setId];
  const exercises = useMemo(
    () => (set?.exerciseIds ?? []).map((id) => areas.tactics.exercises[id]).filter(Boolean),
    [areas.tactics.exercises, set],
  );
  const exercise = exercises[index];

  const evaluateMove = useCallback(
    async (playedMove: string) => {
      if (!exercise || !set || busy || result) return;
      setBusy(true);
      setMessage("");

      const localEngine = engines.find(
        (engine): engine is LocalEngine => engine.type === "local" && Boolean(engine.path),
      );
      const options = {
        fen: exercise.fen,
        moves: [],
        extraOptions: [{ name: "MultiPV", value: "8" }],
      };

      try {
        if (!localEngine) {
          setResult("unsupported");
          setMessage("Configura un motor local para validar tácticas con posiciones FEN.");
          setAreas((previous) => ({
            ...previous,
            tactics: recordTacticsAttempt(previous.tactics, {
              setId,
              exerciseId: exercise.id,
              playedMove,
              outcome: "unsupported",
              timeMs: 0,
            }),
          }));
          return;
        }

        const evaluated = await getLocalBestMoves(
          localEngine,
          evaluatorTabId,
          { t: "Depth", c: 18 },
          options,
        );
        const bestMoves = evaluated?.[1] ?? [];
        const candidate = bestMoves.find((line) => line.uciMoves[0] === playedMove);
        const side = exercise.fen.split(" ")[1] === "b" ? "black" : "white";
        const correct = Boolean(
          candidate && bestMoves[0] && acceptsMove(bestMoves[0], candidate, side, set.config.acceptanceThresholdCp),
        );

        setResult(correct ? "correct" : "incorrect");
        setMessage(
          correct
            ? "Jugada correcta. La posición acepta esta continuación."
            : exercise.solutionMoves[0]
              ? `Jugada incorrecta. La continuación preparada comienza con ${exercise.solutionMoves[0]}.`
              : "Jugada incorrecta según Stockfish.",
        );
        setAreas((previous) => ({
          ...previous,
          tactics: recordTacticsAttempt(previous.tactics, {
            setId,
            exerciseId: exercise.id,
            playedMove,
            outcome: correct ? "correct" : "incorrect",
            timeMs: 0,
          }),
        }));
      } catch (error) {
        setResult("unsupported");
        setMessage(error instanceof Error ? error.message : "No se pudo consultar Stockfish.");
      } finally {
        setBusy(false);
      }
    },
    [busy, engines, evaluatorTabId, exercise, result, set, setAreas, setId],
  );

  function nextExercise() {
    if (exercises.length === 0) return;
    setIndex((current) => (current + 1) % exercises.length);
    setResult(null);
    setMessage("");
  }

  if (!set || !exercise) {
    return (
      <Container size="md" py="xl">
        <Alert color="red" title="Set no encontrado">
          El set de Táctica ya no existe o no contiene ejercicios.
        </Alert>
        <Button component={Link} to="/training/tactics" mt="md" leftSection={<IconArrowLeft size={16} />}>
          Volver a Táctica
        </Button>
      </Container>
    );
  }

  return (
    <Container size="xl" py="md">
      <Stack gap="md">
        <Group justify="space-between">
          <Group>
            <Button component={Link} to="/training/tactics" variant="subtle" p="xs" aria-label="Volver">
              <IconArrowLeft size={20} />
            </Button>
            <div>
              <Title order={2}>{set.name}</Title>
              <Text size="sm" c="dimmed">
                Ejercicio {index + 1} de {exercises.length} · respuesta validada bajo demanda
              </Text>
            </div>
          </Group>
          <Badge color="orange" variant="light">
            Umbral {set.config.acceptanceThresholdCp} cp
          </Badge>
        </Group>

        <Group align="stretch" wrap="wrap">
          <Card withBorder style={{ flex: "1 1 560px", minHeight: 520 }}>
            <TreeStateProvider key={exercise.id} initial={defaultTree(exercise.fen)}>
              <Board
                editingMode={false}
                movable={busy || result ? "none" : "turn"}
                boardRef={boardRef}
                onMove={(move) => void evaluateMove(move)}
              />
            </TreeStateProvider>
          </Card>
          <Card withBorder style={{ flex: "1 1 280px" }}>
            <Stack justify="space-between" h="100%">
              <div>
                <Text fw={600}>{exercise.title}</Text>
                <Text size="sm" c="dimmed" mt="xs">
                  Juega la mejor continuación para resolver la posición.
                </Text>
                {message && (
                  <Alert
                    mt="md"
                    color={result === "correct" ? "teal" : result === "unsupported" ? "yellow" : "red"}
                    icon={result === "correct" ? <IconCheck size={16} /> : <IconX size={16} />}
                  >
                    {message}
                  </Alert>
                )}
              </div>
              <Button
                disabled={!result}
                loading={busy}
                leftSection={<IconPlayerSkipForward size={16} />}
                onClick={nextExercise}
              >
                Siguiente ejercicio
              </Button>
            </Stack>
          </Card>
        </Group>
      </Stack>
    </Container>
  );
}
