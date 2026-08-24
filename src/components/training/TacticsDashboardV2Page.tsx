import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Container,
  Group,
  Modal,
  NumberInput,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconCheck,
  IconDatabase,
  IconEye,
  IconPlayerPlay,
  IconPuzzle,
  IconSettings,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PuzzleDatabaseInfo } from "@/bindings";
import Board from "@/components/boards/Board";
import { TreeStateProvider } from "@/components/common/TreeStateContext";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { trainingAreasAtom } from "@/state/trainingAreas";
import { getPuzzleDatabases } from "@/utils/puzzles";
import {
  addTacticsFileSet,
  deleteTacticsSet,
  getTacticsCompletedIndexes,
  getTacticsFirstIncompleteIndex,
  getTacticsSetProgress,
  updateTacticsSetConfig,
  updateTacticsSetMetadata,
  type TacticsSet,
} from "@/utils/trainingAreas";
import {
  inspectTacticsPgn,
  loadTacticsExercise,
  type TacticsLoadedExercise,
  type TacticsPgnInspection,
} from "@/utils/tacticsTraining";
import { createTab } from "@/utils/tabs";
import { defaultTree } from "@/utils/treeReducer";

const defaultConfig: TacticsSet["config"] = {
  acceptanceThresholdCp: 30,
  mode: "guided",
  startingActor: "student",
  variationPolicy: "opponentResponses",
  validationMode: "auto",
};

function filename(path: string) {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || "Set de táctica"
  );
}

