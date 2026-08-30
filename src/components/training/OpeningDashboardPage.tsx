import { useTranslation as useTrainingTranslation } from "react-i18next";
import i18n from "i18next";
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
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { copyFile, exists, writeTextFile } from "@tauri-apps/plugin-fs";
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
  currentTabSelectedAtom,
  currentPracticeUnitAtom,
  currentOpeningPracticeQueueAtom,
  tabsAtom,
} from "@/state/atoms";
import { trainingAreasAtom } from "@/state/trainingAreas";
import { commands } from "@/bindings";
import { unwrap } from "@/utils/unwrap";
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
import { useTranslation } from "react-i18next";
import RepertoireAdditionModal from "./RepertoireAdditionModal";

function filename(path: string, trainingT: typeof i18n.t = i18n.t): string {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || trainingT("Training.Copy.Repertoire.5125381b", "Repertoire")
  );
}

const defaultConfig: OpeningImportConfig = {
  color: "white",
  subvariationPolicy: "all",
};

export default function OpeningDashboardPage() {
  const { t } = useTranslation();
  const [additionTarget, setAdditionTarget] = useState<{
    repertoireId: string;
    variantId?: string;
  } | null>(null);
  const navigate = useNavigate();
  const { documentDir } = useLoaderData({ from: "/training/openings" });
  const [areas, setAreas] = useAtom(trainingAreasAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const [, setPracticeTab] = useAtom(currentPracticeTabAtom);
  const [, setSelectedPanel] = useAtom(currentTabSelectedAtom);
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
      setFeedback({
        text: t("Training.Copy.Enteranameforthe.a8416594", "Enter a name for the repertoire."),
        color: "red",
      });
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
              name: t("Training.Copy.Mainline.49e68e3d", "Main line"),
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
        text:
          error instanceof Error
            ? error.message
            : t(
                "Training.Copy.Couldnotcreatetherepertoire.3648670e",
                "Could not create the repertoire.",
              ),
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  }

  async function selectImportFile() {
    const selected = await open({
      multiple: false,
      filters: [
        { name: t("Training.Copy.RepertoirePGN.19310184", "Repertoire PGN"), extensions: ["pgn"] },
      ],
    });
    if (typeof selected !== "string") return;

    setBusy(true);
    setFeedback(null);
    try {
      const nextInspection = await inspectOpeningPgn(selected, config);
      if (nextInspection.recordCount === 0)
        throw new Error(
          t("Training.Copy.ThePGNcontainsnochapters.5d1c6941", "The PGN contains no chapters."),
        );
      setInspection(nextInspection);
      if (!name.trim()) setName(filename(selected, t));
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? error.message
            : t(
                "Training.Copy.Couldnotinspecttherepertoire.9c9493bb",
                "Could not inspect the repertoire.",
              ),
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
      setFeedback({
        text: t(
          "Training.Copy.Variationv0addedtov1.bbb30522",
          "Variation “{{v0}}” added to {{v1}}.",
          { v0: name, v1: repertoire.name },
        ),
      });
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? error.message
            : t("Training.Copy.Couldnotaddthevariation.9e48a0e7", "Could not add the variation."),
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
    setAreas((current) => ({ ...current, openings }));
    unwrap(await commands.countPgnGames(repertoire.path));
  }

  async function handleOpeningDrag(result: DropResult) {
    if (!result.destination) return;
    let openings = areas.openings;
    let repertoireId: string | undefined;
    if (result.type.startsWith("VARIANT:")) {
      repertoireId = result.type.slice("VARIANT:".length);
      const ids = openings.repertoires[repertoireId].variantIds;
      const theoryIds = ids.filter((id) => openings.variants[id]?.contentType === "theory");
      openings = reorderOpeningVariant(
        openings,
        repertoireId,
        ids.indexOf(result.draggableId),
        ids.indexOf(theoryIds[result.destination.index]),
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
        text:
          error instanceof Error
            ? error.message
            : t(
                "Training.Copy.Couldnotreorganizetherepertoire.d4e93967",
                "Could not reorganize the repertoire.",
              ),
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
        text: t(
          "Training.Copy.Linev0removedfromthe.56de0bfe",
          "Line “{{v0}}” removed from the manager; the source PGN remains untouched.",
          { v0: line.name },
        ),
      });
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? error.message
            : t("Training.Copy.Couldnotdeletetheline.6cd5c536", "Could not delete the line."),
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
        throw new Error(
          t(
            "Training.Copy.Couldnotprepareanyvalid.d3cbba1a",
            "Could not prepare any valid chapters.",
          ),
        );
      }
      const repertoireName = name.trim() || filename(inspection.path, t);
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
        text: t(
          "Training.Copy.Repertoirev0importedwithv1.109a9e0f",
          "Repertoire “{{v0}}” imported with {{v1}} variations{{v2}}.",
          {
            v0: repertoireName,
            v1: prepared.variants.length,
            v2:
              prepared.skippedRecords > 0 ? `; ${prepared.skippedRecords} registros omitidos` : "",
          },
        ),
      });
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? error.message
            : t(
                "Training.Copy.Couldnotimporttherepertoire.8d7bcf4d",
                "Could not import the repertoire.",
              ),
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
      setFeedback({
        text: t("Training.Copy.Settingsforv0saved.1e25b554", "Settings for “{{v0}}” saved.", {
          v0: variantDraftName.trim(),
        }),
      });
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? error.message
            : t(
                "Training.Copy.Couldnotupdatetheeditable.ee7dfced",
                "Could not update the editable copy.",
              ),
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
      if (mode === "analysis") setSelectedPanel("info");
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
            : t(
                "Training.Copy.Couldnotopentherepertoire.e1bcc7b9",
                "Could not open the repertoire file.",
              ),
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
      setFeedback({
        text: t(
          "Training.Copy.Thisrepertoirehasnotrainable.717541d6",
          "This repertoire has no trainable lines.",
        ),
        color: "yellow",
      });
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
      const normalizePath = (path: string) => path.replace(/\\/g, "/").toLowerCase();
      if (
        [repertoire.path, repertoire.sourcePath].some(
          (path) => path && normalizePath(path) === normalizePath(outputPath),
        )
      ) {
        throw new Error(
          t("Pgn.DifferentPath", "Choose a different file to preserve the source PGN."),
        );
      }
      if (
        (await exists(outputPath)) &&
        !(await ask(
          t("Pgn.Overwrite", "Replace the entire existing file? {{path}}", { path: outputPath }),
          { kind: "warning" },
        ))
      )
        return;
      await copyFile(repertoire.path, outputPath);
      setFeedback({
        text: t(
          "Training.Copy.Editablecopyofv0exported.88b7891b",
          "Editable copy of “{{v0}}” exported.",
          { v0: repertoire.name },
        ),
      });
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? error.message
            : t(
                "Training.Copy.Couldnotexporttheeditable.e7a8ab0a",
                "Could not export the editable copy.",
              ),
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
      {additionTarget && (
        <RepertoireAdditionModal
          initialRepertoireId={additionTarget.repertoireId}
          initialVariantId={additionTarget.variantId}
          onClose={() => setAdditionTarget(null)}
        />
      )}
      <Stack gap="lg">
        <Group align="flex-start">
          <Button
            component={Link}
            to="/training"
            variant="subtle"
            p="xs"
            aria-label={t("Training.Copy.Backtotraining.f928bfe5", "Back to training")}
          >
            <IconArrowLeft size={20} />
          </Button>
          <div>
            <Title order={2}>
              {t("Training.Copy.Openingtraining.268bdba9", "Opening training")}
            </Title>
            <Text c="dimmed" mt={4} maw={820}>
              {" "}
              {t(
                "Training.Copy.Createimportandpracticeyour.23a91199",
                "Create, import, and practice your opening repertoires.",
              )}{" "}
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
                <Text fw={700}>
                  {t(
                    "Training.Copy.Createarepertoirefromscratch.7b3b4fef",
                    "Create a repertoire from scratch",
                  )}
                </Text>
                <Text size="sm" c="dimmed">
                  {" "}
                  {t(
                    "Training.Copy.Settherepertoiresname.7c1c5551",
                    "Set the repertoire's name and color, then add variations and build them on the board.",
                  )}{" "}
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 3 }}>
              <TextInput
                label={t("Training.Copy.Name.562bb157", "Name")}
                placeholder={t(
                  "Training.Copy.egMyWhiterepertoire.ba1915a4",
                  "e.g. My White repertoire",
                )}
                value={createName}
                onChange={(event) => setCreateName(event.currentTarget.value)}
              />
              <TextInput
                label={t("Training.Copy.Description.ee00b96f", "Description")}
                placeholder={t("Training.Copy.Goalorstyle.59aa131a", "Goal or style")}
                value={createDescription}
                onChange={(event) => setCreateDescription(event.currentTarget.value)}
              />
              <Select
                label={t("Training.Copy.Color.6b73191a", "Color")}
                value={createColor}
                data={[
                  { value: "white", label: t("Training.Copy.White.9666a8c0", "White") },
                  { value: "black", label: t("Training.Copy.Black.ead8fe1f", "Black") },
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
              {" "}
              {t("Training.Copy.Createandstartbuilding.c91ef9ae", "Create and start building")}{" "}
            </Button>
          </Stack>
        </Card>

        <Card withBorder style={{ order: 3 }}>
          <Stack>
            <Group>
              <IconUpload size={26} color="var(--mantine-color-blue-6)" />
              <div>
                <Text fw={600}>
                  {t("Training.Copy.ImportPGNrepertoire.bc0efff0", "Import PGN repertoire")}
                </Text>
                <Text size="sm" c="dimmed">
                  {" "}
                  {t(
                    "Training.Copy.Reviewthefileandchoose.d26d10d6",
                    "Review the file and choose which branches to practice. A complete editable copy will be created; the original file remains untouched.",
                  )}{" "}
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 2, lg: 4 }}>
              <TextInput
                label={t("Training.Copy.Name.562bb157", "Name")}
                placeholder={t(
                  "Training.Copy.egFrenchDefenseas.0e31cdee",
                  "e.g. French Defense as Black",
                )}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <TextInput
                label={t("Training.Copy.Description.ee00b96f", "Description")}
                placeholder={t("Training.Copy.Goalorsource.c0fc0731", "Goal or source")}
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
              {" "}
              {t("Training.Copy.SelectPGNfile.ab7fed1d", "Select PGN file")}{" "}
            </Button>
          </Stack>
        </Card>

        <div style={{ order: 1 }}>
          <Group justify="space-between" align="flex-end" wrap="wrap">
            <div>
              <Title order={3}>{t("Training.Copy.Myrepertoires.dee522b9", "My repertoires")}</Title>
              <Text size="sm" c="dimmed">
                {" "}
                {t(
                  "Training.Copy.Browseyourrepertoirespracticetheir.97f5fa80",
                  "Browse your repertoires, practice their lines, or continue building them on the board.",
                )}{" "}
              </Text>
            </div>
            <Stack gap="xs">
              <Switch
                label={t(
                  "Training.Copy.Evaluategoodmovesoutsidethe.beca9e02",
                  "Evaluate good moves outside the repertoire",
                )}
                description={t(
                  "Training.Copy.Usesthereferenceenginewhen.01c86acc",
                  "Uses the reference engine; when disabled, only repertoire moves are accepted.",
                )}
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
                label={t(
                  "Training.Copy.Askfordifficultyaftereach.a5c56b3e",
                  "Ask for difficulty after each line",
                )}
                description={t(
                  "Training.Copy.Turnthisofftocalculate.64fe2614",
                  "Turn this off to calculate it automatically from mistakes and time.",
                )}
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
              <Text c="dimmed">
                {t("Training.Copy.Norepertoiresyet.24e289d9", "No repertoires yet.")}
              </Text>
            </Stack>
          </Card>
        ) : (
          <DragDropContext onDragEnd={(result) => void handleOpeningDrag(result)}>
            <Accordion variant="separated" multiple>
              {repertoires.map((repertoire) => {
                const variants = repertoire.variantIds
                  .map((id) => areas.openings.variants[id])
                  .filter((variant): variant is NonNullable<typeof variant> => Boolean(variant));
                const theoryVariants = variants.filter(
                  (variant) => variant.contentType === "theory",
                );
                const lineCount = theoryVariants.reduce(
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
                            {theoryVariants.length}{" "}
                            {t("Training.Copy.variations.ca95a410", "variations ·")} {lineCount}{" "}
                            {t("Training.Copy.lineseditablecopy.f156ce59", "lines · editable copy")}{" "}
                            {modelGameCount > 0
                              ? t("Training.Copy.v0modelgames.f637b000", " · {{v0}} model games", {
                                  v0: modelGameCount,
                                })
                              : ""}
                          </Text>
                        </div>
                        <Group gap="xs">
                          <Badge color="blue" variant="light">
                            {repertoire.color === "both"
                              ? t("Training.Copy.Both.727f1e02", "Both")
                              : repertoire.color === "white"
                                ? t("Training.Copy.White.9666a8c0", "White")
                                : t("Training.Copy.Black.ead8fe1f", "Black")}
                          </Badge>
                          <Badge variant="outline">
                            {repertoire.subvariationPolicy === "all"
                              ? t("Training.Copy.Allbranches.8d57ac52", "All branches")
                              : t("Training.Copy.Mainlines.a7679347", "Main lines")}
                          </Badge>
                          <Badge color="teal" variant="light">
                            {" "}
                            {t("Training.Copy.Progress.1d4a9eeb", "Progress")}{" "}
                            {repertoireMetrics.progress}%
                          </Badge>
                          <Badge color="orange" variant="light">
                            {" "}
                            {t("Training.Copy.Difficulty.902d807c", "Difficulty")}{" "}
                            {repertoireMetrics.difficulty}%
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
                            variant="light"
                            leftSection={<IconUpload size={14} />}
                            onClick={() => setAdditionTarget({ repertoireId: repertoire.id })}
                          >
                            {t("Repertoire.ImportInto", "Import into repertoire")}
                          </Button>
                          <Button
                            size="xs"
                            color="blue"
                            variant="light"
                            leftSection={<IconPlayerPlay size={14} />}
                            onClick={() => openRepertoirePractice(repertoire)}
                          >
                            {" "}
                            {t(
                              "Training.Copy.Practicerepertoire.da71a3f0",
                              "Practice repertoire",
                            )}{" "}
                          </Button>
                          <Button
                            size="xs"
                            variant="default"
                            leftSection={<IconDownload size={14} />}
                            onClick={() => void exportWorkingCopy(repertoire)}
                          >
                            {" "}
                            {t("Training.Copy.Exportcopy.ee83b2cd", "Export copy")}{" "}
                          </Button>
                          <Button
                            size="xs"
                            variant="default"
                            leftSection={<IconSettings size={14} />}
                            onClick={() => openRepertoireSettings(repertoire)}
                          >
                            {" "}
                            {t("Training.Copy.Editrepertoire.c2627a86", "Edit repertoire")}{" "}
                          </Button>
                          <Button
                            size="xs"
                            variant="light"
                            leftSection={<IconPlus size={14} />}
                            onClick={() => setVariantRepertoireId(repertoire.id)}
                          >
                            {" "}
                            {t("Training.Copy.Addvariation.610970ab", "Add variation")}{" "}
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
                              {variants
                                .filter((variant) => variant.contentType === "theory")
                                .map((variant, variantIndex) => {
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
                                              aria-label={t(
                                                "Training.Copy.Dragvariation.c1e796c2",
                                                "Drag variation",
                                              )}
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
                                                    {" "}
                                                    {t(
                                                      "Training.Copy.Modelgame.f131746e",
                                                      "Model game",
                                                    )}{" "}
                                                  </Badge>
                                                )}
                                                <Badge color="teal" size="sm" variant="light">
                                                  {variantMetrics.progress}%
                                                </Badge>
                                                <Badge color="orange" size="sm" variant="light">
                                                  {" "}
                                                  {t("Training.Copy.Diff.b89aece8", "Diff.")}{" "}
                                                  {variantMetrics.difficulty}%
                                                </Badge>
                                              </Group>
                                              <Text size="xs" c="dimmed">
                                                {t(
                                                  "Training.Copy.v0linesv1comments.1541f5f2",
                                                  "{{v0}} lines · {{v1}} comments",
                                                  { v0: lines.length, v1: variant.commentCount },
                                                )}
                                                {variant.hasVariations
                                                  ? " · contiene subvariantes"
                                                  : ""}
                                              </Text>
                                            </div>
                                            <Group gap="xs" wrap="nowrap">
                                              <ActionIcon
                                                aria-label={t(
                                                  "Repertoire.ImportIntoVariant",
                                                  "Import PGN into this variant",
                                                )}
                                                onClick={() =>
                                                  setAdditionTarget({
                                                    repertoireId: repertoire.id,
                                                    variantId: variant.id,
                                                  })
                                                }
                                              >
                                                <IconUpload size={16} />
                                              </ActionIcon>
                                              <ActionIcon
                                                size="lg"
                                                variant="subtle"
                                                aria-label={t(
                                                  "Training.Copy.Configurevariation.1b5508d9",
                                                  "Configure variation",
                                                )}
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
                                                {" "}
                                                {t(
                                                  "Training.Copy.Editandanalyze.1fa05ca5",
                                                  "Edit and analyze",
                                                )}{" "}
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
                                                  {" "}
                                                  {t(
                                                    "Training.Copy.Addline.136571b2",
                                                    "Add line",
                                                  )}{" "}
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
                                                {" "}
                                                {t(
                                                  "Training.Copy.Practice.5ab096b1",
                                                  "Practice",
                                                )}{" "}
                                              </Button>
                                            </Group>
                                          </Group>
                                          <Droppable
                                            droppableId={`lines:${variant.id}`}
                                            type="LINE"
                                          >
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
                                                                aria-label={t(
                                                                  "Training.Copy.Dragline.43b2b8b3",
                                                                  "Drag line",
                                                                )}
                                                                {...lineDrag.dragHandleProps}
                                                              >
                                                                <IconGripVertical size={14} />
                                                              </ActionIcon>
                                                              <div style={{ minWidth: 0 }}>
                                                                <Text size="sm" fw={500} truncate>
                                                                  {line.name}
                                                                </Text>
                                                                <Text size="xs" c="dimmed">
                                                                  {line.plyCount}{" "}
                                                                  {t(
                                                                    "Training.Copy.pliesprogress.41e81cd7",
                                                                    "plies · progress",
                                                                  )}{" "}
                                                                  {lineMetrics.progress}
                                                                  {t(
                                                                    "Training.Copy.difficulty.e37fbd35",
                                                                    "% · difficulty",
                                                                  )}{" "}
                                                                  {lineMetrics.difficulty}%
                                                                </Text>
                                                              </div>
                                                            </Group>
                                                            <Group gap={4} wrap="nowrap">
                                                              <Checkbox
                                                                size="xs"
                                                                label={t(
                                                                  "Training.Copy.Train.c216b847",
                                                                  "Train",
                                                                )}
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
                                                                          : t(
                                                                              "Training.Copy.Couldnotupdatetheeditable.ee7dfced",
                                                                              "Could not update the editable copy.",
                                                                            ),
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
                                                                aria-label={t(
                                                                  "Training.Copy.Practicev0.ad258b9d",
                                                                  "Practice {{v0}}",
                                                                  { v0: line.name },
                                                                )}
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
                                                                aria-label={t(
                                                                  "Training.Copy.Renameline.ec64c5c9",
                                                                  "Rename line",
                                                                )}
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
                                                                aria-label={t(
                                                                  "Training.Copy.Deleteline.2781e50b",
                                                                  "Delete line",
                                                                )}
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
                                                    {" "}
                                                    {t(
                                                      "Training.Copy.Buildalineonthe.a1944881",
                                                      "Build a line on the board or drop a line from another variation here.",
                                                    )}{" "}
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
                      <Stack mt="lg" gap="sm">
                        <Title order={4}>{t("Repertoire.ModelGames", "Model games")}</Title>
                        <Text size="sm" c="dimmed">
                          {t(
                            "Repertoire.ModelGamesHint",
                            "Reference games for study and analysis. These games never enter memorization practice.",
                          )}
                        </Text>
                        {modelGameCount === 0 && (
                          <Text size="sm" c="dimmed">
                            {t(
                              "Repertoire.NoModelGames",
                              "No model games yet. Add one from a board or import a PGN.",
                            )}
                          </Text>
                        )}
                        <SimpleGrid cols={{ base: 1, md: 2 }}>
                          {variants
                            .filter((variant) => variant.contentType === "modelGame")
                            .map((variant) => (
                              <Card key={variant.id} withBorder>
                                <Stack gap="xs">
                                  <Text fw={600}>{variant.name}</Text>
                                  <Group>
                                    <Button
                                      size="xs"
                                      onClick={() =>
                                        void openVariant(repertoire, variant.id, "analysis")
                                      }
                                    >
                                      {t("Repertoire.AnalyzeModel", "Open and analyze")}
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="default"
                                      onClick={() => openVariantSettings(variant)}
                                    >
                                      {t("Common.Edit", "Edit")}
                                    </Button>
                                  </Group>
                                </Stack>
                              </Card>
                            ))}
                        </SimpleGrid>
                        {!!repertoire.imports?.length && (
                          <Text size="xs" c="dimmed">
                            {t("Repertoire.ImportCount", "Recorded additions: {{count}}", {
                              count: repertoire.imports.length,
                            })}
                          </Text>
                        )}
                      </Stack>
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
        title={t("Training.Copy.Reviewopeningimport.bc0fa54e", "Review opening import")}
        size="xl"
        closeOnClickOutside={!busy}
      >
        {inspection && (
          <Stack>
            <Alert color={sampleErrors > 0 ? "yellow" : "blue"}>
              <Text fw={600}>{inspection.filename}</Text>
              <Text size="sm">
                {inspection.recordCount}{" "}
                {t("Training.Copy.chaptersInthesample.15719b24", "chapters. In the sample:")}{" "}
                {sampleLineCount} {t("Training.Copy.lines.cee668b8", "lines,")} {sampleComments}{" "}
                {t("Training.Copy.commentsand.d6c6e99a", "comments and")} {sampleErrors}{" "}
                {t("Training.Copy.invalidrecords.4f5f4305", "invalid records.")}{" "}
              </Text>
            </Alert>
            <OpeningConfigFields config={config} onChange={setConfig} />
            <Text size="xs" c="dimmed">
              {" "}
              {t(
                "Training.Copy.Thispolicyonlydetermineswhich.d22f3e6e",
                "This policy only determines which lines are initially selected for training. The editable copy keeps every branch and the original file is unchanged.",
              )}{" "}
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
                            t(
                              "Training.Copy.v0linesv1commentsv2.c1095dd0",
                              "{{v0}} lines · {{v1}} comments{{v2}}",
                              {
                                v0: sample.lineCount,
                                v1: sample.commentCount,
                                v2: sample.hasVariations ? " · subvariantes" : "",
                              },
                            )}
                        </Text>
                      </div>
                      {sample.contentType === "modelGame" && (
                        <Badge color="violet">
                          {t("Training.Copy.Modelgame.f131746e", "Model game")}
                        </Badge>
                      )}
                    </Group>
                  </Card>
                ))}
              </Stack>
            </ScrollArea>
            <Group justify="flex-end">
              <Button variant="default" disabled={busy} onClick={() => setInspection(null)}>
                {" "}
                {t("Training.Copy.Cancel.bb9dbb40", "Cancel")}{" "}
              </Button>
              <Button color="blue" loading={busy} onClick={confirmImport}>
                {" "}
                {t("Training.Copy.Importrepertoire.aae3ad98", "Import repertoire")}{" "}
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
        title={t("Training.Copy.Addvariation.610970ab", "Add variation")}
        size="sm"
      >
        <Stack>
          <TextInput
            label={t("Training.Copy.Variationname.1ac1e564", "Variation name")}
            placeholder={t("Training.Copy.egNajdorfSicilian.c9d54c5c", "e.g. Najdorf Sicilian")}
            value={variantName}
            onChange={(event) => setVariantName(event.currentTarget.value)}
            data-autofocus
          />
          <Text size="xs" c="dimmed">
            {" "}
            {t(
              "Training.Copy.Anemptychapterwillbe.d1b4f5fb",
              "An empty chapter will be created in the editable copy. Build its lines on the board or move existing lines into it.",
            )}{" "}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setVariantRepertoireId(null)}>
              {" "}
              {t("Training.Copy.Cancel.bb9dbb40", "Cancel")}{" "}
            </Button>
            <Button
              color="blue"
              loading={busy}
              disabled={!variantName.trim()}
              onClick={addVariantFromScratch}
            >
              {" "}
              {t("Training.Copy.Addvariation.610970ab", "Add variation")}{" "}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={editingLineId !== null}
        onClose={() => setEditingLineId(null)}
        title={t("Training.Copy.Renameline.ec64c5c9", "Rename line")}
        size="sm"
      >
        <Stack>
          <TextInput
            label={t("Training.Copy.Name.562bb157", "Name")}
            value={lineDraftName}
            onChange={(event) => setLineDraftName(event.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditingLineId(null)}>
              {" "}
              {t("Training.Copy.Cancel.bb9dbb40", "Cancel")}{" "}
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
              {" "}
              {t("Training.Copy.Save.13e51a21", "Save")}{" "}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={deletingLineId !== null}
        onClose={() => !busy && setDeletingLineId(null)}
        title={t("Training.Copy.Removelinefrommanager.6422182d", "Remove line from manager")}
        size="sm"
      >
        <Stack>
          <Text size="sm">
            {" "}
            {t(
              "Training.Copy.Thelinewillnolonger.bc83f44f",
              "The line will no longer appear or be trained. This does not delete or rewrite the imported source PGN.",
            )}{" "}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" disabled={busy} onClick={() => setDeletingLineId(null)}>
              {" "}
              {t("Training.Copy.Cancel.bb9dbb40", "Cancel")}{" "}
            </Button>
            <Button color="red" loading={busy} onClick={confirmDeleteLine}>
              {" "}
              {t("Training.Copy.Removefrommanager.f70a6296", "Remove from manager")}{" "}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={editingRepertoireId !== null}
        onClose={() => !busy && setEditingRepertoireId(null)}
        title={t("Training.Copy.Editrepertoire.c2627a86", "Edit repertoire")}
        size="sm"
      >
        <Stack>
          <TextInput
            label={t("Training.Copy.Name.562bb157", "Name")}
            value={repertoireDraftName}
            onChange={(event) => setRepertoireDraftName(event.currentTarget.value)}
            data-autofocus
          />
          <TextInput
            label={t("Training.Copy.Description.ee00b96f", "Description")}
            value={repertoireDraftDescription}
            onChange={(event) => setRepertoireDraftDescription(event.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setEditingRepertoireId(null)}>
              {" "}
              {t("Training.Copy.Cancel.bb9dbb40", "Cancel")}{" "}
            </Button>
            <Button disabled={!repertoireDraftName.trim()} onClick={saveRepertoireSettings}>
              {" "}
              {t("Training.Copy.Save.13e51a21", "Save")}{" "}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={editingVariantId !== null}
        onClose={() => !busy && setEditingVariantId(null)}
        title={t("Training.Copy.Configurevariation.1b5508d9", "Configure variation")}
        size="lg"
      >
        {editingVariantId && areas.openings.variants[editingVariantId] && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label={t("Training.Copy.Name.562bb157", "Name")}
                value={variantDraftName}
                onChange={(event) => setVariantDraftName(event.currentTarget.value)}
                data-autofocus
              />
              <Select
                label={t("Training.Copy.Contenttype.c5117a88", "Content type")}
                value={variantDraftType}
                data={[
                  {
                    value: "theory",
                    label: t("Training.Copy.Trainabletheory.8720c055", "Trainable theory"),
                  },
                  {
                    value: "modelGame",
                    label: t(
                      "Training.Copy.Modelgameanalysisonly.50c8b8d4",
                      "Model game (analysis only)",
                    ),
                  },
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
                    {" "}
                    {t(
                      "Training.Copy.Linestoincludeintraining.459443c1",
                      "Lines to include in training",
                    )}{" "}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {" "}
                    {t(
                      "Training.Copy.Thisselectionchangesthepractice.cf03c9d5",
                      "This selection changes the practice queue without removing branches from the editable copy; the source PGN is unchanged.",
                    )}{" "}
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
                          description={t("Training.Copy.v0plies.26d40cf6", "{{v0}} plies", {
                            v0: line.plyCount,
                          })}
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
                {" "}
                {t("Training.Copy.Cancel.bb9dbb40", "Cancel")}{" "}
              </Button>
              <Button
                loading={busy}
                disabled={!variantDraftName.trim()}
                onClick={saveVariantSettings}
              >
                {" "}
                {t("Training.Copy.Saveandupdatetraining.c2f410ce", "Save and update training")}{" "}
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
  const { t: trainingT } = useTrainingTranslation();

  const fields = (
    <>
      <Select
        label={trainingT("Training.Copy.Repertoirecolor.b3145869", "Repertoire color")}
        value={config.color}
        data={[
          { value: "white", label: trainingT("Training.Copy.White.9666a8c0", "White") },
          { value: "black", label: trainingT("Training.Copy.Black.ead8fe1f", "Black") },
          { value: "both", label: trainingT("Training.Copy.Bothcolors.c5bf9151", "Both colors") },
        ]}
        onChange={(value) =>
          value && onChange({ ...config, color: value as OpeningImportConfig["color"] })
        }
      />
      <Select
        label={trainingT("Training.Copy.Trainablebranches.33bbf995", "Trainable branches")}
        value={config.subvariationPolicy}
        data={[
          {
            value: "mainline",
            label: trainingT("Training.Copy.Mainlinesonly.92cf9aee", "Main lines only"),
          },
          {
            value: "all",
            label: trainingT("Training.Copy.Allsubvariations.3d1748e2", "All subvariations"),
          },
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
