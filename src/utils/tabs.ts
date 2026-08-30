import { resolve, tempDir } from "@tauri-apps/api/path";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { copyFile, exists, writeTextFile } from "@tauri-apps/plugin-fs";
import i18n from "i18next";
import { z } from "zod";
import type { StoreApi } from "zustand";
import { commands } from "@/bindings";
import { type FileMetadata, fileMetadataSchema } from "@/components/files/file";
import type { TreeStoreState } from "@/state/store/tree";
import { getLatestSessionStorageValue } from "@/state/store/debouncedStorage";
import { getPGN, parsePGN } from "./chess";
import { type GameHeaders, getGameName } from "./treeReducer";
import { unwrap } from "./unwrap";

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]+/g;

function getDefaultGameFilename(headers: GameHeaders) {
    const baseName = getGameName(headers).trim();
    const date = headers.date?.trim() || "";
    const hasUsableBase = baseName.length > 0 && baseName !== "Unknown";
    const hasUsableDate = Boolean(date) && date !== "????.??.??" && date !== "????.??";

    let filename = hasUsableBase ? baseName : "";
    if (hasUsableDate) {
        filename = filename ? `${date}_${filename}` : date;
    }

    filename = filename.replace(INVALID_FILENAME_CHARS, " ").replace(/\s+/g, " ").trim();

    if (filename.length > 0) {
        return filename;
    }

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const time = now.toISOString().slice(11, 16).replace(":", ".");
    return `${today}_${time}_analysis`;
}

const gameOriginSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("none"),
    }),
    z.object({
        kind: z.literal("file"),
        file: fileMetadataSchema,
        gameNumber: z.number(),
    }),
    z.object({
        kind: z.literal("temp_file"),
        file: fileMetadataSchema,
        gameNumber: z.number(),
    }),
    z.object({
        kind: z.literal("database"),
        database: z.string(),
        gameId: z.number(),
    }),
]);

