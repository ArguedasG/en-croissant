import { commands, type BestMoves, type ScoreValue } from "@/bindings";
import { getPGN, parsePGN, uciNormalize } from "@/utils/chess";
import { positionFromFen } from "@/utils/chessops";
import { areaId, type OpeningRepertoire, type OpeningsState } from "@/utils/trainingAreas";
import { createNode, type GameHeaders, type TreeNode } from "@/utils/treeReducer";
import { unwrap } from "@/utils/unwrap";
import { makeUci, parseUci } from "chessops";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";

export type OpeningImportConfig = {
    color: OpeningRepertoire["color"];
    subvariationPolicy: OpeningRepertoire["subvariationPolicy"];
};

export type OpeningImportLine = {
    name: string;
    fen: string;
    moves: string[];
    path: number[];
    plyCount: number;
    trainable: boolean;
};

export type OpeningImportVariant = {
    name: string;
    sourceRecordIndex: number;
    trainingRecordIndex: number;
    contentType: "theory" | "modelGame";
    commentCount: number;
    hasVariations: boolean;
    lines: OpeningImportLine[];
};

export type OpeningPgnSample = {
    index: number;
    name: string;
    lineCount: number;
    commentCount: number;
    hasVariations: boolean;
    contentType: "theory" | "modelGame";
    error?: string;
};

export type OpeningPgnInspection = {
    path: string;
    filename: string;
    recordCount: number;
    samples: OpeningPgnSample[];
};

export type PreparedOpeningImport = {
    trainingPgn: string;
    variants: OpeningImportVariant[];
    skippedRecords: number;
};

function scoreForSide(value: ScoreValue, side: "white" | "black"): number {
    const sign = side === "white" ? 1 : -1;
    if (value.type === "cp") return value.value * sign;
    if (value.type === "mate") return value.value * sign * 100000;
    return -value.value * sign;
}

export function acceptsOpeningDeviation(
    best: BestMoves,
    candidate: BestMoves,
    side: "white" | "black",
    thresholdCp = 30,
): boolean {
    const bestValue = best.score.value;
    const candidateValue = candidate.score.value;
    if (bestValue.type === "mate") {
        return candidateValue.type === "mate" && candidateValue.value === bestValue.value;
    }
    if (candidateValue.type === "mate") {
        return scoreForSide(candidateValue, side) > scoreForSide(bestValue, side);
    }
    return scoreForSide(bestValue, side) - scoreForSide(candidateValue, side) <= thresholdCp;
}

export type OpeningMoveClassification =
    | "correct"
    | "good-deviation"
    | "incorrect"
    | "engine-unavailable";

export function classifyOpeningMove(
    expectedSan: string,
    playedSan: string,
    playedUci: string,
    evaluated: BestMoves[] | null,
    side: "white" | "black",
    thresholdCp = 30,
): OpeningMoveClassification {
    if (playedSan === expectedSan) return "correct";
    if (!evaluated || evaluated.length === 0) return "engine-unavailable";

    const candidate = evaluated.find((line) => line.uciMoves[0] === playedUci);
    if (!candidate) return "incorrect";
    return acceptsOpeningDeviation(evaluated[0], candidate, side, thresholdCp)
        ? "good-deviation"
        : "incorrect";
}

function cloneTreeNode(node: TreeNode, selectedPaths: number[][], depth: number): TreeNode {
    return {
        ...node,
        shapes: [...node.shapes],
        annotations: [...node.annotations],
        children: node.children.flatMap((child, childIndex) => {
            const paths = selectedPaths.filter((path) => path[depth] === childIndex);
            return paths.length > 0 ? [cloneTreeNode(child, paths, depth + 1)] : [];
        }),
    };
}

export function filterOpeningTree(root: TreeNode, selectedPaths: number[][]): TreeNode {
    return cloneTreeNode(root, selectedPaths, 0);
}

function moveKey(node: TreeNode): string | null {
    return node.move ? makeUci(node.move) : null;
}

function mergeOpeningBranch(targetRoot: TreeNode, sourceRoot: TreeNode, path: number[]) {
    let target = targetRoot;
    let source = sourceRoot;
    for (const childIndex of path) {
        const sourceChild = source.children[childIndex];
        if (!sourceChild) return;
        const key = moveKey(sourceChild);
        let targetChild = target.children.find((child) => moveKey(child) === key);
        if (!targetChild) {
            targetChild = {
                ...sourceChild,
                children: [],
                shapes: [...sourceChild.shapes],
                annotations: [...sourceChild.annotations],
            };
            target.children.push(targetChild);
        }
        target = targetChild;
        source = sourceChild;
    }
}

