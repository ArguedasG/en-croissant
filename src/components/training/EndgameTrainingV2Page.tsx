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

const themeMetadata: Array<{
  id: EndgameTheme;
  label: string;
  description: string;
}> = [
  {
    id: "pawn",
    label: "Finales de peones",
    description: "Oposición, peones pasados, carreras y casillas clave.",
  },
  {
    id: "rook",
    label: "Finales de torres",
    description: "Torres activas, peones pasados y posiciones teóricas.",
  },
  {
    id: "minorPiece",
    label: "Piezas menores",
    description: "Caballos, alfiles y sus finales contra peones.",
  },
  {
    id: "queen",
    label: "Finales de damas",
    description: "Técnica de mate, jaques y coordinación con el rey.",
  },
  {
    id: "mixed",
    label: "Material mixto",
    description: "Finales con varias clases de piezas en juego.",
  },
  {
    id: "other",
    label: "Otros finales",
    description: "Posiciones especiales y ejercicios complementarios.",
  },
];

function filename(path: string) {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || "Set de finales"
  );
}

function objectiveFromTablebase(category: string): TrainingObjective {
  if (category === "win") return "win";
  if (category === "loss") return "loss";
  if (["draw", "blessed-loss", "cursed-win"].includes(category)) return "draw";
  return "unknown";
}

function objectiveLabel(objective: TrainingObjective) {
  return { win: "Ganar", draw: "Mantener tablas", loss: "Resistir", unknown: "Por definir" }[
    objective
  ];
}

function objectiveColor(objective: TrainingObjective) {
  return objective === "win" ? "teal" : objective === "draw" ? "blue" : "gray";
}

