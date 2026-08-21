import { getGameName, treeIteratorMainLine } from "@/utils/treeReducer";
import { parsePGN } from "./chess";
import { positionFromFen } from "./chessops";
import { createTrainingItem, type TrainingItem, type TrainingKind } from "./training";

export type TrainingImport = {
    item: TrainingItem;
    sourceDescription: string;
};

export async function parseTrainingInput({
    input,
    kind,
    title,
    tags,
    notes,
}: {
    input: string;
    kind: TrainingKind;
    title: string;
    tags: string[];
    notes: string;
}): Promise<TrainingImport> {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new Error("Escribe una posición FEN o una partida PGN.");
    }

    const [position] = positionFromFen(trimmed);
    if (position) {
        return {
            item: createTrainingItem({
                kind,
                title: title.trim() || "Posición sin título",
                fen: trimmed,
                sideToMove: position.turn,
                objective: "custom",
                solutionMoves: [],
                tags,
                notes,
                source: { kind: "fen", label: title.trim() || undefined },
            }),
            sourceDescription: "FEN",
        };
    }

    const tree = await parsePGN(trimmed);
    const mainline = Array.from(treeIteratorMainLine(tree.root)).slice(1);
    if (mainline.length === 0) {
        throw new Error("El PGN no contiene jugadas que puedan entrenarse.");
    }

    return {
        item: createTrainingItem({
            kind,
            title: title.trim() || getGameName(tree.headers),
            fen: tree.root.fen,
            sideToMove: tree.root.halfMoves % 2 === 0 ? "white" : "black",
            objective: kind === "opening" ? "replayLine" : "findBestMove",
            solutionMoves: mainline
                .map(({ node }) => node.san)
                .filter((san): san is string => san !== null),
            tags,
            notes,
            source: { kind: "pgn", label: title.trim() || getGameName(tree.headers), pgn: trimmed },
        }),
        sourceDescription: `PGN · ${mainline.length} jugadas`,
    };
}
