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

function filename(path: string): string {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || "Set de táctica"
  );
}

export default function TacticsDashboardPage() {
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
      const nextInspection = await inspectTacticsPgn(selected, draftConfig);
      if (nextInspection.recordCount === 0) {
        throw new Error("El archivo no contiene ejercicios PGN.");
      }
      setInspection(nextInspection);
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
      }),
    }));
    setInspection(null);
    setSetName("");
    setDescription("");
    setDraftConfig(defaultConfig);
    setFeedback({
      text: `Set «${name}» conectado a ${inspection.recordCount.toLocaleString()} ejercicios sin duplicar el PGN.`,
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
            aria-label="Volver a entrenamiento"
          >
            <IconArrowLeft size={20} />
          </Button>
          <div>
            <Title order={2}>Entrenamiento de Táctica</Title>
            <Text c="dimmed" mt={4}>
              Elige una base o un set para empezar a practicar.
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
                    <Text fw={600}>Bases de puzzles instaladas</Text>
                  </Group>
                  <Badge color="orange" variant="light">
                    {puzzleDbs.length}
                  </Badge>
                </Group>
                <Text size="sm" c="dimmed" mt="sm">
                    Practica los puzzles instalados y utiliza sus filtros de nivel, tema, pistas,
                    tiempo e historial.
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
                Entrenar con una base instalada
              </Button>
            </Stack>
          </Card>

          <Card withBorder>
            <Stack>
              <Group>
                <IconUpload size={26} color="var(--mantine-color-orange-6)" />
                <div>
                  <Text fw={600}>Importar set PGN</Text>
                  <Text size="sm" c="dimmed">
                    Revisa una muestra del archivo antes de crear el set. Los ejercicios se
                    cargarán a medida que los practiques.
                  </Text>
                </div>
              </Group>
              <SimpleGrid cols={{ base: 1, md: 2 }}>
                <TextInput
                  label="Nombre del set"
                  placeholder="Ej. Tácticas de cálculo"
                  value={setName}
                  onChange={(event) => setSetName(event.currentTarget.value)}
                />
                <TextInput
                  label="Descripción"
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
                Seleccionar archivo PGN
              </Button>
            </Stack>
          </Card>
        </SimpleGrid>

        <div>
          <Title order={3}>Sets disponibles</Title>
          <Text size="sm" c="dimmed">
            Cada set tiene su propio contenido y configuración de práctica.
          </Text>
        </div>

        {sets.length === 0 ? (
          <Card withBorder>
            <Stack align="center" py="xl">
              <IconPuzzle size={42} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">Todavía no hay sets propios.</Text>
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
                        {set.description || "Set de posiciones tácticas."}
                      </Text>
                      <Text size="sm" mt="md">
                        Correctas: {progress.correct} · Incorrectas: {progress.incorrect}
                      </Text>
                      <Group gap="xs" mt="xs">
                        <Badge size="sm" variant="outline">
                          {set.config.mode === "woodpecker" ? "Woodpecker" : "Guiado"}
                        </Badge>
                        <Badge size="sm" variant="outline">
                          {set.config.variationPolicy === "mainline"
                            ? "Línea principal"
                            : set.config.variationPolicy === "opponentResponses"
                              ? "Respuestas rivales"
                              : "Todas las variantes"}
                        </Badge>
                      </Group>
                    </div>
                    <Group grow>
                      <Button
                        variant="default"
                        leftSection={<IconSettings size={16} />}
                        onClick={() => openSetSettings(set)}
                      >
                        Configurar
                      </Button>
                      <Button
                        color="orange"
                        variant="light"
                        leftSection={<IconPlayerPlay size={16} />}
                        onClick={() =>
                          navigate({
                            to: "/training/tactics/practice/$setId",
                            params: { setId: set.id },
                          })
                        }
                      >
                        Practicar
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
        title="Revisar importación táctica"
        size="lg"
      >
        {inspection && (
          <Stack>
            <Alert color={sampleErrors > 0 ? "yellow" : "blue"}>
              <Text fw={600}>{inspection.filename}</Text>
              <Text size="sm">
                {inspection.recordCount.toLocaleString()} ejercicios. En la muestra de{" "}
                {inspection.samples.length}: {sampleWithSolutions} con solución,{" "}
                {sampleWithVariations} con variantes y {sampleErrors} inválidos.
              </Text>
            </Alert>
            <div>
              <Text size="sm" fw={600} mb={6}>
                Vista previa
              </Text>
              <ScrollArea h={190} type="auto" offsetScrollbars>
                <Stack gap="xs" pr="sm">
                  {inspection.samples.map((sample) => (
                    <Card key={sample.index} withBorder padding="xs">
                      <Group justify="space-between" wrap="nowrap" align="flex-start">
                        <div style={{ minWidth: 0 }}>
                          <Text size="sm" fw={500} truncate>
                            {sample.index + 1}. {sample.title || `Registro ${sample.index + 1}`}
                          </Text>
                          <Text size="xs" c={sample.error ? "red" : "dimmed"}>
                            {sample.error ||
                              (sample.hasSolution
                                ? `${sample.moveCount} medias jugadas en la primera solución`
                                : "Posición sin solución; se validará con motor")}
                          </Text>
                        </div>
                        <Group gap={4} wrap="nowrap">
                          <Badge
                            size="xs"
                            color={sample.hasSolution ? "green" : "gray"}
                            variant="light"
                          >
                            {sample.hasSolution ? "Con línea" : "Solo FEN"}
                          </Badge>
                          {sample.hasVariations && (
                            <Badge size="xs" color="violet" variant="light">
                              Variantes
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
              “Respuestas rivales” conserva las ramas que cambian la defensa del oponente, pero no
              convierte automáticamente en solución las variantes ilustrativas jugadas por el
              estudiante.
            </Text>
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
          <TacticsConfigFields config={draftConfig} onChange={setDraftConfig} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditingSetId(null)}>
              Cancelar
            </Button>
            <Button color="orange" onClick={saveSetSettings}>
              Guardar
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
  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Select
          label="¿Quién hace la primera jugada?"
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
          label="Tratamiento de variantes"
          value={config.variationPolicy}
          data={[
            { value: "mainline", label: "Solo línea principal" },
            { value: "opponentResponses", label: "Respuestas alternativas del rival" },
            { value: "all", label: "Todas las variantes" },
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
            { value: "auto", label: "Automática según el registro" },
            { value: "prepared", label: "Usar solamente la solución PGN" },
            { value: "engine", label: "Validar con motor" },
          ]}
          onChange={(value) =>
            value &&
            onChange({ ...config, validationMode: value as TacticsSet["config"]["validationMode"] })
          }
        />
        <Select
          label="Modo"
          value={config.mode}
          data={[
            { value: "guided", label: "Resolución guiada" },
            { value: "woodpecker", label: "Ciclo Woodpecker" },
          ]}
          onChange={(value) =>
            value && onChange({ ...config, mode: value as TacticsSet["config"]["mode"] })
          }
        />
      </SimpleGrid>
      {config.mode === "woodpecker" && (
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <NumberInput
            label="Fallos máximos por ciclo"
            min={1}
            value={config.maxFailuresPerCycle}
            onChange={(value) =>
              onChange({ ...config, maxFailuresPerCycle: Math.max(1, Number(value) || 1) })
            }
          />
          <NumberInput
            label="Límite del ciclo en segundos"
            placeholder="Sin límite"
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
        <Text size="sm">Umbral para alternativas evaluadas por motor</Text>
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
