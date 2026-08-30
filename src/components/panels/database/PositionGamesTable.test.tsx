import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig, type State } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commands, type PositionSummary, type PositionGameMetadata } from "@/bindings";
import { createTab } from "@/utils/tabs";
import PositionGamesTable from "./PositionGamesTable";

vi.mock("@mantine/core", () => ({
  Alert: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
  Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Select: ({
    label,
    value,
    data,
    onChange,
  }: {
    label: string;
    value: string;
    data: { value: string; label: string }[];
    onChange: (value: string | null) => void;
  }) => (
    <label>
      {label}
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {data.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
  SegmentedControl: ({
    data,
    onChange,
  }: {
    data: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <div>
      {data.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
  Text: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("jotai", () => ({ useSetAtom: () => vi.fn() }));
vi.mock("@/state/atoms", () => ({ tabsAtom: {}, activeTabAtom: {} }));
vi.mock("@/utils/tabs", () => ({ createTab: vi.fn().mockResolvedValue(undefined) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/bindings", () => ({
  commands: {
    getPositionGames: vi.fn(),
    getPositionGame: vi.fn(),
    cancelPositionSearch: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("mantine-datatable", () => ({
  DataTable: ({
    records,
    page,
    totalRecords,
    onPageChange,
    onRowClick,
  }: {
    records: PositionGameMetadata[];
    page: number;
    totalRecords: number;
    onPageChange: (page: number) => void;
    onRowClick: (row: { index: number }) => Promise<void>;
  }) => (
    <div>
      <span>{`page:${page} total:${totalRecords}`}</span>
      <button type="button" onClick={() => onPageChange(33)}>
        Last page
      </button>
      {records.map((record, index) => (
        <button
          key={record.id}
          type="button"
          onClick={() => {
            void onRowClick({ index });
          }}
        >
          {record.white}
        </button>
      ))}
    </div>
  ),
}));

let root: Root;
let container: HTMLDivElement;
let cache: Map<string, State>;
const expired = vi.fn();
const summary = (token = "one"): PositionSummary => ({
  token,
  total: 650,
  fingerprint: "db-v1",
  fen: "fen",
  openings: [],
  skippedGames: 0,
  scanMs: 10,
  cacheHit: false,
});
const row = (id: number): PositionGameMetadata => ({
  snapshotOffset: id - 1,
  id,
  white: `White ${id}`,
  black: "Black",
  whiteElo: 2400,
  blackElo: 2300,
  date: null,
  result: "*",
  event: "Event",
  ply: 3,
  nextMove: "Nc6",
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cache = new Map();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(commands.getPositionGames).mockImplementation(async (_token, offset) => ({
    status: "ok",
    data: [row(offset + 1)],
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(token = "one") {
  await act(async () =>
    root.render(
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <PositionGamesTable
          snapshot={summary(token)}
          databasePath="games.db3"
          onExpired={expired}
          owner="board"
        />
      </SWRConfig>,
    ),
  );
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === label,
  )!;
  await act(async () => button.click());
}

it("pages beyond 500 without hydrating PGN, then opens the matching node", async () => {
  await mount();
  await click("Last page");
  expect(commands.getPositionGames).toHaveBeenLastCalledWith(
    "one",
    640,
    20,
    "index",
    "asc",
    "games-sort:board",
  );
  expect(container.textContent).toContain("page:33 total:650");
  expect(commands.getPositionGame).not.toHaveBeenCalled();
  vi.mocked(commands.getPositionGame).mockResolvedValue({
    status: "ok",
    data: {
      ply: 3,
      game: { id: 641, white: "White 641", black: "Black", moves: "1. e4 e5 2. Nf3 Nc6 *" },
    },
  } as Awaited<ReturnType<typeof commands.getPositionGame>>);
  await click("White 641");
  expect(commands.getPositionGame).toHaveBeenCalledWith("one", 640);
  expect(createTab).toHaveBeenCalledWith(
    expect.objectContaining({
      position: [0, 0, 0],
      gameOrigin: { kind: "database", database: "games.db3", gameId: 641 },
    }),
  );
});

it("resets pagination on a new snapshot and ignores a late page for the old position", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof commands.getPositionGames>>) => void;
  await mount();
  vi.mocked(commands.getPositionGames).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await click("Last page");
  await mount("two");
  await act(async () => resolve({ status: "ok", data: [row(641)] }));
  expect(commands.getPositionGames).toHaveBeenLastCalledWith(
    "two",
    0,
    20,
    "index",
    "asc",
    "games-sort:board",
  );
  expect(container.textContent).toContain("page:1 total:650");
  expect(container.textContent).not.toContain("White 641");
});

it("requests a fresh snapshot once when a cached token expires", async () => {
  vi.mocked(commands.getPositionGames).mockResolvedValue({
    status: "error",
    error: "Position query expired",
  });
  await mount();
  await mount();
  expect(expired).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

it("retries a lifecycle cancellation without showing a database failure", async () => {
  vi.mocked(commands.getPositionGames)
    .mockResolvedValueOnce({ status: "error", error: "Search cancelled" })
    .mockResolvedValueOnce({ status: "ok", data: [row(1)] });
  await mount();
  await act(async () => {});
  expect(commands.getPositionGames).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("White 1");
});

it("sorts the complete snapshot and resets to the first page", async () => {
  await mount();
  await click("Last page");
  const select = container.querySelector<HTMLSelectElement>(
    '[aria-label="Board.Database.SortBy"]',
  )!;
  await act(async () => {
    select.value = "date";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(commands.getPositionGames).toHaveBeenLastCalledWith(
    "one",
    0,
    20,
    "date",
    "asc",
    "games-sort:board",
  );
  expect(container.textContent).toContain("page:1 total:650");
  await click("Board.Database.Sort.Desc");
  expect(commands.getPositionGames).toHaveBeenLastCalledWith(
    "one",
    0,
    20,
    "date",
    "desc",
    "games-sort:board",
  );
});