export default function EndgameTrainingV2Page() {
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
          name: `Contenido incluido · ${file}`,
          description: "Colección incluida con Chess Lab.",
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
              ? `No se pudo cargar el contenido incluido: ${error.message}`
              : "No se pudo cargar el contenido incluido.",
          color: "yellow",
        });
      });
  }, [areas.endgames.bundledContentVersion, setAreas]);

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
      if (records.length === 0) throw new Error("El PGN no contiene posiciones válidas.");
      const importedSetName = name.trim() || filename(selected);
      setAreas((previous) => ({
        ...previous,
        endgames: addEndgameSet(previous.endgames, importedSetName, description.trim(), records),
      }));
      setName("");
      setDescription("");
      setFeedback({ text: `Set «${importedSetName}» importado con ${records.length} posiciones.` });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "No se pudo importar el set.",
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
      text: `${resolved} objetivos calculados${failed ? `; ${failed} no disponibles` : ""}.`,
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
            ? "Instala y activa Maia 3, o selecciona Stockfish."
            : "Instala y activa Stockfish u otro motor local.",
        color: "yellow",
      });
      return;
    }
    const [chessPosition] = positionFromFen(position.fen);
    if (!chessPosition) {
      setFeedback({ text: "La posición FEN no es válida.", color: "red" });
      return;
    }
    setInputColor(chessPosition.turn);
    setPlayer1({ type: "human", name: "Estudiante" });
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
      name: `Análisis · ${position.title}`,
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
    setFeedback({ text: `Set «${set.name}» eliminado.` });
  }

  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group align="flex-start">
          <Button component={Link} to="/training" variant="subtle" p="xs" aria-label="Volver">
            <IconArrowLeft size={20} />
          </Button>
          <div>
            <Title order={2}>Entrenamiento de Finales</Title>
            <Text c="dimmed">Elige un tema y practica posiciones con objetivos concretos.</Text>
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
              <Text fw={600}>Rival de práctica</Text>
              <Text size="sm" c="dimmed">
                La partida comienza automáticamente al pulsar Jugar.
              </Text>
            </div>
            <Select
              w={280}
              label="Motor predeterminado"
              value={opponentMode}
              data={[
                {
                  value: "maia",
                  label: maiaEngine ? `Maia máximo · ${maiaEngine.name}` : "Maia no instalado",
                },
                {
                  value: "stockfish",
                  label: stockfishEngine
                    ? `Stockfish · ${stockfishEngine.name}`
                    : "Stockfish no instalado",
                },
              ]}
              onChange={(value) => value && setOpponentMode(value as typeof opponentMode)}
            />
          </Group>
          {!selectedEngine && (
            <Alert color="yellow" mt="md">
              El motor seleccionado no está instalado o activo.
            </Alert>
          )}
        </Card>

        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={3}>
              {selectedTheme
                ? themeMetadata.find((theme) => theme.id === selectedTheme)?.label
                : "Finales por tema"}
            </Title>
            <Text size="sm" c="dimmed">
              {selectedTheme
                ? "Elige la posición que quieres practicar."
                : `${includedCompleted} de ${bundledPositions.length} finales incluidos completados.`}
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
                  Calcular objetivos del tema
                </Button>
              )}
              <Button variant="default" onClick={() => setSelectedTheme(null)}>
                Ver todos los temas
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
                        {completed} completados
                      </Text>
                    </div>
                    <Button
                      mt="md"
                      color="teal"
                      rightSection={<IconChevronRight size={16} />}
                      onClick={() => setSelectedTheme(theme.id)}
                    >
                      Abrir tema
                    </Button>
                  </Stack>
                </Card>
              );
            })}
          </SimpleGrid>
        ) : visibleThemePositions.length === 0 ? (
          <Alert color="blue">No hay posiciones incluidas en este tema.</Alert>
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
          <Title order={3}>Tus sets de finales</Title>
          <Text size="sm" c="dimmed">
            Aquí puedes preparar objetivos, practicar y eliminar contenido importado.
          </Text>
        </div>

        {userSets.length === 0 ? (
          <Card withBorder>
            <Text c="dimmed" ta="center" py="lg">
              Todavía no has importado sets propios.
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
                        {set.description || "Set importado por el usuario."}
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
                        Eliminar
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
                      Calcular objetivos
                    </Button>
                    {resolvingSetId === set.id && (
                      <Text size="sm" c="dimmed">
                        Consultando tablebase…
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
                                { value: "unknown", label: "Por definir" },
                                { value: "win", label: "Ganar" },
                                { value: "draw", label: "Tablas" },
                                { value: "loss", label: "Resistir" },
                              ]}
                              onChange={(value) => setManualObjective(position.id, value)}
                            />
                            {position.progress.completed && (
                              <Badge color="teal" leftSection={<IconCheck size={12} />}>
                                Completado
                              </Badge>
                            )}
                            <Button
                              size="xs"
                              variant="subtle"
                              leftSection={<IconSearch size={14} />}
                              onClick={() => analyzePosition(position)}
                            >
                              Analizar
                            </Button>
                            <Button
                              size="xs"
                              variant="subtle"
                              leftSection={<IconPlayerPlay size={14} />}
                              onClick={() => playPosition(position, set.id)}
                            >
                              Jugar
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
                <Text fw={600}>Importar un set propio</Text>
                <Text size="sm" c="dimmed">
                  Añade PGN con una FEN por ejercicio. Esta opción se mantiene al final porque es
                  una herramienta avanzada.
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <TextInput
                label="Nombre del set"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <TextInput
                label="Descripción"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
            </SimpleGrid>
            <Button color="teal" leftSection={<IconUpload size={16} />} onClick={importSet}>
              Seleccionar archivo PGN
            </Button>
          </Stack>
        </Card>
      </Stack>

      <Modal
        opened={deletingSetId !== null}
        onClose={() => setDeletingSetId(null)}
        title="Eliminar set"
        size="sm"
      >
        <Stack>
          <Text size="sm">
            Se eliminarán sus posiciones y todo el progreso asociado. Esta acción no afecta a los
            finales incluidos.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeletingSetId(null)}>
              Cancelar
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
  return (
    <Card withBorder>
      <Stack h="100%" justify="space-between">
        <div>
          <Group justify="space-between">
            <Badge variant="outline">{index + 1}</Badge>
            {position.progress.completed ? (
              <Badge color="teal" leftSection={<IconTrophy size={12} />}>
                Completado
              </Badge>
            ) : (
              <Badge color="gray">Pendiente</Badge>
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
              {objectiveLabel(position.objective)}
            </Badge>
          ) : (
            <Select
              mt="sm"
              label="Objetivo de preparación"
              value={position.objective}
              data={[
                { value: "unknown", label: "Por definir" },
                { value: "win", label: "Ganar" },
                { value: "draw", label: "Tablas" },
                { value: "loss", label: "Resistir" },
              ]}
              onChange={onObjectiveChange}
            />
          )}
          {position.progress.attempts > 0 && (
            <Text size="xs" c="dimmed" mt="sm">
              {position.progress.successes} éxitos en {position.progress.attempts} intentos
            </Text>
          )}
        </div>
        <Group grow mt="md">
          <Button variant="default" leftSection={<IconSearch size={15} />} onClick={onAnalyze}>
            Analizar
          </Button>
          <Button color="teal" leftSection={<IconPlayerPlay size={15} />} onClick={onPlay}>
            Jugar
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
