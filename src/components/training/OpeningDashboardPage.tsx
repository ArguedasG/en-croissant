import {
  ActionIcon,
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Container,
  Group,
  Modal,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { resolve } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import { copyFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  IconArrowLeft,
  IconBook2,
  IconDownload,
  IconFileSearch,
  IconGripVertical,
  IconPencil,
  IconPlus,
  IconPlayerPlay,
  IconSettings,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { Link, useLoaderData, useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { useMemo, useState } from "react";
import {
  activeTabAtom,
  currentPracticeTabAtom,
  currentPracticeUnitAtom,
  currentOpeningPracticeQueueAtom,
  tabsAtom,
} from "@/state/atoms";
import { trainingAreasAtom } from "@/state/trainingAreas";
import {
  inspectOpeningPgn,
  buildOpeningTrainingPgn,
  prepareOpeningImport,
  type OpeningImportConfig,
  type OpeningPgnInspection,
} from "@/utils/openingTraining";
import {
  addBlankOpeningVariant,
  addOpeningRepertoire,
  addOpeningVariantFolder,
  deleteOpeningLine,
  getOpeningLineMetrics,
  getOpeningRepertoireMetrics,
  getOpeningVariantMetrics,
  moveOpeningLine,
  reorderOpeningVariant,
  renameOpeningLine,
  type OpeningVariant,
  type OpeningRepertoire,
  updateOpeningLineTrainable,
  updateOpeningPracticeSettings,
  updateOpeningRepertoire,
  updateOpeningVariant,
} from "@/utils/trainingAreas";
import { createFile, openFile } from "@/utils/files";
import { headersToPGN } from "@/utils/chess";
import { INITIAL_FEN } from "chessops/fen";

function filename(path: string): string {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || "Repertorio"
  );
}

const defaultConfig: OpeningImportConfig = {
  color: "white",
  subvariationPolicy: "mainline",
};

export default function OpeningDashboardPage() {
  const navigate = useNavigate();
  const { documentDir } = useLoaderData({ from: "/training/openings" });
  const [areas, setAreas] = useAtom(trainingAreasAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const [, setPracticeTab] = useAtom(currentPracticeTabAtom);
  const [, setPracticeUnit] = useAtom(currentPracticeUnitAtom);
  const [, setOpeningPracticeQueue] = useAtom(currentOpeningPracticeQueueAtom);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createColor, setCreateColor] = useState<"white" | "black">("white");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState<OpeningImportConfig>(defaultConfig);
  const [inspection, setInspection] = useState<OpeningPgnInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; color?: string } | null>(null);
  const [variantRepertoireId, setVariantRepertoireId] = useState<string | null>(null);
  const [variantName, setVariantName] = useState("");
  const [editingRepertoireId, setEditingRepertoireId] = useState<string | null>(null);
  const [repertoireDraftName, setRepertoireDraftName] = useState("");
  const [repertoireDraftDescription, setRepertoireDraftDescription] = useState("");
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [variantDraftName, setVariantDraftName] = useState("");
  const [variantDraftType, setVariantDraftType] = useState<OpeningVariant["contentType"]>("theory");
  const [trainableLineIds, setTrainableLineIds] = useState<string[]>([]);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [lineDraftName, setLineDraftName] = useState("");
  const [deletingLineId, setDeletingLineId] = useState<string | null>(null);
  const repertoires = useMemo(
    () => Object.values(areas.openings.repertoires),
    [areas.openings.repertoires],
  );

  async function createRepertoireFromScratch() {
    const repertoireName = createName.trim();
    if (!repertoireName) {
      setFeedback({ text: "Escribe un nombre para el repertorio.", color: "red" });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const pgn = `${headersToPGN({
        id: 0,
        fen: INITIAL_FEN,
        black: "",
        white: "",
        result: "*",
        event: repertoireName,
        site: "",
        orientation: createColor,
      })}\n*`;
      const created = await createFile({
        filename: repertoireName,
        filetype: "repertoire",
        pgn,
        dir: documentDir,
      });
      if (created.isErr) throw created.error;

      setAreas((previous) => ({
        ...previous,
        openings: addOpeningRepertoire(previous.openings, {
          name: repertoireName,
          color: createColor,
          description: createDescription.trim(),
          path: created.value.path,
          sourcePath: created.value.path,
          recordCount: 1,
          subvariationPolicy: "all",
          variants: [
            {
              name: "Línea principal",
              sourceRecordIndex: 0,
              trainingRecordIndex: 0,
              contentType: "theory",
              commentCount: 0,
              hasVariations: false,
              lines: [],
            },
          ],
        }),
      }));
      setCreateName("");
      setCreateDescription("");
      setCreateColor("white");
      await navigate({ to: "/" });
      await openFile(created.value, setTabs, setActiveTab);
      setPracticeUnit("line");
      setPracticeTab("build");
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "No se pudo crear el repertorio.",
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  async function selectImportFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PGN de repertorio", extensions: ["pgn"] }],
    });
    if (typeof selected !== "string") return;

    setBusy(true);
    setFeedback(null);
    try {
      const nextInspection = await inspectOpeningPgn(selected, config);
      if (nextInspection.recordCount === 0) throw new Error("El PGN no contiene capítulos.");
      setInspection(nextInspection);
      if (!name.trim()) setName(filename(selected));
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "No se pudo revisar el repertorio.",
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  async function addVariantFromScratch() {
    if (!variantRepertoireId || !variantName.trim()) return;
    const repertoire = areas.openings.repertoires[variantRepertoireId];
    if (!repertoire) return;
    setBusy(true);
    try {
      const name = variantName.trim();
      const openings =
        repertoire.sourcePath === repertoire.path
          ? addBlankOpeningVariant(areas.openings, variantRepertoireId, name)
          : addOpeningVariantFolder(areas.openings, variantRepertoireId, name);
      await persistOpeningOrganization(openings, repertoire.id);
      setVariantName("");
      setVariantRepertoireId(null);
      setFeedback({ text: `Variante «${name}» añadida a ${repertoire.name}.` });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "No se pudo añadir la variante.",
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  async function persistOpeningOrganization(openings: typeof areas.openings, repertoireId: string) {
    const repertoire = openings.repertoires[repertoireId];
    if (!repertoire) return;
    const pgn = await buildOpeningTrainingPgn(openings, repertoireId);
    await writeTextFile(repertoire.path, pgn);
    setAreas({ ...areas, openings });
  }

  async function handleOpeningDrag(result: DropResult) {
    if (!result.destination) return;
    let openings = areas.openings;
    let repertoireId: string | undefined;
    if (result.type.startsWith("VARIANT:")) {
      repertoireId = result.type.slice("VARIANT:".length);
      openings = reorderOpeningVariant(
        openings,
        repertoireId,
        result.source.index,
        result.destination.index,
      );
    } else if (result.type === "LINE") {
      const sourceVariantId = result.source.droppableId.replace("lines:", "");
      const targetVariantId = result.destination.droppableId.replace("lines:", "");
      const sourceVariant = openings.variants[sourceVariantId];
      const lineId = sourceVariant?.lineIds[result.source.index];
      if (!sourceVariant || !lineId) return;
      repertoireId = sourceVariant.repertoireId;
      openings = moveOpeningLine(openings, lineId, targetVariantId, result.destination.index);
    }
    if (!repertoireId || openings === areas.openings) return;
    setBusy(true);
    setFeedback(null);
    try {
      await persistOpeningOrganization(openings, repertoireId);
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "No se pudo reorganizar el repertorio.",
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteLine() {
    if (!deletingLineId) return;
    const line = areas.openings.lines[deletingLineId];
    const variant = line ? areas.openings.variants[line.variantId] : undefined;
    if (!line || !variant) return;
    setBusy(true);
    try {
      const openings = deleteOpeningLine(areas.openings, line.id);
      await persistOpeningOrganization(openings, variant.repertoireId);
      setDeletingLineId(null);
      setFeedback({
        text: `Línea «${line.name}» eliminada del gestor; el PGN fuente sigue intacto.`,
      });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "No se pudo eliminar la línea.",
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!inspection) return;
    setBusy(true);
    try {
      const prepared = await prepareOpeningImport(inspection, config);
      if (prepared.variants.length === 0) {
        throw new Error("No se pudo preparar ningún capítulo válido.");
      }
      const repertoireName = name.trim() || filename(inspection.path);
      const created = await createFile({
        filename: `${repertoireName} - Editable`,
        filetype: "repertoire",
        pgn: prepared.trainingPgn,
        dir: documentDir,
      });
      if (created.isErr) throw created.error;

      setAreas((previous) => ({
        ...previous,
        openings: addOpeningRepertoire(previous.openings, {
          name: repertoireName,
          color: config.color,
          description: description.trim(),
          path: created.value.path,
          sourcePath: inspection.path,
          recordCount: inspection.recordCount,
          subvariationPolicy: config.subvariationPolicy,
          variants: prepared.variants,
        }),
      }));
      setInspection(null);
      setName("");
      setDescription("");
      setConfig(defaultConfig);
      setFeedback({
        text: `Repertorio «${repertoireName}» importado con ${prepared.variants.length} variantes${
          prepared.skippedRecords > 0 ? `; ${prepared.skippedRecords} registros omitidos` : ""
        }.`,
      });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "No se pudo importar el repertorio.",
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  function openRepertoireSettings(repertoire: OpeningRepertoire) {
    setEditingRepertoireId(repertoire.id);
    setRepertoireDraftName(repertoire.name);
    setRepertoireDraftDescription(repertoire.description);
  }

  function saveRepertoireSettings() {
    if (!editingRepertoireId || !repertoireDraftName.trim()) return;
    setAreas((previous) => ({
      ...previous,
      openings: updateOpeningRepertoire(previous.openings, editingRepertoireId, {
        name: repertoireDraftName.trim(),
        description: repertoireDraftDescription.trim(),
      }),
    }));
    setEditingRepertoireId(null);
  }

  function openVariantSettings(variant: OpeningVariant) {
    setEditingVariantId(variant.id);
    setVariantDraftName(variant.name);
    setVariantDraftType(variant.contentType);
    setTrainableLineIds(
      variant.lineIds.filter((lineId) => areas.openings.lines[lineId]?.trainable),
    );
  }

  async function saveVariantSettings() {
    if (!editingVariantId || !variantDraftName.trim()) return;
    const variant = areas.openings.variants[editingVariantId];
    if (!variant) return;
    const repertoire = areas.openings.repertoires[variant.repertoireId];
    if (!repertoire) return;

    setBusy(true);
    setFeedback(null);
    try {
      let openings = updateOpeningVariant(areas.openings, variant.id, {
        name: variantDraftName.trim(),
        contentType: variantDraftType,
      });
      for (const lineId of variant.lineIds) {
        openings = updateOpeningLineTrainable(
          openings,
          lineId,
          variantDraftType === "theory" && trainableLineIds.includes(lineId),
        );
      }
      await persistOpeningOrganization(openings, repertoire.id);
      setEditingVariantId(null);
      setFeedback({ text: `Configuración de «${variantDraftName.trim()}» guardada.` });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "No se pudo actualizar la copia editable.",
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  async function openVariant(
    repertoire: OpeningRepertoire,
    variantId: string,
    mode: "analysis" | "practice" | "build",
  ): Promise<boolean> {
    const variant = areas.openings.variants[variantId];
    if (!variant) return false;
    try {
      await navigate({ to: "/" });
      await openFile(
        {
          type: "file",
          name: `${repertoire.name} · ${variant.name}`,
          path: repertoire.path,
          numGames: repertoire.variantIds.length,
          metadata: { type: "repertoire", tags: [] },
          lastModified: Date.now(),
        },
        setTabs,
        setActiveTab,
        {
          gameNumber: variant.trainingRecordIndex,
        },
      );
      if (mode !== "analysis") setPracticeUnit("line");
      if (mode === "practice") {
        const lineIds = variant.lineIds.filter((lineId) => areas.openings.lines[lineId]?.trainable);
        setPracticeTab("train");
        setOpeningPracticeQueue({
          gameNumbers: lineIds.map(() => variant.trainingRecordIndex),
          currentIndex: 0,
          repertoireId: repertoire.id,
          variantIds: lineIds.map(() => variant.id),
          lineIds,
        });
      }
      if (mode === "build") setPracticeTab("build");
      return true;
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? error.message
            : "No se pudo abrir el archivo asociado al repertorio.",
        color: "red",
      });
      return false;
    }
  }

  async function openRepertoirePractice(repertoire: OpeningRepertoire) {
    const variants = repertoire.variantIds
      .map((id) => areas.openings.variants[id])
      .filter((variant): variant is NonNullable<typeof variant> =>
        Boolean(variant && variant.contentType === "theory"),
      );
    const entries = variants.flatMap((variant) =>
      variant.lineIds
        .filter((lineId) => areas.openings.lines[lineId]?.trainable)
        .map((lineId) => ({ variant, lineId })),
    );
    if (entries.length === 0) {
      setFeedback({ text: "Este repertorio no tiene líneas entrenables.", color: "yellow" });
      return;
    }
    const opened = await openVariant(repertoire, entries[0].variant.id, "practice");
    if (!opened) return;
    setOpeningPracticeQueue({
      gameNumbers: entries.map(({ variant }) => variant.trainingRecordIndex),
      currentIndex: 0,
      repertoireId: repertoire.id,
      variantIds: entries.map(({ variant }) => variant.id),
      lineIds: entries.map(({ lineId }) => lineId),
    });
  }

  async function exportWorkingCopy(repertoire: OpeningRepertoire) {
    try {
      const defaultPath = await resolve(documentDir, `${repertoire.name} - editable.pgn`);
      const target = await save({
        defaultPath,
        filters: [{ name: "Portable Game Notation", extensions: ["pgn"] }],
      });
      if (!target) return;
      const outputPath = target.toLowerCase().endsWith(".pgn") ? target : `${target}.pgn`;
      if (outputPath !== repertoire.path) await copyFile(repertoire.path, outputPath);
      setFeedback({ text: `Copia editable de «${repertoire.name}» exportada.` });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "No se pudo exportar la copia editable.",
        color: "red",
      });
    }
  }

  async function openLinePractice(
    repertoire: OpeningRepertoire,
    variant: OpeningVariant,
    lineId: string,
  ) {
    const opened = await openVariant(repertoire, variant.id, "practice");
    if (!opened) return;
    setOpeningPracticeQueue({
      gameNumbers: [variant.trainingRecordIndex],
      currentIndex: 0,
      repertoireId: repertoire.id,
      variantIds: [variant.id],
      lineIds: [lineId],
    });
  }

  const sampleLineCount =
    inspection?.samples.reduce((sum, sample) => sum + sample.lineCount, 0) ?? 0;
  const sampleComments =
    inspection?.samples.reduce((sum, sample) => sum + sample.commentCount, 0) ?? 0;
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
            <Title order={2}>Entrenamiento de Aperturas</Title>
            <Text c="dimmed" mt={4} maw={820}>
              Crea, importa y practica tus repertorios de aperturas.
            </Text>
          </div>
        </Group>

        {feedback && (
          <Alert color={feedback.color} withCloseButton onClose={() => setFeedback(null)}>
            {feedback.text}
          </Alert>
        )}

        <Card
          withBorder
          shadow="sm"
          style={{ borderColor: "var(--mantine-color-blue-5)", order: 2 }}
        >
          <Stack>
            <Group>
              <IconPlus size={28} color="var(--mantine-color-blue-6)" />
              <div>
                <Text fw={700}>Crear repertorio desde cero</Text>
                <Text size="sm" c="dimmed">
                  Define el nombre y el color del repertorio; después podrás añadir variantes y
                  construirlas en el tablero.
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 3 }}>
              <TextInput
                label="Nombre"
                placeholder="Ej. Mi repertorio con blancas"
                value={createName}
                onChange={(event) => setCreateName(event.currentTarget.value)}
              />
              <TextInput
                label="Descripción"
                placeholder="Objetivo o estilo"
                value={createDescription}
                onChange={(event) => setCreateDescription(event.currentTarget.value)}
              />
              <Select
                label="Color"
                value={createColor}
                data={[
                  { value: "white", label: "Blancas" },
                  { value: "black", label: "Negras" },
                ]}
                onChange={(value) => value && setCreateColor(value as typeof createColor)}
              />
            </SimpleGrid>
            <Button
              color="blue"
              leftSection={<IconPlus size={16} />}
              loading={busy && inspection === null}
              onClick={createRepertoireFromScratch}
            >
              Crear y comenzar a construir
            </Button>
          </Stack>
        </Card>

        <Card withBorder style={{ order: 3 }}>
          <Stack>
            <Group>
              <IconUpload size={26} color="var(--mantine-color-blue-6)" />
              <div>
                <Text fw={600}>Importar repertorio PGN</Text>
                <Text size="sm" c="dimmed">
                  Revisa el archivo y elige qué ramas quieres practicar. Se creará una copia
                  editable completa; el archivo original permanecerá intacto.
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 2, lg: 4 }}>
              <TextInput
                label="Nombre"
                placeholder="Ej. Francesa con negras"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <TextInput
                label="Descripción"
                placeholder="Objetivo o procedencia"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
              <OpeningConfigFields config={config} onChange={setConfig} compact />
            </SimpleGrid>
            <Button
              color="blue"
              leftSection={<IconUpload size={16} />}
              loading={busy && inspection === null}
              onClick={selectImportFile}
            >
              Seleccionar archivo PGN
            </Button>
          </Stack>
        </Card>

        <div style={{ order: 1 }}>
          <Group justify="space-between" align="flex-end" wrap="wrap">
            <div>
              <Title order={3}>Mis repertorios</Title>
              <Text size="sm" c="dimmed">
                Consulta tus repertorios, practica sus líneas o continúa construyéndolos en el
                tablero.
              </Text>
            </div>
            <Stack gap="xs">
              <Switch
                label="Evaluar jugadas buenas fuera del repertorio"
                description="Usa el motor de referencia; desactivado aplica el repertorio estrictamente."
                checked={areas.openings.settings.evaluateOutsideRepertoire}
                onChange={(event) =>
                  setAreas((previous) => ({
                    ...previous,
                    openings: updateOpeningPracticeSettings(previous.openings, {
                      evaluateOutsideRepertoire: event.currentTarget.checked,
                    }),
                  }))
                }
              />
              <Switch
                label="Preguntar dificultad al terminar cada línea"
                description="Desactívalo para calcularla automáticamente con errores y tiempo."
                checked={areas.openings.settings.askLineDifficulty}
                onChange={(event) =>
                  setAreas((previous) => ({
                    ...previous,
                    openings: updateOpeningPracticeSettings(previous.openings, {
                      askLineDifficulty: event.currentTarget.checked,
                    }),
                  }))
                }
              />
            </Stack>
          </Group>
        </div>

        {repertoires.length === 0 ? (
          <Card withBorder>
            <Stack align="center" py="xl">
              <IconBook2 size={42} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">Todavía no hay repertorios registrados.</Text>
            </Stack>
          </Card>
        ) : (
          <DragDropContext onDragEnd={(result) => void handleOpeningDrag(result)}>
            <Accordion variant="separated" multiple>
              {repertoires.map((repertoire) => {
                const variants = repertoire.variantIds
                  .map((id) => areas.openings.variants[id])
                  .filter((variant): variant is NonNullable<typeof variant> => Boolean(variant));
                const lineCount = variants.reduce(
                  (sum, variant) => sum + variant.lineIds.length,
                  0,
                );
                const modelGameCount = variants.filter(
                  (variant) => variant.contentType === "modelGame",
                ).length;
                const repertoireMetrics = getOpeningRepertoireMetrics(
                  areas.openings,
                  repertoire.id,
                );
                return (
                  <Accordion.Item key={repertoire.id} value={repertoire.id}>
                    <Accordion.Control>
                      <Group justify="space-between" wrap="nowrap" pr="md">
                        <div>
                          <Text fw={600}>{repertoire.name}</Text>
                          <Text size="sm" c="dimmed">
                            {variants.length} variantes · {lineCount} líneas · copia editable
                            {modelGameCount > 0 ? ` · ${modelGameCount} partidas modelo` : ""}
                          </Text>
                        </div>
                        <Group gap="xs">
                          <Badge color="blue" variant="light">
                            {repertoire.color === "both"
                              ? "Ambos"
                              : repertoire.color === "white"
                                ? "Blancas"
                                : "Negras"}
                          </Badge>
                          <Badge variant="outline">
                            {repertoire.subvariationPolicy === "all"
                              ? "Todas las ramas"
                              : "Líneas principales"}
                          </Badge>
                          <Badge color="teal" variant="light">
                            Progreso {repertoireMetrics.progress}%
                          </Badge>
                          <Badge color="orange" variant="light">
                            Dificultad {repertoireMetrics.difficulty}%
                          </Badge>
                        </Group>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Group justify="space-between" mb="md">
                        {repertoire.description ? (
                          <Text size="sm" c="dimmed">
                            {repertoire.description}
                          </Text>
                        ) : (
                          <span />
                        )}
                        <Group gap="xs">
                          <Button
                            size="xs"
                            color="blue"
                            variant="light"
                            leftSection={<IconPlayerPlay size={14} />}
                            onClick={() => openRepertoirePractice(repertoire)}
                          >
                            Practicar repertorio
                          </Button>
                          <Button
                            size="xs"
                            variant="default"
                            leftSection={<IconDownload size={14} />}
                            onClick={() => void exportWorkingCopy(repertoire)}
                          >
                            Exportar copia
                          </Button>
                          <Button
                            size="xs"
                            variant="default"
                            leftSection={<IconSettings size={14} />}
                            onClick={() => openRepertoireSettings(repertoire)}
                          >
                            Editar repertorio
                          </Button>
                          <Button
                            size="xs"
                            variant="light"
                            leftSection={<IconPlus size={14} />}
                            onClick={() => setVariantRepertoireId(repertoire.id)}
                          >
                            Añadir variante
                          </Button>
                        </Group>
                      </Group>
                      <ScrollArea
                        h={Math.min(
                          680,
                          Math.max(
                            300,
                            variants.reduce(
                              (height, variant) =>
                                height + 112 + Math.min(variant.lineIds.length, 8) * 52,
                              0,
                            ),
                          ),
                        )}
                        type="auto"
                        offsetScrollbars
                      >
                        <Droppable
                          droppableId={`variants:${repertoire.id}`}
                          type={`VARIANT:${repertoire.id}`}
                        >
                          {(variantDrop) => (
                            <Stack
                              gap="xs"
                              pr="sm"
                              ref={variantDrop.innerRef}
                              {...variantDrop.droppableProps}
                            >
                              {variants.map((variant, variantIndex) => {
                                const lines = variant.lineIds
                                  .map((id) => areas.openings.lines[id])
                                  .filter((line): line is NonNullable<typeof line> =>
                                    Boolean(line),
                                  );
                                const trainable = lines.filter((line) => line.trainable).length;
                                const variantMetrics = getOpeningVariantMetrics(
                                  areas.openings,
                                  variant.id,
                                );
                                return (
                                  <Draggable
                                    key={variant.id}
                                    draggableId={variant.id}
                                    index={variantIndex}
                                    isDragDisabled={busy}
                                  >
                                    {(variantDrag) => (
                                      <Card
                                        withBorder
                                        padding="sm"
                                        ref={variantDrag.innerRef}
                                        {...variantDrag.draggableProps}
                                      >
                                        <Group
                                          justify="space-between"
                                          wrap="nowrap"
                                          align="flex-start"
                                        >
                                          <ActionIcon
                                            variant="subtle"
                                            color="gray"
                                            aria-label="Arrastrar variante"
                                            {...variantDrag.dragHandleProps}
                                          >
                                            <IconGripVertical size={17} />
                                          </ActionIcon>
                                          <div style={{ minWidth: 0 }}>
                                            <Group gap="xs">
                                              <Text fw={500} truncate>
                                                {variant.name}
                                              </Text>
                                              {variant.contentType === "modelGame" && (
                                                <Badge color="violet" size="sm">
                                                  Partida modelo
                                                </Badge>
                                              )}
                                              <Badge color="teal" size="sm" variant="light">
                                                {variantMetrics.progress}%
                                              </Badge>
                                              <Badge color="orange" size="sm" variant="light">
                                                Dif. {variantMetrics.difficulty}%
                                              </Badge>
                                            </Group>
                                            <Text size="xs" c="dimmed">
                                              {`${lines.length} líneas · ${variant.commentCount} comentarios`}
                                              {variant.hasVariations
                                                ? " · contiene subvariantes"
                                                : ""}
                                            </Text>
                                          </div>
                                          <Group gap="xs" wrap="nowrap">
                                            <ActionIcon
                                              size="lg"
                                              variant="subtle"
                                              aria-label="Configurar variante"
                                              onClick={() => openVariantSettings(variant)}
                                            >
                                              <IconSettings size={16} />
                                            </ActionIcon>
                                            <Button
                                              size="xs"
                                              variant="default"
                                              leftSection={<IconFileSearch size={14} />}
                                              onClick={() =>
                                                openVariant(repertoire, variant.id, "analysis")
                                              }
                                            >
                                              Editar y analizar
                                            </Button>
                                            {variant.contentType === "theory" && (
                                              <Button
                                                size="xs"
                                                variant="default"
                                                leftSection={<IconPlus size={14} />}
                                                onClick={() =>
                                                  openVariant(repertoire, variant.id, "build")
                                                }
                                              >
                                                Añadir línea
                                              </Button>
                                            )}
                                            <Button
                                              size="xs"
                                              color="blue"
                                              variant="light"
                                              disabled={
                                                variant.contentType === "modelGame" ||
                                                trainable === 0
                                              }
                                              leftSection={<IconPlayerPlay size={14} />}
                                              onClick={() =>
                                                openVariant(repertoire, variant.id, "practice")
                                              }
                                            >
                                              Practicar
                                            </Button>
                                          </Group>
                                        </Group>
                                        <Droppable droppableId={`lines:${variant.id}`} type="LINE">
                                          {(lineDrop) => (
                                            <Stack
                                              gap={5}
                                              mt="sm"
                                              ref={lineDrop.innerRef}
                                              {...lineDrop.droppableProps}
                                            >
                                              {lines.map((line, lineIndex) => {
                                                const lineMetrics = getOpeningLineMetrics(line);
                                                return (
                                                  <Draggable
                                                    key={line.id}
                                                    draggableId={line.id}
                                                    index={lineIndex}
                                                    isDragDisabled={busy}
                                                  >
                                                    {(lineDrag) => (
                                                      <Card
                                                        padding="xs"
                                                        withBorder
                                                        ref={lineDrag.innerRef}
                                                        {...lineDrag.draggableProps}
                                                      >
                                                        <Group
                                                          justify="space-between"
                                                          wrap="nowrap"
                                                        >
                                                          <Group
                                                            gap="xs"
                                                            wrap="nowrap"
                                                            style={{ minWidth: 0 }}
                                                          >
                                                            <ActionIcon
                                                              size="sm"
                                                              variant="subtle"
                                                              color="gray"
                                                              aria-label="Arrastrar línea"
                                                              {...lineDrag.dragHandleProps}
                                                            >
                                                              <IconGripVertical size={14} />
                                                            </ActionIcon>
                                                            <div style={{ minWidth: 0 }}>
                                                              <Text size="sm" fw={500} truncate>
                                                                {line.name}
                                                              </Text>
                                                              <Text size="xs" c="dimmed">
                                                                {line.plyCount} plies · progreso{" "}
                                                                {lineMetrics.progress}% · dificultad{" "}
                                                                {lineMetrics.difficulty}%
                                                              </Text>
                                                            </div>
                                                          </Group>
                                                          <Group gap={4} wrap="nowrap">
                                                            <Checkbox
                                                              size="xs"
                                                              label="Entrenar"
                                                              checked={line.trainable}
                                                              disabled={
                                                                variant.contentType ===
                                                                  "modelGame" || busy
                                                              }
                                                              onChange={async (event) => {
                                                                const openings =
                                                                  updateOpeningLineTrainable(
                                                                    areas.openings,
                                                                    line.id,
                                                                    event.currentTarget.checked,
                                                                  );
                                                                setBusy(true);
                                                                try {
                                                                  await persistOpeningOrganization(
                                                                    openings,
                                                                    repertoire.id,
                                                                  );
                                                                } catch (error) {
                                                                  setFeedback({
                                                                    text:
                                                                      error instanceof Error
                                                                        ? error.message
                                                                        : "No se pudo actualizar la copia editable.",
                                                                    color: "red",
                                                                  });
                                                                } finally {
                                                                  setBusy(false);
                                                                }
                                                              }}
                                                            />
                                                            <ActionIcon
                                                              size="sm"
                                                              color="blue"
                                                              variant="light"
                                                              aria-label={`Practicar ${line.name}`}
                                                              disabled={
                                                                variant.contentType ===
                                                                  "modelGame" ||
                                                                !line.trainable ||
                                                                busy
                                                              }
                                                              onClick={() =>
                                                                void openLinePractice(
                                                                  repertoire,
                                                                  variant,
                                                                  line.id,
                                                                )
                                                              }
                                                            >
                                                              <IconPlayerPlay size={14} />
                                                            </ActionIcon>
                                                            <ActionIcon
                                                              size="sm"
                                                              variant="subtle"
                                                              aria-label="Renombrar línea"
                                                              onClick={() => {
                                                                setEditingLineId(line.id);
                                                                setLineDraftName(line.name);
                                                              }}
                                                            >
                                                              <IconPencil size={14} />
                                                            </ActionIcon>
                                                            <ActionIcon
                                                              size="sm"
                                                              color="red"
                                                              variant="subtle"
                                                              aria-label="Eliminar línea"
                                                              onClick={() =>
                                                                setDeletingLineId(line.id)
                                                              }
                                                            >
                                                              <IconTrash size={14} />
                                                            </ActionIcon>
                                                          </Group>
                                                        </Group>
                                                      </Card>
                                                    )}
                                                  </Draggable>
                                                );
                                              })}
                                              {lineDrop.placeholder}
                                              {lines.length === 0 && (
                                                <Text size="xs" c="dimmed" ta="center" py={4}>
                                                  Construye una línea en el tablero o suelta aquí
                                                  una línea de otra variante.
                                                </Text>
                                              )}
                                            </Stack>
                                          )}
                                        </Droppable>
                                      </Card>
                                    )}
                                  </Draggable>
                                );
                              })}
                              {variantDrop.placeholder}
                            </Stack>
                          )}
                        </Droppable>
                      </ScrollArea>
                    </Accordion.Panel>
                  </Accordion.Item>
                );
              })}
            </Accordion>
          </DragDropContext>
        )}
      </Stack>

      <Modal
        opened={inspection !== null}
        onClose={() => !busy && setInspection(null)}
        title="Revisar importación de Aperturas"
        size="xl"
        closeOnClickOutside={!busy}
      >
        {inspection && (
          <Stack>
            <Alert color={sampleErrors > 0 ? "yellow" : "blue"}>
              <Text fw={600}>{inspection.filename}</Text>
              <Text size="sm">
                {inspection.recordCount} capítulos. En la muestra: {sampleLineCount} líneas,{" "}
                {sampleComments} comentarios y {sampleErrors} registros inválidos.
              </Text>
            </Alert>
            <OpeningConfigFields config={config} onChange={setConfig} />
            <Text size="xs" c="dimmed">
              Esta política solo decide qué líneas empiezan marcadas para entrenar. La copia
              editable conserva todas las ramas y el archivo original no se modifica.
            </Text>
            <ScrollArea h={260} type="auto" offsetScrollbars>
              <Stack gap="xs" pr="sm">
                {inspection.samples.map((sample) => (
                  <Card key={sample.index} withBorder padding="xs">
                    <Group justify="space-between" wrap="nowrap">
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={500} truncate>
                          {sample.index + 1}. {sample.name}
                        </Text>
                        <Text size="xs" c={sample.error ? "red" : "dimmed"}>
                          {sample.error ||
                            `${sample.lineCount} líneas · ${sample.commentCount} comentarios${
                              sample.hasVariations ? " · subvariantes" : ""
                            }`}
                        </Text>
                      </div>
                      {sample.contentType === "modelGame" && (
                        <Badge color="violet">Partida modelo</Badge>
                      )}
                    </Group>
                  </Card>
                ))}
              </Stack>
            </ScrollArea>
            <Group justify="flex-end">
              <Button variant="default" disabled={busy} onClick={() => setInspection(null)}>
                Cancelar
              </Button>
              <Button color="blue" loading={busy} onClick={confirmImport}>
                Importar repertorio
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={variantRepertoireId !== null}
        onClose={() => {
          if (busy) return;
          setVariantRepertoireId(null);
          setVariantName("");
        }}
        title="Añadir variante"
        size="sm"
      >
        <Stack>
          <TextInput
            label="Nombre de la variante"
            placeholder="Ej. Siciliana Najdorf"
            value={variantName}
            onChange={(event) => setVariantName(event.currentTarget.value)}
            data-autofocus
          />
          <Text size="xs" c="dimmed">
            Se creará un capítulo vacío en la copia editable. Podrás construir sus líneas
            directamente con el tablero o mover líneas existentes hasta él.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setVariantRepertoireId(null)}>
              Cancelar
            </Button>
            <Button
              color="blue"
              loading={busy}
              disabled={!variantName.trim()}
              onClick={addVariantFromScratch}
            >
              Añadir variante
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={editingLineId !== null}
        onClose={() => setEditingLineId(null)}
        title="Renombrar línea"
        size="sm"
      >
        <Stack>
          <TextInput
            label="Nombre"
            value={lineDraftName}
            onChange={(event) => setLineDraftName(event.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditingLineId(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!lineDraftName.trim()}
              onClick={() => {
                if (!editingLineId) return;
                setAreas((previous) => ({
                  ...previous,
                  openings: renameOpeningLine(previous.openings, editingLineId, lineDraftName),
                }));
                setEditingLineId(null);
              }}
            >
              Guardar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={deletingLineId !== null}
        onClose={() => !busy && setDeletingLineId(null)}
        title="Eliminar línea del gestor"
        size="sm"
      >
        <Stack>
          <Text size="sm">
            La línea dejará de aparecer y de entrenarse. Esta acción no elimina ni reescribe el PGN
            fuente importado.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" disabled={busy} onClick={() => setDeletingLineId(null)}>
              Cancelar
            </Button>
            <Button color="red" loading={busy} onClick={confirmDeleteLine}>
              Eliminar del gestor
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={editingRepertoireId !== null}
        onClose={() => !busy && setEditingRepertoireId(null)}
        title="Editar repertorio"
        size="sm"
      >
        <Stack>
          <TextInput
            label="Nombre"
            value={repertoireDraftName}
            onChange={(event) => setRepertoireDraftName(event.currentTarget.value)}
            data-autofocus
          />
          <TextInput
            label="Descripción"
            value={repertoireDraftDescription}
            onChange={(event) => setRepertoireDraftDescription(event.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditingRepertoireId(null)}>
              Cancelar
            </Button>
            <Button disabled={!repertoireDraftName.trim()} onClick={saveRepertoireSettings}>
              Guardar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={editingVariantId !== null}
        onClose={() => !busy && setEditingVariantId(null)}
        title="Configurar variante"
        size="lg"
      >
        {editingVariantId && areas.openings.variants[editingVariantId] && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label="Nombre"
                value={variantDraftName}
                onChange={(event) => setVariantDraftName(event.currentTarget.value)}
                data-autofocus
              />
              <Select
                label="Tipo de contenido"
                value={variantDraftType}
                data={[
                  { value: "theory", label: "Teoría entrenable" },
                  { value: "modelGame", label: "Partida modelo (solo análisis)" },
                ]}
                onChange={(value) =>
                  value && setVariantDraftType(value as OpeningVariant["contentType"])
                }
              />
            </SimpleGrid>
            {areas.openings.variants[editingVariantId].lineIds.length > 0 && (
              <>
                <div>
                  <Text fw={600} size="sm">
                    Líneas que se incluirán al entrenar
                  </Text>
                  <Text size="xs" c="dimmed">
                    Esta selección cambia la cola de práctica sin eliminar ramas de la copia
                    editable; el PGN fuente no se modifica.
                  </Text>
                </div>
                <ScrollArea h={260} type="auto" offsetScrollbars>
                  <Stack gap="xs" pr="sm">
                    {areas.openings.variants[editingVariantId].lineIds.map((lineId) => {
                      const line = areas.openings.lines[lineId];
                      if (!line) return null;
                      return (
                        <Checkbox
                          key={line.id}
                          label={line.name}
                          description={`${line.plyCount} jugadas de medio movimiento`}
                          disabled={variantDraftType === "modelGame"}
                          checked={
                            variantDraftType === "theory" && trainableLineIds.includes(line.id)
                          }
                          onChange={(event) =>
                            setTrainableLineIds((current) =>
                              event.currentTarget.checked
                                ? [...current, line.id]
                                : current.filter((id) => id !== line.id),
                            )
                          }
                        />
                      );
                    })}
                  </Stack>
                </ScrollArea>
              </>
            )}
            <Group justify="flex-end">
              <Button variant="default" disabled={busy} onClick={() => setEditingVariantId(null)}>
                Cancelar
              </Button>
              <Button
                loading={busy}
                disabled={!variantDraftName.trim()}
                onClick={saveVariantSettings}
              >
                Guardar y actualizar entrenamiento
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Container>
  );
}

function OpeningConfigFields({
  config,
  onChange,
  compact = false,
}: {
  config: OpeningImportConfig;
  onChange: (config: OpeningImportConfig) => void;
  compact?: boolean;
}) {
  const fields = (
    <>
      <Select
        label="Color del repertorio"
        value={config.color}
        data={[
          { value: "white", label: "Blancas" },
          { value: "black", label: "Negras" },
          { value: "both", label: "Ambos colores" },
        ]}
        onChange={(value) =>
          value && onChange({ ...config, color: value as OpeningImportConfig["color"] })
        }
      />
      <Select
        label="Ramas entrenables"
        value={config.subvariationPolicy}
        data={[
          { value: "mainline", label: "Solo líneas principales" },
          { value: "all", label: "Todas las subvariantes" },
        ]}
        onChange={(value) =>
          value &&
          onChange({
            ...config,
            subvariationPolicy: value as OpeningImportConfig["subvariationPolicy"],
          })
        }
      />
    </>
  );
  return compact ? fields : <SimpleGrid cols={{ base: 1, sm: 2 }}>{fields}</SimpleGrid>;
}
