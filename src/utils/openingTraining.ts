import { commands, type BestMoves, type ScoreValue } from "@/bindings";
import { getPGN, parsePGN, uciNormalize } from "@/utils/chess";
import { positionFromFen } from "@/utils/chessops";
import type { OpeningRepertoire, OpeningsState } from "@/utils/trainingAreas";
import type { GameHeaders, TreeNode } from "@/utils/treeReducer";
import { unwrap } from "@/utils/unwrap";

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

export async function buildOpeningTrainingPgn(
    state: OpeningsState,
    repertoireId: string,
): Promise<string> {
    const repertoire = state.repertoires[repertoireId];
    if (!repertoire) throw new Error("No se encontró el repertorio.");
    if (repertoire.sourcePath === repertoire.path) {
        throw new Error("Los repertorios creados en el tablero ya usan su PGN como fuente.");
    }

    const variants = repertoire.variantIds
        .map((id) => state.variants[id])
        .filter((variant): variant is NonNullable<typeof variant> => Boolean(variant))
        .sort((left, right) => left.trainingRecordIndex - right.trainingRecordIndex);
    const records =
        repertoire.recordCount > 0
            ? unwrap(await commands.readGames(repertoire.sourcePath, 0, repertoire.recordCount - 1))
            : [];
    const trainingRecords: string[] = [];

    for (const variant of variants) {
        const raw = records[variant.sourceRecordIndex];
        if (!raw) throw new Error(`No se encontró el capítulo «${variant.name}» en el PGN fuente.`);
        const tree = await parsePGN(raw);
        const selectedPaths = variant.lineIds
            .map((id) => state.lines[id])
            .filter((line): line is NonNullable<typeof line> => Boolean(line?.trainable))
            .map((line) => line.path);
        const root =
            variant.contentType === "theory"
                ? filterOpeningTree(tree.root, selectedPaths)
                : filterOpeningTree(tree.root, []);
        const orientation =
            repertoire.color === "both" ? (tree.headers.orientation ?? "white") : repertoire.color;
        trainingRecords.push(
            getPGN(root, {
                headers: {
                    ...tree.headers,
                    event: variant.name,
                    orientation,
                    other: { ...tree.headers.other, ChapterName: variant.name },
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
    const lines = extractOpeningImportLines(tree.root, config.subvariationPolicy).map((line) => ({
        ...line,
        trainable: contentType === "theory",
    }));
    const orientation =
        config.color === "both" ? (tree.headers.orientation ?? "white") : config.color;
    const trainingPgn = getPGN(tree.root, {
        headers: { ...tree.headers, orientation },
        glyphs: true,
        comments: true,
        variations: config.subvariationPolicy === "all",
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
