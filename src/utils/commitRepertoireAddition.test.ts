import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyFile, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { commitRepertoireAddition } from "./commitRepertoireAddition";

vi.mock("i18next", () => ({ default: { t: (_key: string, fallback: string) => fallback } }));

vi.mock("@tauri-apps/plugin-fs", () => ({
    copyFile: vi.fn(),
    readTextFile: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    writeTextFile: vi.fn(),
}));
beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(readTextFile).mockResolvedValue("original");
    vi.mocked(remove).mockResolvedValue();
});
const fixture = () => ({
    path: "editable.pgn",
    baseline: "original",
    pgn: "merged",
    assertUnchanged: vi.fn(),
});
describe("repertoire commit safety", () => {
    it("backs up the working copy and writes a staged file before replacing it", async () => {
        const args = fixture();
        const backup = await commitRepertoireAddition(args);
        expect(copyFile).toHaveBeenCalledWith("editable.pgn", backup);
        expect(writeTextFile).toHaveBeenCalledWith(
            expect.stringMatching(/^editable\.pgn\.import-.*\.tmp$/),
            "merged",
        );
        expect(rename).toHaveBeenCalledWith(
            vi.mocked(writeTextFile).mock.calls[0][0],
            "editable.pgn",
        );
        expect(readTextFile).toHaveBeenCalledTimes(2);
        expect(remove).not.toHaveBeenCalled();
    });
    it("refuses a stale preview without writing", async () => {
        vi.mocked(readTextFile).mockResolvedValue("edited externally");
        await expect(commitRepertoireAddition(fixture())).rejects.toThrow(
            "The repertoire has changed",
        );
        expect(copyFile).not.toHaveBeenCalled();
        expect(writeTextFile).not.toHaveBeenCalled();
    });
    it("does not replace the PGN when staged writing fails", async () => {
        vi.mocked(writeTextFile).mockRejectedValue(new Error("Disk full"));
        await expect(commitRepertoireAddition(fixture())).rejects.toThrow("Disk full");
        expect(rename).not.toHaveBeenCalled();
        expect(remove).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/));
    });
    it("rechecks pending edits and external changes after staging", async () => {
        const args = fixture();
        vi.mocked(writeTextFile).mockImplementation(async () => {
            args.assertUnchanged.mockImplementation(() => {
                throw new Error("Unsaved edits");
            });
        });
        await expect(commitRepertoireAddition(args)).rejects.toThrow("Unsaved edits");
        expect(rename).not.toHaveBeenCalled();
        vi.mocked(writeTextFile).mockResolvedValue();
        vi.mocked(readTextFile)
            .mockResolvedValueOnce("original")
            .mockResolvedValueOnce("changed while staging");
        await expect(commitRepertoireAddition(fixture())).rejects.toThrow(
            "The repertoire has changed",
        );
        expect(rename).not.toHaveBeenCalled();
    });
    it("retains the recovery PGN if replacement fails", async () => {
        vi.mocked(rename).mockRejectedValue(new Error("File locked"));
        await expect(commitRepertoireAddition(fixture())).rejects.toThrow("File locked");
        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove).not.toHaveBeenCalledWith(expect.stringMatching(/\.pgn$/));
    });
});
