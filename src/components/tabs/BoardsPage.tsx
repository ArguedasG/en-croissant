import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import { ActionIcon, ScrollArea, Tabs } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { IconPlus } from "@tabler/icons-react";
import { useAtom, useAtomValue, useStore } from "jotai";
import {
  type ReactNode,
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Mosaic, type MosaicNode } from "react-mosaic-component";
import { match } from "ts-pattern";
import { commands } from "@/bindings";
import { activeTabAtom, importModalOpenAtom, tabsAtom } from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import { getLatestSessionStorageValue } from "@/state/store/debouncedStorage";
import { createTab, genID, isPersistentGameOrigin, type Tab } from "@/utils/tabs";
import {
  getTabPath,
  getTrainingTabName,
  isTrainingPath,
  updateTrainingTab,
} from "@/utils/trainingTabs";
import BoardAnalysis from "../boards/BoardAnalysis";
import BoardGame from "../boards/BoardGame";
import { TreeStateProvider } from "../common/TreeStateContext";
import Puzzles from "../puzzles/Puzzles";
import { BoardTab } from "./BoardTab";
import ConfirmChangesModal from "./ConfirmChangesModal";
import ImportModal from "./ImportModal";
import NewTabHome from "./NewTabHome";

import "react-mosaic-component/react-mosaic-component.css";

import "@/styles/react-mosaic.css";
import { platform } from "@tauri-apps/plugin-os";
import { atomWithStorage } from "jotai/utils";
import classes from "./BoardsPage.module.css";

const TabCloseContext = createContext<{
  pendingClose: string | null;
  cancelClose: () => void;
  closeTab: (value: string | null, forced?: boolean) => Promise<void>;
} | null>(null);

