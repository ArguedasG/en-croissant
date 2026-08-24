import { commands } from "@/bindings";
import { parsePGN, uciNormalize } from "@/utils/chess";
import { positionFromFen } from "@/utils/chessops";
import type {
    TacticsExercise,
    TacticsSet,
    TacticsStartingActor,
    TacticsVariationPolicy,
} from "@/utils/trainingAreas";
import type { TreeNode } from "@/utils/treeReducer";
import { unwrap } from "@/utils/unwrap";

export type TacticsLoadedExercise = {
    id: string;
    recordIndex: number;
    title: string;
    fen: string;
    solutionLines: string[][];
    hasVariations: boolean;
    sourcePgn: string;
};

export type TacticsPgnSample = {
    index: number;
    title: string;
    moveCount: number;
    hasVariations: boolean;
    hasSolution: boolean;
    error?: string;
};

export type TacticsPgnInspection = {
    path: string;
    filename: string;
    recordCount: number;
    samples: TacticsPgnSample[];
};

function filename(path: string): string {
    return path.split(/[\\/]/).pop() || "Set de táctica.pgn";
}

function treeHasVariations(node: TreeNode): boolean {
    return node.children.length > 1 || node.children.some(treeHasVariations);
}

function isStudentTurn(ply: number, startingActor: TacticsStartingActor): boolean {
    return startingActor === "student" ? ply % 2 === 0 : ply % 2 === 1;
}

export function extractTacticsSolutionLines(
    root: TreeNode,
    variationPolicy: TacticsVariationPolicy,
    startingActor: TacticsStartingActor,
): string[][] {
    const lines: string[][] = [];

    function visit(node: TreeNode, prefix: string[]) {
        if (node.children.length === 0) {
            if (prefix.length > 0) lines.push(prefix);
            return;
        }

        const studentTurn = isStudentTurn(prefix.length, startingActor);
        const children =
            variationPolicy === "all" || (variationPolicy === "opponentResponses" && !studentTurn)
                ? node.children
                : node.children.slice(0, 1);

        const [position] = positionFromFen(node.fen);
        if (!position) return;

        for (const child of children) {
            if (!child.move) continue;
            visit(child, [...prefix, uciNormalize(position.clone(), child.move)]);
        }
    }

    visit(root, []);
    return lines;
}

export async function parseTacticsPgnRecord(
    raw: string,
    recordIndex: number,
    config: Pick<TacticsSet["config"], "startingActor" | "variationPolicy">,
): Promise<TacticsLoadedExercise> {
    const tree = await parsePGN(raw);
    const [position] = positionFromFen(tree.headers.fen);
    if (!position) {
        throw new Error("La posición FEN del registro no es válida.");
    }

    return {
        id: `record-${recordIndex}`,
        recordIndex,
        title: tree.headers.event || `${tree.headers.white} - ${tree.headers.black}`,
        fen: tree.headers.fen,
        solutionLines: extractTacticsSolutionLines(
            tree.root,
            config.variationPolicy,
            config.startingActor,
        ),
        hasVariations: treeHasVariations(tree.root),
        sourcePgn: raw,
    };
}

export async function inspectTacticsPgn(
    path: string,
    config: Pick<TacticsSet["config"], "startingActor" | "variationPolicy">,
    sampleSize = 12,
): Promise<TacticsPgnInspection> {
    const recordCount = unwrap(await commands.countPgnGames(path));
    const end = Math.min(recordCount, sampleSize) - 1;
    const records = end >= 0 ? unwrap(await commands.readGames(path, 0, end)) : [];
    const samples = await Promise.all(
        records.map(async (raw, index): Promise<TacticsPgnSample> => {
            try {
                const parsed = await parseTacticsPgnRecord(raw, index, config);
                return {
                    index,
                    title: parsed.title,
                    moveCount: parsed.solutionLines[0]?.length ?? 0,
                    hasVariations: parsed.hasVariations,
                    hasSolution: parsed.solutionLines.length > 0,
                };
            } catch (error) {
                return {
                    index,
                    title: `Registro ${index + 1}`,
                    moveCount: 0,
                    hasVariations: false,
                    hasSolution: false,
                    error: error instanceof Error ? error.message : "Registro inválido",
                };
            }
        }),
    );

    return { path, filename: filename(path), recordCount, samples };
}

export async function loadTacticsFileExercise(
    set: Pick<TacticsSet, "source" | "config">,
    recordIndex: number,
): Promise<TacticsLoadedExercise> {
    if (set.source?.kind !== "pgnFile") {
        throw new Error("El set no está conectado a un archivo PGN.");
    }
    const records = unwrap(await commands.readGames(set.source.path, recordIndex, recordIndex));
    if (!records[0]) {
        throw new Error(`No se pudo leer el ejercicio ${recordIndex + 1}.`);
    }
    return parseTacticsPgnRecord(records[0], recordIndex, set.config);
}

export function loadEmbeddedTacticsExercise(
    exercise: TacticsExercise,
    recordIndex: number,
): TacticsLoadedExercise {
    return {
        id: exercise.id,
        recordIndex,
        title: exercise.title,
        fen: exercise.fen,
        solutionLines: exercise.solutionMoves.length > 0 ? [exercise.solutionMoves] : [],
        hasVariations: false,
        sourcePgn: exercise.source.pgn ?? "",
    };
}

export async function loadTacticsExercise(
    set: Pick<TacticsSet, "source" | "exerciseIds" | "config">,
    exercises: Record<string, TacticsExercise>,
    recordIndex: number,
): Promise<TacticsLoadedExercise> {
    if (set.source?.kind === "pgnFile") return loadTacticsFileExercise(set, recordIndex);
    const exerciseId = set.exerciseIds[recordIndex];
    const exercise = exercises[exerciseId];
    if (!exercise) throw new Error(`No se pudo leer el ejercicio ${recordIndex + 1}.`);
    return loadEmbeddedTacticsExercise(exercise, recordIndex);
}
