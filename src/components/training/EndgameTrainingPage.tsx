import { useTranslation as useTrainingTranslation } from "react-i18next";
import i18n from "i18next";
import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Group,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { resolveResource } from "@tauri-apps/api/path";
import { readTextFile } from "@tauri-apps/plugin-fs";
import {
  IconArrowLeft,
  IconChess,
  IconDatabase,
  IconPlayerPlay,
  IconSearch,
  IconUpload,
} from "@tabler/icons-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  activeTabAtom,
  enginesAtom,
  gameInputColorAtom,
  gamePlayer1SettingsAtom,
  gamePlayer2SettingsAtom,
  tabsAtom,
} from "@/state/atoms";
import { trainingAreasAtom } from "@/state/trainingAreas";
import { getTablebaseInfo } from "@/utils/lichess/api";
import {
  addEndgameSet,
  installBundledEndgameSets,
  parseTrainingRecords,
  updateEndgameObjective,
  type TrainingObjective,
} from "@/utils/trainingAreas";
import { launchTrainingPosition } from "@/utils/trainingLaunch";
import { isMaiaEngine, MAIA_ELO_MAX } from "@/utils/humanBots";
import type { LocalEngine } from "@/utils/engines";
import { positionFromFen } from "@/utils/chessops";

const BUNDLED_ENDGAMES_VERSION = 1;
const bundledEndgameFiles = [
  {
    file: "FinalesParte1.pgn",
    name: i18n.t("Training.Copy.IncludedendgamesPart1.76ed183d", "Included endgames · Part 1"),
  },
  {
    file: "FinalesParte2.pgn",
    name: i18n.t("Training.Copy.IncludedendgamesPart2.f1372136", "Included endgames · Part 2"),
  },
  {
    file: "FinalesParte3.pgn",
    name: i18n.t("Training.Copy.IncludedendgamesPart3.2717b8d0", "Included endgames · Part 3"),
  },
];

function filename(path: string, trainingT: typeof i18n.t = i18n.t): string {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || trainingT("Training.Copy.Endgameset.cb6b7408", "Endgame set")
  );
}

function objectiveFromTablebase(category: string): TrainingObjective {
  if (category === "win") return "win";
  if (category === "loss") return "loss";
  if (["draw", "blessed-loss", "cursed-win"].includes(category)) return "draw";
  return "unknown";
}

function objectiveLabel(objective: TrainingObjective, trainingT: typeof i18n.t = i18n.t): string {
  return {
    win: trainingT("Training.Copy.Winning.2ba628ca", "Winning"),
    draw: trainingT("Training.Copy.Draw.9c0dd07e", "Draw"),
    loss: trainingT("Training.Copy.Losing.471dde97", "Losing"),
    unknown: trainingT("Training.Copy.Pending.2ef68536", "Pending"),
  }[objective];
}

