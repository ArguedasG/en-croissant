import type { GameManifest } from "@/bindings";
import { getPGN } from "./chess";
import { serializeGameManifest } from "./gameManifest";
import type { GameHeaders, TreeNode } from "./treeReducer";

function cloneLineToPath(node: TreeNode, path: number[]): TreeNode {
    const clone: TreeNode = {
        ...node,
        children: [],
        shapes: [...node.shapes],
        annotations: [...node.annotations],
    };
    if (path.length === 0) return clone;

    const child = node.children[path[0]];
    if (child) {
        clone.children = [cloneLineToPath(child, path.slice(1))];
    }
    return clone;
}

export function buildModelGameSourcePgn(
    root: TreeNode,
    headers: GameHeaders,
    position: number[],
): string {
    return getPGN(cloneLineToPath(root, position), {
        headers: { ...headers, result: "*" },
        glyphs: false,
        comments: false,
        variations: false,
        extraMarkups: false,
    });
}

export function getModelGameArtifactPaths(selectedPath: string): {
    pgnPath: string;
    manifestPath: string;
} {
    const pgnPath = selectedPath.toLowerCase().endsWith(".pgn")
        ? selectedPath
        : `${selectedPath}.pgn`;
    return {
        pgnPath,
        manifestPath: pgnPath.replace(/\.pgn$/i, ".manifest.json"),
    };
}

export function serializeModelGameArtifacts(
    pgn: string,
    manifest: GameManifest,
): { pgn: string; manifest: string } {
    return {
        pgn: `${pgn.trim()}\n`,
        manifest: serializeGameManifest(manifest),
    };
}
