import { beforeEach, describe, expect, it, vi } from "vitest";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { exists, writeTextFile } from "@tauri-apps/plugin-fs";
import { commands } from "@/bindings";
import { createTreeStore } from "@/state/store/tree";
import { saveToFile, type Tab } from "./tabs";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), ask: vi.fn() }));
vi.mock("i18next", () => ({ default: { t: (_key: string, fallback: string) => fallback } }));
vi.mock("@tauri-apps/plugin-fs", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tauri-apps/plugin-fs")>()),
    exists: vi.fn(),
    writeTextFile: vi.fn(),
    copyFile: vi.fn(),
}));
vi.mock("@tauri-apps/api/path", () => ({ resolve: async (...parts: string[]) => parts.join("/") }));
vi.mock("@tauri-apps/plugin-log", () => ({ error: vi.fn() }));
vi.mock("@/bindings", () => ({ commands: { writeGame: vi.fn(), writeDbGame: vi.fn() } }));

function fixture(database = false) {
    const store = createTreeStore();
    store.setState({ dirty: true });
    const tab: Tab = {
        name: "Game",
        value: "game",
        type: "play",
        gameOrigin: database
            ? { kind: "database", database: "games.db3", gameId: 2 }
            : { kind: "none" },
    };
    return { dir: "C:/test", tab, store, setCurrentTab: vi.fn(), isUserSave: true };
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(save).mockResolvedValue("C:/test/game.pgn");
    vi.mocked(commands.writeGame).mockResolvedValue({ status: "ok", data: null });
    vi.mocked(commands.writeDbGame).mockResolvedValue({ status: "ok", data: null });
});

describe("save before closing a tab", () => {
    it("protects a repertoire's imported source when exporting its editable copy", async () => {
        const args = fixture();
        vi.mocked(save).mockResolvedValue("C:/original.pgn");
        await expect(
            saveToFile({ ...args, mode: "export", protectedPaths: ["C:/original.pgn"] }),
        ).rejects.toThrow("Choose a different file");
        expect(writeTextFile).not.toHaveBeenCalled();
    });
    it("saves only the selected record in its existing multi-game source", async () => {
        const args = fixture();
        args.tab.gameOrigin = {
            kind: "file",
            gameNumber: 9,
            file: {
                type: "file",
                path: "C:/source.pgn",
                name: "Source",
                numGames: 20,
                metadata: { type: "game", tags: [] },
                lastModified: 0,
            },
        };
        expect(await saveToFile(args)).toBe(true);
        expect(commands.writeGame).toHaveBeenCalledWith(
            "C:/source.pgn",
            9,
            expect.stringContaining("[Result"),
        );
        expect(writeTextFile).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        expect(args.setCurrentTab).not.toHaveBeenCalled();
    });
    it.each(["saveAs", "export"] as const)(
        "%s refuses the same source path, including case and separator differences",
        async (mode) => {
            const args = fixture();
            args.tab.gameOrigin = {
                kind: "file",
                gameNumber: 0,
                file: {
                    type: "file",
                    path: "C:/SOURCE.pgn",
                    name: "Source",
                    numGames: 1,
                    metadata: { type: "game", tags: [] },
                    lastModified: 0,
                },
            };
            vi.mocked(save).mockResolvedValue("c:\\source.pgn");
            await expect(saveToFile({ ...args, mode })).rejects.toThrow("Choose a different file");
            expect(writeTextFile).not.toHaveBeenCalled();
            expect(args.setCurrentTab).not.toHaveBeenCalled();
            expect(args.store.getState().dirty).toBe(true);
        },
    );
    it("does not switch source or clear unsaved edits when Save As fails", async () => {
        const args = fixture();
        vi.mocked(writeTextFile).mockRejectedValue(new Error("Disk full"));
        await expect(saveToFile({ ...args, mode: "saveAs" })).rejects.toThrow("Disk full");
        expect(args.setCurrentTab).not.toHaveBeenCalled();
        expect(args.store.getState().dirty).toBe(true);
    });
    it.each(["saveAs", "export"] as const)(
        "%s writes only the current game from a multi-game file",
        async (mode) => {
            const args = fixture();
            args.tab.gameOrigin = {
                kind: "file",
                gameNumber: 9,
                file: {
                    type: "file",
                    path: "C:/source.pgn",
                    name: "Source",
                    numGames: 20,
                    metadata: { type: "game", tags: [] },
                    lastModified: 0,
                },
            };
            expect(await saveToFile({ ...args, mode })).toBe(true);
            expect(writeTextFile).toHaveBeenCalledOnce();
            expect(commands.writeGame).not.toHaveBeenCalled();
            expect(args.setCurrentTab).toHaveBeenCalledTimes(mode === "saveAs" ? 1 : 0);
            expect(args.store.getState().dirty).toBe(mode === "export");
            const updatedTab = args.setCurrentTab.mock.calls[0]?.[0](args.tab) ?? args.tab;
            expect(updatedTab.gameOrigin).toMatchObject(
                mode === "saveAs"
                    ? {
                          gameNumber: 0,
                          file: { numGames: 1 },
                      }
                    : args.tab.gameOrigin,
            );
        },
    );
    it("keeps the source untouched and honours overwrite refusal", async () => {
        const args = fixture();
        vi.mocked(exists).mockResolvedValue(true);
        vi.mocked(ask).mockResolvedValue(false);
        expect(await saveToFile({ ...args, mode: "export" })).toBe(false);
        expect(writeTextFile).not.toHaveBeenCalled();
    });
    it("does not permit closing when the save dialog is cancelled", async () => {
        vi.mocked(save).mockResolvedValue(null);
        const args = fixture();
        expect(await saveToFile(args)).toBe(false);
        expect(args.store.getState().dirty).toBe(true);
        expect(commands.writeGame).not.toHaveBeenCalled();
        expect(args.setCurrentTab).not.toHaveBeenCalled();
    });

    it("waits for the write to finish before reporting success or marking the tree saved", async () => {
        let finish!: () => void;
        vi.mocked(commands.writeGame).mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = () => resolve({ status: "ok", data: null });
                }),
        );
        const args = fixture();
        let completed = false;
        const saving = saveToFile(args).then((saved) => {
            completed = saved;
        });
        await vi.waitFor(() => expect(commands.writeGame).toHaveBeenCalled());
        expect(completed).toBe(false);
        expect(args.store.getState().dirty).toBe(true);
        expect(args.setCurrentTab).not.toHaveBeenCalled();
        finish();
        await saving;
        expect(completed).toBe(true);
        expect(args.store.getState().dirty).toBe(false);
        expect(args.setCurrentTab).toHaveBeenCalledOnce();
    });

    it.each([false, true])("leaves a failed write dirty (database=%s)", async (database) => {
        vi.mocked(database ? commands.writeDbGame : commands.writeGame).mockResolvedValue({
            status: "error",
            error: "Write failed",
        });
        const args = fixture(database);
        await expect(saveToFile(args)).rejects.toThrow("Write failed");
        expect(args.store.getState().dirty).toBe(true);
        expect(args.setCurrentTab).not.toHaveBeenCalled();
    });
});
