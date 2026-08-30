// @ts-nocheck -- Legacy page kept temporarily while the redesigned route is validated.
import { useTranslation as useTrainingTranslation } from "react-i18next";
import i18n from "i18next";
import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  IconArrowLeft,
  IconDatabase,
  IconPlayerPlay,
  IconPuzzle,
  IconSettings,
  IconUpload,
} from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import type { PuzzleDatabaseInfo } from "@/bindings";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { trainingAreasAtom } from "@/state/trainingAreas";
import { getPuzzleDatabases } from "@/utils/puzzles";
import {
  addTacticsFileSet,
  getTacticsSetProgress,
  updateTacticsSetConfig,
  type TacticsSet,
} from "@/utils/trainingAreas";
import { inspectTacticsPgn, type TacticsPgnInspection } from "@/utils/tacticsTraining";
import { createTab } from "@/utils/tabs";

const defaultConfig: TacticsSet["config"] = {
  acceptanceThresholdCp: 30,
  mode: "guided",
  maxFailuresPerCycle: 3,
  timeLimitSeconds: null,
  startingActor: "student",
  variationPolicy: "opponentResponses",
  validationMode: "auto",
};

function filename(path: string, trainingT: typeof i18n.t = i18n.t): string {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || trainingT("Training.Copy.Tacticsset.e9b5f38c", "Tactics set")
  );
}

