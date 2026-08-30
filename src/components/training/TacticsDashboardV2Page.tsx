import { useTranslation as useTrainingTranslation } from "react-i18next";
import i18n from "i18next";
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

function filename(path: string, trainingT: typeof i18n.t = i18n.t) {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || trainingT("Training.Copy.Tacticsset.e9b5f38c", "Tactics set")
  );
}

function numericRating(value: string | number): number | null {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

function ratingLabel(set: TacticsSet, trainingT: typeof i18n.t = i18n.t) {
  const { min, max } = set.recommendedRating;
  if (min !== null && max !== null) return `${min}–${max} ELO`;
  if (min !== null)
    return trainingT("Training.Copy.Fromv0ELO.92be5507", "From {{v0}} ELO", { v0: min });
  if (max !== null)
    return trainingT("Training.Copy.Uptov0ELO.249acac4", "Up to {{v0}} ELO", { v0: max });
  return trainingT("Training.Copy.Alllevels.268b96a8", "All levels");
}

export default function TacticsDashboardV2Page() {
  const { t: trainingT } = useTrainingTranslation();

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
          setReviewError(
            error instanceof Error
              ? error.message
              : trainingT(
                  "Training.Copy.Couldnotreadthepuzzle.3ad5e4a1",
                  "Could not read the puzzle.",
                ),
          );
        }
      })
      .finally(() => !cancelled && setReviewLoading(false));
    return () => {
      cancelled = true;
    };
  }, [areas.tactics.exercises, reviewIndex, reviewSet, reviewTotal, reviewView, trainingT]);

  function ratingRange(minValue: string | number, maxValue: string | number) {
    const min = numericRating(minValue);
    const max = numericRating(maxValue);
    if (min !== null && max !== null && min > max) {
      setFeedback({
        text: trainingT(
          "Training.Copy.MinimumELOcannotexceedmaximum.c30da85b",
          "Minimum ELO cannot exceed maximum ELO.",
        ),
        color: "red",
      });
      return null;
    }
    return { min, max };
  }

  async function openLichessTrainer() {
    await navigate({ to: "/" });
    await createTab({
      tab: {
        name: trainingT("Training.Copy.Tacticstraining.8816b222", "Tactics training"),
        type: "puzzles",
      },
      setTabs,
      setActiveTab,
    });
  }

  async function selectImportFile() {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: trainingT("Training.Copy.TacticsPGN.2840fe24", "Tactics PGN"),
          extensions: ["pgn"],
        },
      ],
    });
    if (typeof selected !== "string") return;
    setImportBusy(true);
    setFeedback(null);
    try {
      const next = await inspectTacticsPgn(selected, draftConfig);
      if (next.recordCount === 0)
        throw new Error(
          trainingT(
            "Training.Copy.ThefilecontainsnoPGN.40a99062",
            "The file contains no PGN exercises.",
          ),
        );
      setInspection(next);
      if (!setName.trim()) setSetName(filename(selected, trainingT));
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? error.message
            : trainingT(
                "Training.Copy.CouldnotinspectthePGN.dc19e21b",
                "Could not inspect the PGN.",
              ),
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
    const name = setName.trim() || filename(inspection.path, trainingT);
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
      text: trainingT(
        "Training.Copy.Setv0addedwithv1.f3488bc5",
        "Set “{{v0}}” added with {{v1}} puzzles.",
        { v0: name, v1: inspection.recordCount.toLocaleString() },
      ),
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
    setFeedback({
      text: trainingT(
        "Training.Copy.Setv0removedItsPGN.42a87794",
        "Set “{{v0}}” removed. Its PGN file was not deleted.",
        { v0: set.name },
      ),
    });
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
          <Button
            component={Link}
            to="/training"
            variant="subtle"
            p="xs"
            aria-label={trainingT("Training.Copy.Back.ab26ae7b", "Back")}
          >
            <IconArrowLeft size={20} />
          </Button>
          <div>
            <Title order={2}>
              {trainingT("Training.Copy.Tacticstraining.8816b222", "Tactics training")}
            </Title>
            <Text c="dimmed">
              {trainingT(
                "Training.Copy.Chooseasetresumeyour.f0e70311",
                "Choose a set, resume your progress, and train at your own pace.",
              )}
            </Text>
          </div>
        </Group>

        {feedback && (
          <Alert color={feedback.color} withCloseButton onClose={() => setFeedback(null)}>
            {feedback.text}
          </Alert>
        )}

        <div>
          <Title order={3}>
            {trainingT("Training.Copy.Availablesets.d6d3e738", "Available sets")}
          </Title>
          <Text size="sm" c="dimmed">
            {" "}
            {trainingT(
              "Training.Copy.Eachsetkeepsitsprogress.6ec42902",
              "Each set keeps its progress, recommended level, and previous cycles.",
            )}{" "}
          </Text>
        </div>

        {sets.length === 0 ? (
          <Card withBorder>
            <Stack align="center" py="xl">
              <IconPuzzle size={42} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">
                {trainingT("Training.Copy.Nosetsavailableyet.3041bd51", "No sets available yet.")}
              </Text>
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
                        {set.description ||
                          trainingT(
                            "Training.Copy.Tacticalpositioncollection.cc3246c4",
                            "Tactical position collection.",
                          )}
                      </Text>
                      <Progress value={progress.percent} color="orange" mt="md" />
                      <Group justify="space-between" mt={4}>
                        <Text size="xs" c="dimmed">
                          {" "}
                          {trainingT("Training.Copy.Progress.1d4a9eeb", "Progress")}{" "}
                          {progress.percent}%
                        </Text>
                        <Text size="xs" c="dimmed">
                          {" "}
                          {trainingT("Training.Copy.Next.57d01069", "Next:")} {resume + 1}
                        </Text>
                      </Group>
                      <Group gap="xs" mt="sm">
                        <Badge size="sm" variant="outline">
                          {set.config.mode === "woodpecker"
                            ? "Woodpecker"
                            : trainingT("Training.Copy.Guided.57bd258f", "Guided")}
                        </Badge>
                        <Badge size="sm" color="blue" variant="light">
                          {ratingLabel(set, trainingT)}
                        </Badge>
                        {set.origin === "bundled" && (
                          <Badge size="sm" color="teal">
                            {" "}
                            {trainingT("Training.Copy.Included.384f88d5", "Included")}{" "}
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed" mt="sm">
                        {progress.incorrect}{" "}
                        {trainingT("Training.Copy.mistakes.5c65c76e", "mistakes ·")}{" "}
                        {set.progress.cycles.length}{" "}
                        {trainingT("Training.Copy.cycles.5d205153", "cycles")}{" "}
                        {lastCycle
                          ? trainingT(
                              "Training.Copy.lastv0mistakes.35e6e46a",
                              " · last: {{v0}} mistakes",
                              { v0: lastCycle.failures },
                            )
                          : ""}
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
                            ? trainingT(
                                "Training.Copy.Startcyclev0.4952ee6f",
                                "Start cycle {{v0}}",
                                { v0: set.progress.cycles.length + 1 },
                              )
                            : trainingT("Training.Copy.Startcycle1.1f37b857", "Start cycle 1")
                          : progress.attempted > 0
                            ? trainingT(
                                "Training.Copy.Continueatpuzzlev0.e476dc9b",
                                "Continue at puzzle {{v0}}",
                                { v0: resume + 1 },
                              )
                            : trainingT("Training.Copy.Startset.88c407a1", "Start set")}
                      </Button>
                      <Group grow>
                        <Button
                          variant="default"
                          leftSection={<IconEye size={16} />}
                          onClick={() => review(set.id)}
                        >
                          {" "}
                          {trainingT("Training.Copy.Review.52fadddb", "Review")}{" "}
                        </Button>
                        <Button
                          variant="default"
                          leftSection={<IconSettings size={16} />}
                          onClick={() => editSet(set)}
                        >
                          {" "}
                          {trainingT("Training.Copy.Configure.d685ddb9", "Configure")}{" "}
                        </Button>
                        {set.origin === "user" && (
                          <ActionIcon
                            size={36}
                            color="red"
                            variant="subtle"
                            aria-label={trainingT(
                              "Training.Copy.Deletev0.8fd0a297",
                              "Delete {{v0}}",
                              { v0: set.name },
                            )}
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
                  <Text fw={600}>
                    {trainingT(
                      "Training.Copy.Installedpuzzledatabases.0a978ef7",
                      "Installed puzzle databases",
                    )}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {" "}
                    {trainingT(
                      "Training.Copy.Trainwithyourlocaldatabases.45bd0460",
                      "Train with your local databases and filters.",
                    )}{" "}
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
              {" "}
              {trainingT(
                "Training.Copy.Opendatabasetrainer.54b0961e",
                "Open database trainer",
              )}{" "}
            </Button>
          </Stack>
        </Card>

        <Card withBorder>
          <Stack>
            <Group>
              <IconUpload size={26} color="var(--mantine-color-orange-6)" />
              <div>
                <Text fw={600}>
                  {trainingT(
                    "Training.Copy.ImportanotherPGNset.1d885849",
                    "Import another PGN set",
                  )}
                </Text>
                <Text size="sm" c="dimmed">
                  {" "}
                  {trainingT(
                    "Training.Copy.Reviewasamplebeforeadding.624433b2",
                    "Review a sample before adding it; the file is read on demand.",
                  )}{" "}
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 2, lg: 4 }}>
              <TextInput
                label={trainingT("Training.Copy.Name.562bb157", "Name")}
                value={setName}
                onChange={(event) => setSetName(event.currentTarget.value)}
              />
              <TextInput
                label={trainingT("Training.Copy.Description.ee00b96f", "Description")}
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
              <NumberInput
                label={trainingT("Training.Copy.MinimumELO.8f4b3e52", "Minimum ELO")}
                placeholder={trainingT("Training.Copy.Optional.a6e63474", "Optional")}
                min={0}
                value={ratingMin}
                onChange={setRatingMin}
              />
              <NumberInput
                label={trainingT("Training.Copy.MaximumELO.86ea8125", "Maximum ELO")}
                placeholder={trainingT("Training.Copy.Optional.a6e63474", "Optional")}
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
              {" "}
              {trainingT("Training.Copy.SelectPGN.c64242a6", "Select PGN")}{" "}
            </Button>
          </Stack>
        </Card>
      </Stack>

      <Modal
        opened={inspection !== null}
        onClose={() => setInspection(null)}
        title={trainingT("Training.Copy.Reviewimport.fdac9a14", "Review import")}
        size="lg"
      >
        {inspection && (
          <Stack>
            <Alert color={sampleErrors > 0 ? "yellow" : "blue"}>
              {inspection.recordCount.toLocaleString()}{" "}
              {trainingT("Training.Copy.puzzlesInthesample.8d658c6e", "puzzles. In the sample:")}{" "}
              {sampleSolutions}{" "}
              {trainingT("Training.Copy.withsolutions.9969c715", "with solutions,")}{" "}
              {sampleVariations}{" "}
              {trainingT("Training.Copy.withvariationsand.e3e62542", "with variations and")}{" "}
              {sampleErrors} {trainingT("Training.Copy.invalid.1ca85cf6", "invalid.")}{" "}
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
                          ? trainingT("Training.Copy.v0plies.b7fec1eb", "{{v0}} plies", {
                              v0: sample.moveCount,
                            })
                          : trainingT(
                              "Training.Copy.Nopreparedsolution.2ac57fbb",
                              "No prepared solution",
                            ))}
                    </Text>
                  </Card>
                ))}
              </Stack>
            </ScrollArea>
            <TacticsConfigFields config={draftConfig} onChange={setDraftConfig} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setInspection(null)}>
                {" "}
                {trainingT("Training.Copy.Cancel.bb9dbb40", "Cancel")}{" "}
              </Button>
              <Button color="orange" onClick={confirmImport}>
                {" "}
                {trainingT("Training.Copy.Importset.ea3b85ed", "Import set")}{" "}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={editingSetId !== null}
        onClose={() => setEditingSetId(null)}
        title={trainingT("Training.Copy.Configureset.2cabbadb", "Configure set")}
        size="lg"
      >
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label={trainingT("Training.Copy.Name.562bb157", "Name")}
              value={draftName}
              onChange={(event) => setDraftName(event.currentTarget.value)}
            />
            <TextInput
              label={trainingT("Training.Copy.Description.ee00b96f", "Description")}
              value={draftDescription}
              onChange={(event) => setDraftDescription(event.currentTarget.value)}
            />
            <NumberInput
              label={trainingT("Training.Copy.MinimumELO.8f4b3e52", "Minimum ELO")}
              placeholder={trainingT("Training.Copy.Optional.a6e63474", "Optional")}
              min={0}
              value={draftRatingMin}
              onChange={setDraftRatingMin}
            />
            <NumberInput
              label={trainingT("Training.Copy.MaximumELO.86ea8125", "Maximum ELO")}
              placeholder={trainingT("Training.Copy.Optional.a6e63474", "Optional")}
              min={0}
              value={draftRatingMax}
              onChange={setDraftRatingMax}
            />
          </SimpleGrid>
          <TacticsConfigFields config={draftConfig} onChange={setDraftConfig} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditingSetId(null)}>
              {" "}
              {trainingT("Training.Copy.Cancel.bb9dbb40", "Cancel")}{" "}
            </Button>
            <Button color="orange" disabled={!draftName.trim()} onClick={saveSettings}>
              {" "}
              {trainingT("Training.Copy.Save.13e51a21", "Save")}{" "}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={reviewSetId !== null}
        onClose={() => setReviewSetId(null)}
        title={
          reviewSet
            ? trainingT("Training.Copy.Reviewv0.1225646c", "Review · {{v0}}", {
                v0: reviewSet.name,
              })
            : trainingT("Training.Copy.Reviewset.80a50582", "Review set")
        }
        size="xl"
      >
        {reviewSet && (
          <Stack>
            <SegmentedControl
              fullWidth
              value={reviewView}
              onChange={(value) => setReviewView(value as "list" | "detail")}
              data={[
                { value: "list", label: trainingT("Training.Copy.PGNlist.ae6d1c72", "PGN list") },
                {
                  value: "detail",
                  label: trainingT("Training.Copy.Detailsandboard.97f9fbdf", "Details and board"),
                },
              ]}
            />
            {reviewView === "list" ? (
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    {reviewSet.config.mode === "woodpecker"
                      ? trainingT(
                          "Training.Copy.Completedincyclev0v1.5c3dbffb",
                          "Completed in cycle {{v0}}: {{v1}}",
                          { v0: reviewCycleNumber, v1: reviewCompletedIndexes.length },
                        )
                      : trainingT("Training.Copy.Completedv0.03311aa2", "Completed: {{v0}}", {
                          v0: reviewCompletedIndexes.length,
                        })}
                  </Text>
                  <Badge>
                    {reviewTotal} {trainingT("Training.Copy.puzzles.29f0f1a4", "puzzles")}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  {" "}
                  {trainingT(
                    "Training.Copy.Selectanyrecordtoopen.e9e71457",
                    "Select any record to open it on the board. Exploring other puzzles does not change your resume point.",
                  )}{" "}
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
                            {embeddedExercise?.title ||
                              trainingT("Training.Copy.Puzzlev0.c9ca2375", "Puzzle {{v0}}", {
                                v0: problemIndex + 1,
                              })}
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
                      label={trainingT("Training.Copy.Puzzle.cc6c1a06", "Puzzle")}
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
                    {reviewIndex + 1} {trainingT("Training.Copy.of.959a45d4", "of")} {reviewTotal}
                  </Badge>
                </Group>
                {reviewLoading ? (
                  <Text c="dimmed">
                    {trainingT("Training.Copy.Loadingpuzzle.f51a73af", "Loading puzzle…")}
                  </Text>
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
                          {" "}
                          {trainingT(
                            "Training.Copy.Parsedsolutions.e4a6ad63",
                            "Parsed solutions",
                          )}{" "}
                        </Text>
                        {reviewExercise.solutionLines.length > 0 ? (
                          reviewExercise.solutionLines.map((line, index) => (
                            <Code key={`${reviewExercise.id}-${index}`} block mt={4}>
                              {line.join(" ")}
                            </Code>
                          ))
                        ) : (
                          <Text size="sm" c="dimmed">
                            {" "}
                            {trainingT(
                              "Training.Copy.Nopreparedsolutionanengine.1544feda",
                              "No prepared solution; an engine is required.",
                            )}{" "}
                          </Text>
                        )}
                      </div>
                      <Text size="sm">
                        {reviewAttempts.filter((a) => a.outcome === "correct").length}{" "}
                        {trainingT("Training.Copy.correct.a2ea3fbc", "correct ·")}{" "}
                        {reviewAttempts.filter((a) => a.outcome === "incorrect").length}{" "}
                        {trainingT("Training.Copy.mistakes.5fb1604c", "mistakes")}{" "}
                      </Text>
                      <Button
                        leftSection={<IconPlayerPlay size={16} />}
                        onClick={() => practiceReviewedProblem(reviewIndex)}
                      >
                        {" "}
                        {trainingT(
                          "Training.Copy.Practicethispuzzle.9d0effd1",
                          "Practice this puzzle",
                        )}{" "}
                      </Button>
                    </Stack>
                    <Textarea
                      label={trainingT("Training.Copy.PGNrecord.f7296c15", "PGN record")}
                      readOnly
                      autosize
                      minRows={15}
                      maxRows={24}
                      value={
                        reviewExercise.sourcePgn ||
                        trainingT(
                          "Training.Copy.NoPGNtexthasbeen.d994de65",
                          "No PGN text has been saved.",
                        )
                      }
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
        title={trainingT("Training.Copy.Deleteset.0d8bbde1", "Delete set")}
        size="sm"
      >
        <Stack>
          <Text size="sm">
            {" "}
            {trainingT(
              "Training.Copy.Progresscyclesandattemptswill.331b07ea",
              "Progress, cycles, and attempts will be deleted. The original PGN remains untouched.",
            )}{" "}
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
              {" "}
              {trainingT("Training.Copy.Reviewfirst.15a9aa85", "Review first")}{" "}
            </Button>
            <Button color="red" onClick={removeSet}>
              {" "}
              {trainingT("Training.Copy.Deleteset.0d8bbde1", "Delete set")}{" "}
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
  const { t: trainingT } = useTrainingTranslation();

  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Select
          label={trainingT("Training.Copy.Firstmove.5f131f9a", "First move")}
          value={config.startingActor}
          data={[
            {
              value: "student",
              label: trainingT("Training.Copy.Thestudent.5c566d78", "The student"),
            },
            {
              value: "opponent",
              label: trainingT("Training.Copy.Theopponent.16ea601a", "The opponent"),
            },
          ]}
          onChange={(value) =>
            value &&
            onChange({ ...config, startingActor: value as TacticsSet["config"]["startingActor"] })
          }
        />
        <Select
          label={trainingT("Training.Copy.Variations.64774cce", "Variations")}
          value={config.variationPolicy}
          data={[
            { value: "mainline", label: trainingT("Training.Copy.Mainline.49e68e3d", "Main line") },
            {
              value: "opponentResponses",
              label: trainingT("Training.Copy.Opponentresponses.999dc9d0", "Opponent responses"),
            },
            { value: "all", label: trainingT("Training.Copy.All.aff4d19d", "All") },
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
          label={trainingT("Training.Copy.Validation.c1e3865f", "Validation")}
          value={config.validationMode}
          data={[
            { value: "auto", label: trainingT("Training.Copy.Automatic.e51e19df", "Automatic") },
            {
              value: "prepared",
              label: trainingT("Training.Copy.PGNsolution.c4ca9361", "PGN solution"),
            },
            { value: "engine", label: trainingT("Training.Copy.Engine.b25a14f2", "Engine") },
          ]}
          onChange={(value) =>
            value &&
            onChange({ ...config, validationMode: value as TacticsSet["config"]["validationMode"] })
          }
        />
        <Select
          label={trainingT("Training.Copy.Type.3868d284", "Type")}
          value={config.mode}
          data={[
            { value: "guided", label: trainingT("Training.Copy.Guided.57bd258f", "Guided") },
            { value: "woodpecker", label: "Woodpecker" },
          ]}
          onChange={(value) =>
            value && onChange({ ...config, mode: value as TacticsSet["config"]["mode"] })
          }
        />
      </SimpleGrid>
      <Group justify="space-between">
        <Text size="sm">
          {trainingT(
            "Training.Copy.Alternativemovetolerance.c8f821d8",
            "Alternative move tolerance",
          )}
        </Text>
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
          {" "}
          {trainingT(
            "Training.Copy.Cyclesrecordtimeandmistakes.24fef14e",
            "Cycles record time and mistakes but do not end at a limit.",
          )}{" "}
        </Text>
      )}
    </Stack>
  );
}
