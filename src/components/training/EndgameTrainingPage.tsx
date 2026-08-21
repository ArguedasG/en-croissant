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
  { file: "FinalesParte1.pgn", name: "Finales incluidos · Parte 1" },
  { file: "FinalesParte2.pgn", name: "Finales incluidos · Parte 2" },
  { file: "FinalesParte3.pgn", name: "Finales incluidos · Parte 3" },
];

function filename(path: string): string {
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

function objectiveLabel(objective: TrainingObjective): string {
  return {
    win: "Gana",
    draw: "Tablas",
    loss: "Pierde",
    unknown: "Pendiente",
  }[objective];
}

export default function EndgameTrainingPage() {
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
          description: "Colección de ejercicios de finales incluida con Chess Lab.",
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
              ? `No se pudo cargar el contenido de Finales incluido: ${error.message}`
              : "No se pudo cargar el contenido de Finales incluido.",
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
      const usable = await parseTrainingRecords(await readTextFile(selected), {
        requireExplicitFen: true,
        skipInvalid: true,
      });
      if (usable.length === 0) {
        throw new Error(
          "El archivo PGN no contiene posiciones de finales válidas.",
        );
      }
      const newSetName = name.trim() || filename(selected);
      setAreas((previous) => ({
        ...previous,
        endgames: addEndgameSet(previous.endgames, newSetName, description.trim(), usable),
      }));
      setName("");
      setDescription("");
      setFeedback({ text: `Set «${newSetName}» importado con ${usable.length} posiciones.` });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "No se pudo importar el set de finales.",
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
      text: `Objetivos calculados: ${resolved}${failed > 0 ? `; ${failed} posiciones no pudieron consultarse` : ""}.`,
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
            ? "Instala y activa Maia 3 en Motores, o selecciona Stockfish para practicar."
            : "Instala y activa Stockfish u otro motor local de referencia para practicar.",
        color: "yellow",
      });
      return;
    }
    const [position] = positionFromFen(fen);
    if (!position) {
      setFeedback({ text: "La posición FEN no es válida.", color: "red" });
      return;
    }
    setInputColor(position.turn);
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
      name: `Análisis · ${title}`,
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
            aria-label="Volver a entrenamiento"
          >
            <IconArrowLeft size={20} />
          </Button>
          <div>
            <Title order={2}>Entrenamiento de Finales</Title>
            <Text c="dimmed" mt={4}>
              Importa posiciones de finales, revisa sus objetivos y practica contra un motor.
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
                <Text fw={600}>Importar posiciones desde un archivo PGN</Text>
                <Text size="sm" c="dimmed">
                  Selecciona un archivo PGN con una posición inicial FEN para cada ejercicio. Los
                  objetivos se pueden revisar después de importar el set.
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <TextInput
                label="Nombre del set"
                placeholder="Ej. Finales de torre"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <TextInput
                label="Descripción"
                placeholder="Fuente o tema"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
            </SimpleGrid>
            <Button color="teal" leftSection={<IconUpload size={16} />} onClick={importSet}>
              Seleccionar archivo PGN
            </Button>
          </Stack>
        </Card>

        <Card withBorder>
          <Group justify="space-between" align="flex-end">
            <div>
              <Text fw={600}>Rival de práctica</Text>
              <Text size="sm" c="dimmed" maw={720}>
                Elige el motor contra el que quieres practicar. Tu color se determina
                automáticamente según el turno de la posición.
              </Text>
            </div>
            <Select
              w={260}
              label="Motor predeterminado"
              value={opponentMode}
              data={[
                {
                  value: "maia",
                  label: maiaEngine
                    ? `Maia máximo · ${maiaEngine.name}`
                    : "Maia máximo · no instalado",
                },
                {
                  value: "stockfish",
                  label: stockfishEngine
                    ? `Stockfish · ${stockfishEngine.name}`
                    : "Stockfish · no instalado",
                },
              ]}
              onChange={(value) => value && setOpponentMode(value as typeof opponentMode)}
            />
          </Group>
          {!selectedEngine && (
            <Alert color="yellow" mt="md">
              El motor seleccionado no está instalado o activo. Puedes cambiar la selección o
              configurarlo en la sección Motores.
            </Alert>
          )}
        </Card>

        {sets.length === 0 ? (
          <Card withBorder>
            <Stack align="center" py="xl">
              <IconChess size={42} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">Todavía no hay sets de finales.</Text>
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
                        {set.description || "Ejercicios de finales disponibles."}
                      </Text>
                    </div>
                    <Badge color="teal" variant="light">
                      {positions.length} posiciones
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
                      Calcular objetivos
                    </Button>
                    {resolving && (
                      <Text size="sm" c="dimmed">
                        Consultando tablebase…
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
                                { value: "unknown", label: "Pendiente" },
                                { value: "win", label: "Gana" },
                                { value: "draw", label: "Tablas" },
                                { value: "loss", label: "Pierde" },
                              ]}
                              onChange={(value) => setManualObjective(position.id, value)}
                            />
                            <Badge
                              color={position.objectiveSource === "manual" ? "yellow" : "gray"}
                            >
                              {objectiveLabel(position.objective)}
                            </Badge>
                            <Button
                              size="xs"
                              variant="subtle"
                              leftSection={<IconSearch size={14} />}
                              onClick={() => analyzePosition(position.fen, position.title)}
                            >
                              Analizar
                            </Button>
                            <Button
                              size="xs"
                              variant="subtle"
                              leftSection={<IconPlayerPlay size={14} />}
                              onClick={() => playPosition(position.fen, position.title)}
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
      </Stack>
    </Container>
  );
}
