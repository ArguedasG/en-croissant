import { makeUci } from "chessops";
import i18n from "i18next";
import { getPGN } from "./chess";
import {
    extractOpeningImportLines,
    filterOpeningTree,
    syncOpeningVariantTree,
} from "./openingTraining";
import { addBlankOpeningVariant, updateOpeningVariant, type OpeningsState } from "./trainingAreas";
import type { TreeNode, TreeState } from "./treeReducer";

export type AdditionMode = "theory" | "modelGame";
export type AdditionSource = { label: string; recordIndexes: number[] };

export function selectRepertoireTree(
    root: TreeNode,
    position: number[],
    scope: "line" | "subtree" | "game",
): TreeNode {
    if (scope === "game") return structuredClone(root);
    if (scope === "line") return filterOpeningTree(root, [position]);
    const paths = extractOpeningImportLines(root, "all")
        .map((line) => line.path)
        .filter((path) => position.every((index, depth) => path[depth] === index));
    return filterOpeningTree(root, paths.length ? paths : [position]);
}

// Keep both authors' annotations; an identical move is one node, not a duplicate line.
export function mergeRepertoireTree(target: TreeNode, source: TreeNode): TreeNode {
    if (target.fen !== source.fen)
        throw new Error(
            i18n.t(
                "Repertoire.FenConflict",
                "The starting positions are incompatible. No changes were saved.",
            ),
        );
    function merge(left: TreeNode, right: TreeNode): TreeNode {
        const node = structuredClone(left);
        if (right.comment.trim() && !node.comment.includes(right.comment.trim())) {
            node.comment = [node.comment.trim(), right.comment.trim()].filter(Boolean).join("\n\n");
        }
        node.annotations = [...new Set([...node.annotations, ...right.annotations])];
        for (const shape of right.shapes) {
            if (!node.shapes.some((existing) => JSON.stringify(existing) === JSON.stringify(shape)))
                node.shapes.push(structuredClone(shape));
        }
        for (const child of right.children) {
            const index = node.children.findIndex(
                (candidate) =>
                    candidate.move && child.move && makeUci(candidate.move) === makeUci(child.move),
            );
            if (index < 0) node.children.push(structuredClone(child));
            else node.children[index] = merge(node.children[index], child);
        }
        return node;
    }
    return merge(target, source);
}

export function serializeRepertoireRecords(records: TreeState[]): string {
    return (
        records
            .map((record) =>
                getPGN(record.root, {
                    headers: record.headers,
                    comments: true,
                    glyphs: true,
                    variations: true,
                    extraMarkups: true,
                }),
            )
            .join("\n\n\n") + "\n"
    );
}