export default function EndgameTrainingPage() {
  const { t: trainingT } = useTrainingTranslation();

  const navigate = useNavigate();
  const [areas, setAreas] = useAtom(trainingAreasAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const storedEngines = useAtomValue(enginesAtom);
  const engines = useMemo(() => storedEngines ?? [], [storedEngines]);
  const setInputColor = useSetAtom(gameInputColorAtom);
  const setPlayer1 = useSetAtom(gamePlayer1SettingsAtom);
  const setPlayer2 = useSetAtom(gamePlayer2SettingsAtom);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; color?: string } | null>(null);
  const [resolvingSetId, setResolvingSetId] = useState<string | null>(null);
  const [opponentMode, setOpponentMode] = useState<"maia" | "stockfish">("maia");
  const bundledLoadStarted = useRef(false);
  const sets = useMemo(() => Object.values(areas.endgames.sets), [areas.endgames.sets]);
  const localEngines = useMemo(
    () =>
      engines.filter(
        (engine): engine is LocalEngine =>
          engine.type === "local" && Boolean(engine.path) && Boolean(engine.loaded),
      ),
    [engines],
  );
  const maiaEngine = localEngines.find(isMaiaEngine) ?? null;
  const stockfishEngine =
    localEngines.find((engine) => !isMaiaEngine(engine) && /stockfish/i.test(engine.name)) ??
    localEngines.find((engine) => !isMaiaEngine(engine)) ??
    null;
  const selectedEngine = opponentMode === "maia" ? maiaEngine : stockfishEngine;

  useEffect(() => {
    if (
      areas.endgames.bundledContentVersion >= BUNDLED_ENDGAMES_VERSION ||
      bundledLoadStarted.current
    ) {
      return;
    }
    bundledLoadStarted.current = true;

    Promise.all(
      bundledEndgameFiles.map(async ({ file, name }) => {
        const path = await resolveResource(`training/endgames/${file}`);
        const records = await parseTrainingRecords(await readTextFile(path), {
          requireExplicitFen: true,
          skipInvalid: true,
        });
        return {
          name,
          description: trainingT(
            "Training.Copy.Endgameexercisecollectionincludedwith.8f12d13f",
            "Endgame exercise collection included with Chess Lab.",
          ),
          records,
        };
      }),
    )
      .then((bundles) => {
        setAreas((previous) => ({
          ...previous,
          endgames: installBundledEndgameSets(previous.endgames, bundles, BUNDLED_ENDGAMES_VERSION),
        }));
      })
      .catch((error) => {
        bundledLoadStarted.current = false;
        setFeedback({
          text:
            error instanceof Error
              ? trainingT(
                  "Training.Copy.Couldnotloadtheincluded.7eb2aefd",
                  "Could not load the included endgames: {{v0}}",
                  { v0: error.message },
                )
              : trainingT(
                  "Training.Copy.Couldnotloadtheincluded.1cc90b12",
                  "Could not load the included endgames.",
                ),
          color: "yellow",
        });
      });
  }, [areas.endgames.bundledContentVersion, setAreas, trainingT]);

  async function importSet() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PGN de estudio", extensions: ["pgn"] }],
    });
    if (typeof selected !== "string") return;

    try {
      const usable = await parseTrainingRecords(await readTextFile(selected), {
        requireExplicitFen: true,
        skipInvalid: true,
      });
      if (usable.length === 0) {
        throw new Error(
          trainingT(
            "Training.Copy.ThePGNfilecontainsno.f5360ca6",
            "The PGN file contains no valid endgame positions.",
          ),
        );
      }
      const newSetName = name.trim() || filename(selected, trainingT);
      setAreas((previous) => ({
        ...previous,
        endgames: addEndgameSet(previous.endgames, newSetName, description.trim(), usable),
      }));
      setName("");
      setDescription("");
      setFeedback({
        text: trainingT(
          "Training.Copy.Setv0importedwithv1.f380ca3c",
          "Set “{{v0}}” imported with {{v1}} positions.",
          { v0: newSetName, v1: usable.length },
        ),
      });
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? error.message
            : trainingT(
                "Training.Copy.Couldnotimporttheendgame.74086f19",
                "Could not import the endgame set.",
              ),
        color: "red",
      });
    }
  }

  async function resolveObjectives(setId: string) {
    const set = areas.endgames.sets[setId];
    if (!set) return;
    setResolvingSetId(setId);
    let resolved = 0;
    let failed = 0;

    for (const positionId of set.positionIds) {
      const position = areas.endgames.positions[positionId];
      if (!position) continue;
      try {
        const data = await getTablebaseInfo(position.fen);
        setAreas((previous) => ({
          ...previous,
          endgames: updateEndgameObjective(
            previous.endgames,
            positionId,
            objectiveFromTablebase(data.category),
            "tablebase",
            data.category,
          ),
        }));
        resolved++;
      } catch {
        failed++;
      }
    }

    setResolvingSetId(null);
    setFeedback({
      text: trainingT(
        "Training.Copy.Objectivescalculatedv0v1.04e87083",
        "Objectives calculated: {{v0}}{{v1}}.",
        {
          v0: resolved,
          v1:
            failed > 0
              ? trainingT(
                  "Training.Copy.v0positionscouldnotbe.4408c8db",
                  "; {{v0}} positions could not be queried",
                  { v0: failed },
                )
              : "",
        },
      ),
      color: failed > 0 ? "yellow" : undefined,
    });
  }

  function setManualObjective(positionId: string, value: string | null) {
    if (!value) return;
    setAreas((previous) => ({
      ...previous,
      endgames: updateEndgameObjective(
        previous.endgames,
        positionId,
        value as TrainingObjective,
        "manual",
      ),
    }));
  }

  async function playPosition(fen: string, title: string) {
    if (!selectedEngine) {
      setFeedback({
        text:
          opponentMode === "maia"
            ? trainingT(
                "Training.Copy.InstallandenableMaia3.6add00f5",
                "Install and enable Maia 3 in Engines, or select Stockfish to practice.",
              )
            : trainingT(
                "Training.Copy.InstallandenableStockfishor.50c81377",
                "Install and enable Stockfish or another local reference engine to practice.",
              ),
        color: "yellow",
      });
      return;
    }
    const [position] = positionFromFen(fen);
    if (!position) {
      setFeedback({
        text: trainingT(
          "Training.Copy.TheFENpositionisinvalid.97da3f3f",
          "The FEN position is invalid.",
        ),
        color: "red",
      });
      return;
    }
    setInputColor(position.turn);
    setPlayer1({ type: "human", name: trainingT("Training.Copy.Student.789a6356", "Student") });
    setPlayer2({
      type: "engine",
      engine: selectedEngine,
      go: opponentMode === "maia" ? { t: "Depth", c: 1 } : { t: "Depth", c: 18 },
      presetId: opponentMode === "maia" ? "custom" : "strong",
      targetElo: opponentMode === "maia" ? MAIA_ELO_MAX : undefined,
    });
    await navigate({ to: "/" });
    await launchTrainingPosition({
      fen,
      name: title,
      type: "play",
      setTabs,
      setActiveTab,
      trainingArea: "endgames",
    });
  }

  async function analyzePosition(fen: string, title: string) {
    await navigate({ to: "/" });
    await launchTrainingPosition({
      fen,
      name: trainingT("Training.Copy.Analysisv0.b7ffacfd", "Analysis · {{v0}}", { v0: title }),
      type: "analysis",
      setTabs,
      setActiveTab,
      trainingArea: "endgames",
    });
  }

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
              {trainingT("Training.Copy.Endgametraining.d2c99939", "Endgame training")}
            </Title>
            <Text c="dimmed" mt={4}>
              {" "}
              {trainingT(
                "Training.Copy.Importendgamepositionsreviewtheir.a3642e04",
                "Import endgame positions, review their objectives, and practice against an engine.",
              )}{" "}
            </Text>
          </div>
        </Group>

        {feedback && (
          <Alert color={feedback.color} withCloseButton onClose={() => setFeedback(null)}>
            {feedback.text}
          </Alert>
        )}

        <Card withBorder>
          <Stack>
            <Group>
              <IconUpload size={24} color="var(--mantine-color-teal-6)" />
              <div>
                <Text fw={600}>
                  {trainingT(
                    "Training.Copy.ImportpositionsfromaPGN.638cfea3",
                    "Import positions from a PGN file",
                  )}
                </Text>
                <Text size="sm" c="dimmed">
                  {" "}
                  {trainingT(
                    "Training.Copy.SelectaPGNfilewith.ff6f836f",
                    "Select a PGN file with an initial FEN for each exercise. Objectives can be reviewed after importing the set.",
                  )}{" "}
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <TextInput
                label={trainingT("Training.Copy.Setname.a54101c6", "Set name")}
                placeholder={trainingT(
                  "Training.Copy.egRookendgames.022e2591",
                  "e.g. Rook endgames",
                )}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <TextInput
                label={trainingT("Training.Copy.Description.ee00b96f", "Description")}
                placeholder={trainingT("Training.Copy.Sourceortheme.dc40af1d", "Source or theme")}
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
            </SimpleGrid>
            <Button color="teal" leftSection={<IconUpload size={16} />} onClick={importSet}>
              {" "}
              {trainingT("Training.Copy.SelectPGNfile.ab7fed1d", "Select PGN file")}{" "}
            </Button>
          </Stack>
        </Card>

        <Card withBorder>
          <Group justify="space-between" align="flex-end">
            <div>
              <Text fw={600}>
                {trainingT("Training.Copy.Practiceopponent.95f64dc7", "Practice opponent")}
              </Text>
              <Text size="sm" c="dimmed" maw={720}>
                {" "}
                {trainingT(
                  "Training.Copy.Chooseanenginetopractice.d8d32e9f",
                  "Choose an engine to practice against. Your color is determined by the position's side to move.",
                )}{" "}
              </Text>
            </div>
            <Select
              w={260}
              label={trainingT("Training.Copy.Defaultengine.4d45d471", "Default engine")}
              value={opponentMode}
              data={[
                {
                  value: "maia",
                  label: maiaEngine
                    ? trainingT("Training.Copy.MaximumMaiav0.32eb5b83", "Maximum Maia · {{v0}}", {
                        v0: maiaEngine.name,
                      })
                    : trainingT(
                        "Training.Copy.MaximumMaianotinstalled.5c70de40",
                        "Maximum Maia · not installed",
                      ),
                },
                {
                  value: "stockfish",
                  label: stockfishEngine
                    ? `Stockfish · ${stockfishEngine.name}`
                    : trainingT(
                        "Training.Copy.Stockfishnotinstalled.d234d3e2",
                        "Stockfish · not installed",
                      ),
                },
              ]}
              onChange={(value) => value && setOpponentMode(value as typeof opponentMode)}
            />
          </Group>
          {!selectedEngine && (
            <Alert color="yellow" mt="md">
              {" "}
              {trainingT(
                "Training.Copy.Theselectedengineisnot.ab4dae7e",
                "The selected engine is not installed or active. Choose another engine or configure it in Engines.",
              )}{" "}
            </Alert>
          )}
        </Card>

        {sets.length === 0 ? (
          <Card withBorder>
            <Stack align="center" py="xl">
              <IconChess size={42} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">
                {trainingT("Training.Copy.Noendgamesetsyet.fb488ba1", "No endgame sets yet.")}
              </Text>
            </Stack>
          </Card>
        ) : (
          sets.map((set) => {
            const positions = set.positionIds
              .map((id) => areas.endgames.positions[id])
              .filter((position): position is NonNullable<typeof position> => Boolean(position));
            const resolving = resolvingSetId === set.id;
            return (
              <Card key={set.id} withBorder>
                <Stack>
                  <Group justify="space-between" align="flex-start">
                    <div>
                      <Title order={4}>{set.name}</Title>
                      <Text size="sm" c="dimmed" mt={4}>
                        {set.description ||
                          trainingT(
                            "Training.Copy.Availableendgameexercises.7a390c26",
                            "Available endgame exercises.",
                          )}
                      </Text>
                    </div>
                    <Badge color="teal" variant="light">
                      {positions.length}{" "}
                      {trainingT("Training.Copy.positions.2aa0f225", "positions")}{" "}
                    </Badge>
                  </Group>
                  <Group>
                    <Button
                      color="teal"
                      variant="light"
                      leftSection={<IconDatabase size={16} />}
                      loading={resolving}
                      onClick={() => resolveObjectives(set.id)}
                    >
                      {" "}
                      {trainingT(
                        "Training.Copy.Calculateobjectives.7219a82e",
                        "Calculate objectives",
                      )}{" "}
                    </Button>
                    {resolving && (
                      <Text size="sm" c="dimmed">
                        {" "}
                        {trainingT(
                          "Training.Copy.Queryingtablebase.5fa95349",
                          "Querying tablebase…",
                        )}{" "}
                      </Text>
                    )}
                  </Group>
                  <ScrollArea h={Math.min(420, Math.max(120, positions.length * 76))}>
                    <Stack gap="xs">
                      {positions.map((position, index) => (
                        <Group key={position.id} justify="space-between" wrap="nowrap">
                          <Group gap="xs" wrap="nowrap">
                            <Badge variant="outline">{index + 1}</Badge>
                            <div>
                              <Text size="sm" fw={500}>
                                {position.title}
                              </Text>
                              <Text size="xs" c="dimmed" ff="monospace" truncate maw={420}>
                                {position.fen}
                              </Text>
                            </div>
                          </Group>
                          <Group gap="xs" wrap="nowrap">
                            <Select
                              w={105}
                              size="xs"
                              value={position.objective}
                              data={[
                                {
                                  value: "unknown",
                                  label: trainingT("Training.Copy.Pending.2ef68536", "Pending"),
                                },
                                {
                                  value: "win",
                                  label: trainingT("Training.Copy.Winning.2ba628ca", "Winning"),
                                },
                                {
                                  value: "draw",
                                  label: trainingT("Training.Copy.Draw.9c0dd07e", "Draw"),
                                },
                                {
                                  value: "loss",
                                  label: trainingT("Training.Copy.Losing.471dde97", "Losing"),
                                },
                              ]}
                              onChange={(value) => setManualObjective(position.id, value)}
                            />
                            <Badge
                              color={position.objectiveSource === "manual" ? "yellow" : "gray"}
                            >
                              {objectiveLabel(position.objective, trainingT)}
                            </Badge>
                            <Button
                              size="xs"
                              variant="subtle"
                              leftSection={<IconSearch size={14} />}
                              onClick={() => analyzePosition(position.fen, position.title)}
                            >
                              {" "}
                              {trainingT("Training.Copy.Analyze.67ffbe0d", "Analyze")}{" "}
                            </Button>
                            <Button
                              size="xs"
                              variant="subtle"
                              leftSection={<IconPlayerPlay size={14} />}
                              onClick={() => playPosition(position.fen, position.title)}
                            >
                              {" "}
                              {trainingT("Training.Copy.Play.b61eda6f", "Play")}{" "}
                            </Button>
                          </Group>
                        </Group>
                      ))}
                    </Stack>
                  </ScrollArea>
                </Stack>
              </Card>
            );
          })
        )}
      </Stack>
    </Container>
  );
}
