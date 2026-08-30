import { useTranslation as useTrainingTranslation } from "react-i18next";
import i18n from "i18next";
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

const getKindOptions = (trainingT: typeof i18n.t = i18n.t) => [
  { value: "puzzle", label: trainingT("Training.Copy.Tacticspuzzle.459ef2b0", "Tactics / puzzle") },
  { value: "opening", label: trainingT("Training.Copy.Opening.cba19243", "Opening") },
  { value: "endgame", label: trainingT("Training.Copy.Endgame.f4ed8fa6", "Endgame") },
];

const getOutcomeLabels = (
  trainingT: typeof i18n.t = i18n.t,
): Record<TrainingAttemptOutcome, string> => ({
  correct: trainingT("Training.Copy.Correct.e98f5156", "Correct"),
  incorrect: trainingT("Training.Copy.Incorrect.bac5ee43", "Incorrect"),
  skipped: trainingT("Training.Copy.Skipped.b2749bdf", "Skipped"),
  incomplete: trainingT("Training.Copy.Incomplete.aa82b7c2", "Incomplete"),
});

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

function kindLabel(kind: TrainingKind, trainingT: typeof i18n.t = i18n.t): string {
  return getKindOptions(trainingT).find((option) => option.value === kind)?.label ?? kind;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function TrainingPage() {
  const { t: trainingT } = useTrainingTranslation();
  const kindOptions = getKindOptions(trainingT);
  const collectionKindOptions = [
    { value: "mixed", label: trainingT("Training.Copy.Mixed.31b7e97d", "Mixed") },
    ...kindOptions,
  ];
  const outcomeLabels = getOutcomeLabels(trainingT);

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
      showFeedback(
        trainingT(
          "Training.Copy.Createorselectacollection.e96d60b4",
          "Create or select a collection first.",
        ),
        "red",
      );
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
      showFeedback(
        trainingT("Training.Copy.Addedtov0v1.fa8dceab", "Added to “{{v0}}”: {{v1}}.", {
          v0: selectedCollection.name,
          v1: parsed.sourceDescription,
        }),
      );
    } catch (error) {
      showFeedback(
        error instanceof Error
          ? error.message
          : trainingT(
              "Training.Copy.Couldnotimporttheposition.64425c0e",
              "Could not import the position.",
            ),
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
      showFeedback(
        trainingT(
          "Training.Copy.Thecollectionneedsatleast.067858d6",
          "The collection needs at least one position.",
        ),
        "yellow",
      );
      return;
    }
    setLibrary(result.library);
    setActiveSessionId(result.session.id);
    showFeedback(
      trainingT(
        "Training.Copy.Sessionstartedwithv0positions.af0940d3",
        "Session started with {{v0}} positions.",
        { v0: result.session.itemIds.length },
      ),
    );
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
    showFeedback(
      trainingT("Training.Copy.Attemptrecordedv0.662c0454", "Attempt recorded: {{v0}}.", {
        v0: outcomeLabels[outcome].toLowerCase(),
      }),
    );
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
    const confirmed = await ask(
      trainingT(
        "Training.Copy.Removev0fromthelibrary.00275163",
        "Remove “{{v0}}” from the library?",
        { v0: item.title },
      ),
      {
        title: trainingT("Training.Copy.Deleteposition.c3cad629", "Delete position"),
        kind: "warning",
      },
    );
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
    showFeedback(
      trainingT(
        "Training.Copy.Backupexportedsuccessfully.d203707a",
        "Backup exported successfully.",
      ),
    );
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
        trainingT(
          "Training.Copy.v0positionswillbereplaced.6dc6ae10",
          "{{v0}} positions will be replaced with {{v1}} from the backup.",
          { v0: Object.keys(library.items).length, v1: Object.keys(imported.items).length },
        ),
        {
          title: trainingT("Training.Copy.Importbackup.214bdca3", "Import backup"),
          kind: "warning",
        },
      );
      if (!confirmed) return;
      setLibrary(imported);
      setActiveSessionId(null);
      showFeedback(
        trainingT(
          "Training.Copy.Backupimportedsuccessfully.bee32bb6",
          "Backup imported successfully.",
        ),
      );
    } catch (error) {
      showFeedback(
        error instanceof Error
          ? error.message
          : trainingT("Training.Copy.Thebackupisinvalid.fea8d635", "The backup is invalid."),
        "red",
      );
    }
  }

  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2}>
              {trainingT("Training.Copy.Positionlibrary.9e9f1828", "Position library")}
            </Title>
            <Text c="dimmed" maw={720} mt={4}>
              {" "}
              {trainingT(
                "Training.Copy.Importandbackuppositions.57a92b46",
                "Import and back up positions here. Open Tactics, Openings, or Endgames in Training to practice.",
              )}{" "}
            </Text>
          </div>
          <Group>
            <Button variant="default" leftSection={<IconUpload size={16} />} onClick={importBackup}>
              {" "}
              {trainingT("Training.Copy.Importbackup.214bdca3", "Import backup")}{" "}
            </Button>
            <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              onClick={exportBackup}
            >
              {" "}
              {trainingT("Training.Copy.Exportbackup.435d4fc4", "Export backup")}{" "}
            </Button>
          </Group>
        </Group>

        {feedback && <Alert color={feedback.color}>{feedback.message}</Alert>}

        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <StatCard
            label={trainingT("Training.Copy.Positions.94572a03", "Positions")}
            value={selectedCollectionStats.total}
          />
          <StatCard
            label={trainingT("Training.Copy.Practiced.bc0d2935", "Practiced")}
            value={selectedCollectionStats.practiced}
          />
          <StatCard
            label={trainingT("Training.Copy.Correct.7d636b05", "Correct")}
            value={selectedCollectionStats.correct}
            color="teal"
          />
          <StatCard
            label={trainingT("Training.Copy.Incorrect.defc9404", "Incorrect")}
            value={selectedCollectionStats.incorrect}
            color="red"
          />
        </SimpleGrid>

        <Group align="flex-end">
          <Select
            label={trainingT("Training.Copy.Activecollection.cbe4440d", "Active collection")}
            placeholder={trainingT(
              "Training.Copy.Selectacollection.6cf2ce0a",
              "Select a collection",
            )}
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
            {" "}
            {trainingT("Training.Copy.Newcollection.ea27a47a", "New collection")}{" "}
          </Button>
          <Button
            variant="light"
            leftSection={<IconPlayerPlay size={16} />}
            disabled={!selectedCollection || selectedCollection.itemIds.length === 0}
            onClick={startSession}
          >
            {" "}
            {trainingT("Training.Copy.Startsession.8d518bb6", "Start session")}{" "}
          </Button>
        </Group>

        {activeSessionId && (
          <Alert
            icon={<IconPlayerPlay size={18} />}
            title={trainingT("Training.Copy.Activesession.43a35f7c", "Active session")}
            withCloseButton
            onClose={() => setActiveSessionId(null)}
          >
            {" "}
            {trainingT(
              "Training.Copy.Recordtheresultofeach.105a879c",
              "Record the result of each position after working on it. Attempts are linked to this session.",
            )}{" "}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Card withBorder>
            <Stack>
              <Group justify="space-between">
                <div>
                  <Title order={4}>
                    {trainingT("Training.Copy.Addcontent.0d729f3c", "Add content")}
                  </Title>
                  <Text size="sm" c="dimmed">
                    {" "}
                    {trainingT(
                      "Training.Copy.PasteaFENpositionor.9e98dcf5",
                      "Paste a FEN position or a PGN to keep its main line.",
                    )}{" "}
                  </Text>
                </div>
                <IconArchive size={24} color="var(--mantine-color-blue-5)" />
              </Group>
              <Select
                label={trainingT("Training.Copy.Type.3868d284", "Type")}
                data={kindOptions}
                value={importKind}
                onChange={(value) => value && setImportKind(value as TrainingKind)}
              />
              <TextInput
                label={trainingT("Training.Copy.Title.4c08a5d5", "Title")}
                placeholder={trainingT(
                  "Training.Copy.egMateintwo.27762a2b",
                  "e.g. Mate in two: deflection",
                )}
                value={importTitle}
                onChange={(event) => setImportTitle(event.currentTarget.value)}
              />
              <TextInput
                label={trainingT("Training.Copy.Tags.137cb944", "Tags")}
                placeholder={trainingT(
                  "Training.Copy.tacticspintournament.d4172f79",
                  "tactics, pin, tournament",
                )}
                value={importTags}
                onChange={(event) => setImportTags(event.currentTarget.value)}
              />
              <Textarea
                label={trainingT("Training.FenOrPgn", "FEN or PGN")}
                placeholder={"8/8/8/8/8/2k5/8/2K5 w - - 0 1\n\n1. e4 e5 2. Nf3 Nc6"}
                minRows={5}
                autosize
                value={importInput}
                onChange={(event) => setImportInput(event.currentTarget.value)}
              />
              <Textarea
                label={trainingT("Training.Copy.Notes.8a6172e2", "Notes")}
                placeholder={trainingT(
                  "Training.Copy.Whatwouldyouliketo.ff8bc254",
                  "What would you like to remember or measure...",
                )}
                minRows={2}
                value={importNotes}
                onChange={(event) => setImportNotes(event.currentTarget.value)}
              />
              <Button loading={importBusy} onClick={importPosition} disabled={!selectedCollection}>
                {" "}
                {trainingT("Training.Copy.Addtocollection.dc037288", "Add to collection")}{" "}
              </Button>
            </Stack>
          </Card>

          <Card withBorder>
            <Stack>
              <Group justify="space-between">
                <div>
                  <Title order={4}>
                    {selectedCollection?.name ??
                      trainingT("Training.Copy.Collection.1f5e6d24", "Collection")}
                  </Title>
                  <Text size="sm" c="dimmed">
                    {selectedCollection?.description ||
                      trainingT("Training.Copy.Nodescription.9e3d482f", "No description")}
                  </Text>
                </div>
                {selectedCollection && <Badge variant="light">{selectedCollection.kind}</Badge>}
              </Group>
              <Divider />
              {items.length === 0 ? (
                <Text c="dimmed" ta="center" py="xl">
                  {" "}
                  {trainingT(
                    "Training.Copy.Thiscollectionhasnopositions.a69b9e0f",
                    "This collection has no positions yet.",
                  )}{" "}
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
        title={trainingT("Training.Copy.Newcollection.ea27a47a", "New collection")}
      >
        <Stack>
          <TextInput
            label={trainingT("Training.Copy.Name.562bb157", "Name")}
            required
            value={collectionName}
            onChange={(event) => setCollectionName(event.currentTarget.value)}
          />
          <Textarea
            label={trainingT("Training.Copy.Description.ee00b96f", "Description")}
            value={collectionDescription}
            onChange={(event) => setCollectionDescription(event.currentTarget.value)}
          />
          <Select
            label={trainingT("Training.Copy.Maincontent.a6d99d71", "Main content")}
            data={collectionKindOptions}
            value={collectionKind}
            onChange={(value) => value && setCollectionKind(value as TrainingCollectionKind)}
          />
          <Button onClick={createCollection} disabled={!collectionName.trim()}>
            {" "}
            {trainingT("Training.Copy.Createcollection.34d70430", "Create collection")}{" "}
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
  const { t: trainingT } = useTrainingTranslation();

  return (
    <Paper withBorder p="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Group gap="xs" wrap="wrap">
            <Text fw={600}>{item.title}</Text>
            <Badge size="sm" variant="light">
              {kindLabel(item.kind, trainingT)}
            </Badge>
            <Badge size="sm" variant="outline">
              {attempts} {trainingT("Training.Copy.attempts.59675592", "attempts")}{" "}
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
                {" "}
                {trainingT("Training.Copy.Savedline.7551a593", "Saved line:")}{" "}
                {item.solutionMoves.length}{" "}
                {trainingT("Training.Copy.moves.a1a4a814", "moves")}{" "}
              </Text>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {" "}
            {trainingT("Training.Copy.Added.f52c88f4", "Added")} {formatDate(item.createdAt)}
          </Text>
        </Stack>
        <Group gap={4} wrap="nowrap">
          <Tooltip label={trainingT("Training.Copy.Openonboard.e88da3ab", "Open on board")}>
            <ActionIcon
              onClick={onOpen}
              aria-label={trainingT("Training.Copy.Openonboard.e88da3ab", "Open on board")}
            >
              <IconExternalLink size={17} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={trainingT("Training.Copy.Correct.e98f5156", "Correct")}>
            <ActionIcon
              color="teal"
              onClick={() => onRecord("correct")}
              aria-label={trainingT("Training.Copy.Markcorrect.cb2884f9", "Mark correct")}
            >
              <IconCheck size={17} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={trainingT("Training.Copy.Incorrect.bac5ee43", "Incorrect")}>
            <ActionIcon
              color="red"
              onClick={() => onRecord("incorrect")}
              aria-label={trainingT("Training.Copy.Markincorrect.968c6921", "Mark incorrect")}
            >
              <IconX size={17} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={trainingT("Training.Copy.Skip.33ff2158", "Skip")}>
            <ActionIcon
              onClick={() => onRecord("skipped")}
              aria-label={trainingT("Training.Copy.Markskipped.25ebd017", "Mark skipped")}
            >
              <IconPlayerSkipForward size={17} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={trainingT("Training.Copy.Delete.c9894cf0", "Delete")}>
            <ActionIcon
              color="red"
              onClick={onDelete}
              aria-label={trainingT("Training.Copy.Deleteposition.c3cad629", "Delete position")}
            >
              <IconTrash size={17} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Paper>
  );
}