export const tabSchema = z.object({
    revision: z.number().int().nonnegative().optional(),
    name: z.string(),
    value: z.string(),
    type: z.enum(["new", "play", "generator", "analysis", "puzzles", "training"]),
    trainingPath: z
        .string()
        .regex(/^\/training(?:\/[^?#]*)?$/)
        .optional(),
    returnPath: z.enum(["/accounts", "/databases"]).optional(),
    gameOrigin: gameOriginSchema,
});

export type GameOrigin = z.infer<typeof gameOriginSchema>;
export type Tab = z.infer<typeof tabSchema>;

export function getTabFile(tab?: Tab | null): FileMetadata | undefined {
    if (!tab) return undefined;
    if (tab.gameOrigin.kind === "file" || tab.gameOrigin.kind === "temp_file") {
        return tab.gameOrigin.file;
    }
    return undefined;
}

export function getTabGameNumber(tab?: Tab | null): number {
    if (!tab) return 0;
    if (tab.gameOrigin.kind === "file" || tab.gameOrigin.kind === "temp_file") {
        return tab.gameOrigin.gameNumber;
    }
    return 0;
}

export function isPersistentGameOrigin(tab?: Tab | null): boolean {
    if (!tab) return false;
    return tab.gameOrigin.kind !== "none";
}

export function genID() {
    function S4() {
        return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
    }
    return S4() + S4();
}

export async function createTab({
    tab,
    setTabs,
    setActiveTab,
    pgn,
    headers,
    gameOrigin,
    position,
    reuseTabId,
    preserveNewTab = false,
}: {
    tab: Omit<Tab, "value" | "gameOrigin">;
    setTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
    setActiveTab: React.Dispatch<React.SetStateAction<string | null>>;
    pgn?: string;
    headers?: GameHeaders;
    gameOrigin?: GameOrigin;
    position?: number[];
    reuseTabId?: string;
    preserveNewTab?: boolean;
}) {
    const id = reuseTabId ?? genID();

    if (pgn !== undefined) {
        const tree = await parsePGN(pgn, headers?.fen);
        if (headers) {
            tree.headers = headers;
        }
        if (position) tree.position = position;
        sessionStorage.setItem(id, JSON.stringify({ version: 0, state: tree }));
    }

    setTabs((prev) => {
        const nextTab = {
            ...tab,
            value: id,
            gameOrigin: gameOrigin ?? { kind: "none" },
        };
        if (reuseTabId && prev.some((candidate) => candidate.value === reuseTabId)) {
            return prev.map((candidate) => (candidate.value === reuseTabId ? nextTab : candidate));
        }
        if (
            prev.length === 0 ||
            (prev.length === 1 && prev[0].type === "new" && tab.type !== "new" && !preserveNewTab)
        ) {
            return [nextTab];
        }
        return [...prev, nextTab];
    });
    setActiveTab(id);
    return id;
}

export function isEmptyAnalysisTab(tab: Tab | undefined): boolean {
    if (!tab) return false;
    const hasTreeState = getLatestSessionStorageValue(tab.value) !== null;
    if (tab.type === "new") return !hasTreeState;
    return tab.type === "analysis" && tab.gameOrigin.kind === "none" && !hasTreeState;
}

export async function createOrReuseBoardTab({
    tabs,
    activeTab,
    type,
    name,
    reuseEmpty,
    setTabs,
    setActiveTab,
}: {
    tabs: Tab[];
    activeTab: string | null;
    type: "analysis" | "play" | "generator";
    name: string;
    reuseEmpty: boolean;
    setTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
    setActiveTab: React.Dispatch<React.SetStateAction<string | null>>;
}) {
    const current = tabs.find((tab) => tab.value === activeTab);
    const reuseTabId = reuseEmpty && isEmptyAnalysisTab(current) ? current?.value : undefined;
    return createTab({
        tab: { name, type },
        setTabs,
        setActiveTab,
        reuseTabId,
    });
}

export async function isInTempDir(filePath: string): Promise<boolean> {
    const tmp = await tempDir();
    const normalize = (p: string) => p.replace(/[\\/]+/g, "/").toLowerCase();
    return normalize(filePath).startsWith(normalize(tmp));
}

export async function saveToFile({
    dir,
    tab,
    setCurrentTab,
    store,
    isUserSave,
    mode = "save",
    protectedPaths = [],
}: {
    dir: string;
    tab: Tab | undefined;
    setCurrentTab: React.Dispatch<React.SetStateAction<Tab>>;
    store: StoreApi<TreeStoreState>;
    isUserSave?: boolean;
    mode?: "save" | "saveAs" | "export";
    protectedPaths?: string[];
}) {
    let filePath: string;
    let savedOrigin: GameOrigin | undefined;
    const currentOrigin = tab?.gameOrigin;
    const fileOrigin =
        currentOrigin?.kind === "file" || currentOrigin?.kind === "temp_file"
            ? currentOrigin
            : undefined;
    const databaseOrigin = currentOrigin?.kind === "database" ? currentOrigin : undefined;
    const isTempFile = currentOrigin?.kind === "temp_file";
    const pgn = `${getPGN(store.getState().root, {
        headers: store.getState().headers,
        comments: true,
        extraMarkups: true,
        glyphs: true,
        variations: true,
    })}\n\n`;

    if (mode !== "save") {
        const selected = await save({
            title:
                mode === "saveAs"
                    ? i18n.t("Pgn.SaveAs", "Save as new PGN")
                    : i18n.t("Pgn.ExportCopy", "Export PGN copy"),
            defaultPath: await resolve(
                dir,
                `${getDefaultGameFilename(store.getState().headers)}.pgn`,
            ),
            filters: [{ name: "PGN", extensions: ["pgn"] }],
        });
        if (!selected) return false;
        const destination = /\.pgn$/i.test(selected) ? selected : `${selected}.pgn`;
        const normalized = (path: string) => path.replace(/\\/g, "/").toLowerCase();
        if (
            [...protectedPaths, ...(fileOrigin ? [fileOrigin.file.path] : [])].some(
                (path) => normalized(destination) === normalized(path),
            )
        ) {
            throw new Error(
                i18n.t("Pgn.DifferentPath", "Choose a different file to keep the source intact."),
            );
        }
        if (
            (await exists(destination)) &&
            !(await ask(
                i18n.t("Pgn.Overwrite", "Replace the entire existing file? {{path}}", {
                    path: destination,
                }),
                { kind: "warning" },
            ))
        )
            return false;
        // Save As / Export contain only this game, never its neighbouring PGN records.
        await writeTextFile(destination, pgn);
        if (mode === "saveAs") {
            setCurrentTab((previous) => ({
                ...previous,
                gameOrigin: {
                    kind: "file",
                    gameNumber: 0,
                    file: {
                        type: "file",
                        name: destination,
                        path: destination,
                        numGames: 1,
                        metadata: { type: "game", tags: [] },
                        lastModified: Date.now(),
                    },
                },
            }));
            store.getState().save();
        }
        return true;
    }

    if (databaseOrigin) {
        unwrap(await commands.writeDbGame(databaseOrigin.database, databaseOrigin.gameId, pgn));
        store.getState().save();
        return true;
    }

    if (fileOrigin && !(isTempFile && isUserSave)) {
        filePath = fileOrigin.file.path;
    } else {
        const headers = store.getState().headers;
        const suggestedName = getDefaultGameFilename(headers) || "Game";
        const defaultPath = await resolve(dir, `${suggestedName}.pgn`);
        const userChoice = await save({
            defaultPath,
            filters: [
                {
                    name: "PGN",
                    extensions: ["pgn"],
                },
            ],
        });
        if (userChoice === null) {
            return false;
        }
        if (userChoice.endsWith(".pgn")) {
            filePath = userChoice;
        } else {
            // on Linux filters for userChoice seemingly don't work
            // so userChoice can end without 'pgn' extension
            filePath = userChoice.concat(".pgn");
        }

        if (isTempFile && fileOrigin) {
            await copyFile(fileOrigin.file.path, filePath);
        }

        const numGames = isTempFile && fileOrigin ? fileOrigin.file.numGames : 1;
        const gameNumber = fileOrigin?.gameNumber ?? 0;
        savedOrigin = {
            kind: "file",
            gameNumber,
            file: {
                type: "file",
                name: filePath,
                path: filePath,
                numGames,
                metadata: {
                    tags: [],
                    type: "game",
                },
                lastModified: Date.now(),
            },
        };
    }
    unwrap(await commands.writeGame(filePath, fileOrigin?.gameNumber ?? 0, pgn));
    if (savedOrigin) {
        const gameOrigin = savedOrigin;
        setCurrentTab((prev) => ({ ...prev, gameOrigin }));
    }
    store.getState().save();
    return true;
}
