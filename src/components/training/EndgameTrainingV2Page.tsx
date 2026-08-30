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
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { resolveResource } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import {
  IconArrowLeft,
  IconCheck,
  IconChess,
  IconChevronRight,
  IconDatabase,
  IconLock,
  IconPlayerPlay,
  IconSearch,
  IconTrash,
  IconTrophy,
  IconUpload,
} from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
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
import { positionFromFen } from "@/utils/chessops";
import type { LocalEngine } from "@/utils/engines";
import { isMaiaEngine, MAIA_ELO_MAX } from "@/utils/humanBots";
import { getTablebaseInfo } from "@/utils/lichess/api";
import { launchTrainingPosition } from "@/utils/trainingLaunch";
import {
  addEndgameSet,
  deleteEndgameSet,
  getEndgameSetProgress,
  installBundledEndgameSets,
  parseTrainingRecords,
  updateEndgameObjective,
  type EndgamePosition,
  type EndgameSet,
  type EndgameTheme,
  type TrainingObjective,
} from "@/utils/trainingAreas";

const BUNDLED_ENDGAMES_VERSION = 1;
const bundledEndgameFiles = ["FinalesParte1.pgn", "FinalesParte2.pgn", "FinalesParte3.pgn"];

const getThemeMetadata = (
  trainingT: typeof i18n.t = i18n.t,
): Array<{
  id: EndgameTheme;
  label: string;
  description: string;
}> => [
  {
    id: "pawn",
    label: trainingT("Training.Copy.Pawnendgames.1d9ad580", "Pawn endgames"),
    description: trainingT(
      "Training.Copy.Oppositionpassedpawnspawnraces.1613b20c",
      "Opposition, passed pawns, pawn races, and key squares.",
    ),
  },
  {
    id: "rook",
    label: trainingT("Training.Copy.Rookendgames.5017d5d9", "Rook endgames"),
    description: trainingT(
      "Training.Copy.Activerookspassedpawnsand.8fbd6a79",
      "Active rooks, passed pawns, and theoretical positions.",
    ),
  },
  {
    id: "minorPiece",
    label: trainingT("Training.Copy.Minorpieces.3037b1a3", "Minor pieces"),
    description: trainingT(
      "Training.Copy.Knightsbishopsandtheirendgames.fc5978ce",
      "Knights, bishops, and their endgames against pawns.",
    ),
  },
  {
    id: "queen",
    label: trainingT("Training.Copy.Queenendgames.e698cea4", "Queen endgames"),
    description: trainingT(
      "Training.Copy.Matingtechniquechecksandking.b4e7aea3",
      "Mating technique, checks, and king coordination.",
    ),
  },
  {
    id: "mixed",
    label: trainingT("Training.Copy.Mixedmaterial.d33aeb87", "Mixed material"),
    description: trainingT(
      "Training.Copy.Endgameswithseveralkindsof.1b3d107d",
      "Endgames with several kinds of pieces on the board.",
    ),
  },
  {
    id: "other",
    label: trainingT("Training.Copy.Otherendgames.75f81a60", "Other endgames"),
    description: trainingT(
      "Training.Copy.Specialpositionsandsupplementaryexercises.08022247",
      "Special positions and supplementary exercises.",
    ),
  },
];

