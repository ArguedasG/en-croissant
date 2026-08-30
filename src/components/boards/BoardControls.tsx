import { ActionIcon, Menu, Stack, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowBack,
  IconCamera,
  IconDeviceFloppy,
  IconEdit,
  IconEditOff,
  IconEraser,
  IconFlask,
  IconSwitchVertical,
  IconPlayerPlay,
  IconZoomCheck,
  IconDots,
  IconBook2,
} from "@tabler/icons-react";
import { useLoaderData } from "@tanstack/react-router";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import domtoimage from "dom-to-image";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  autoSaveAtom,
  activeTabAtom,
  currentTabAtom,
  eraseDrawablesOnClickAtom,
  tabsAtom,
} from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import { trainingAreasAtom } from "@/state/trainingAreas";
import { buildModelGameSourcePgn } from "@/utils/modelGame";
import { createTab, getTabFile, getTabGameNumber, saveToFile } from "@/utils/tabs";
import type { TreeState } from "@/utils/treeReducer";
import RepertoireAdditionModal from "../training/RepertoireAdditionModal";

interface BoardControlsProps {
  editingMode: boolean;
  toggleEditingMode: () => void;
  dirty: boolean;
  saveFile?: () => void;
  canTakeBack?: boolean;
  onTakeBack?: () => void;
  disableVariations?: boolean;
  allowEditing?: boolean;
  onGenerateModelGame?: () => void;
}

