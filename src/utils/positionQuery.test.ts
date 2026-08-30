import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "@/bindings";
import type { LocalOptions } from "@/components/panels/database/DatabasePanel";
import { queryPosition } from "./db";
import { computeTreeCoverage } from "./repertoire";
import type { TreeNode } from "./treeReducer";

vi.mock("@/bindings", () => ({
    commands: { queryPosition: vi.fn(), cancelPositionSearch: vi.fn().mockResolvedValue(true) },
}));
const options: LocalOptions = {
    path: "games.db3",
    fen: "start",
    type: "exact",
    player: null,
    color: "white",
    result: "any",
};
const summary = {
    token: "snapshot",
    fingerprint: "revision",
    fen: "start",
    total: 10,
    openings: [{ move: "e4", white: 3, draw: 2, black: 1, unknown: 4 }],
    skippedGames: 0,
    scanMs: 1,
    cacheHit: false,
};
afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
});

describe("position query lifecycle", () => {
    it("rejects a late response after abort and cancels its native owner", async () => {
        let finish!: (v: unknown) => void;
        vi.mocked(commands.queryPosition).mockImplementationOnce(
            () =>
                new Promise((r) => {
                    finish = r;
                }) as never,
        );
        const controller = new AbortController();
        const result = queryPosition(options, "board:1", controller.signal).catch(
            (error: unknown) => error,
        );
        controller.abort();
        finish({ status: "ok", data: summary });
        expect(await result).toMatchObject({ name: "AbortError" });
        expect(commands.cancelPositionSearch).toHaveBeenCalledWith("board:1");
    });

    it("retries preempted background work without treating it as zero games", async () => {
        vi.useFakeTimers();
        vi.mocked(commands.queryPosition)
            .mockResolvedValueOnce({ status: "error", error: "Search preempted" })
            .mockResolvedValueOnce({ status: "ok", data: summary });
        const result = queryPosition(options, "coverage:1", new AbortController().signal, true);
        await vi.advanceTimersByTimeAsync(150);
        expect(await result).toEqual(summary);
        expect(commands.queryPosition).toHaveBeenCalledTimes(2);
    });

    it("maps an any-color player and one shared Elo range to the native position query", async () => {
        vi.mocked(commands.queryPosition).mockResolvedValueOnce({ status: "ok", data: summary });
        await queryPosition(
            { ...options, player: 42, color: "any", elo_min: 1800, elo_max: 2200 },
            "board:elo",
        );
        expect(commands.queryPosition).toHaveBeenCalledWith(
            "games.db3",
            expect.objectContaining({
                any_player: 42,
                player1: undefined,
                player2: undefined,
                range1: [1800, 2200],
                range2: [1800, 2200],
            }),
            "board:elo",
            false,
        );
    });

    it("stops a preempted retry when the component is unmounted", async () => {
        vi.useFakeTimers();
        vi.mocked(commands.queryPosition).mockResolvedValueOnce({
            status: "error",
            error: "Search preempted",
        });
        const controller = new AbortController();
        const result = queryPosition(options, "coverage:2", controller.signal, true).catch(
            (error: unknown) => error,
        );
        await vi.advanceTimersByTimeAsync(0);
        controller.abort();
        expect(await result).toMatchObject({ name: "AbortError" });
        await vi.advanceTimersByTimeAsync(1000);
        expect(commands.queryPosition).toHaveBeenCalledTimes(1);
    });

    it("does not turn a failed coverage query into a fully covered line", async () => {
        vi.mocked(commands.queryPosition).mockResolvedValueOnce({
            status: "error",
            error: "Database unavailable",
        });
        const root = { fen: "start", halfMoves: 0, children: [] } as unknown as TreeNode;
        await expect(
            computeTreeCoverage(
                root,
                "white",
                "games.db3",
                5,
                [],
                new AbortController().signal,
                "coverage:3",
            ),
        ).rejects.toThrow("Database unavailable");
    });
});