function openingPathForMoves(root: TreeNode, moves: string[]): number[] | null {
    const path: number[] = [];
    let node = root;
    for (const uci of moves) {
        const [position] = positionFromFen(node.fen);
        if (!position) return null;
        const childIndex = node.children.findIndex(
            (child) => child.move && uciNormalize(position.clone(), child.move) === uci,
        );
        if (childIndex < 0) return null;
        path.push(childIndex);
        node = node.children[childIndex];
    }
    return path;
}

function lineKey(moves: string[]): string {
    return moves.join(" ");
}

function commonMovePrefix(left: string[], right: string[]): number {
    let index = 0;
    while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
    return index;
}

const REPERTOIRE_ID_HEADER = "ChessLabRepertoireId";
const VARIANT_ID_HEADER = "ChessLabVariantId";

function appendOpeningMoves(root: TreeNode, moves: string[]) {
    let node = root;
    for (const uci of moves) {
        const [position] = positionFromFen(node.fen);
        const move = parseUci(uci);
        if (!position || !move || !position.isLegal(move)) {
            throw new Error(`La secuencia contiene una jugada ilegal: ${uci}.`);
        }
        const key = makeUci(move);
        let child = node.children.find((candidate) => moveKey(candidate) === key);
        if (!child) {
            const san = makeSan(position, move);
            position.play(move);
            child = createNode({
                fen: makeFen(position.toSetup()),
                move,
                san,
                halfMoves: node.halfMoves + 1,
            });
            node.children.push(child);
        }
        node = child;
    }
}

export async function buildOpeningTrainingPgn(
    state: OpeningsState,
    repertoireId: string,
): Promise<string> {
    const repertoire = state.repertoires[repertoireId];
    if (!repertoire) throw new Error("No se encontró el repertorio.");
    const variants = repertoire.variantIds
        .map((id) => state.variants[id])
        .filter((variant): variant is NonNullable<typeof variant> => Boolean(variant))
        .sort((left, right) => left.trainingRecordIndex - right.trainingRecordIndex);
    const workingRecordCount = unwrap(await commands.countPgnGames(repertoire.path));
    const records =
        workingRecordCount > 0
            ? unwrap(await commands.readGames(repertoire.path, 0, workingRecordCount - 1))
            : [];
    const trainingRecords: string[] = [];

    const parsedRecords = await Promise.all(records.map((raw) => parsePGN(raw)));
    const recordForVariant = (variant: (typeof variants)[number]) =>
        parsedRecords.find((record) => record.headers.other?.[VARIANT_ID_HEADER] === variant.id) ??
        parsedRecords.find(
            (record) =>
                record.headers.other?.ChapterName === variant.name ||
                record.headers.event === variant.name,
        ) ??
        parsedRecords[variant.trainingRecordIndex];

    for (const variant of variants) {
        const selectedLines = variant.lineIds
            .map((id) => state.lines[id])
            .filter((line): line is NonNullable<typeof line> => Boolean(line));
        const firstLineSource = selectedLines
            .map((line) =>
                parsedRecords.find((record) => openingPathForMoves(record.root, line.moves)),
            )
            .find(Boolean);
        const tree = recordForVariant(variant) ?? firstLineSource ?? parsedRecords[0];
        if (!tree) {
            throw new Error(`No se pudo crear el capítulo «${variant.name}».`);
        }
        const root = cloneTreeNode(tree.root, [], 0);
        for (const line of selectedLines) {
            const source = parsedRecords
                .map((record) => ({ record, path: openingPathForMoves(record.root, line.moves) }))
                .find((candidate) => candidate.path !== null);
            if (source?.path) {
                if (source.record.root.fen !== root.fen) {
                    throw new Error(`La línea «${line.name}» parte de una posición incompatible.`);
                }
                mergeOpeningBranch(root, source.record.root, source.path);
            } else {
                appendOpeningMoves(root, line.moves);
            }
        }
        const orientation =
            repertoire.color === "both" ? (tree.headers.orientation ?? "white") : repertoire.color;
        trainingRecords.push(
            getPGN(root, {
                headers: {
                    ...tree.headers,
                    event: variant.name,
                    orientation,
                    other: {
                        ...tree.headers.other,
                        ChapterName: variant.name,
                        [REPERTOIRE_ID_HEADER]: repertoire.id,
                        [VARIANT_ID_HEADER]: variant.id,
                    },
                },
                glyphs: true,
                comments: true,
                variations: true,
                extraMarkups: true,
            }),
        );
    }

    return trainingRecords.join("\n\n\n");
}

