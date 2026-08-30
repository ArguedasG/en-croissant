import { MantineProvider } from "@mantine/core";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { createStore, Provider } from "jotai";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "@/bindings";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { defaultTree } from "@/utils/treeReducer";
import type { Tab } from "@/utils/tabs";
import BoardsPage, { WorkspaceTabs } from "./BoardsPage";

vi.mock("@/components/boards/BoardAnalysis", () => ({ default: () => <div>Analysis board</div> }));
vi.mock("@/components/boards/BoardGame", () => ({ default: () => <div>Game board</div> }));
vi.mock("@/components/puzzles/Puzzles", () => ({ default: () => null }));
vi.mock("./ImportModal", () => ({ default: () => null }));
vi.mock("./NewTabHome", () => ({ default: () => null }));
vi.mock("react-mosaic-component", () => ({ Mosaic: () => null }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "windows" }));
vi.mock("@tauri-apps/plugin-log", () => ({ error: vi.fn() }));
vi.mock("@/bindings", () => ({
  commands: {
    finalizeSingleModelGameExperimentsForOwner: vi.fn().mockResolvedValue({ status: "ok" }),
    killEngines: vi.fn().mockResolvedValue({ status: "ok" }),
    abortGame: vi.fn().mockResolvedValue({ status: "ok" }),
    cancelModelGameBatchesForOwner: vi.fn().mockResolvedValue({ status: "ok" }),
    cancelBotLeaguesForOwner: vi.fn().mockResolvedValue({ status: "ok" }),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) =>
      typeof options === "string" ? options : (options?.defaultValue ?? key),
  }),
}));
vi.mock("@hello-pangea/dnd", () => ({
  DragDropContext: ({ children }: { children: ReactNode }) => children,
  Droppable: ({ children }: { children: (provided: object) => ReactNode }) =>
    children({ innerRef: () => {}, droppableProps: {}, placeholder: null }),
  Draggable: ({ children }: { children: (provided: object) => ReactNode }) =>
    children({ innerRef: () => {}, draggableProps: {}, dragHandleProps: {} }),
}));

const board: Tab = {
  name: "Analysis",
  value: "board",
  type: "analysis",
  gameOrigin: { kind: "none" },
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mountWorkspace(path = "/training", initialTabs = [board], activeTab = "board") {
  const store = createStore();
  store.set(tabsAtom, initialTabs);
  store.set(activeTabAtom, activeTab);
  const rootRoute = createRootRoute({
    component: () => (
      <WorkspaceTabs>
        <Outlet />
      </WorkspaceTabs>
    ),
  });
  const boardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: BoardsPage,
    loader: () => ({ documentDir: "C:/test" }),
  });
  const training = createRoute({
    getParentRoute: () => rootRoute,
    path: "/training",
    component: () => <Outlet />,
  });
  const hub = createRoute({
    getParentRoute: () => training,
    path: "/",
    component: () => <Link to="/training/tactics">Choose tactics</Link>,
  });
  const areas = ["tactics", "openings", "endgames"].map((area) =>
    createRoute({
      getParentRoute: () => training,
      path: area,
      component: () => <div>{area} content</div>,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([boardRoute, training.addChildren([hub, ...areas])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await act(async () => {
    await router.load();
    root.render(
      <Provider store={store}>
        <MantineProvider>
          <RouterProvider router={router} />
        </MantineProvider>
      </Provider>,
    );
  });
  return { store, router };
}

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("workspace tab navigation and closing", () => {
  it("shows the tabs in the hub and converts the same tab into each training area", async () => {
    const { store, router } = await mountWorkspace();
    const trainingId = store.get(activeTabAtom);
    expect(store.get(tabsAtom)).toHaveLength(2);
    expect(document.body.textContent).toContain("Analysis");
    await click(document.querySelector('a[href="/training/tactics"]'));
    expect(store.get(activeTabAtom)).toBe(trainingId);
    expect(store.get(tabsAtom)).toHaveLength(2);
    expect(document.body.textContent).toContain("tactics content");
    for (const area of ["openings", "endgames"]) {
      await act(async () => {
        await router.navigate({ to: `/training/${area}` });
      });
      expect(store.get(tabsAtom).find((tab) => tab.value === trainingId)?.trainingPath).toBe(
        `/training/${area}`,
      );
      expect(store.get(tabsAtom)).toHaveLength(2);
    }
    await click(document.querySelector('[aria-label="Close: Training.Endgames"]'));
    expect(store.get(tabsAtom)).toEqual([board]);
    expect(router.state.location.pathname).toBe("/");
    expect(document.body.textContent).toContain("Analysis board");
  });

  it("closes a dirty legacy play tab through a visible confirmation without closing its neighbour", async () => {
    const legacy: Tab = {
      name: "Legacy game",
      value: "legacy",
      type: "play",
      gameOrigin: { kind: "database", database: "test.db3", gameId: 7 },
    };
    sessionStorage.setItem(
      "legacy",
      JSON.stringify({ version: 0, state: { ...defaultTree(), dirty: true } }),
    );
    const { store, router } = await mountWorkspace("/training", [board, legacy]);
    await click(document.querySelector('[aria-label="Close: Legacy game"]'));
    expect(router.state.location.pathname).toBe("/");
    expect(document.body.textContent).toContain("Unsaved changes");
    expect(store.get(tabsAtom).some((tab) => tab.value === "legacy")).toBe(true);
    await click(
      Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent === "Close without saving",
      ) ?? null,
    );
    expect(store.get(tabsAtom).some((tab) => tab.value === "legacy")).toBe(false);
    expect(store.get(tabsAtom).some((tab) => tab.value === "board")).toBe(true);
    expect(commands.abortGame).toHaveBeenCalledWith("legacy-game");
  });
});