export function prepareRepertoireAddition({
    state,
    repertoireId,
    variantId,
    records,
    incoming,
    mode,
    source,
    name,
}: {
    state: OpeningsState;
    repertoireId: string;
    variantId?: string;
    records: TreeState[];
    incoming: TreeState[];
    mode: AdditionMode;
    source: AdditionSource;
    name?: string;
}) {
    const repertoire = state.repertoires[repertoireId];
    if (!repertoire || incoming.length === 0)
        throw new Error(i18n.t("Repertoire.EmptyImport", "Select at least one valid PGN record."));
    const nextRecords = structuredClone(records);
    let next = state;
    let addedLines = 0;
    let addedGames = 0;
    let duplicateLines = 0;
    const target = variantId ? state.variants[variantId] : undefined;
    if (
        mode === "theory" &&
        (!target || target.repertoireId !== repertoireId || target.contentType !== "theory")
    ) {
        throw new Error(i18n.t("Repertoire.SelectVariant", "Select a theory variant."));
    }
    for (const [index, entry] of incoming.entries()) {
        const importedLines = extractOpeningImportLines(entry.root, "all");
        if (!importedLines.length)
            throw new Error(
                i18n.t(
                    "Repertoire.NoMoves",
                    "A selected record has no moves. Select a line or a game with moves.",
                ),
            );
        let variant = target;
        if (mode === "modelGame") {
            const signature = importedLines
                .map((line) => line.moves.join(" "))
                .sort()
                .join("|");
            variant = next.repertoires[repertoireId].variantIds
                .map((id) => next.variants[id])
                .find((candidate) => {
                    if (candidate?.contentType !== "modelGame") return false;
                    const record = nextRecords[candidate.trainingRecordIndex];
                    return (
                        record?.root.fen === entry.root.fen &&
                        extractOpeningImportLines(record.root, "all")
                            .map((line) => line.moves.join(" "))
                            .sort()
                            .join("|") === signature
                    );
                });
            if (!variant) {
                const base =
                    name?.trim() ||
                    entry.headers.other?.ChapterName ||
                    `${entry.headers.white} — ${entry.headers.black}`;
                const names = new Set(
                    Object.values(next.variants)
                        .filter((item) => item.repertoireId === repertoireId)
                        .map((item) => item.name),
                );
                let title = base;
                let suffix = 2;
                while (names.has(title)) title = `${base} (${suffix++})`;
                next = addBlankOpeningVariant(next, repertoireId, title);
                const id = next.repertoires[repertoireId].variantIds.at(-1)!;
                next = updateOpeningVariant(next, id, { name: title, contentType: "modelGame" });
                variant = next.variants[id];
                nextRecords.push(structuredClone(entry));
                addedGames += 1;
            }
        }
        if (!variant) throw new Error("Missing variant");
        const record = nextRecords[variant.trainingRecordIndex];
        if (!record)
            throw new Error(
                i18n.t(
                    "Repertoire.Changed",
                    "The repertoire has changed. Close this preview and try again.",
                ),
            );
        const existing = new Set(
            extractOpeningImportLines(record.root, "all").map((line) => line.moves.join(" ")),
        );
        const merged = mergeRepertoireTree(record.root, entry.root);
        const updated = {
            ...record,
            root: merged,
            headers: {
                ...record.headers,
                start: [],
                orientation:
                    repertoire.color === "both" ? record.headers.orientation : repertoire.color,
                other: {
                    ...record.headers.other,
                    ChapterName: variant.name,
                    ChessLabRepertoireId: repertoireId,
                    ChessLabVariantId: variant.id,
                    ChessLabContentType: mode,
                    ChessLabLastImport: `${source.label} #${(source.recordIndexes[index] ?? index) + 1}`,
                },
            },
        };
        if (mode === "theory") {
            duplicateLines += importedLines.filter((line) =>
                existing.has(line.moves.join(" ")),
            ).length;
            addedLines += extractOpeningImportLines(merged, "all").filter(
                (line) => !existing.has(line.moves.join(" ")),
            ).length;
        }
        nextRecords[variant.trainingRecordIndex] = updated;
        next = syncOpeningVariantTree(
            next,
            repertoire.path,
            variant.trainingRecordIndex,
            updated.root,
            updated.headers,
        );
    }
    next = {
        ...next,
        repertoires: {
            ...next.repertoires,
            [repertoireId]: {
                ...next.repertoires[repertoireId],
                imports: [
                    ...(repertoire.imports ?? []),
                    {
                        at: new Date().toISOString(),
                        source: source.label,
                        recordIndexes: source.recordIndexes,
                        mode,
                        addedLines,
                        addedGames,
                    },
                ],
            },
        },
    };
    return {
        state: next,
        records: nextRecords,
        pgn: serializeRepertoireRecords(nextRecords),
        addedLines,
        addedGames,
        duplicateLines,
    };
}

// User-facing record numbers are one-based; storage/backend indexes are zero-based.
export function parseRecordSelection(value: string, count: number): number[] {
    if (!value.trim()) return Array.from({ length: count }, (_, index) => index);
    const indexes = new Set<number>();
    for (const part of value.split(",")) {
        const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
        const start = Number(match?.[1]);
        const end = Number(match?.[2] ?? start);
        if (!match || start < 1 || end < start || end > count)
            throw new Error(
                i18n.t("Repertoire.InvalidRange", "Use valid record numbers, for example 1, 3-5."),
            );
        for (let number = start; number <= end; number++) indexes.add(number - 1);
    }
    return [...indexes].sort((a, b) => a - b);
}