export default function TacticsDashboardPage() {
  const { t: trainingT } = useTrainingTranslation();

  const navigate = useNavigate();
  const [areas, setAreas] = useAtom(trainingAreasAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const [setName, setSetName] = useState("");
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; color?: string } | null>(null);
  const [inspection, setInspection] = useState<TacticsPgnInspection | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [draftConfig, setDraftConfig] = useState<TacticsSet["config"]>(defaultConfig);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [puzzleDbs, setPuzzleDbs] = useState<PuzzleDatabaseInfo[]>([]);
  const sets = useMemo(() => Object.values(areas.tactics.sets), [areas.tactics.sets]);

  useEffect(() => {
    void getPuzzleDatabases()
      .then(setPuzzleDbs)
      .catch(() => setPuzzleDbs([]));
  }, []);

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
      const nextInspection = await inspectTacticsPgn(selected, draftConfig);
      if (nextInspection.recordCount === 0) {
        throw new Error(
          trainingT(
            "Training.Copy.ThefilecontainsnoPGN.40a99062",
            "The file contains no PGN exercises.",
          ),
        );
      }
      setInspection(nextInspection);
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
      }),
    }));
    setInspection(null);
    setSetName("");
    setDescription("");
    setDraftConfig(defaultConfig);
    setFeedback({
      text: trainingT(
        "Training.Copy.Setv0linkedtov1.f993ae7d",
        "Set “{{v0}}” linked to {{v1}} exercises without duplicating the PGN.",
        { v0: name, v1: inspection.recordCount.toLocaleString() },
      ),
    });
  }

  function openSetSettings(set: TacticsSet) {
    setEditingSetId(set.id);
    setDraftConfig(set.config);
  }

  function saveSetSettings() {
    if (!editingSetId) return;
    setAreas((previous) => ({
      ...previous,
      tactics: updateTacticsSetConfig(previous.tactics, editingSetId, draftConfig),
    }));
    setEditingSetId(null);
    setDraftConfig(defaultConfig);
  }

  const sampleWithSolutions =
    inspection?.samples.filter((sample) => sample.hasSolution).length ?? 0;
  const sampleWithVariations =
    inspection?.samples.filter((sample) => sample.hasVariations).length ?? 0;
  const sampleErrors = inspection?.samples.filter((sample) => sample.error).length ?? 0;

  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group align="flex-start">
          <Button
            component={Link}
            to="/training"
            variant="subtle"
            p="xs"
            aria-label={trainingT("Training.Copy.Backtotraining.f928bfe5", "Back to training")}
          >
            <IconArrowLeft size={20} />
          </Button>
          <div>
            <Title order={2}>
              {trainingT("Training.Copy.Tacticstraining.8816b222", "Tactics training")}
            </Title>
            <Text c="dimmed" mt={4}>
              {" "}
              {trainingT(
                "Training.Copy.Chooseadatabaseorset.18bbc9dc",
                "Choose a database or set to start practicing.",
              )}{" "}
            </Text>
          </div>
        </Group>

        {feedback && (
          <Alert color={feedback.color} withCloseButton onClose={() => setFeedback(null)}>
            {feedback.text}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Card withBorder>
            <Stack h="100%" justify="space-between">
              <div>
                <Group justify="space-between">
                  <Group>
                    <IconDatabase size={26} color="var(--mantine-color-orange-6)" />
                    <Text fw={600}>
                      {trainingT(
                        "Training.Copy.Installedpuzzledatabases.0a978ef7",
                        "Installed puzzle databases",
                      )}
                    </Text>
                  </Group>
                  <Badge color="orange" variant="light">
                    {puzzleDbs.length}
                  </Badge>
                </Group>
                <Text size="sm" c="dimmed" mt="sm">
                  {" "}
                  {trainingT(
                    "Training.Copy.Practiceinstalledpuzzlesusinglevel.f21404af",
                    "Practice installed puzzles using level, theme, hint, time, and history filters.",
                  )}{" "}
                </Text>
                {puzzleDbs.length > 0 && (
                  <Text size="xs" c="dimmed" mt="xs">
                    {puzzleDbs.map((database) => database.title.replace(/\.db3$/i, "")).join(" · ")}
                  </Text>
                )}
              </div>
              <Button
                mt="md"
                leftSection={<IconPlayerPlay size={16} />}
                onClick={openLichessTrainer}
              >
                {" "}
                {trainingT(
                  "Training.Copy.Trainwithaninstalleddatabase.5e5c89c3",
                  "Train with an installed database",
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
                    {trainingT("Training.Copy.ImportPGNset.6076cae9", "Import PGN set")}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {" "}
                    {trainingT(
                      "Training.Copy.Reviewafilesamplebefore.7499d1c1",
                      "Review a file sample before creating the set. Exercises load as you practice them.",
                    )}{" "}
                  </Text>
                </div>
              </Group>
              <SimpleGrid cols={{ base: 1, md: 2 }}>
                <TextInput
                  label={trainingT("Training.Copy.Setname.a54101c6", "Set name")}
                  placeholder={trainingT(
                    "Training.Copy.egCalculationtactics.73de31ea",
                    "e.g. Calculation tactics",
                  )}
                  value={setName}
                  onChange={(event) => setSetName(event.currentTarget.value)}
                />
                <TextInput
                  label={trainingT("Training.Copy.Description.ee00b96f", "Description")}
                  placeholder="Origen, nivel o tema"
                  value={description}
                  onChange={(event) => setDescription(event.currentTarget.value)}
                />
              </SimpleGrid>
              <Button
                leftSection={<IconUpload size={16} />}
                color="orange"
                loading={importBusy}
                onClick={selectImportFile}
              >
                {" "}
                {trainingT("Training.Copy.SelectPGNfile.ab7fed1d", "Select PGN file")}{" "}
              </Button>
            </Stack>
          </Card>
        </SimpleGrid>

        <div>
          <Title order={3}>
            {trainingT("Training.Copy.Availablesets.d6d3e738", "Available sets")}
          </Title>
          <Text size="sm" c="dimmed">
            {" "}
            {trainingT(
              "Training.Copy.Eachsethasitsown.f92c14b2",
              "Each set has its own content and practice settings.",
            )}{" "}
          </Text>
        </div>

        {sets.length === 0 ? (
          <Card withBorder>
            <Stack align="center" py="xl">
              <IconPuzzle size={42} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">
                {trainingT("Training.Copy.Nopersonalsetsyet.621db003", "No personal sets yet.")}
              </Text>
            </Stack>
          </Card>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }}>
            {sets.map((set) => {
              const progress = getTacticsSetProgress(areas.tactics, set.id);
              return (
                <Card key={set.id} withBorder>
                  <Stack h="100%" justify="space-between">
                    <div>
                      <Group justify="space-between" align="flex-start">
                        <Title order={4}>{set.name}</Title>
                        <Badge color="orange" variant="light">
                          {progress.attempted}/{progress.total}
                        </Badge>
                      </Group>
                      <Text size="sm" c="dimmed" mt="xs" mih={42}>
                        {set.description ||
                          trainingT(
                            "Training.Copy.Tacticalpositionset.3fbbdb39",
                            "Tactical position set.",
                          )}
                      </Text>
                      <Text size="sm" mt="md">
                        {" "}
                        {trainingT("Training.Copy.Correct.6fb6bcb3", "Correct:")} {progress.correct}{" "}
                        {trainingT("Training.Copy.Incorrect.ffa38b68", "· Incorrect:")}{" "}
                        {progress.incorrect}
                      </Text>
                      <Group gap="xs" mt="xs">
                        <Badge size="sm" variant="outline">
                          {set.config.mode === "woodpecker"
                            ? "Woodpecker"
                            : trainingT("Training.Copy.Guided.57bd258f", "Guided")}
                        </Badge>
                        <Badge size="sm" variant="outline">
                          {set.config.variationPolicy === "mainline"
                            ? trainingT("Training.Copy.Mainline.49e68e3d", "Main line")
                            : set.config.variationPolicy === "opponentResponses"
                              ? trainingT(
                                  "Training.Copy.Opponentresponses.c5568328",
                                  "Opponent responses",
                                )
                              : trainingT("Training.Copy.Allvariations.73a76c59", "All variations")}
                        </Badge>
                      </Group>
                    </div>
                    <Group grow>
                      <Button
                        variant="default"
                        leftSection={<IconSettings size={16} />}
                        onClick={() => openSetSettings(set)}
                      >
                        {" "}
                        {trainingT("Training.Copy.Configure.d685ddb9", "Configure")}{" "}
                      </Button>
                      <Button
                        color="orange"
                        variant="light"
                        leftSection={<IconPlayerPlay size={16} />}
                        onClick={() =>
                          navigate({
                            to: "/training/tactics/practice/$setId",
                            params: { setId: set.id },
                            search: { problem: undefined },
                          })
                        }
                      >
                        {" "}
                        {trainingT("Training.Copy.Practice.5ab096b1", "Practice")}{" "}
                      </Button>
                    </Group>
                  </Stack>
                </Card>
              );
            })}
          </SimpleGrid>
        )}
      </Stack>

      <Modal
        opened={inspection !== null}
        onClose={() => setInspection(null)}
        title={trainingT("Training.Copy.Reviewtacticsimport.389e7722", "Review tactics import")}
        size="lg"
      >
        {inspection && (
          <Stack>
            <Alert color={sampleErrors > 0 ? "yellow" : "blue"}>
              <Text fw={600}>{inspection.filename}</Text>
              <Text size="sm">
                {inspection.recordCount.toLocaleString()}{" "}
                {trainingT(
                  "Training.Copy.exercisesInthesampleof.a40e3603",
                  "exercises. In the sample of",
                )}{" "}
                {inspection.samples.length}: {sampleWithSolutions}{" "}
                {trainingT("Training.Copy.withsolutions.9969c715", "with solutions,")}{" "}
                {sampleWithVariations}{" "}
                {trainingT("Training.Copy.withvariationsand.e3e62542", "with variations and")}{" "}
                {sampleErrors} {trainingT("Training.Copy.invalid.1ca85cf6", "invalid.")}{" "}
              </Text>
            </Alert>
            <div>
              <Text size="sm" fw={600} mb={6}>
                {" "}
                {trainingT("Training.Copy.Preview.c5341f19", "Preview")}{" "}
              </Text>
              <ScrollArea h={190} type="auto" offsetScrollbars>
                <Stack gap="xs" pr="sm">
                  {inspection.samples.map((sample) => (
                    <Card key={sample.index} withBorder padding="xs">
                      <Group justify="space-between" wrap="nowrap" align="flex-start">
                        <div style={{ minWidth: 0 }}>
                          <Text size="sm" fw={500} truncate>
                            {sample.index + 1}.{" "}
                            {sample.title ||
                              trainingT("Training.Copy.Recordv0.12f1f931", "Record {{v0}}", {
                                v0: sample.index + 1,
                              })}
                          </Text>
                          <Text size="xs" c={sample.error ? "red" : "dimmed"}>
                            {sample.error ||
                              (sample.hasSolution
                                ? trainingT(
                                    "Training.Copy.v0pliesinthefirst.b89fff64",
                                    "{{v0}} plies in the first solution",
                                    { v0: sample.moveCount },
                                  )
                                : trainingT(
                                    "Training.Copy.Positionwithoutasolutionengine.839760d8",
                                    "Position without a solution; engine validation will be used",
                                  ))}
                          </Text>
                        </div>
                        <Group gap={4} wrap="nowrap">
                          <Badge
                            size="xs"
                            color={sample.hasSolution ? "green" : "gray"}
                            variant="light"
                          >
                            {sample.hasSolution
                              ? trainingT("Training.Copy.Withaline.eec8f5d4", "With a line")
                              : trainingT("Training.Copy.FENonly.24feab59", "FEN only")}
                          </Badge>
                          {sample.hasVariations && (
                            <Badge size="xs" color="violet" variant="light">
                              {" "}
                              {trainingT("Training.Copy.Variations.64774cce", "Variations")}{" "}
                            </Badge>
                          )}
                        </Group>
                      </Group>
                    </Card>
                  ))}
                </Stack>
              </ScrollArea>
            </div>
            <TacticsConfigFields config={draftConfig} onChange={setDraftConfig} />
            <Text size="xs" c="dimmed">
              {" "}
              {trainingT(
                "Training.Copy.Opponentresponseskeepsbranchesthat.e7627508",
                "Opponent responses keeps branches that change the opponent's defense without treating the student's illustrative variations as solutions.",
              )}{" "}
            </Text>
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
          <TacticsConfigFields config={draftConfig} onChange={setDraftConfig} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditingSetId(null)}>
              {" "}
              {trainingT("Training.Copy.Cancel.bb9dbb40", "Cancel")}{" "}
            </Button>
            <Button color="orange" onClick={saveSetSettings}>
              {" "}
              {trainingT("Training.Copy.Save.13e51a21", "Save")}{" "}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
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
          label={trainingT(
            "Training.Copy.Whomakesthefirstmove.055d1845",
            "Who makes the first move?",
          )}
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
          label={trainingT("Training.Copy.Variationpolicy.8631777f", "Variation policy")}
          value={config.variationPolicy}
          data={[
            {
              value: "mainline",
              label: trainingT("Training.Copy.Mainlineonly.36b6c7af", "Main line only"),
            },
            {
              value: "opponentResponses",
              label: trainingT(
                "Training.Copy.Alternativeopponentresponses.bd92d6e1",
                "Alternative opponent responses",
              ),
            },
            {
              value: "all",
              label: trainingT("Training.Copy.Allvariations.73a76c59", "All variations"),
            },
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
            {
              value: "auto",
              label: trainingT(
                "Training.Copy.Automaticforeachrecord.d5ba30c4",
                "Automatic for each record",
              ),
            },
            {
              value: "prepared",
              label: trainingT(
                "Training.Copy.UseonlythePGNsolution.80441ac3",
                "Use only the PGN solution",
              ),
            },
            {
              value: "engine",
              label: trainingT("Training.Copy.Validatewithengine.6bee77c6", "Validate with engine"),
            },
          ]}
          onChange={(value) =>
            value &&
            onChange({ ...config, validationMode: value as TacticsSet["config"]["validationMode"] })
          }
        />
        <Select
          label={trainingT("Training.Copy.Mode.6efe5e3c", "Mode")}
          value={config.mode}
          data={[
            {
              value: "guided",
              label: trainingT("Training.Copy.Guidedsolving.88ac907a", "Guided solving"),
            },
            {
              value: "woodpecker",
              label: trainingT("Training.Copy.Woodpeckercycle.22479def", "Woodpecker cycle"),
            },
          ]}
          onChange={(value) =>
            value && onChange({ ...config, mode: value as TacticsSet["config"]["mode"] })
          }
        />
      </SimpleGrid>
      {config.mode === "woodpecker" && (
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <NumberInput
            label={trainingT(
              "Training.Copy.Maximummistakespercycle.45a66468",
              "Maximum mistakes per cycle",
            )}
            min={1}
            value={config.maxFailuresPerCycle}
            onChange={(value) =>
              onChange({ ...config, maxFailuresPerCycle: Math.max(1, Number(value) || 1) })
            }
          />
          <NumberInput
            label={trainingT(
              "Training.Copy.Cyclelimitinseconds.5d03684f",
              "Cycle limit in seconds",
            )}
            placeholder={trainingT("Training.Copy.Unlimited.553f5b2f", "Unlimited")}
            min={1}
            value={config.timeLimitSeconds ?? ""}
            onChange={(value) =>
              onChange({
                ...config,
                timeLimitSeconds: value === "" ? null : Math.max(1, Number(value)),
              })
            }
          />
        </SimpleGrid>
      )}
      <Group justify="space-between">
        <Text size="sm">
          {trainingT(
            "Training.Copy.Thresholdforengineevaluatedalternatives.ec4b9d86",
            "Threshold for engine-evaluated alternatives",
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
    </Stack>
  );
}