export function syncOpeningVariantTree(
    state: OpeningsState,
    workingPath: string,
    recordIndex: number,
    root: TreeNode,
    headers: GameHeaders,
): OpeningsState {
    const repertoire = Object.values(state.repertoires).find(
        (candidate) => candidate.path === workingPath,
    );
    if (!repertoire) return state;

    const taggedVariantId = headers.other?.[VARIANT_ID_HEADER];
    let variant = taggedVariantId ? state.variants[taggedVariantId] : undefined;
    if (variant?.repertoireId !== repertoire.id) variant = undefined;
    variant ??= repertoire.variantIds
        .map((id) => state.variants[id])
        .find((candidate) => candidate?.trainingRecordIndex === recordIndex);

    const variants = { ...state.variants };
    const lines = { ...state.lines };
    const variantIds = [...repertoire.variantIds];
    const variantId = variant?.id ?? areaId("variant");
    const extracted = extractOpeningImportLines(root, "all");
    const existingByMoves = new Map(
        (variant?.lineIds ?? [])
            .map((id) => lines[id])
            .filter((line): line is NonNullable<typeof line> => Boolean(line))
            .map((line) => [lineKey(line.moves), line]),
    );
    const nextLineIds = extracted.map((entry) => {
        const exact = existingByMoves.get(lineKey(entry.moves));
        const existing =
            exact ??
            [...existingByMoves.values()]
                .map((line) => ({ line, prefix: commonMovePrefix(line.moves, entry.moves) }))
                .filter(
                    ({ line, prefix }) =>
                        prefix === Math.min(line.moves.length, entry.moves.length) && prefix > 0,
                )
                .sort((left, right) => right.prefix - left.prefix)[0]?.line;
        if (existing) {
            existingByMoves.delete(lineKey(existing.moves));
            lines[existing.id] = {
                ...existing,
                fen: entry.fen,
                moves: entry.moves,
                path: entry.path,
                plyCount: entry.plyCount,
                sourceRecordIndex: null,
            };
            return existing.id;
        }
        const id = areaId("line");
        lines[id] = {
            id,
            variantId,
            name: entry.name,
            fen: entry.fen,
            moves: entry.moves,
            path: entry.path,
            plyCount: entry.plyCount,
            trainable: variant?.contentType !== "modelGame",
            sourceRecordIndex: null,
            moveProgress: {},
            session: { attempts: 0, completions: 0, flawless: 0, totalTimeMs: 0 },
        };
        return id;
    });
    for (const obsolete of existingByMoves.values()) delete lines[obsolete.id];

    const stats = treeStats(root);
    const name = openingName(headers, recordIndex);
    variants[variantId] = {
        id: variantId,
        repertoireId: repertoire.id,
        name,
        lineIds: nextLineIds,
        sourceRecordIndex: variant?.sourceRecordIndex ?? recordIndex,
        trainingRecordIndex: recordIndex,
        contentType: variant?.contentType ?? "theory",
        commentCount: stats.commentCount,
        hasVariations: stats.hasVariations,
    };
    if (!variant) {
        variantIds.splice(Math.min(recordIndex, variantIds.length), 0, variantId);
    }

    return {
        ...state,
        lines,
        variants,
        repertoires: {
            ...state.repertoires,
            [repertoire.id]: {
                ...repertoire,
                variantIds,
                updatedAt: new Date().toISOString(),
            },
        },
    };
}

function filename(path: string): string {
    return path.split(/[\\/]/).pop() || "Repertorio.pgn";
}

function openingName(headers: GameHeaders, index: number): string {
    const chapter = headers.other?.ChapterName?.trim();
    if (chapter) return chapter;
    if (headers.white && headers.white !== "?" && headers.black && headers.black !== "?") {
        return `${headers.white} — ${headers.black}`;
    }
    if (headers.white && headers.white !== "?") return headers.white;
    if (headers.black && headers.black !== "?") return headers.black;
    if (headers.event && headers.event !== "?") return headers.event;
    return `Variante ${index + 1}`;
}

function isModelGame(headers: GameHeaders): boolean {
    return [
        headers.event,
        headers.white,
        headers.black,
        headers.other?.ChapterName,
        headers.other?.StudyName,
    ].some((value) => /model\s*games?|partidas?\s*modelo/i.test(value ?? ""));
}

function treeStats(root: TreeNode): { commentCount: number; hasVariations: boolean } {
    let commentCount = root.comment.trim() ? 1 : 0;
    let hasVariations = root.children.length > 1;
    for (const child of root.children) {
        const childStats = treeStats(child);
        commentCount += childStats.commentCount;
        hasVariations ||= childStats.hasVariations;
    }
    return { commentCount, hasVariations };
}

