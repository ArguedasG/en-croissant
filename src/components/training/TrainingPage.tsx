import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ask } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  IconArchive,
  IconCheck,
  IconDownload,
  IconExternalLink,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconPlus,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { useAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { trainingLibraryAtom } from "@/state/training";
import { defaultTree } from "@/utils/treeReducer";
import { createTab } from "@/utils/tabs";
import {
  addTrainingCollection,
  addTrainingItem,
  createTrainingSession,
  getTrainingCollectionStats,
  parseTrainingBackup,
  recordTrainingAttempt,
  removeTrainingItem,
  serializeTrainingLibrary,
  trainingId,
  type TrainingAttemptOutcome,
  type TrainingCollectionKind,
  type TrainingItem,
  type TrainingKind,
} from "@/utils/training";
import { parseTrainingInput } from "@/utils/trainingImport";

const kindOptions = [
  { value: "puzzle", label: "Táctica / puzzle" },
  { value: "opening", label: "Apertura" },
  { value: "endgame", label: "Final" },
];

const collectionKindOptions = [{ value: "mixed", label: "Mixta · provisional" }, ...kindOptions];

const outcomeLabels: Record<TrainingAttemptOutcome, string> = {
  correct: "Correcto",
  incorrect: "Incorrecto",
  skipped: "Omitido",
  incomplete: "Incompleto",
};

function splitTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

function kindLabel(kind: TrainingKind): string {
  return kindOptions.find((option) => option.value === kind)?.label ?? kind;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function TrainingPage() {
  const navigate = useNavigate();
  const [library, setLibrary] = useAtom(trainingLibraryAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);

  const collections = useMemo(
    () => Object.values(library.collections).sort((a, b) => a.name.localeCompare(b.name)),
    [library.collections],
  );
  const [selectedCollectionId, setSelectedCollectionId] = useState(collections[0]?.id ?? "");
  const selectedCollection = library.collections[selectedCollectionId] ?? collections[0];
  const selectedCollectionStats = selectedCollection
    ? getTrainingCollectionStats(library, selectedCollection.id)
    : { total: 0, practiced: 0, correct: 0, incorrect: 0, skipped: 0 };
  const items = selectedCollection
    ? selectedCollection.itemIds
        .map((itemId) => library.items[itemId])
        .filter((item): item is TrainingItem => item !== undefined)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    : [];

  const [collectionModalOpened, setCollectionModalOpened] = useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [collectionDescription, setCollectionDescription] = useState("");
  const [collectionKind, setCollectionKind] = useState<TrainingCollectionKind>("mixed");

  const [importKind, setImportKind] = useState<TrainingKind>("puzzle");
  const [importTitle, setImportTitle] = useState("");
  const [importTags, setImportTags] = useState("");
  const [importNotes, setImportNotes] = useState("");
  const [importInput, setImportInput] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; color?: string } | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedCollectionId && library.collections[selectedCollectionId]) return;
    setSelectedCollectionId(collections[0]?.id ?? "");
  }, [collections, library.collections, selectedCollectionId]);

  function showFeedback(message: string, color?: string) {
    setFeedback({ message, color });
    window.setTimeout(() => setFeedback(null), 5000);
  }

  function createCollection() {
    const name = collectionName.trim();
    if (!name) return;

    const id = trainingId("collection");
    setLibrary((previous) =>
      addTrainingCollection(previous, {
        id,
        name,
        description: collectionDescription.trim(),
        kind: collectionKind,
      }),
    );
    setSelectedCollectionId(id);
    setCollectionName("");
    setCollectionDescription("");
    setCollectionKind("mixed");
    setCollectionModalOpened(false);
  }

  async function importPosition() {
    if (!selectedCollection) {
      showFeedback("Crea o selecciona una colección primero.", "red");
      return;
    }

    setImportBusy(true);
    try {
      const parsed = await parseTrainingInput({
        input: importInput,
        kind: importKind,
        title: importTitle,
        tags: splitTags(importTags),
        notes: importNotes,
      });
      setLibrary((previous) => addTrainingItem(previous, parsed.item, selectedCollection.id));
      setImportInput("");
      setImportTitle("");
      setImportTags("");
      setImportNotes("");
      showFeedback(`Añadido a «${selectedCollection.name}»: ${parsed.sourceDescription}.`);
    } catch (error) {
      showFeedback(
        error instanceof Error ? error.message : "No se pudo importar la posición.",
        "red",
      );
    } finally {
      setImportBusy(false);
    }
  }

  function startSession() {
    if (!selectedCollection) return;
    const result = createTrainingSession(library, selectedCollection.id, "all");
    if (!result) {
      showFeedback("La colección necesita al menos una posición.", "yellow");
      return;
    }
    setLibrary(result.library);
    setActiveSessionId(result.session.id);
    showFeedback(`Sesión iniciada con ${result.session.itemIds.length} posiciones.`);
  }

  function recordOutcome(itemId: string, outcome: TrainingAttemptOutcome) {
    const finishedAt = new Date();
    const startedAt = new Date(finishedAt.getTime() - 1000);
    setLibrary((previous) =>
      recordTrainingAttempt(previous, {
        itemId,
        sessionId: activeSessionId,
        outcome,
        grade: outcome === "correct" ? 3 : outcome === "incorrect" ? 1 : null,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        timeMs: 1000,
      }),
    );
    showFeedback(`Intento registrado: ${outcomeLabels[outcome].toLowerCase()}.`);
  }

  async function openItem(item: TrainingItem) {
    await navigate({ to: "/" });
    const headers = {
      ...defaultTree(item.fen).headers,
      event: item.title,
      fen: item.fen,
    };
    await createTab({
      tab: { name: item.title, type: "analysis" },
      setTabs,
      setActiveTab,
      pgn: item.source.pgn ?? "",
      headers,
    });
  }

  async function deleteItem(item: TrainingItem) {
    const confirmed = await ask(`¿Eliminar «${item.title}» de la biblioteca?`, {
      title: "Eliminar posición",
      kind: "warning",
    });
    if (!confirmed) return;
    setLibrary((previous) => removeTrainingItem(previous, item.id));
  }

  async function exportBackup() {
    const path = await save({
      defaultPath: "chess-lab-training-backup.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    await writeTextFile(path, serializeTrainingLibrary(library));
    showFeedback("Backup exportado correctamente.");
  }

  async function importBackup() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof selected !== "string") return;

    try {
      const imported = parseTrainingBackup(await readTextFile(selected));
      const confirmed = await ask(
        `Se reemplazarán ${Object.keys(library.items).length} posiciones por ${Object.keys(imported.items).length} del backup.`,
        { title: "Importar backup", kind: "warning" },
      );
      if (!confirmed) return;
      setLibrary(imported);
      setActiveSessionId(null);
      showFeedback("Backup importado correctamente.");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "El backup no es válido.", "red");
    }
  }

  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2}>Biblioteca técnica provisional</Title>
            <Text c="dimmed" maw={720} mt={4}>
              Herramienta de infraestructura para importar y respaldar posiciones. Las experiencias
              reales de Táctica, Aperturas y Finales están separadas en el centro de Entrenamiento.
            </Text>
          </div>
          <Group>
            <Button variant="default" leftSection={<IconUpload size={16} />} onClick={importBackup}>
              Importar backup
            </Button>
            <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              onClick={exportBackup}
            >
              Exportar backup
            </Button>
          </Group>
        </Group>

        {feedback && <Alert color={feedback.color}>{feedback.message}</Alert>}

        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <StatCard label="Posiciones" value={selectedCollectionStats.total} />
          <StatCard label="Practicadas" value={selectedCollectionStats.practiced} />
          <StatCard label="Correctas" value={selectedCollectionStats.correct} color="teal" />
          <StatCard label="Incorrectas" value={selectedCollectionStats.incorrect} color="red" />
        </SimpleGrid>

        <Group align="flex-end">
          <Select
            label="Colección activa"
            placeholder="Selecciona una colección"
            data={collections.map((collection) => ({
              value: collection.id,
              label: `${collection.name} · ${collection.itemIds.length}`,
            }))}
            value={selectedCollection?.id ?? null}
            onChange={(value) => value && setSelectedCollectionId(value)}
            style={{ flex: 1 }}
          />
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => setCollectionModalOpened(true)}
          >
            Nueva colección
          </Button>
          <Button
            variant="light"
            leftSection={<IconPlayerPlay size={16} />}
            disabled={!selectedCollection || selectedCollection.itemIds.length === 0}
            onClick={startSession}
          >
            Iniciar sesión
          </Button>
        </Group>

        {activeSessionId && (
          <Alert
            icon={<IconPlayerPlay size={18} />}
            title="Sesión activa"
            withCloseButton
            onClose={() => setActiveSessionId(null)}
          >
            Registra el resultado de cada posición después de trabajarla en el tablero. Los intentos
            quedan asociados a esta sesión.
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Card withBorder>
            <Stack>
              <Group justify="space-between">
                <div>
                  <Title order={4}>Añadir contenido</Title>
                  <Text size="sm" c="dimmed">
                    Pega una FEN para una posición o un PGN para conservar su línea principal.
                  </Text>
                </div>
                <IconArchive size={24} color="var(--mantine-color-blue-5)" />
              </Group>
              <Select
                label="Tipo"
                data={kindOptions}
                value={importKind}
                onChange={(value) => value && setImportKind(value as TrainingKind)}
              />
              <TextInput
                label="Título"
                placeholder="Ej. Mate en dos: desviación"
                value={importTitle}
                onChange={(event) => setImportTitle(event.currentTarget.value)}
              />
              <TextInput
                label="Etiquetas"
                placeholder="táctica, clavada, torneo"
                value={importTags}
                onChange={(event) => setImportTags(event.currentTarget.value)}
              />
              <Textarea
                label="FEN o PGN"
                placeholder={"8/8/8/8/8/2k5/8/2K5 w - - 0 1\n\nó\n\n1. e4 e5 2. Nf3 Nc6"}
                minRows={5}
                autosize
                value={importInput}
                onChange={(event) => setImportInput(event.currentTarget.value)}
              />
              <Textarea
                label="Notas"
                placeholder="Qué quieres recordar o medir..."
                minRows={2}
                value={importNotes}
                onChange={(event) => setImportNotes(event.currentTarget.value)}
              />
              <Button loading={importBusy} onClick={importPosition} disabled={!selectedCollection}>
                Añadir a la colección
              </Button>
            </Stack>
          </Card>

          <Card withBorder>
            <Stack>
              <Group justify="space-between">
                <div>
                  <Title order={4}>{selectedCollection?.name ?? "Colección"}</Title>
                  <Text size="sm" c="dimmed">
                    {selectedCollection?.description || "Sin descripción"}
                  </Text>
                </div>
                {selectedCollection && <Badge variant="light">{selectedCollection.kind}</Badge>}
              </Group>
              <Divider />
              {items.length === 0 ? (
                <Text c="dimmed" ta="center" py="xl">
                  Esta colección todavía no tiene posiciones.
                </Text>
              ) : (
                <Stack gap="xs">
                  {items.map((item) => (
                    <TrainingItemRow
                      key={item.id}
                      item={item}
                      attempts={
                        library.attempts.filter((attempt) => attempt.itemId === item.id).length
                      }
                      onOpen={() => openItem(item)}
                      onDelete={() => deleteItem(item)}
                      onRecord={(outcome) => recordOutcome(item.id, outcome)}
                    />
                  ))}
                </Stack>
              )}
            </Stack>
          </Card>
        </SimpleGrid>
      </Stack>

      <Modal
        opened={collectionModalOpened}
        onClose={() => setCollectionModalOpened(false)}
        title="Nueva colección"
      >
        <Stack>
          <TextInput
            label="Nombre"
            required
            value={collectionName}
            onChange={(event) => setCollectionName(event.currentTarget.value)}
          />
          <Textarea
            label="Descripción"
            value={collectionDescription}
            onChange={(event) => setCollectionDescription(event.currentTarget.value)}
          />
          <Select
            label="Contenido principal"
            data={collectionKindOptions}
            value={collectionKind}
            onChange={(value) => value && setCollectionKind(value as TrainingCollectionKind)}
          />
          <Button onClick={createCollection} disabled={!collectionName.trim()}>
            Crear colección
          </Button>
        </Stack>
      </Modal>
    </Container>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Paper withBorder p="sm">
      <Text size="xs" tt="uppercase" c="dimmed" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700} c={color}>
        {value}
      </Text>
    </Paper>
  );
}