function numericRating(value: string | number): number | null {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

function ratingLabel(set: TacticsSet) {
  const { min, max } = set.recommendedRating;
  if (min !== null && max !== null) return `${min}–${max} ELO`;
  if (min !== null) return `Desde ${min} ELO`;
  if (max !== null) return `Hasta ${max} ELO`;
  return "Todos los niveles";
}

export default function TacticsDashboardV2Page() {
  const navigate = useNavigate();
  const [areas, setAreas] = useAtom(trainingAreasAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const [feedback, setFeedback] = useState<{ text: string; color?: string } | null>(null);
  const [puzzleDbs, setPuzzleDbs] = useState<PuzzleDatabaseInfo[]>([]);

  const [setName, setSetName] = useState("");
  const [description, setDescription] = useState("");
  const [ratingMin, setRatingMin] = useState<string | number>("");
  const [ratingMax, setRatingMax] = useState<string | number>("");
  const [draftConfig, setDraftConfig] = useState<TacticsSet["config"]>(defaultConfig);
  const [inspection, setInspection] = useState<TacticsPgnInspection | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftRatingMin, setDraftRatingMin] = useState<string | number>("");
  const [draftRatingMax, setDraftRatingMax] = useState<string | number>("");
  const [deletingSetId, setDeletingSetId] = useState<string | null>(null);

  const [reviewSetId, setReviewSetId] = useState<string | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewExercise, setReviewExercise] = useState<TacticsLoadedExercise | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewView, setReviewView] = useState<"list" | "detail">("list");
  const reviewListViewportRef = useRef<HTMLDivElement>(null);

  const sets = useMemo(
    () =>
      Object.values(areas.tactics.sets).sort((a, b) => {
        if (a.origin !== b.origin) return a.origin === "bundled" ? -1 : 1;
        return a.createdAt.localeCompare(b.createdAt);
      }),
    [areas.tactics.sets],
  );
  const reviewSet = reviewSetId ? areas.tactics.sets[reviewSetId] : undefined;
  const reviewTotal = reviewSet
    ? reviewSet.source?.kind === "pgnFile"
      ? reviewSet.source.recordCount
      : reviewSet.exerciseIds.length
    : 0;
  const reviewCycleNumber = reviewSet
    ? (reviewSet.progress.activeCycle?.number ?? reviewSet.progress.cycles.at(-1)?.number ?? 1)
    : null;
  const reviewCompletedIndexes = useMemo(
    () =>
      reviewSetId
        ? getTacticsCompletedIndexes(
            areas.tactics,
            reviewSetId,
            reviewSet?.config.mode === "woodpecker" ? reviewCycleNumber : null,
          )
        : [],
    [areas.tactics, reviewCycleNumber, reviewSet?.config.mode, reviewSetId],
  );
  const reviewCompletedSet = useMemo(
    () => new Set(reviewCompletedIndexes),
    [reviewCompletedIndexes],
  );
  const reviewListVirtualizer = useVirtualizer({
    count: reviewSetId && reviewView === "list" ? reviewTotal : 0,
    getScrollElement: () => reviewListViewportRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  useEffect(() => {
    void getPuzzleDatabases()
      .then(setPuzzleDbs)
      .catch(() => setPuzzleDbs([]));
  }, []);

  useEffect(() => {
    if (!reviewSet || reviewTotal === 0 || reviewView !== "detail") {
      setReviewExercise(null);
      return;
    }
    let cancelled = false;
    const safeIndex = Math.min(Math.max(0, reviewIndex), reviewTotal - 1);
    setReviewLoading(true);
    setReviewError("");
    void loadTacticsExercise(reviewSet, areas.tactics.exercises, safeIndex)
      .then((exercise) => !cancelled && setReviewExercise(exercise))
      .catch((error) => {
        if (!cancelled) {
          setReviewExercise(null);
          setReviewError(error instanceof Error ? error.message : "No se pudo leer el problema.");
        }
      })
      .finally(() => !cancelled && setReviewLoading(false));
    return () => {
      cancelled = true;
    };
  }, [areas.tactics.exercises, reviewIndex, reviewSet, reviewTotal, reviewView]);

  function ratingRange(minValue: string | number, maxValue: string | number) {
    const min = numericRating(minValue);
    const max = numericRating(maxValue);
    if (min !== null && max !== null && min > max) {
      setFeedback({ text: "El ELO mínimo no puede ser mayor que el máximo.", color: "red" });
      return null;
    }
    return { min, max };
  }

  async function openLichessTrainer() {
    await navigate({ to: "/" });
    await createTab({
      tab: { name: "Entrenamiento de Táctica", type: "puzzles" },
      setTabs,
      setActiveTab,
    });
  }

  async function selectImportFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PGN de táctica", extensions: ["pgn"] }],
    });
    if (typeof selected !== "string") return;
    setImportBusy(true);
    setFeedback(null);
    try {
      const next = await inspectTacticsPgn(selected, draftConfig);
      if (next.recordCount === 0) throw new Error("El archivo no contiene ejercicios PGN.");
      setInspection(next);
      if (!setName.trim()) setSetName(filename(selected));
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "No se pudo inspeccionar el PGN.",
        color: "red",
      });
    } finally {
      setImportBusy(false);
    }
  }

  function confirmImport() {
    if (!inspection) return;
    const recommendedRating = ratingRange(ratingMin, ratingMax);
    if (!recommendedRating) return;
    const name = setName.trim() || filename(inspection.path);
    setAreas((previous) => ({
      ...previous,
      tactics: addTacticsFileSet(previous.tactics, {
        name,
        description: description.trim(),
        path: inspection.path,
        filename: inspection.filename,
        recordCount: inspection.recordCount,
        config: draftConfig,
        recommendedRating,
      }),
    }));
    setInspection(null);
    setSetName("");
    setDescription("");
    setRatingMin("");
    setRatingMax("");
    setDraftConfig(defaultConfig);
    setFeedback({
      text: `Set «${name}» añadido con ${inspection.recordCount.toLocaleString()} problemas.`,
    });
  }

  function editSet(set: TacticsSet) {
    setEditingSetId(set.id);
    setDraftName(set.name);
    setDraftDescription(set.description);
    setDraftRatingMin(set.recommendedRating.min ?? "");
    setDraftRatingMax(set.recommendedRating.max ?? "");
    setDraftConfig(set.config);
  }

  function saveSettings() {
    if (!editingSetId || !draftName.trim()) return;
    const recommendedRating = ratingRange(draftRatingMin, draftRatingMax);
    if (!recommendedRating) return;
    setAreas((previous) => {
      const configured = updateTacticsSetConfig(previous.tactics, editingSetId, draftConfig);
      return {
        ...previous,
        tactics: updateTacticsSetMetadata(configured, editingSetId, {
          name: draftName,
          description: draftDescription,
          recommendedRating,
        }),
      };
    });
    setEditingSetId(null);
  }

  function removeSet() {
    if (!deletingSetId) return;
    const set = areas.tactics.sets[deletingSetId];
    if (!set) return;
    setAreas((previous) => ({
      ...previous,
      tactics: deleteTacticsSet(previous.tactics, deletingSetId),
    }));
    setDeletingSetId(null);
    setFeedback({ text: `Set «${set.name}» eliminado. Su archivo PGN no se ha borrado.` });
  }

  function review(setId: string) {
    setReviewIndex(0);
    setReviewView("list");
    setReviewSetId(setId);
  }

  function practiceReviewedProblem(index: number) {
    if (!reviewSetId) return;
    const setId = reviewSetId;
    setReviewSetId(null);
    void navigate({
      to: "/training/tactics/practice/$setId",
      params: { setId },
      search: { problem: index + 1 },
    });
  }

  const sampleSolutions = inspection?.samples.filter((sample) => sample.hasSolution).length ?? 0;
  const sampleVariations = inspection?.samples.filter((sample) => sample.hasVariations).length ?? 0;
  const sampleErrors = inspection?.samples.filter((sample) => sample.error).length ?? 0;
  const reviewAttempts = reviewExercise
    ? areas.tactics.attempts.filter(
        (attempt) => attempt.setId === reviewSetId && attempt.exerciseId === reviewExercise.id,
      )
    : [];

  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group align="flex-start">
          <Button component={Link} to="/training" variant="subtle" p="xs" aria-label="Volver">
            <IconArrowLeft size={20} />
          </Button>
          <div>
            <Title order={2}>Entrenamiento de Táctica</Title>
            <Text c="dimmed">Elige un set, retoma tu progreso y entrena a tu ritmo.</Text>
          </div>
        </Group>

        {feedback && (
          <Alert color={feedback.color} withCloseButton onClose={() => setFeedback(null)}>
            {feedback.text}
          </Alert>
        )}

        <div>
          <Title order={3}>Sets disponibles</Title>
          <Text size="sm" c="dimmed">
            Cada set conserva su progreso, nivel recomendado y ciclos anteriores.
          </Text>
        </div>

        {sets.length === 0 ? (
          <Card withBorder>
            <Stack align="center" py="xl">
              <IconPuzzle size={42} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">Todavía no hay sets disponibles.</Text>
            </Stack>
          </Card>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }}>
            {sets.map((set) => {
              const progress = getTacticsSetProgress(areas.tactics, set.id);
              const resume = Math.min(
                set.config.mode === "woodpecker"
                  ? set.progress.activeCycle
                    ? getTacticsFirstIncompleteIndex(
                        areas.tactics,
                        set.id,
                        set.progress.activeCycle.number,
                      )
                    : 0
                  : set.progress.nextExerciseIndex,
                Math.max(0, progress.total - 1),
              );
              const lastCycle = set.progress.cycles.at(-1);
              return (
                <Card key={set.id} withBorder>
                  <Stack h="100%" justify="space-between">
                    <div>
                      <Group justify="space-between" align="flex-start" wrap="nowrap">
                        <Title order={4}>{set.name}</Title>
                        <Badge color="orange">
                          {progress.completed}/{progress.total}
                        </Badge>
                      </Group>
                      <Text size="sm" c="dimmed" mt="xs" mih={42}>
                        {set.description || "Colección de posiciones tácticas."}
                      </Text>
                      <Progress value={progress.percent} color="orange" mt="md" />
                      <Group justify="space-between" mt={4}>
                        <Text size="xs" c="dimmed">
                          Progreso {progress.percent}%
                        </Text>
                        <Text size="xs" c="dimmed">
                          Siguiente: {resume + 1}
                        </Text>
                      </Group>
                      <Group gap="xs" mt="sm">
                        <Badge size="sm" variant="outline">
                          {set.config.mode === "woodpecker" ? "Woodpecker" : "Guiado"}
                        </Badge>
                        <Badge size="sm" color="blue" variant="light">
                          {ratingLabel(set)}
                        </Badge>
                        {set.origin === "bundled" && (
                          <Badge size="sm" color="teal">
                            Incluido
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed" mt="sm">
                        {progress.incorrect} fallos · {set.progress.cycles.length} ciclos
                        {lastCycle ? ` · último: ${lastCycle.failures} fallos` : ""}
                      </Text>
                    </div>
                    <Stack gap="xs" mt="md">
                      <Button
                        color="orange"
                        leftSection={<IconPlayerPlay size={16} />}
                        onClick={() =>
                          navigate({
                            to: "/training/tactics/practice/$setId",
                            params: { setId: set.id },
                            search: { problem: undefined },
                          })
                        }
                      >
                        {set.config.mode === "woodpecker" && !set.progress.activeCycle
                          ? set.progress.cycles.length > 0
                            ? `Comenzar ciclo ${set.progress.cycles.length + 1}`
                            : "Empezar ciclo 1"
                          : progress.attempted > 0
                            ? `Continuar en el problema ${resume + 1}`
                            : "Empezar set"}
                      </Button>
                      <Group grow>
                        <Button
                          variant="default"
                          leftSection={<IconEye size={16} />}
                          onClick={() => review(set.id)}
                        >
                          Revisar
                        </Button>
                        <Button
                          variant="default"
                          leftSection={<IconSettings size={16} />}
                          onClick={() => editSet(set)}
                        >
                          Configurar
                        </Button>
                        {set.origin === "user" && (
                          <ActionIcon
                            size={36}
                            color="red"
                            variant="subtle"
                            aria-label={`Eliminar ${set.name}`}
                            onClick={() => setDeletingSetId(set.id)}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        )}
                      </Group>
                    </Stack>
                  </Stack>
                </Card>
              );
            })}
          </SimpleGrid>
        )}

        <Card withBorder>
          <Stack>
            <Group justify="space-between">
              <Group>
                <IconDatabase size={26} color="var(--mantine-color-orange-6)" />
                <div>
                  <Text fw={600}>Bases de puzzles instaladas</Text>
                  <Text size="sm" c="dimmed">
                    Entrena con tus bases locales y sus filtros.
                  </Text>
                </div>
              </Group>
              <Badge color="orange">{puzzleDbs.length}</Badge>
            </Group>
            {puzzleDbs.length > 0 && (
              <Text size="xs" c="dimmed">
                {puzzleDbs.map((db) => db.title.replace(/\.db3$/i, "")).join(" · ")}
              </Text>
            )}
            <Button
              variant="light"
              leftSection={<IconPlayerPlay size={16} />}
              onClick={openLichessTrainer}
            >
              Abrir entrenador de bases
            </Button>
          </Stack>
        </Card>

        <Card withBorder>
          <Stack>
            <Group>
              <IconUpload size={26} color="var(--mantine-color-orange-6)" />
              <div>
                <Text fw={600}>Importar otro set desde PGN</Text>
                <Text size="sm" c="dimmed">
                  Revisa una muestra antes de añadirlo; el archivo se lee bajo demanda.
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 2, lg: 4 }}>
              <TextInput
                label="Nombre"
                value={setName}
                onChange={(event) => setSetName(event.currentTarget.value)}
              />
              <TextInput
                label="Descripción"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
              <NumberInput
                label="ELO mínimo"
                placeholder="Opcional"
                min={0}
                value={ratingMin}
                onChange={setRatingMin}
              />
              <NumberInput
                label="ELO máximo"
                placeholder="Opcional"
                min={0}
                value={ratingMax}
                onChange={setRatingMax}
              />
            </SimpleGrid>
            <Button
              color="orange"
              loading={importBusy}
              leftSection={<IconUpload size={16} />}
              onClick={selectImportFile}
            >
              Seleccionar PGN
            </Button>
          </Stack>
        </Card>
      </Stack>

      <Modal
        opened={inspection !== null}
        onClose={() => setInspection(null)}
        title="Revisar importación"
        size="lg"
      >
        {inspection && (
          <Stack>
            <Alert color={sampleErrors > 0 ? "yellow" : "blue"}>
              {inspection.recordCount.toLocaleString()} problemas. En la muestra: {sampleSolutions}{" "}
              con solución, {sampleVariations} con variantes y {sampleErrors} inválidos.
            </Alert>
            <ScrollArea h={210}>
              <Stack gap="xs" pr="sm">
                {inspection.samples.map((sample) => (
                  <Card key={sample.index} withBorder padding="xs">
                    <Text size="sm" fw={500}>
                      {sample.index + 1}. {sample.title}
                    </Text>
                    <Text size="xs" c={sample.error ? "red" : "dimmed"}>
                      {sample.error ||
                        (sample.hasSolution
                          ? `${sample.moveCount} medias jugadas`
                          : "Sin solución preparada")}
                    </Text>
                  </Card>
                ))}
              </Stack>
            </ScrollArea>
            <TacticsConfigFields config={draftConfig} onChange={setDraftConfig} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setInspection(null)}>
                Cancelar
              </Button>
              <Button color="orange" onClick={confirmImport}>
                Importar set
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={editingSetId !== null}
        onClose={() => setEditingSetId(null)}
        title="Configurar set"
        size="lg"
      >
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="Nombre"
              value={draftName}
              onChange={(event) => setDraftName(event.currentTarget.value)}
            />
            <TextInput
              label="Descripción"
              value={draftDescription}
              onChange={(event) => setDraftDescription(event.currentTarget.value)}
            />
            <NumberInput
              label="ELO mínimo"
              placeholder="Opcional"
              min={0}
              value={draftRatingMin}
              onChange={setDraftRatingMin}
            />
            <NumberInput
              label="ELO máximo"
              placeholder="Opcional"
              min={0}
              value={draftRatingMax}
              onChange={setDraftRatingMax}
            />
          </SimpleGrid>
          <TacticsConfigFields config={draftConfig} onChange={setDraftConfig} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditingSetId(null)}>
              Cancelar
            </Button>
            <Button color="orange" disabled={!draftName.trim()} onClick={saveSettings}>
              Guardar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={reviewSetId !== null}
        onClose={() => setReviewSetId(null)}
        title={reviewSet ? `Revisar · ${reviewSet.name}` : "Revisar set"}
        size="xl"
      >
        {reviewSet && (
          <Stack>
            <SegmentedControl
              fullWidth
              value={reviewView}
              onChange={(value) => setReviewView(value as "list" | "detail")}
              data={[
                { value: "list", label: "Lista PGN" },
                { value: "detail", label: "Detalle y tablero" },
              ]}
            />
            {reviewView === "list" ? (
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    {reviewSet.config.mode === "woodpecker"
                      ? `Completados en el ciclo ${reviewCycleNumber}: ${reviewCompletedIndexes.length}`
                      : `Completados: ${reviewCompletedIndexes.length}`}
                  </Text>
                  <Badge>{reviewTotal} problemas</Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  Selecciona cualquier registro para abrirlo directamente en el tablero. Explorar
                  otros problemas no cambia tu punto de reanudación.
                </Text>
                <ScrollArea h={520} viewportRef={reviewListViewportRef} type="auto">
                  <div
                    style={{
                      height: reviewListVirtualizer.getTotalSize(),
                      position: "relative",
                    }}
                  >
                    {reviewListVirtualizer.getVirtualItems().map((virtualRow) => {
                      const problemIndex = virtualRow.index;
                      const exerciseId = reviewSet.exerciseIds[problemIndex];
                      const embeddedExercise = exerciseId
                        ? areas.tactics.exercises[exerciseId]
                        : undefined;
                      const completed = reviewCompletedSet.has(problemIndex);
                      return (
                        <Button
                          key={problemIndex}
                          variant={completed ? "light" : "default"}
                          color={completed ? "teal" : "gray"}
                          fullWidth
                          justify="space-between"
                          leftSection={
                            completed ? <IconCheck size={16} /> : <Text>{problemIndex + 1}</Text>
                          }
                          rightSection={<IconPlayerPlay size={15} />}
                          onClick={() => practiceReviewedProblem(problemIndex)}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            height: 40,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <Text size="sm" truncate>
                            {embeddedExercise?.title || `Problema ${problemIndex + 1}`}
                            {completed ? " · completado" : ""}
                          </Text>
                        </Button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </Stack>
            ) : (
              <Stack>
                <Group justify="space-between">
                  <Group align="flex-end">
                    <ActionIcon
                      size={36}
                      variant="default"
                      disabled={reviewIndex === 0}
                      onClick={() => setReviewIndex((value) => value - 1)}
                    >
                      <IconChevronLeft size={16} />
                    </ActionIcon>
                    <NumberInput
                      label="Problema"
                      w={150}
                      min={1}
                      max={reviewTotal}
                      value={reviewIndex + 1}
                      onChange={(value) =>
                        setReviewIndex(
                          Math.min(reviewTotal - 1, Math.max(0, Number(value || 1) - 1)),
                        )
                      }
                    />
                    <ActionIcon
                      size={36}
                      variant="default"
                      disabled={reviewIndex + 1 >= reviewTotal}
                      onClick={() => setReviewIndex((value) => value + 1)}
                    >
                      <IconChevronRight size={16} />
                    </ActionIcon>
                  </Group>
                  <Badge>
                    {reviewIndex + 1} de {reviewTotal}
                  </Badge>
                </Group>
                {reviewLoading ? (
                  <Text c="dimmed">Cargando problema…</Text>
                ) : reviewError ? (
                  <Alert color="red">{reviewError}</Alert>
                ) : reviewExercise ? (
                  <SimpleGrid cols={{ base: 1, md: 2 }}>
                    <Stack>
                      <TacticsReviewBoard key={reviewExercise.id} fen={reviewExercise.fen} />
                      <Text fw={600}>{reviewExercise.title}</Text>
                      <Code block>{reviewExercise.fen}</Code>
                      <div>
                        <Text size="sm" fw={600}>
                          Soluciones interpretadas
                        </Text>
                        {reviewExercise.solutionLines.length > 0 ? (
                          reviewExercise.solutionLines.map((line, index) => (
                            <Code key={`${reviewExercise.id}-${index}`} block mt={4}>
                              {line.join(" ")}
                            </Code>
                          ))
                        ) : (
                          <Text size="sm" c="dimmed">
                            Sin solución preparada; requiere motor.
                          </Text>
                        )}
                      </div>
                      <Text size="sm">
                        {reviewAttempts.filter((a) => a.outcome === "correct").length} aciertos ·{" "}
                        {reviewAttempts.filter((a) => a.outcome === "incorrect").length} fallos
                      </Text>
                      <Button
                        leftSection={<IconPlayerPlay size={16} />}
                        onClick={() => practiceReviewedProblem(reviewIndex)}
                      >
                        Practicar este problema
                      </Button>
                    </Stack>
                    <Textarea
                      label="Registro PGN"
                      readOnly
                      autosize
                      minRows={15}
                      maxRows={24}
                      value={reviewExercise.sourcePgn || "No hay PGN textual guardado."}
                    />
                  </SimpleGrid>
                ) : null}
              </Stack>
            )}
          </Stack>
        )}
      </Modal>

      <Modal
        opened={deletingSetId !== null}
        onClose={() => setDeletingSetId(null)}
        title="Eliminar set"
        size="sm"
      >
        <Stack>
          <Text size="sm">
            Se eliminarán el progreso, los ciclos y los intentos. El PGN original permanecerá
            intacto.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              leftSection={<IconEye size={16} />}
              onClick={() => {
                if (!deletingSetId) return;
                const id = deletingSetId;
                setDeletingSetId(null);
                review(id);
              }}
            >
              Revisar primero
            </Button>
            <Button color="red" onClick={removeSet}>
              Eliminar set
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}

function TacticsReviewBoard({ fen }: { fen: string }) {
  const initial = useMemo(() => defaultTree(fen), [fen]);
  const boardRef = useRef<HTMLDivElement>(null);
  return (
    <div style={{ width: "100%", maxWidth: 430, alignSelf: "center" }}>
      <TreeStateProvider initial={initial}>
        <Board editingMode={false} movable="none" boardRef={boardRef} />
      </TreeStateProvider>
    </div>
  );
}

function TacticsConfigFields({
  config,
  onChange,
}: {
  config: TacticsSet["config"];
  onChange: (config: TacticsSet["config"]) => void;
}) {
  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Select
          label="Primera jugada"
          value={config.startingActor}
          data={[
            { value: "student", label: "El estudiante" },
            { value: "opponent", label: "El rival" },
          ]}
          onChange={(value) =>
            value &&
            onChange({ ...config, startingActor: value as TacticsSet["config"]["startingActor"] })
          }
        />
        <Select
          label="Variantes"
          value={config.variationPolicy}
          data={[
            { value: "mainline", label: "Línea principal" },
            { value: "opponentResponses", label: "Respuestas del rival" },
            { value: "all", label: "Todas" },
          ]}
          onChange={(value) =>
            value &&
            onChange({
              ...config,
              variationPolicy: value as TacticsSet["config"]["variationPolicy"],
            })
          }
        />
        <Select
          label="Validación"
          value={config.validationMode}
          data={[
            { value: "auto", label: "Automática" },
            { value: "prepared", label: "Solución PGN" },
            { value: "engine", label: "Motor" },
          ]}
          onChange={(value) =>
            value &&
            onChange({ ...config, validationMode: value as TacticsSet["config"]["validationMode"] })
          }
        />
        <Select
          label="Tipo"
          value={config.mode}
          data={[
            { value: "guided", label: "Guiado" },
            { value: "woodpecker", label: "Woodpecker" },
          ]}
          onChange={(value) =>
            value && onChange({ ...config, mode: value as TacticsSet["config"]["mode"] })
          }
        />
      </SimpleGrid>
      <Group justify="space-between">
        <Text size="sm">Tolerancia de alternativas</Text>
        <NumberInput
          w={120}
          min={0}
          suffix=" cp"
          value={config.acceptanceThresholdCp}
          onChange={(value) =>
            onChange({ ...config, acceptanceThresholdCp: Math.max(0, Number(value) || 0) })
          }
        />
      </Group>
      {config.mode === "woodpecker" && (
        <Text size="xs" c="dimmed">
          Los ciclos registran tiempo y fallos, pero no terminan por límites.
        </Text>
      )}
    </Stack>
  );
}
