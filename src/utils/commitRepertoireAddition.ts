import { copyFile, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import i18n from "i18next";

/** Stage beside the working copy, retain a recovery PGN, and recheck before replacing. */
export async function commitRepertoireAddition({
    path,
    baseline,
    pgn,
    assertUnchanged,
}: {
    path: string;
    baseline: string;
    pgn: string;
    assertUnchanged: () => void;
}) {
    const suffix = crypto.randomUUID();
    const backup = `${path}.before-import-${suffix}.pgn`;
    const staged = `${path}.import-${suffix}.tmp`;
    async function check() {
        assertUnchanged();
        if ((await readTextFile(path)) !== baseline) {
            throw new Error(
                i18n.t(
                    "Repertoire.Changed",
                    "The repertoire has changed. Close this preview and try again.",
                ),
            );
        }
        assertUnchanged();
    }
    await check();
    await copyFile(path, backup);
    try {
        await writeTextFile(staged, pgn);
        await check();
        await rename(staged, path);
        return backup;
    } catch (error) {
        // Only our uniquely named temporary file is removed; the recovery PGN is retained.
        await remove(staged).catch(() => {});
        throw error;
    }
}