export function WorkspaceTabs({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const atomStore = useStore();

  const [tabs, setTabs] = useAtom(tabsAtom);
  const [activeTab, setActiveTab] = useAtom(activeTabAtom);
  const [pendingClose, setPendingClose] = useState<string | null>(null);

  // Route navigation opens a training workspace or changes its current area.
  // Read current atoms here so selecting/closing a tab does not reopen it.
  useEffect(() => {
    const currentTabs = atomStore.get(tabsAtom);
    const current = currentTabs.find((tab) => tab.value === atomStore.get(activeTabAtom));
    if (isTrainingPath(pathname)) {
      if (current?.type === "training") {
        setTabs((prev) =>
          prev.map((tab) => (tab.value === current.value ? updateTrainingTab(tab, pathname) : tab)),
        );
      } else {
        const existing = currentTabs.find(
          (tab) => tab.type === "training" && getTabPath(tab) === pathname,
        );
        if (existing) setActiveTab(existing.value);
        else
          void createTab({
            tab: { name: getTrainingTabName(pathname), type: "training", trainingPath: pathname },
            setTabs,
            setActiveTab,
          });
      }
    } else if (!current || current.type === "training") {
      const board = currentTabs.find((tab) => tab.type !== "training");
      if (board) setActiveTab(board.value);
      else
        void createTab({
          tab: { name: "Home.Card.AnalysisBoard.Title", type: "analysis" },
          setTabs,
          setActiveTab,
        });
    }
  }, [pathname, atomStore, setActiveTab, setTabs]);

  const activateTab = useCallback(
    (tab: Tab) => {
      setActiveTab(tab.value);
      void navigate({ to: getTabPath(tab) });
    },
    [navigate, setActiveTab],
  );

  const closeTab = useCallback(
    async (value: string | null, forced?: boolean) => {
      if (value !== null) {
        const closedTab = tabs.find((tab) => tab.value === value);
        if (!closedTab) return;
        const tabState = getLatestSessionStorageValue<{ dirty?: boolean }>(value);
        if (isPersistentGameOrigin(closedTab) && tabState?.state.dirty && !forced) {
          setPendingClose(value);
          activateTab(closedTab);
          return;
        }
        if (value === activeTab) {
          const index = tabs.findIndex((tab) => tab.value === value);
          if (closedTab.returnPath) {
            const nextTab = tabs[index === tabs.length - 1 ? index - 1 : index + 1];
            setActiveTab(nextTab?.value ?? null);
            void navigate({ to: closedTab.returnPath });
          } else if (tabs.length > 1) {
            activateTab(tabs[index === tabs.length - 1 ? index - 1 : index + 1]);
          } else {
            setActiveTab(null);
            void navigate({ to: "/" });
          }
        }
        setPendingClose(null);
        setTabs((prev) => prev.filter((tab) => tab.value !== value));
        if (tabs.length === 1) {
          await createTab({
            tab: { name: "Home.Card.AnalysisBoard.Title", type: "analysis" },
            setTabs,
            setActiveTab,
          });
        }
        // Finalize experiment records before stopping their game. A cleanup
        // failure must not prevent the remaining owners from stopping.
        await Promise.allSettled([commands.finalizeSingleModelGameExperimentsForOwner(value)]);
        await Promise.allSettled([
          commands.killEngines(value),
          commands.abortGame(`${value}-game`),
          commands.cancelModelGameBatchesForOwner(value),
          commands.cancelBotLeaguesForOwner(value),
        ]);
      }
    },
    [tabs, activeTab, setTabs, setActiveTab, activateTab, navigate],
  );

  function selectTab(index: number) {
    const tab = tabs[Math.min(index, tabs.length - 1)];
    if (tab) activateTab(tab);
  }

  function cycleTabs(reverse = false) {
    if (tabs.length === 0) return;
    const index = tabs.findIndex((tab) => tab.value === activeTab);
    activateTab(tabs[(index + (reverse ? -1 : 1) + tabs.length) % tabs.length]);
  }

  const renameTab = useCallback(
    (value: string, name: string) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.value === value) {
            return { ...tab, name };
          }
          return tab;
        }),
      );
    },
    [setTabs],
  );

  const duplicateTab = useCallback(
    (value: string) => {
      const id = genID();
      const tab = tabs.find((tab) => tab.value === value);
      const latest = getLatestSessionStorageValue(value);
      if (latest) {
        sessionStorage.setItem(id, JSON.stringify(latest));
      }

      if (tab) {
        setTabs((prev) => [
          ...prev,
          {
            ...tab,
            value: id,
          },
        ]);
        activateTab({ ...tab, value: id });
      }
    },
    [tabs, setTabs, activateTab],
  );

  useEffect(() => {
    if (platform() !== "macos") return;

    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        e.stopPropagation();
        closeTab(activeTab);
      }
    };

    window.addEventListener("keydown", handler, { capture: true });

    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [activeTab, closeTab]);

  const keyMap = useAtomValue(keyMapAtom);

  const handleSetActiveTab = useCallback(
    (v: string) => {
      const tab = tabs.find((tab) => tab.value === v);
      if (tab) startTransition(() => activateTab(tab));
    },
    [tabs, activateTab],
  );
  useHotkeys([
    [keyMap.CLOSE_TAB.keys, () => closeTab(activeTab)],
    [keyMap.CYCLE_TABS.keys, () => cycleTabs()],
    [keyMap.REVERSE_CYCLE_TABS.keys, () => cycleTabs(true)],
    ["alt+1", () => selectTab(0)],
    ["ctrl+1", () => selectTab(0)],
    ["alt+2", () => selectTab(1)],
    ["ctrl+2", () => selectTab(1)],
    ["alt+3", () => selectTab(2)],
    ["ctrl+3", () => selectTab(2)],
    ["alt+4", () => selectTab(3)],
    ["ctrl+4", () => selectTab(3)],
    ["alt+5", () => selectTab(4)],
    ["ctrl+5", () => selectTab(4)],
    ["alt+6", () => selectTab(5)],
    ["ctrl+6", () => selectTab(5)],
    ["alt+7", () => selectTab(6)],
    ["ctrl+7", () => selectTab(6)],
    ["alt+8", () => selectTab(7)],
    ["ctrl+8", () => selectTab(7)],
    ["alt+9", () => selectTab(tabs.length - 1)],
    ["ctrl+9", () => selectTab(tabs.length - 1)],
  ]);

  return (
    <TabCloseContext.Provider
      value={{ pendingClose, cancelClose: () => setPendingClose(null), closeTab }}
    >
      <Tabs
        value={activeTab}
        onChange={(v) => v && handleSetActiveTab(v)}
        keepMounted={false}
        className={classes.tabsContainer}
      >
        <ScrollArea scrollbarSize={6} className={classes.tabsHeader}>
          <DragDropContext
            onDragEnd={({ destination, source }) =>
              destination?.index !== undefined &&
              setTabs((prev) => {
                const result = Array.from(prev);
                const [removed] = result.splice(source.index, 1);
                result.splice(destination.index, 0, removed);
                return result;
              })
            }
          >
            <Droppable droppableId="droppable" direction="horizontal">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  style={{ display: "flex" }}
                >
                  {tabs.map((tab, i) => (
                    <Draggable key={tab.value} draggableId={tab.value} index={i}>
                      {(provided) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                        >
                          <BoardTab
                            tab={tab}
                            tabType={tab.type}
                            setActiveTab={handleSetActiveTab}
                            closeTab={closeTab}
                            renameTab={renameTab}
                            duplicateTab={duplicateTab}
                            selected={activeTab === tab.value}
                          />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                  <ActionIcon
                    variant="default"
                    radius={0}
                    onClick={async () => {
                      await createTab({
                        tab: {
                          name: t("Home.Card.AnalysisBoard.Title"),
                          type: "analysis",
                        },
                        setTabs,
                        setActiveTab,
                      });
                      await navigate({ to: "/" });
                    }}
                    classNames={{
                      root: classes.newTab,
                    }}
                  >
                    <IconPlus />
                  </ActionIcon>
                  <div className={classes.tabsFiller} />
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </ScrollArea>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</div>
      </Tabs>
    </TabCloseContext.Provider>
  );
}

export default function BoardsPage() {
  const [tabs, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const [importModalOpen, setImportModalOpen] = useAtom(importModalOpenAtom);
  return (
    <>
      <ImportModal
        openModal={importModalOpen}
        setOpenModal={setImportModalOpen}
        setTabs={setTabs}
        setActiveTab={setActiveTab}
      />
      {tabs.map((tab) => (
        <Tabs.Panel key={tab.value} value={tab.value} h="100%" w="100%" pb="sm" px="xs">
          <TabSwitch tab={tab} />
        </Tabs.Panel>
      ))}
    </>
  );
}

type ViewId = "left" | "topRight" | "bottomRight";

const fullLayout: { [viewId: string]: ReactNode } = {
  left: <div id="left" />,
  topRight: <div id="topRight" />,
  bottomRight: <div id="bottomRight" />,
};

interface WindowsState {
  currentNode: MosaicNode<ViewId> | null;
}

const windowsStateAtom = atomWithStorage<WindowsState>("windowsState", {
  currentNode: {
    direction: "row",
    first: "left",
    second: {
      direction: "column",
      first: "topRight",
      second: "bottomRight",
    },
  },
});

function TabSwitch({ tab }: { tab: Tab }) {
  const [windowsState, setWindowsState] = useAtom(windowsStateAtom);
  const { pendingClose, cancelClose, closeTab } = useContext(TabCloseContext)!;

  if (tab.type === "training") return null;
  if (tab.type === "new") return <NewTabHome id={tab.value} />;

  return (
    <TreeStateProvider key={tab.revision ?? 0} id={tab.value}>
      <Mosaic<ViewId>
        renderTile={(id) => fullLayout[id]}
        value={windowsState.currentNode}
        onChange={(currentNode) => setWindowsState({ currentNode })}
        resize={{ minimumPaneSizePercentage: 0 }}
      />
      {match(tab.type)
        .with("play", () => <BoardGame />)
        .with("generator", () => <BoardGame generatorMode />)
        .with("analysis", () => <BoardAnalysis />)
        .with("puzzles", () => <Puzzles id={tab.value} />)
        .exhaustive()}
      <ConfirmChangesModal
        tab={tab}
        opened={pendingClose === tab.value}
        toggle={cancelClose}
        closeTab={() => void closeTab(tab.value, true)}
      />
    </TreeStateProvider>
  );
}
