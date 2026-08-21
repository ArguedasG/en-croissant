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
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  IconArrowLeft,
  IconArrowDown,
  IconArrowUp,
  IconBook2,
  IconFileSearch,
  IconPlus,
  IconPlayerPlay,
  IconSettings,
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
  moveOpeningVariant,
  type OpeningVariant,
  type OpeningRepertoire,
  updateOpeningLineTrainable,
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
    if (!repertoire || repertoire.sourcePath !== repertoire.path) return;
    setBusy(true);
    try {
      const name = variantName.trim();
      const orientation = repertoire.color === "black" ? "black" : "white";
      const pgn = `${headersToPGN({
        id: repertoire.recordCount,
        fen: INITIAL_FEN,
        black: "",
        white: "",
        result: "*",
        event: name,
        site: "",
        orientation,
      })}\n*`;
      await writeTextFile(repertoire.path, `\n\n${pgn}\n`, { append: true });
      setAreas((previous) => ({
        ...previous,
        openings: addBlankOpeningVariant(previous.openings, variantRepertoireId, name),
      }));
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
        filename: `${repertoireName} - Entrenamiento`,
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
      if (repertoire.sourcePath !== repertoire.path) {
        const pgn = await buildOpeningTrainingPgn(openings, repertoire.id);
        await writeTextFile(repertoire.path, pgn);
      }
      setAreas({ ...areas, openings });
      setEditingVariantId(null);
      setFeedback({ text: `Configuración de «${variantDraftName.trim()}» guardada.` });
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? error.message
            : "No se pudo actualizar el archivo de entrenamiento.",
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
      const analysis = mode === "analysis";
      await navigate({ to: "/" });
      await openFile(
        {
          type: "file",
          name: `${repertoire.name} · ${variant.name}`,
          path: analysis ? repertoire.sourcePath : repertoire.path,
          numGames: analysis ? repertoire.recordCount : repertoire.variantIds.length,
          metadata: { type: analysis ? "game" : "repertoire", tags: [] },
          lastModified: Date.now(),
        },
        setTabs,
        setActiveTab,
        {
          gameNumber: analysis ? variant.sourceRecordIndex : variant.trainingRecordIndex,
        },
      );
      if (mode !== "analysis") setPracticeUnit("line");
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
      .filter((variant): variant is NonNullable<typeof variant> => {
        if (!variant || variant.contentType !== "theory") return false;
        if (repertoire.sourcePath === repertoire.path) return true;
        return variant.lineIds.some((lineId) => areas.openings.lines[lineId]?.trainable);
      });
    if (variants.length === 0) {
      setFeedback({ text: "Este repertorio no tiene variantes entrenables.", color: "yellow" });
      return;
    }
    const opened = await openVariant(repertoire, variants[0].id, "practice");
    if (!opened) return;
    setOpeningPracticeQueue({
      gameNumbers: variants.map((variant) => variant.trainingRecordIndex),
      currentIndex: 0,
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
                  Revisa el archivo y elige qué ramas quieres practicar. El contenido original se
                  conservará para consultarlo y analizarlo.
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
          <Title order={3}>Mis repertorios</Title>
          <Text size="sm" c="dimmed">
            Consulta tus repertorios, practica sus líneas o continúa construyéndolos en el tablero.
          </Text>
        </div>

        {repertoires.length === 0 ? (
          <Card withBorder>
            <Stack align="center" py="xl">
              <IconBook2 size={42} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">Todavía no hay repertorios registrados.</Text>
            </Stack>
          </Card>
        ) : (
          <Accordion variant="separated" multiple>
            {repertoires.map((repertoire) => {
              const variants = repertoire.variantIds
                .map((id) => areas.openings.variants[id])
                .filter((variant): variant is NonNullable<typeof variant> => Boolean(variant));
              const lineCount = variants.reduce((sum, variant) => sum + variant.lineIds.length, 0);
              const modelGameCount = variants.filter(
                (variant) => variant.contentType === "modelGame",
              ).length;
              const editableFromScratch = repertoire.sourcePath === repertoire.path;
              return (
                <Accordion.Item key={repertoire.id} value={repertoire.id}>
                  <Accordion.Control>
                    <Group justify="space-between" wrap="nowrap" pr="md">
                      <div>
                        <Text fw={600}>{repertoire.name}</Text>
                        <Text size="sm" c="dimmed">
                          {variants.length} variantes ·{" "}
                          {editableFromScratch ? "editable en tablero" : `${lineCount} líneas`}
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
                          leftSection={<IconSettings size={14} />}
                          onClick={() => openRepertoireSettings(repertoire)}
                        >
                          Editar repertorio
                        </Button>
                        {repertoire.sourcePath === repertoire.path && (
                          <Button
                            size="xs"
                            variant="light"
                            leftSection={<IconPlus size={14} />}
                            onClick={() => setVariantRepertoireId(repertoire.id)}
                          >
                            Añadir variante
                          </Button>
                        )}
                      </Group>
                    </Group>
                    <ScrollArea h={Math.min(520, Math.max(160, variants.length * 112))}>
                      <Stack gap="xs" pr="sm">
                        {variants.map((variant, variantIndex) => {
                          const lines = variant.lineIds
                            .map((id) => areas.openings.lines[id])
                            .filter((line): line is NonNullable<typeof line> => Boolean(line));
                          const trainable = lines.filter((line) => line.trainable).length;
                          return (
                            <Card key={variant.id} withBorder padding="sm">
                              <Group justify="space-between" wrap="nowrap" align="flex-start">
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
                                  </Group>
                                  <Text size="xs" c="dimmed">
                                    {editableFromScratch && lines.length === 0
                                      ? "Contenido editable en el tablero"
                                      : `${lines.length} líneas · ${variant.commentCount} comentarios`}
                                    {variant.hasVariations ? " · contiene subvariantes" : ""}
                                  </Text>
                                  {lines.length > 0 && (
                                    <Text size="xs" c="dimmed" mt={4} lineClamp={1}>
                                      {lines
                                        .slice(0, 3)
                                        .map((line) => line.name)
                                        .join(" · ")}
                                    </Text>
                                  )}
                                </div>
                                <Group gap="xs" wrap="nowrap">
                                  <ActionIcon
                                    size="lg"
                                    variant="subtle"
                                    disabled={variantIndex === 0}
                                    aria-label="Subir variante"
                                    onClick={() =>
                                      setAreas((previous) => ({
                                        ...previous,
                                        openings: moveOpeningVariant(
                                          previous.openings,
                                          repertoire.id,
                                          variant.id,
                                          "up",
                                        ),
                                      }))
                                    }
                                  >
                                    <IconArrowUp size={16} />
                                  </ActionIcon>
                                  <ActionIcon
                                    size="lg"
                                    variant="subtle"
                                    disabled={variantIndex === variants.length - 1}
                                    aria-label="Bajar variante"
                                    onClick={() =>
                                      setAreas((previous) => ({
                                        ...previous,
                                        openings: moveOpeningVariant(
                                          previous.openings,
                                          repertoire.id,
                                          variant.id,
                                          "down",
                                        ),
                                      }))
                                    }
                                  >
                                    <IconArrowDown size={16} />
                                  </ActionIcon>
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
                                    onClick={() => openVariant(repertoire, variant.id, "analysis")}
                                  >
                                    Analizar
                                  </Button>
                                  {editableFromScratch && (
                                    <Button
                                      size="xs"
                                      variant="default"
                                      leftSection={<IconPlus size={14} />}
                                      onClick={() => openVariant(repertoire, variant.id, "build")}
                                    >
                                      Construir
                                    </Button>
                                  )}
                                  <Button
                                    size="xs"
                                    color="blue"
                                    variant="light"
                                    disabled={
                                      variant.contentType === "modelGame" ||
                                      (!editableFromScratch && trainable === 0)
                                    }
                                    leftSection={<IconPlayerPlay size={14} />}
                                    onClick={() => openVariant(repertoire, variant.id, "practice")}
                                  >
                                    Practicar
                                  </Button>
                                </Group>
                              </Group>
                            </Card>
                          );
                        })}
                      </Stack>
                    </ScrollArea>
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
          </Accordion>
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
              Cambiar esta política no elimina ramas del archivo original. Solo determina qué árbol
              se copia al archivo de entrenamiento.
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
            Se creará un capítulo vacío. Después podrás abrirlo con “Construir” y añadir sus líneas
            directamente en el tablero.
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
                    Esta selección solo reconstruye la copia de entrenamiento; el PGN fuente no se
                    modifica.
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
