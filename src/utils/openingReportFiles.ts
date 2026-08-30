import { ask, save } from "@tauri-apps/plugin-dialog";
import { exists, writeTextFile } from "@tauri-apps/plugin-fs";
import { makePgn, PgnParser, type Game, type PgnNodeData } from "chessops/pgn";
import type { TFunction } from "i18next";
import { commands, type OpeningReport } from "@/bindings";

const MAX_EXPORT_BYTES = 8 * 1024 * 1024;

export async function saveOpeningReport(
    content: string,
    extension: "html" | "pgn",
    sourceDatabase: string,
    t: TFunction,
    signal?: AbortSignal,
) {
    signal?.throwIfAborted();
    const selected = await save({
        defaultPath: `opening-report.${extension}`,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!selected) return false;
    signal?.throwIfAborted();
    const destination = selected.toLowerCase().endsWith(`.${extension}`)
        ? selected
        : `${selected}.${extension}`;
    const normalize = (path: string) => path.replaceAll("\\", "/").toLowerCase();
    if (
        [sourceDatabase, sourceDatabase.replace(/\.[^.]+$/, ".ecsi")].some(
            (path) => normalize(path) === normalize(destination),
        )
    )
        throw new Error("Protected database path");
    if (
        (await exists(destination)) &&
        !(await ask(t("OpeningReport.Overwrite", { path: destination }), { kind: "warning" }))
    )
        return false;
    signal?.throwIfAborted();
    await writeTextFile(destination, content);
    return true;
}

/** Export at most 20 distinct references, never an implicit export of the entire database. */
export async function openingReferenceGamesPgn(report: OpeningReport, signal?: AbortSignal) {
    const offsets = [...new Set(report.theory.map((line) => line.exampleOffset))].slice(0, 20);
    const games: string[] = [];
    let bytes = 0;
    for (const offset of offsets) {
        signal?.throwIfAborted();
        const response = await commands.getPositionGame(report.position.token, offset);
        signal?.throwIfAborted();
        if (response.status === "error") throw new Error(response.error);
        const source = response.data.game;
        if (new TextEncoder().encode(source.moves).byteLength > MAX_EXPORT_BYTES)
            throw new Error("Reference export exceeds 8 MiB");
        const parsed: Game<PgnNodeData>[] = [];
        let parseError: Error | undefined;
        new PgnParser(
            (game, error) => {
                parsed.push(game);
                parseError ??= error;
            },
            undefined,
            MAX_EXPORT_BYTES,
        ).parse(source.moves);
        const game = parsed[0];
        if (parseError || parsed.length !== 1)
            throw new Error("Invalid or oversized reference game", { cause: parseError });
        const fields: Record<string, string | number | null | undefined> = {
            Event: source.event,
            Site: source.site,
            Date: source.date,
            Round: source.round,
            White: source.white,
            Black: source.black,
            Result: source.result,
            WhiteElo: source.white_elo,
            BlackElo: source.black_elo,
            SetUp: "1",
            FEN: source.fen,
            SourceDatabase: report.databaseName,
            SourceGameId: source.id,
        };
        for (const [name, value] of Object.entries(fields))
            if (value != null)
                game.headers.set(
                    name,
                    String(value)
                        .replaceAll("\0", " ")
                        .replace(/[\r\n]/g, " "),
                );
        const pgn = makePgn(game);
        bytes += new TextEncoder().encode(pgn).byteLength + (games.length ? 2 : 0);
        if (bytes > MAX_EXPORT_BYTES) throw new Error("Reference export exceeds 8 MiB");
        games.push(pgn);
    }
    return games.join("\n\n");
}
