import { MantineProvider } from "@mantine/core";
import i18n from "i18next";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commands } from "@/bindings";
import en from "@/translation/en-US.json";
import es from "@/translation/es-ES.json";
import { openingReportFixture } from "@/utils/openingReport.fixture";
import { saveOpeningReport } from "@/utils/openingReportFiles";
import { createTab } from "@/utils/tabs";
import OpeningReportPanel from "./OpeningReportPanel";
import OpeningReportView from "./OpeningReportView";

const { atomSet } = vi.hoisted(() => ({ atomSet: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("jotai", () => ({
  useSetAtom: () => vi.fn(),
  useStore: () => ({ set: atomSet }),
}));
vi.mock("@/state/atoms", () => ({
  tabsAtom: {},
  activeTabAtom: {},
  dbTabFamily: (id: string) => `db-tab:${id}`,
  localOptionsFamily: (id: string) => `local-options:${id}`,
  tabFamily: (id: string) => `panel-tab:${id}`,
}));
vi.mock("@/utils/tabs", () => ({ createTab: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/utils/openingReportFiles", () => ({
  saveOpeningReport: vi.fn(),
  openingReferenceGamesPgn: vi.fn(),
}));
vi.mock("@/bindings", () => ({
  commands: {
    generateOpeningReport: vi.fn(),
    getPositionGame: vi.fn(),
    cancelPositionSearch: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("./DatabaseLoader", () => ({ default: () => null }));

let root: Root;
let container: HTMLDivElement;
const onGames = vi.fn(),
  onExpired = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks();
  await i18n
    .use(initReactI18next)
    .init({ resources: { "en-US": en, "es-ES": es }, lng: "es-ES", fallbackLng: "en-US" });
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
  vi.mocked(commands.generateOpeningReport).mockResolvedValue({
    status: "ok",
    data: openingReportFixture(),
  });
  vi.mocked(createTab).mockResolvedValue("player-tab");
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(node: ReactNode) {
  await act(async () => root.render(<MantineProvider env="test">{node}</MantineProvider>));
}
async function mount() {
  const fixture = openingReportFixture();
  await render(
    <OpeningReportPanel
      snapshot={fixture.position}
      displayFen={fixture.options.displayFen}
      databasePath="local.db3"
      owner="board"
      onGames={onGames}
      onExpired={onExpired}
    />,
  );
}
async function click(key: string) {
  const button = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === i18n.t(key),
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

it("shows report coverage in both languages and sends exact theory prefixes and reference offsets", async () => {
  const onVariant = vi.fn(),
    onGame = vi.fn();
  await render(
    <OpeningReportView
      report={openingReportFixture()}
      onVariant={onVariant}
      onGame={onGame}
      onPlayer={vi.fn()}
    />,
  );
  expect(container.textContent).toContain(
    i18n.t("OpeningReport.Cohort", { selected: 3, total: 4 }),
  );
  const move = container.querySelector<HTMLButtonElement>('[aria-label="2... Nf6"]')!;
  await act(async () => move.click());
  expect(onVariant).toHaveBeenCalledWith(["d4", "d5", "Nf3", "Nf6"]);
  await click("Ana – Diego");
  expect(onGame).toHaveBeenCalledWith(0, 6);
  await act(async () => i18n.changeLanguage("en-US"));
  expect(container.textContent).toContain("Opening report");
  expect(container.textContent).not.toContain("OpeningReport.");
});

it("generates explicitly, reuses Games and does not fetch PGN until opening a reference", async () => {
  await mount();
  expect(commands.generateOpeningReport).not.toHaveBeenCalled();
  await click("OpeningReport.Generate");
  expect(commands.generateOpeningReport).toHaveBeenCalledWith(
    "fixture",
    expect.objectContaining({ depth: 12, theoryGames: 5000, maxLines: 64 }),
    "report:board",
  );
  expect(commands.getPositionGame).not.toHaveBeenCalled();
  await click("Board.Database.Games");
  expect(onGames).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("opens every matching game for a report player in a separate Games tab", async () => {
  await mount();
  await click("OpeningReport.Generate");
  await click("Ana");
  expect(createTab).toHaveBeenCalledWith(
    expect.objectContaining({
      tab: expect.objectContaining({ type: "analysis" }),
    }),
  );
  expect(atomSet).toHaveBeenCalledWith(
    "local-options:player-tab",
    expect.objectContaining({
      path: "local.db3",
      player: 1,
      color: "any",
      type: "exact",
    }),
  );
  expect(atomSet).toHaveBeenCalledWith("panel-tab:player-tab", "database");
  expect(atomSet).toHaveBeenCalledWith("db-tab:player-tab", "games");
});

it("opens a reference at root ply plus continuation length with its database identity", async () => {
  await mount();
  await click("OpeningReport.Generate");
  vi.mocked(commands.getPositionGame).mockResolvedValue({
    status: "ok",
    data: { ply: 4, game: { id: 1, white: "Ana", black: "Diego", moves: "1. d4 d5 *" } },
  } as Awaited<ReturnType<typeof commands.getPositionGame>>);
  await click("Ana – Diego");
  expect(commands.getPositionGame).toHaveBeenCalledWith("fixture", 0);
  expect(createTab).toHaveBeenCalledWith(
    expect.objectContaining({
      position: Array(10).fill(0),
      gameOrigin: { kind: "database", database: "local.db3", gameId: 1 },
    }),
  );
});

it("cancels an in-flight report and discards its late result", async () => {
  let resolve!: (result: Awaited<ReturnType<typeof commands.generateOpeningReport>>) => void;
  vi.mocked(commands.generateOpeningReport).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await mount();
  await click("OpeningReport.Generate");
  await click("Common.Cancel");
  expect(commands.cancelPositionSearch).toHaveBeenCalledWith("report:board");
  await act(async () => resolve({ status: "ok", data: openingReportFixture() }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).not.toContain(i18n.t("OpeningReport.Open"));
});

it("cancels when the owning position panel unmounts and asks to refresh expired snapshots", async () => {
  vi.mocked(commands.generateOpeningReport).mockResolvedValueOnce({
    status: "error",
    error: "Position query expired",
  });
  await mount();
  await click("OpeningReport.Generate");
  expect(onExpired).toHaveBeenCalledOnce();
  expect(container.textContent).toContain(i18n.t("OpeningReport.Expired"));
  vi.mocked(commands.generateOpeningReport).mockReturnValueOnce(new Promise(() => {}));
  await click("OpeningReport.Generate");
  await render(null);
  expect(commands.cancelPositionSearch).toHaveBeenCalledWith("report:board");
});

it("exports HTML and never shows success for a cancelled or failed save", async () => {
  await mount();
  await click("OpeningReport.Generate");
  vi.mocked(saveOpeningReport).mockResolvedValueOnce(false);
  await click("OpeningReport.ExportHtml");
  expect(saveOpeningReport).toHaveBeenCalledWith(
    expect.stringContaining("<!doctype html>"),
    "html",
    "local.db3",
    expect.any(Function),
    expect.any(AbortSignal),
  );
  expect(document.body.textContent).not.toContain(i18n.t("OpeningReport.Saved"));
  vi.mocked(saveOpeningReport).mockRejectedValueOnce(new Error("Disk full"));
  await click("OpeningReport.ExportHtml");
  expect(document.body.textContent).toContain(i18n.t("OpeningReport.Failed"));
  vi.mocked(saveOpeningReport).mockResolvedValueOnce(true);
  await click("OpeningReport.ExportTheory");
  expect(document.body.textContent).toContain(i18n.t("OpeningReport.Saved"));
});