function BoardControls({
  editingMode,
  toggleEditingMode,
  dirty,
  saveFile,
  canTakeBack,
  onTakeBack,
  disableVariations,
  allowEditing,
  onGenerateModelGame,
}: BoardControlsProps) {
  const { t } = useTranslation();
  const { documentDir } = useLoaderData({ from: "/" });

  const store = useContext(TreeStateContext)!;
  const headers = useStore(store, (s) => s.headers);
  const root = useStore(store, (s) => s.root);
  const setHeaders = useStore(store, (s) => s.setHeaders);
  const clearShapes = useStore(store, (s) => s.clearShapes);

  const keyMap = useAtomValue(keyMapAtom);
  const [currentTab, setCurrentTab] = useAtom(currentTabAtom);
  const setTabs = useSetAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const autoSave = useAtomValue(autoSaveAtom);
  const eraseDrawablesOnClick = useAtomValue(eraseDrawablesOnClickAtom);
  const [addition, setAddition] = useState<{
    tree: TreeState;
    source: { label: string; recordIndexes: number[] };
  } | null>(null);
  const file = getTabFile(currentTab);
  const trainingAreas = useAtomValue(trainingAreasAtom);

  async function savePgn(mode: "save" | "saveAs" | "export") {
    try {
      if (mode === "save" && saveFile) {
        await saveFile();
        return;
      }
      const ownerId = currentTab?.value;
      await saveToFile({
        dir: documentDir,
        tab: currentTab,
        store,
        isUserSave: true,
        mode,
        protectedPaths: Object.values(trainingAreas.openings.repertoires)
          .filter((repertoire) => repertoire.path === file?.path && repertoire.sourcePath)
          .map((repertoire) => repertoire.sourcePath!),
        setCurrentTab: (update) =>
          setTabs((tabs) =>
            tabs.map((tab) =>
              tab.value === ownerId ? (typeof update === "function" ? update(tab) : update) : tab,
            ),
          ),
      });
    } catch (error) {
      notifications.show({ color: "red", message: String(error) });
    }
  }

  const orientation = headers.orientation || "white";
  const toggleOrientation = () =>
    setHeaders({
      ...headers,
      fen: root.fen,
      orientation: orientation === "black" ? "white" : "black",
    });

  async function changeTabType() {
    if (currentTab?.type === "analysis") {
      const source = store.getState();
      // Copy only the selected branch up to the visible position. A fresh owner
      // also isolates game state and prevents play/autosave from editing a repertoire.
      await createTab({
        tab: { name: t("Home.NewGame", "New Game"), type: "play" },
        pgn: buildModelGameSourcePgn(source.root, source.headers, source.position),
        position: source.position.map(() => 0),
        setTabs,
        setActiveTab,
      });
    } else {
      setCurrentTab((tab) => ({ ...tab, type: "analysis" }));
    }
  }

  const takeSnapshot = async () => {
    const snapshotTarget = document.querySelector(".cg-wrap") as HTMLElement | null;
    if (!snapshotTarget) return;

    domtoimage.toBlob(snapshotTarget).then(async (blob) => {
      if (blob == null) return;

      const filePath = await save({
        title: "Save board snapshot",
        defaultPath: documentDir,
        filters: [
          {
            name: "PNG Image",
            extensions: ["png"],
          },
        ],
      });
      const arrayBuffer = await blob.arrayBuffer();
      if (filePath == null) return;
      await writeFile(filePath, new Uint8Array(arrayBuffer));
    });
  };

  return (
    <Stack gap={4} align="center">
      {addition && (
        <RepertoireAdditionModal
          tree={addition.tree}
          treeSource={addition.source}
          onClose={() => setAddition(null)}
        />
      )}
      <Menu position="right-start" withinPortal>
        <Menu.Target>
          <ActionIcon aria-label={t("Pgn.Actions", "PGN and repertoire actions")}>
            <IconDots size="1.2rem" />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>
            {file
              ? `${file.path} · ${getTabGameNumber(currentTab) + 1}/${file.numGames}`
              : currentTab?.gameOrigin.kind === "database"
                ? currentTab.gameOrigin.database
                : t("Pgn.Unsaved", "Not saved to a file")}
          </Menu.Label>
          <Menu.Item onClick={() => void savePgn("save")}>
            {t("Pgn.Save", "Save current game")}
          </Menu.Item>
          <Menu.Item onClick={() => void savePgn("saveAs")}>
            {t("Pgn.SaveAs", "Save as new PGN")}
          </Menu.Item>
          <Menu.Item onClick={() => void savePgn("export")}>
            {t("Pgn.ExportCopy", "Export PGN copy")}
          </Menu.Item>
          <Menu.Label>
            {t(
              "Pgn.ExportHint",
              "Save As changes this tab's file; Export keeps its source and unsaved changes.",
            )}
          </Menu.Label>
          <Menu.Divider />
          <Menu.Item
            leftSection={<IconBook2 size={16} />}
            onClick={() => {
              const state = store.getState();
              setAddition({
                source: {
                  label:
                    file?.path ??
                    (currentTab?.gameOrigin.kind === "database"
                      ? `${currentTab.gameOrigin.database} #${currentTab.gameOrigin.gameId}`
                      : (currentTab?.name ?? t("Repertoire.AnalysisSource", "Analysis board"))),
                  recordIndexes: [getTabGameNumber(currentTab)],
                },
                tree: structuredClone({
                  root: state.root,
                  headers: state.headers,
                  position: state.position,
                  dirty: state.dirty,
                  report: state.report,
                }),
              });
            }}
          >
            {t("Repertoire.AddContent", "Add to repertoire")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Tooltip position="right" label={t("Board.Action.TakeSnapshot")}>
        <ActionIcon onClick={() => takeSnapshot()}>
          <IconCamera size="1.2rem" />
        </ActionIcon>
      </Tooltip>
      {canTakeBack && onTakeBack && (
        <Tooltip label="Take Back" position="right">
          <ActionIcon onClick={() => onTakeBack()}>
            <IconArrowBack />
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip
        position="right"
        label={t(
          currentTab?.type === "analysis"
            ? "Board.Action.PlayFromHere"
            : "Board.Action.AnalyzeGame",
        )}
      >
        <ActionIcon onClick={changeTabType}>
          {currentTab?.type === "analysis" ? (
            <IconPlayerPlay size="1.2rem" />
          ) : (
            <IconZoomCheck size="1.2rem" />
          )}
        </ActionIcon>
      </Tooltip>
      {onGenerateModelGame && (
        <Tooltip
          position="right"
          label={t("ModelGame.FromPosition", "Generate model game from this position")}
        >
          <ActionIcon onClick={onGenerateModelGame}>
            <IconFlask size="1.2rem" />
          </ActionIcon>
        </Tooltip>
      )}
      {!eraseDrawablesOnClick && (
        <Tooltip position="right" label={t("Board.Action.ClearDrawings")}>
          <ActionIcon onClick={() => clearShapes()}>
            <IconEraser size="1.2rem" />
          </ActionIcon>
        </Tooltip>
      )}
      {(!disableVariations || allowEditing) && (
        <Tooltip position="right" label={t("Board.Action.EditPosition")}>
          <ActionIcon onClick={() => toggleEditingMode()}>
            {editingMode ? <IconEditOff size="1.2rem" /> : <IconEdit size="1.2rem" />}
          </ActionIcon>
        </Tooltip>
      )}

      {saveFile && (
        <Tooltip position="right" label={t("Board.Action.SavePGN", { key: keyMap.SAVE_FILE.keys })}>
          <ActionIcon
            onClick={() => saveFile()}
            variant={dirty && !autoSave ? "default" : "transparent"}
          >
            <IconDeviceFloppy size="1.2rem" />
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip
        position="right"
        label={t("Board.Action.FlipBoard", {
          key: keyMap.SWAP_ORIENTATION.keys,
        })}
      >
        <ActionIcon onClick={() => toggleOrientation()}>
          <IconSwitchVertical size="1.2rem" />
        </ActionIcon>
      </Tooltip>
    </Stack>
  );
}

export default memo(BoardControls);