function filename(path: string, trainingT: typeof i18n.t = i18n.t) {
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

function objectiveLabel(objective: TrainingObjective, trainingT: typeof i18n.t = i18n.t) {
  return {
    win: trainingT("Training.Copy.Win.fc572f64", "Win"),
    draw: trainingT("Training.Copy.Holdadraw.1c931742", "Hold a draw"),
    loss: trainingT("Training.Copy.Defend.69d716e2", "Defend"),
    unknown: trainingT("Training.Copy.Tobedetermined.20317191", "To be determined"),
  }[objective];
}

function objectiveColor(objective: TrainingObjective) {
  return objective === "win" ? "teal" : objective === "draw" ? "blue" : "gray";
}

export default function EndgameTrainingV2Page() {
  const { t: trainingT } = useTrainingTranslation();

  const themeMetadata = getThemeMetadata(trainingT);
  useTrainingTranslation();

  const navigate = useNavigate();
  const [areas, setAreas] = useAtom(trainingAreasAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const storedEngines = useAtomValue(enginesAtom);
  const setInputColor = useSetAtom(gameInputColorAtom);
  const setPlayer1 = useSetAtom(gamePlayer1SettingsAtom);
  const setPlayer2 = useSetAtom(gamePlayer2SettingsAtom);
  const [selectedTheme, setSelectedTheme] = useState<EndgameTheme | null>(null);
  const [opponentMode, setOpponentMode] = useState<"maia" | "stockfish">("maia");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; color?: string } | null>(null);
  const [resolvingSetId, setResolvingSetId] = useState<string | null>(null);
  const [deletingSetId, setDeletingSetId] = useState<string | null>(null);
  const bundledLoadStarted = useRef(false);

  const sets = useMemo(() => Object.values(areas.endgames.sets), [areas.endgames.sets]);
  const bundledSets = sets.filter((set) => set.origin === "bundled");
  const userSets = sets.filter((set) => set.origin === "user");
  const bundledPositions = useMemo(
    () =>
      bundledSets.flatMap((set) =>
        set.positionIds.flatMap((id) => {
          const position = areas.endgames.positions[id];
          return position ? [{ position, setId: set.id }] : [];
        }),
      ),
    [areas.endgames.positions, bundledSets],
  );
  const visibleThemePositions = selectedTheme
    ? bundledPositions.filter(({ position }) => position.theme === selectedTheme)
    : [];
  const includedCompleted = bundledPositions.filter(
    ({ position }) => position.progress.completed,
  ).length;

  const engines = useMemo(() => storedEngines ?? [], [storedEngines]);
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
      bundledEndgameFiles.map(async (file) => {
        const path = await resolveResource(`training/endgames/${file}`);
        const records = await parseTrainingRecords(await readTextFile(path), {
          requireExplicitFen: true,
          skipInvalid: true,
        });
        return {
          name: trainingT("Training.Copy.Includedcontentv0.e121b272", "Included content · {{v0}}", {
            v0: file,
          }),
          description: trainingT(
            "Training.Copy.CollectionincludedwithChessLab.7e9e4b92",
            "Collection included with Chess Lab.",
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
                  "Training.Copy.Couldnotloadincludedcontent.74d42938",
                  "Could not load included content: {{v0}}",
                  { v0: error.message },
                )
              : trainingT(
                  "Training.Copy.Couldnotloadincludedcontent.7fcd5f76",
                  "Could not load included content.",
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
      const records = await parseTrainingRecords(await readTextFile(selected), {
        requireExplicitFen: true,
        skipInvalid: true,
      });
      if (records.length === 0)
        throw new Error(
          trainingT(
            "Training.Copy.ThePGNcontainsnovalid.b0f13444",
            "The PGN contains no valid positions.",
          ),
        );
      const importedSetName = name.trim() || filename(selected, trainingT);
      setAreas((previous) => ({
        ...previous,
        endgames: addEndgameSet(previous.endgames, importedSetName, description.trim(), records),
      }));
      setName("");
      setDescription("");
      setFeedback({
        text: trainingT(
          "Training.Copy.Setv0importedwithv1.f380ca3c",
          "Set “{{v0}}” imported with {{v1}} positions.",
          { v0: importedSetName, v1: records.length },
        ),
      });
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? error.message
            : trainingT("Training.Copy.Couldnotimporttheset.90285448", "Could not import the set."),
        color: "red",
      });
    }
  }

  async function resolveObjectives(set: EndgameSet) {
    if (set.origin !== "user") return;
    await resolvePositionObjectives(set.positionIds, set.id);
  }

  async function resolveIncludedThemeObjectives() {
    if (!import.meta.env.DEV || !selectedTheme) return;
    await resolvePositionObjectives(
      visibleThemePositions.map(({ position }) => position.id),
      `bundled-${selectedTheme}`,
    );
  }

  async function resolvePositionObjectives(positionIds: string[], busyId: string) {
    setResolvingSetId(busyId);
    let resolved = 0;
    let failed = 0;
    for (const positionId of positionIds) {
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
        resolved += 1;
      } catch {
        failed += 1;
      }
    }
    setResolvingSetId(null);
    setFeedback({
      text: trainingT(
        "Training.Copy.v0objectivescalculatedv1.e4de69e7",
        "{{v0}} objectives calculated{{v1}}.",
        {
          v0: resolved,
          v1: failed
            ? trainingT("Training.Copy.v0unavailable.86830fd9", "; {{v0}} unavailable", {
                v0: failed,
              })
            : "",
        },
      ),
      color: failed ? "yellow" : undefined,
    });
  }

  function setManualObjective(positionId: string, objective: string | null) {
    if (!objective) return;
    setAreas((previous) => ({
      ...previous,
      endgames: updateEndgameObjective(
        previous.endgames,
        positionId,
        objective as TrainingObjective,
        "manual",
      ),
    }));
  }

  async function playPosition(position: EndgamePosition, setId: string) {
    if (!selectedEngine) {
      setFeedback({
        text:
          opponentMode === "maia"
            ? trainingT(
                "Training.Copy.InstallandenableMaia3.1f0572bc",
                "Install and enable Maia 3, or select Stockfish.",
              )
            : trainingT(
                "Training.Copy.InstallandenableStockfishor.f6a203ba",
                "Install and enable Stockfish or another local engine.",
              ),
        color: "yellow",
      });
      return;
    }
    const [chessPosition] = positionFromFen(position.fen);
    if (!chessPosition) {
      setFeedback({
        text: trainingT(
          "Training.Copy.TheFENpositionisinvalid.97da3f3f",
          "The FEN position is invalid.",
        ),
        color: "red",
      });
      return;
    }
    setInputColor(chessPosition.turn);
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
      fen: position.fen,
      name: position.title,
      type: "play",
      setTabs,
      setActiveTab,
      trainingArea: "endgames",
      trainingContext: {
        ChessLabEndgamePositionId: position.id,
        ChessLabEndgameSetId: setId,
        ChessLabEndgameObjective: position.objective,
        ChessLabEndgameStudentColor: chessPosition.turn,
        ChessLabEndgameAutoStart: "1",
      },
    });
  }

  async function analyzePosition(position: EndgamePosition) {
    await navigate({ to: "/" });
    await launchTrainingPosition({
      fen: position.fen,
      name: trainingT("Training.Copy.Analysisv0.b7ffacfd", "Analysis · {{v0}}", {
        v0: position.title,
      }),
      type: "analysis",
      setTabs,
      setActiveTab,
      trainingArea: "endgames",
    });
  }

  function removeSet() {
    if (!deletingSetId) return;
    const set = areas.endgames.sets[deletingSetId];
    if (!set || set.origin !== "user") return;
    setAreas((previous) => ({
      ...previous,
      endgames: deleteEndgameSet(previous.endgames, deletingSetId),
    }));
    setDeletingSetId(null);
    setFeedback({
      text: trainingT("Training.Copy.Setv0deleted.2c6952d5", "Set “{{v0}}” deleted.", {
        v0: set.name,
      }),
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
            aria-label={trainingT("Training.Copy.Back.ab26ae7b", "Back")}
          >
            <IconArrowLeft size={20} />
          </Button>
          <div>
            <Title order={2}>
              {trainingT("Training.Copy.Endgametraining.d2c99939", "Endgame training")}
            </Title>
            <Text c="dimmed">
              {trainingT(
                "Training.Copy.Chooseathemeandpractice.30a98294",
                "Choose a theme and practice positions with specific objectives.",
              )}
            </Text>
          </div>
        </Group>

        {feedback && (
          <Alert color={feedback.color} withCloseButton onClose={() => setFeedback(null)}>
            {feedback.text}
          </Alert>
        )}

        <Card withBorder>
          <Group justify="space-between" align="flex-end">
            <div>
              <Text fw={600}>
                {trainingT("Training.Copy.Practiceopponent.95f64dc7", "Practice opponent")}
              </Text>
              <Text size="sm" c="dimmed">
                {" "}
                {trainingT(
                  "Training.Copy.Thegamestartsautomaticallywhen.248688bd",
                  "The game starts automatically when you press Play.",
                )}{" "}
              </Text>
            </div>
            <Select
              w={280}
              label={trainingT("Training.Copy.Defaultengine.4d45d471", "Default engine")}
              value={opponentMode}
              data={[
                {
                  value: "maia",
                  label: maiaEngine
                    ? trainingT("Training.Copy.MaximumMaiav0.32eb5b83", "Maximum Maia · {{v0}}", {
                        v0: maiaEngine.name,
                      })
                    : trainingT("Training.Copy.Maianotinstalled.1dd2fb71", "Maia not installed"),
                },
                {
                  value: "stockfish",
                  label: stockfishEngine
                    ? `Stockfish · ${stockfishEngine.name}`
                    : trainingT(
                        "Training.Copy.Stockfishnotinstalled.86d6bf26",
                        "Stockfish not installed",
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
                "Training.Copy.Theselectedengineisnot.0223c2c7",
                "The selected engine is not installed or active.",
              )}{" "}
            </Alert>
          )}
        </Card>

        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={3}>
              {selectedTheme
                ? themeMetadata.find((theme) => theme.id === selectedTheme)?.label
                : trainingT("Training.Copy.Endgamesbytheme.00e25467", "Endgames by theme")}
            </Title>
            <Text size="sm" c="dimmed">
              {selectedTheme
                ? trainingT(
                    "Training.Copy.Chooseapositiontopractice.21897c47",
                    "Choose a position to practice.",
                  )
                : trainingT(
                    "Training.Copy.v0ofv1includedendgames.bd6b6fc6",
                    "{{v0}} of {{v1}} included endgames completed.",
                    { v0: includedCompleted, v1: bundledPositions.length },
                  )}
            </Text>
          </div>
          {selectedTheme && (
            <Group>
              {import.meta.env.DEV && (
                <Button
                  variant="light"
                  leftSection={<IconDatabase size={16} />}
                  loading={resolvingSetId === `bundled-${selectedTheme}`}
                  onClick={resolveIncludedThemeObjectives}
                >
                  {" "}
                  {trainingT(
                    "Training.Copy.Calculatethemeobjectives.410764ed",
                    "Calculate theme objectives",
                  )}{" "}
                </Button>
              )}
              <Button variant="default" onClick={() => setSelectedTheme(null)}>
                {" "}
                {trainingT("Training.Copy.Viewallthemes.67a3bfda", "View all themes")}{" "}
              </Button>
            </Group>
          )}
        </Group>

        {!selectedTheme ? (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
            {themeMetadata.map((theme) => {
              const positions = bundledPositions.filter(
                ({ position }) => position.theme === theme.id,
              );
              if (positions.length === 0) return null;
              const completed = positions.filter(
                ({ position }) => position.progress.completed,
              ).length;
              return (
                <Card key={theme.id} withBorder>
                  <Stack h="100%" justify="space-between">
                    <div>
                      <Group justify="space-between">
                        <IconChess size={28} />
                        <Badge color="teal">{positions.length}</Badge>
                      </Group>
                      <Title order={4} mt="md">
                        {theme.label}
                      </Title>
                      <Text size="sm" c="dimmed" mt="xs" mih={42}>
                        {theme.description}
                      </Text>
                      <Progress value={(completed / positions.length) * 100} color="teal" mt="md" />
                      <Text size="xs" c="dimmed" mt={4}>
                        {completed}{" "}
                        {trainingT("Training.Copy.completed.9f880723", "completed")}{" "}
                      </Text>
                    </div>
                    <Button
                      mt="md"
                      color="teal"
                      rightSection={<IconChevronRight size={16} />}
                      onClick={() => setSelectedTheme(theme.id)}
                    >
                      {" "}
                      {trainingT("Training.Copy.Opentheme.2c1b7643", "Open theme")}{" "}
                    </Button>
                  </Stack>
                </Card>
              );
            })}
          </SimpleGrid>
        ) : visibleThemePositions.length === 0 ? (
          <Alert color="blue">
            {trainingT(
              "Training.Copy.Noincludedpositionsforthis.2378ec53",
              "No included positions for this theme.",
            )}
          </Alert>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }}>
            {visibleThemePositions.map(({ position, setId }, index) => (
              <EndgamePositionCard
                key={position.id}
                position={position}
                index={index}
                locked={!import.meta.env.DEV}
                onPlay={() => playPosition(position, setId)}
                onAnalyze={() => analyzePosition(position)}
                onObjectiveChange={(value) => setManualObjective(position.id, value)}
              />
            ))}
          </SimpleGrid>
        )}

        <div>
          <Title order={3}>
            {trainingT("Training.Copy.Yourendgamesets.bc0a26f3", "Your endgame sets")}
          </Title>
          <Text size="sm" c="dimmed">
            {" "}
            {trainingT(
              "Training.Copy.Prepareobjectivespracticeandremove.d29f4af3",
              "Prepare objectives, practice, and remove imported content here.",
            )}{" "}
          </Text>
        </div>

        {userSets.length === 0 ? (
          <Card withBorder>
            <Text c="dimmed" ta="center" py="lg">
              {" "}
              {trainingT(
                "Training.Copy.Youhavenotimportedany.bcb93682",
                "You have not imported any sets yet.",
              )}{" "}
            </Text>
          </Card>
        ) : (
          userSets.map((set) => {
            const progress = getEndgameSetProgress(areas.endgames, set.id);
            const positions = set.positionIds.flatMap((id) => {
              const position = areas.endgames.positions[id];
              return position ? [position] : [];
            });
            return (
              <Card key={set.id} withBorder>
                <Stack>
                  <Group justify="space-between" align="flex-start">
                    <div>
                      <Title order={4}>{set.name}</Title>
                      <Text size="sm" c="dimmed">
                        {set.description ||
                          trainingT("Training.Copy.Userimportedset.aab5b452", "User-imported set.")}
                      </Text>
                    </div>
                    <Group>
                      <Badge color="teal">
                        {progress.completed}/{progress.total}
                      </Badge>
                      <Button
                        color="red"
                        variant="subtle"
                        leftSection={<IconTrash size={15} />}
                        onClick={() => setDeletingSetId(set.id)}
                      >
                        {" "}
                        {trainingT("Training.Copy.Delete.c9894cf0", "Delete")}{" "}
                      </Button>
                    </Group>
                  </Group>
                  <Progress value={progress.percent} color="teal" />
                  <Group>
                    <Button
                      variant="light"
                      leftSection={<IconDatabase size={16} />}
                      loading={resolvingSetId === set.id}
                      onClick={() => resolveObjectives(set)}
                    >
                      {" "}
                      {trainingT(
                        "Training.Copy.Calculateobjectives.7219a82e",
                        "Calculate objectives",
                      )}{" "}
                    </Button>
                    {resolvingSetId === set.id && (
                      <Text size="sm" c="dimmed">
                        {" "}
                        {trainingT(
                          "Training.Copy.Queryingtablebase.5fa95349",
                          "Querying tablebase…",
                        )}{" "}
                      </Text>
                    )}
                  </Group>
                  <ScrollArea h={Math.min(470, Math.max(150, positions.length * 86))}>
                    <Stack gap="xs" pr="sm">
                      {positions.map((position, index) => (
                        <Group key={position.id} justify="space-between" wrap="nowrap">
                          <Group wrap="nowrap">
                            <Badge variant="outline">{index + 1}</Badge>
                            <div>
                              <Text size="sm" fw={500}>
                                {position.title}
                              </Text>
                              <Text size="xs" c="dimmed" ff="monospace" truncate maw={380}>
                                {position.fen}
                              </Text>
                            </div>
                          </Group>
                          <Group wrap="nowrap">
                            <Select
                              size="xs"
                              w={130}
                              value={position.objective}
                              data={[
                                {
                                  value: "unknown",
                                  label: trainingT(
                                    "Training.Copy.Tobedetermined.20317191",
                                    "To be determined",
                                  ),
                                },
                                {
                                  value: "win",
                                  label: trainingT("Training.Copy.Win.fc572f64", "Win"),
                                },
                                {
                                  value: "draw",
                                  label: trainingT("Training.Copy.Draw.9c0dd07e", "Draw"),
                                },
                                {
                                  value: "loss",
                                  label: trainingT("Training.Copy.Defend.69d716e2", "Defend"),
                                },
                              ]}
                              onChange={(value) => setManualObjective(position.id, value)}
                            />
                            {position.progress.completed && (
                              <Badge color="teal" leftSection={<IconCheck size={12} />}>
                                {" "}
                                {trainingT("Training.Copy.Completed.856641d2", "Completed")}{" "}
                              </Badge>
                            )}
                            <Button
                              size="xs"
                              variant="subtle"
                              leftSection={<IconSearch size={14} />}
                              onClick={() => analyzePosition(position)}
                            >
                              {" "}
                              {trainingT("Training.Copy.Analyze.67ffbe0d", "Analyze")}{" "}
                            </Button>
                            <Button
                              size="xs"
                              variant="subtle"
                              leftSection={<IconPlayerPlay size={14} />}
                              onClick={() => playPosition(position, set.id)}
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

        <Card withBorder>
          <Stack>
            <Group>
              <IconUpload size={24} color="var(--mantine-color-teal-6)" />
              <div>
                <Text fw={600}>
                  {trainingT("Training.Copy.Importyourownset.587a23b9", "Import your own set")}
                </Text>
                <Text size="sm" c="dimmed">
                  {" "}
                  {trainingT(
                    "Training.Copy.AddPGNfileswithone.dfb387a5",
                    "Add PGN files with one FEN per exercise using this advanced tool.",
                  )}{" "}
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <TextInput
                label={trainingT("Training.Copy.Setname.a54101c6", "Set name")}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <TextInput
                label={trainingT("Training.Copy.Description.ee00b96f", "Description")}
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
      </Stack>

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
              "Training.Copy.Itspositionsandallrelated.56316447",
              "Its positions and all related progress will be deleted. Included endgames are unaffected.",
            )}{" "}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeletingSetId(null)}>
              {" "}
              {trainingT("Training.Copy.Cancel.bb9dbb40", "Cancel")}{" "}
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

function EndgamePositionCard({
  position,
  index,
  locked,
  onPlay,
  onAnalyze,
  onObjectiveChange,
}: {
  position: EndgamePosition;
  index: number;
  locked: boolean;
  onPlay: () => void;
  onAnalyze: () => void;
  onObjectiveChange?: (value: string | null) => void;
}) {
  const { t: trainingT } = useTrainingTranslation();

  return (
    <Card withBorder>
      <Stack h="100%" justify="space-between">
        <div>
          <Group justify="space-between">
            <Badge variant="outline">{index + 1}</Badge>
            {position.progress.completed ? (
              <Badge color="teal" leftSection={<IconTrophy size={12} />}>
                {" "}
                {trainingT("Training.Copy.Completed.856641d2", "Completed")}{" "}
              </Badge>
            ) : (
              <Badge color="gray">{trainingT("Training.Copy.Pending.2ef68536", "Pending")}</Badge>
            )}
          </Group>
          <Text fw={600} mt="md">
            {position.title}
          </Text>
          <Text size="xs" c="dimmed" ff="monospace" truncate mt={4}>
            {position.fen}
          </Text>
          {locked ? (
            <Badge
              mt="sm"
              color={objectiveColor(position.objective)}
              variant="light"
              leftSection={<IconLock size={11} />}
            >
              {objectiveLabel(position.objective, trainingT)}
            </Badge>
          ) : (
            <Select
              mt="sm"
              label={trainingT("Training.Copy.Preparationgoal.c75e6c82", "Preparation goal")}
              value={position.objective}
              data={[
                {
                  value: "unknown",
                  label: trainingT("Training.Copy.Tobedetermined.20317191", "To be determined"),
                },
                { value: "win", label: trainingT("Training.Copy.Win.fc572f64", "Win") },
                { value: "draw", label: trainingT("Training.Copy.Draw.9c0dd07e", "Draw") },
                { value: "loss", label: trainingT("Training.Copy.Defend.69d716e2", "Defend") },
              ]}
              onChange={onObjectiveChange}
            />
          )}
          {position.progress.attempts > 0 && (
            <Text size="xs" c="dimmed" mt="sm">
              {position.progress.successes}{" "}
              {trainingT("Training.Copy.successesin.a6eaa679", "successes in")}{" "}
              {position.progress.attempts}{" "}
              {trainingT("Training.Copy.attempts.59675592", "attempts")}{" "}
            </Text>
          )}
        </div>
        <Group grow mt="md">
          <Button variant="default" leftSection={<IconSearch size={15} />} onClick={onAnalyze}>
            {" "}
            {trainingT("Training.Copy.Analyze.67ffbe0d", "Analyze")}{" "}
          </Button>
          <Button color="teal" leftSection={<IconPlayerPlay size={15} />} onClick={onPlay}>
            {" "}
            {trainingT("Training.Copy.Play.b61eda6f", "Play")}{" "}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