function TrainingItemRow({
  item,
  attempts,
  onOpen,
  onDelete,
  onRecord,
}: {
  item: TrainingItem;
  attempts: number;
  onOpen: () => void;
  onDelete: () => void;
  onRecord: (outcome: TrainingAttemptOutcome) => void;
}) {
  return (
    <Paper withBorder p="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Group gap="xs" wrap="wrap">
            <Text fw={600}>{item.title}</Text>
            <Badge size="sm" variant="light">
              {kindLabel(item.kind)}
            </Badge>
            <Badge size="sm" variant="outline">
              {attempts} intentos
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" ff="monospace" truncate>
            {item.fen}
          </Text>
          <Group gap={4}>
            {item.tags.map((tag) => (
              <Badge key={tag} size="xs" variant="dot">
                {tag}
              </Badge>
            ))}
            {item.solutionMoves.length > 0 && (
              <Text size="xs" c="dimmed">
                Línea guardada: {item.solutionMoves.length} jugadas
              </Text>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            Añadido {formatDate(item.createdAt)}
          </Text>
        </Stack>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Abrir en el tablero">
            <ActionIcon onClick={onOpen} aria-label="Abrir en el tablero">
              <IconExternalLink size={17} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Correcto">
            <ActionIcon
              color="teal"
              onClick={() => onRecord("correct")}
              aria-label="Registrar correcto"
            >
              <IconCheck size={17} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Incorrecto">
            <ActionIcon
              color="red"
              onClick={() => onRecord("incorrect")}
              aria-label="Registrar incorrecto"
            >
              <IconX size={17} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Omitir">
            <ActionIcon onClick={() => onRecord("skipped")} aria-label="Registrar omitido">
              <IconPlayerSkipForward size={17} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Eliminar">
            <ActionIcon color="red" onClick={onDelete} aria-label="Eliminar posición">
              <IconTrash size={17} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Paper>
  );
}
