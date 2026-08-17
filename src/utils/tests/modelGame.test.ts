import { parseUci } from "chessops";
import { describe, expect, it } from "vitest";
import { buildModelGameSourcePgn, getModelGameArtifactPaths } from "../modelGame";
import { createNode, defaultTree } from "../treeReducer";

describe("model game generator utilities", () => {
    it("copies only the PGN history leading to the selected node", () => {
        const state = defaultTree();
        state.headers.event = "Source";
        const e4 = createNode({
            fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
            move: parseUci("e2e4")!,
            san: "e4",
            halfMoves: 1,
        });
        const e5 = createNode({
            fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
            move: parseUci("e7e5")!,
            san: "e5",
            halfMoves: 2,
        });
        const nf3 = createNode({
            fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
            move: parseUci("g1f3")!,
            san: "Nf3",
            halfMoves: 3,
        });
        e5.children = [nf3];
        e4.children = [e5];
        state.root.children = [e4];

        const source = buildModelGameSourcePgn(state.root, state.headers, [0, 0]);

        expect(source).toContain("1. e4 e5");
        expect(source).not.toContain("Nf3");
        expect(source).toContain('[Result "*"]');
    });

    it("keeps an isolated FEN when the root node is selected", () => {
        const state = defaultTree("8/8/8/8/8/4k3/8/4K3 w - - 0 1");

        const source = buildModelGameSourcePgn(state.root, state.headers, []);

        expect(source).toContain('[SetUp "1"]');
        expect(source).toContain('[FEN "8/8/8/8/8/4k3/8/4K3 w - - 0 1"]');
    });

    it("derives paired PGN and manifest paths from one selection", () => {
        expect(getModelGameArtifactPaths("C:\\games\\sample")).toEqual({
            pgnPath: "C:\\games\\sample.pgn",
            manifestPath: "C:\\games\\sample.manifest.json",
        });
        expect(getModelGameArtifactPaths("C:\\games\\sample.PGN")).toEqual({
            pgnPath: "C:\\games\\sample.PGN",
            manifestPath: "C:\\games\\sample.manifest.json",
        });
    });
});
