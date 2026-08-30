import { ask, save } from "@tauri-apps/plugin-dialog";
import { exists, writeTextFile } from "@tauri-apps/plugin-fs";
import { parsePgn } from "chessops/pgn";
import i18n from "i18next";
import { beforeEach, expect, it, vi } from "vitest";
import { commands } from "@/bindings";
import { openingReportFixture } from "./openingReport.fixture";
import { openingReferenceGamesPgn, saveOpeningReport } from "./openingReportFiles";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: vi.fn(), writeTextFile: vi.fn() }));
vi.mock("@/bindings", () => ({ commands: { getPositionGame: vi.fn() } }));
beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(save).mockResolvedValue("C:/exports/report");
    vi.mocked(commands.getPositionGame).mockImplementation(async (_token, offset) => ({
        status: "ok",
        data: {
            ply: 0,
            game: {
                id: offset + 1,
                event_id: 0,
                site_id: 0,
                white_id: 0,
                black_id: 0,
                event: "Test",
                site: "Local",
                white: 'Ana "A"',
                black: "Diego",
                result: "*",
                fen: openingReportFixture().options.displayFen,
                moves: "1. d4 {Comment} d5 (1... Nf6) 2. c4 *",
            },
        },
    }));
});

it("adds the selected extension and reports success only after a successful write", async () => {
    await expect(saveOpeningReport("content", "html", "C:/base.db3", i18n.t)).resolves.toBe(true);
    expect(writeTextFile).toHaveBeenCalledWith("C:/exports/report.html", "content");
    vi.mocked(writeTextFile).mockRejectedValue(new Error("Disk full"));
    await expect(saveOpeningReport("content", "html", "C:/base.db3", i18n.t)).rejects.toThrow(
        "Disk full",
    );
});

it("does not write after dialog cancellation, overwrite refusal, or an aborted dialog", async () => {
    vi.mocked(save).mockResolvedValueOnce(null);
    expect(await saveOpeningReport("x", "pgn", "base.db3", i18n.t)).toBe(false);
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(ask).mockResolvedValue(false);
    expect(await saveOpeningReport("x", "pgn", "base.db3", i18n.t)).toBe(false);
    const controller = new AbortController();
    vi.mocked(save).mockImplementationOnce(async () => {
        controller.abort();
        return "report.pgn";
    });
    await expect(
        saveOpeningReport("x", "pgn", "base.db3", i18n.t, controller.signal),
    ).rejects.toThrow(/abort/i);
    expect(writeTextFile).not.toHaveBeenCalled();
});

it("exports at most 20 distinct game references, preserving comments, branches and escaped headers", async () => {
    const report = openingReportFixture();
    report.theory = Array.from({ length: 30 }, (_, i) => ({
        ...report.theory[0],
        exampleOffset: Math.floor(i / 1.2),
    }));
    const pgn = await openingReferenceGamesPgn(report);
    const games = parsePgn(pgn);
    expect(commands.getPositionGame).toHaveBeenCalledTimes(20);
    expect(games).toHaveLength(20);
    expect(games[0].headers.get("White")).toBe('Ana "A"');
    expect(games[0].headers.get("SourceGameId")).toBe("1");
    expect(games[0].moves.children[0].data.comments).toEqual(["Comment"]);
    expect(games[0].moves.children[0].children).toHaveLength(2);
});

it("discards a late game after cancellation and propagates expired snapshot errors", async () => {
    const controller = new AbortController();
    const response = await commands.getPositionGame("fixture", 0);
    vi.mocked(commands.getPositionGame)
        .mockClear()
        .mockImplementationOnce(async () => {
            controller.abort();
            return response;
        });
    await expect(
        openingReferenceGamesPgn(openingReportFixture(), controller.signal),
    ).rejects.toThrow(/abort/i);
    expect(commands.getPositionGame).toHaveBeenCalledTimes(1);
    vi.mocked(commands.getPositionGame).mockResolvedValue({
        status: "error",
        error: "Position query expired",
    });
    await expect(openingReferenceGamesPgn(openingReportFixture())).rejects.toThrow(
        "Position query expired",
    );
});

it("rejects a reference exceeding the UTF-8 byte limit before constructing its PGN tree", async () => {
    const result = await commands.getPositionGame("fixture", 0);
    if (result.status !== "ok") throw new Error("Missing test fixture");
    result.data.game.moves = `1. d4 {${"á".repeat(4 * 1024 * 1024)}} *`;
    vi.mocked(commands.getPositionGame).mockClear().mockResolvedValue(result);
    await expect(openingReferenceGamesPgn(openingReportFixture())).rejects.toThrow(
        "Reference export exceeds 8 MiB",
    );
    expect(commands.getPositionGame).toHaveBeenCalledOnce();
});