export function extractOpeningImportLines(
    root: TreeNode,
    policy: OpeningImportConfig["subvariationPolicy"],
): OpeningImportLine[] {
    const lines: OpeningImportLine[] = [];

    function visit(node: TreeNode, path: number[], moves: string[], sans: string[]) {
        const children = policy === "all" ? node.children : node.children.slice(0, 1);
        if (children.length === 0) {
            if (moves.length > 0) {
                lines.push({
                    name: sans.slice(-4).join(" ") || `Línea ${lines.length + 1}`,
                    fen: root.fen,
                    moves,
                    path,
                    plyCount: moves.length,
                    trainable: true,
                });
            }
            return;
        }

        const [position] = positionFromFen(node.fen);
        if (!position) return;
        children.forEach((child, index) => {
            if (!child.move) return;
            visit(
                child,
                [...path, index],
                [...moves, uciNormalize(position.clone(), child.move)],
                [...sans, child.san ?? ""],
            );
        });
    }

    visit(root, [], [], []);
    return lines;
}

async function parseOpeningRecord(
    raw: string,
    sourceRecordIndex: number,
    trainingRecordIndex: number,
    config: OpeningImportConfig,
) {
    const tree = await parsePGN(raw);
    const stats = treeStats(tree.root);
    const contentType = isModelGame(tree.headers) ? "modelGame" : "theory";
    const selectedLineKeys = new Set(
        extractOpeningImportLines(tree.root, config.subvariationPolicy).map((line) =>
            lineKey(line.moves),
        ),
    );
    const lines = extractOpeningImportLines(tree.root, "all").map((line) => ({
        ...line,
        trainable: contentType === "theory" && selectedLineKeys.has(lineKey(line.moves)),
    }));
    const orientation =
        config.color === "both" ? (tree.headers.orientation ?? "white") : config.color;
    const trainingPgn = getPGN(tree.root, {
        headers: { ...tree.headers, orientation },
        glyphs: true,
        comments: true,
        variations: true,
        extraMarkups: true,
    });

    return {
        trainingPgn,
        variant: {
            name: openingName(tree.headers, sourceRecordIndex),
            sourceRecordIndex,
            trainingRecordIndex,
            contentType,
            commentCount: stats.commentCount,
            hasVariations: stats.hasVariations,
            lines,
        } satisfies OpeningImportVariant,
    };
}

export async function inspectOpeningPgn(
    path: string,
    config: OpeningImportConfig,
    sampleSize = 12,
): Promise<OpeningPgnInspection> {
    const recordCount = unwrap(await commands.countPgnGames(path));
    const end = Math.min(recordCount, sampleSize) - 1;
    const records = end >= 0 ? unwrap(await commands.readGames(path, 0, end)) : [];
    const samples: OpeningPgnSample[] = [];

    for (const [index, raw] of records.entries()) {
        try {
            const parsed = await parseOpeningRecord(raw, index, index, config);
            samples.push({
                index,
                name: parsed.variant.name,
                lineCount: parsed.variant.lines.length,
                commentCount: parsed.variant.commentCount,
                hasVariations: parsed.variant.hasVariations,
                contentType: parsed.variant.contentType,
            });
        } catch (error) {
            samples.push({
                index,
                name: `Registro ${index + 1}`,
                lineCount: 0,
                commentCount: 0,
                hasVariations: false,
                contentType: "theory",
                error: error instanceof Error ? error.message : "Registro inválido",
            });
        }
    }

    return { path, filename: filename(path), recordCount, samples };
}

export async function prepareOpeningImport(
    inspection: OpeningPgnInspection,
    config: OpeningImportConfig,
): Promise<PreparedOpeningImport> {
    const records =
        inspection.recordCount > 0
            ? unwrap(await commands.readGames(inspection.path, 0, inspection.recordCount - 1))
            : [];
    const variants: OpeningImportVariant[] = [];
    const trainingRecords: string[] = [];
    let skippedRecords = 0;

    for (const [sourceRecordIndex, raw] of records.entries()) {
        try {
            const parsed = await parseOpeningRecord(
                raw,
                sourceRecordIndex,
                trainingRecords.length,
                config,
            );
            variants.push(parsed.variant);
            trainingRecords.push(parsed.trainingPgn);
        } catch {
            skippedRecords += 1;
        }
    }

    return {
        trainingPgn: trainingRecords.join("\n\n\n"),
        variants,
        skippedRecords,
    };
}
