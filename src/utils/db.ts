import { resolve } from "@tauri-apps/api/path";
import { readDir } from "@tauri-apps/plugin-fs";
import { fetch } from "@tauri-apps/plugin-http";
import useSWR from "swr";
import {
    commands,
    type DatabaseInfo,
    type GameQuery,
    type NormalizedGame,
    type Player,
    type PlayerQuery,
    type PuzzleDatabaseInfo,
    type QueryResponse,
} from "@/bindings";
import type { LocalOptions } from "@/components/panels/database/DatabasePanel";
import { getDatabasesDir } from "@/utils/directories";
import { unwrap } from "./unwrap";

export type SuccessDatabaseInfo = Extract<DatabaseInfo, { type: "success" }>;

export type Sides = "WhiteBlack" | "BlackWhite" | "Any";

export interface CompleteGame {
    game: NormalizedGame;
    currentMove: number[];
}

export type Speed =
    | "UltraBullet"
    | "Bullet"
    | "Blitz"
    | "Rapid"
    | "Classical"
    | "Correspondence"
    | "Unknown";

/**
 * Position requests are cancelled when their owning tab unmounts or a newer
 * request supersedes them. Those lifecycle cancellations must not be surfaced
 * as database failures when the tab is restored from the SWR cache.
 */
export function isTransientPositionError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "AbortError") return true;
    const message = error instanceof Error ? error.message : String(error ?? "");
    return (
        message === "Search cancelled" ||
        message === "Search preempted" ||
        message === "This operation was aborted"
    );
}

function normalizeRange(range?: [number, number] | null): [number, number] | undefined {
    if (!range || range[1] - range[0] === 3000) {
        return undefined;
    }
    return range;
}

export async function query_games(
    db: string,
    query: GameQuery,
): Promise<QueryResponse<NormalizedGame[]>> {
    return unwrap(
        await commands.getGames(db, {
            player1: query.player1,
            range1: normalizeRange(query.range1),
            player2: query.player2,
            range2: normalizeRange(query.range2),
            tournament_id: query.tournament_id,
            sides: query.sides,
            outcome: query.outcome,
            start_date: query.start_date,
            end_date: query.end_date,
            position: null,
            options: {
                skipCount: query.options?.skipCount ?? false,
                page: query.options?.page,
                pageSize: query.options?.pageSize,
                sort: query.options?.sort || "id",
                direction: query.options?.direction || "desc",
            },
        }),
    );
}

export async function query_players(
    db: string,
    query: PlayerQuery,
): Promise<QueryResponse<Player[]>> {
    return unwrap(
        await commands.getPlayers(db, {
            options: {
                skipCount: query.options.skipCount || false,
                page: query.options.page,
                pageSize: query.options.pageSize,
                sort: query.options.sort,
                direction: query.options.direction,
            },
            name: query.name,
            range: normalizeRange(query.range),
        }),
    );
}

export async function getDatabases(): Promise<DatabaseInfo[]> {
    const dbDir = await getDatabasesDir();
    const files = await readDir(dbDir);
    const dbs = files.filter((file) => file.name?.endsWith(".db3"));
    return (await Promise.allSettled(dbs.map((db) => getDatabase(db.name))))
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<DatabaseInfo>).value);
}

async function getDatabase(name: string): Promise<DatabaseInfo> {
    const dbDir = await getDatabasesDir();
    const path = await resolve(dbDir, name);
    const res = await commands.getDbInfo(path);
    if (res.status === "ok") {
        return {
            type: "success",
            ...res.data,
            file: path,
        };
    }
    return {
        type: "error",
        filename: path,
        file: path,
        error: res.error,
        indexed: false,
    };
}

export function useDefaultDatabases(opened: boolean) {
    const { data, error, isLoading } = useSWR(opened ? "default-dbs" : null, async () => {
        const data = await fetch("https://www.encroissant.org/databases", {
            method: "GET",
        });
        if (!data.ok) {
            throw new Error("Failed to fetch engines");
        }
        return (await data.json()) as SuccessDatabaseInfo[];
    });
    return {
        defaultDatabases: data,
        error,
        isLoading,
    };
}

export async function getDefaultPuzzleDatabases(): Promise<
    (PuzzleDatabaseInfo & { downloadLink: string })[]
> {
    const data = await fetch("https://www.encroissant.org/puzzle_databases", {
        method: "GET",
    });
    if (!data.ok) {
        throw new Error("Failed to fetch puzzle databases");
    }
    return (await data.json()) as (PuzzleDatabaseInfo & {
        downloadLink: string;
    })[];
}

export interface Opening {
    move: string;
    white: number;
    black: number;
    draw: number;
    unknown?: number;
}

export async function getTournamentGames(file: string, id: number) {
    return await query_games(file, {
        options: {
            direction: "asc",
            sort: "id",
            skipCount: true,
        },
        tournament_id: id,
    });
}

export async function queryPosition(
    options: LocalOptions,
    tab: string,
    signal?: AbortSignal,
    background = false,
) {
    signal?.throwIfAborted();
    const cancel = () => {
        void commands.cancelPositionSearch(tab);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
        while (true) {
            signal?.throwIfAborted();
            const eloRange: [number, number] | undefined =
                options.elo_min != null || options.elo_max != null
                    ? [
                          Math.min(options.elo_min ?? 1, options.elo_max ?? 32767),
                          Math.max(options.elo_min ?? 1, options.elo_max ?? 32767),
                      ]
                    : undefined;
            const res = await commands.queryPosition(
                options.path!,
                {
                    player1: options.color === "white" ? options.player : undefined,
                    player2: options.color === "black" ? options.player : undefined,
                    any_player: options.color === "any" ? options.player : undefined,
                    range1: eloRange,
                    range2: eloRange,
                    position: {
                        fen: options.fen,
                        type_: options.type,
                    },
                    start_date: options.start_date,
                    end_date: options.end_date,
                    wanted_result: options.result,
                },
                tab,
                background,
            );
            signal?.throwIfAborted();
            if (res.status === "ok") return res.data;
            if (res.error === "Search preempted" && background && signal) {
                await new Promise<void>((resolve, reject) => {
                    const abort = () => {
                        clearTimeout(timer);
                        reject(signal.reason);
                    };
                    const timer = setTimeout(() => {
                        signal.removeEventListener("abort", abort);
                        resolve();
                    }, 150);
                    signal.addEventListener("abort", abort, { once: true });
                    if (signal.aborted) abort();
                });
                continue;
            }
            throw new Error(res.error);
        }
    } finally {
        signal?.removeEventListener("abort", cancel);
    }
}

/** Compatibility for repertoire callers: no PGN hydration for an aggregate-only query. */
export async function searchPosition(
    options: LocalOptions,
    tab: string,
    signal?: AbortSignal,
    background = false,
): Promise<[Opening[], NormalizedGame[]]> {
    const summary = await queryPosition(options, tab, signal, background);
    return [summary.openings, []];
}
