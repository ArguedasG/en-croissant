import { describe, expect, it, vi } from "vitest";
import { createTreeStore } from "@/state/store/tree";
import { addOpeningRepertoire, createEmptyTrainingAreas } from "./trainingAreas";
import { extractOpeningImportLines, isModelGame } from "./openingTraining";
import {
    mergeRepertoireTree,
    parseRecordSelection,
    prepareRepertoireAddition,
    selectRepertoireTree,
} from "./repertoireAddition";

vi.mock("i18next", () => ({ default: { t: (_key: string, fallback: string) => fallback } }));

function tree(moves: string[]) {
    const store = createTreeStore();
    store.getState().makeMoves({ payload: moves });
    const { root, headers, position, dirty, report } = store.getState();
    return structuredClone({ root, headers, position, dirty, report });
}
function fixture() {
    const record = tree(["e4", "e5"]);
    const state = addOpeningRepertoire(createEmptyTrainingAreas().openings, {
        name: "Test",
        color: "white",
        description: "",
        path: "editable.pgn",
        sourcePath: "source.pgn",
        recordCount: 1,
        subvariationPolicy: "mainline",
        variants: [
            {
                name: "Theory",
                sourceRecordIndex: 0,
                trainingRecordIndex: 0,
                contentType: "theory",
                commentCount: 0,
                hasVariations: false,
                lines: extractOpeningImportLines(record.root, "all"),
            },
        ],
    });
    const repertoireId = Object.keys(state.repertoires)[0];
    const variantId = state.repertoires[repertoireId].variantIds[0];
    return {
        state,
        repertoireId,
        variantId,
        records: [record],
        mode: "theory" as const,
        source: { label: "test.pgn", recordIndexes: [0] },
    };
}

describe("repertoire additions", () => {
    it("honours explicit content classification when a model game is exported or reclassified", () => {
        const headers = tree(["e4"]).headers;
        expect(
            isModelGame({
                ...headers,
                event: "Reference",
                other: { ChessLabContentType: "modelGame" },
            }),
        ).toBe(true);
        expect(
            isModelGame({
                ...headers,
                event: "Model game",
                other: { ChessLabContentType: "theory" },
            }),
        ).toBe(false);
        expect(isModelGame({ ...headers, event: "Partida modelo" })).toBe(true);
    });
    it("merges new branches, preserves existing annotations and progress, and does not mutate the source", () => {
        const args = fixture();
        args.records[0].root.children[0].comment = "Existing note";
        const line = Object.values(args.state.lines)[0];
        line.session.attempts = 8;
        line.trainable = false;
        const incoming = tree(["e4", "c5"]);
        incoming.root.children[0].comment = "Imported note";
        const before = JSON.stringify(args);
        const result = prepareRepertoireAddition({ ...args, incoming: [incoming] });
        expect(result.addedLines).toBe(1);
        expect(result.state.lines[line.id].session.attempts).toBe(8);
        expect(result.state.lines[line.id].trainable).toBe(false);
        expect(result.records[0].root.children[0].comment).toBe("Existing note\n\nImported note");
        expect(result.state.repertoires[args.repertoireId].sourcePath).toBe("source.pgn");
        expect(result.state.repertoires[args.repertoireId].subvariationPolicy).toBe("mainline");
        expect(result.state.repertoires[args.repertoireId].imports).toHaveLength(1);
        expect(JSON.stringify(args)).toBe(before);
    });
    it("does not duplicate identical lines and rejects incompatible FEN before changing state", () => {
        const args = fixture();
        const result = prepareRepertoireAddition({ ...args, incoming: [tree(["e4", "e5"])] });
        expect(result.addedLines).toBe(0);
        expect(result.duplicateLines).toBe(1);
        const other = tree(["e4"]);
        other.root.fen = other.root.children[0].fen;
        expect(() => prepareRepertoireAddition({ ...args, incoming: [other] })).toThrow(
            "The starting positions are incompatible",
        );
        expect(args.state.repertoires[args.repertoireId].imports).toBeUndefined();
    });
    it("stores model games as separate non-trainable records and deduplicates within a batch", () => {
        const args = fixture();
        const incoming = tree(["d4", "d5", "c4"]);
        const result = prepareRepertoireAddition({
            ...args,
            mode: "modelGame",
            incoming: [incoming, incoming],
            name: "Example",
        });
        expect(result.addedGames).toBe(1);
        expect(result.records).toHaveLength(2);
        const model = Object.values(result.state.variants).find(
            (variant) => variant.contentType === "modelGame",
        )!;
        expect(model.name).toBe("Example");
        expect(model.lineIds.every((id) => !result.state.lines[id].trainable)).toBe(true);
        expect(result.records[0]).toEqual(args.records[0]);
    });
    it("keeps different move orders separate even when they transpose", () => {
        const a = tree(["Nf3", "Nf6", "d4", "d5"]);
        const b = tree(["d4", "d5", "Nf3", "Nf6"]);
        expect(extractOpeningImportLines(mergeRepertoireTree(a.root, b.root), "all")).toHaveLength(
            2,
        );
    });
    it("captures a line or its continuations without unrelated branches", () => {
        const a = tree(["e4", "e5", "Nf3"]);
        a.root = mergeRepertoireTree(a.root, tree(["d4", "d5"]).root);
        expect(
            extractOpeningImportLines(selectRepertoireTree(a.root, [0], "line"), "all")[0].moves,
        ).toEqual(["e2e4"]);
        expect(
            extractOpeningImportLines(selectRepertoireTree(a.root, [0], "subtree"), "all"),
        ).toHaveLength(1);
        expect(selectRepertoireTree(a.root, [], "game")).toEqual(a.root);
    });
    it("validates ranges and removes duplicate record selections", () => {
        expect(parseRecordSelection("1, 3-5, 3", 5)).toEqual([0, 2, 3, 4]);
        expect(parseRecordSelection("", 2)).toEqual([0, 1]);
        for (const value of ["0", "6", "3-1", "bad", "1,"])
            expect(() => parseRecordSelection(value, 5)).toThrow("Use valid record numbers");
    });
});
