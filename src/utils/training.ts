import { z } from "zod";

export const TRAINING_SCHEMA_VERSION = 1;
export const DEFAULT_TRAINING_COLLECTION_ID = "default-training-collection";

export const trainingKindSchema = z.enum(["puzzle", "opening", "endgame"]);
export type TrainingKind = z.infer<typeof trainingKindSchema>;

export const trainingCollectionKindSchema = z.enum(["mixed", "puzzle", "opening", "endgame"]);
export type TrainingCollectionKind = z.infer<typeof trainingCollectionKindSchema>;

export const trainingObjectiveSchema = z.enum([
    "findBestMove",
    "replayLine",
    "win",
    "draw",
    "hold",
    "custom",
]);
export type TrainingObjective = z.infer<typeof trainingObjectiveSchema>;

export const trainingSourceSchema = z.object({
    kind: z.enum(["fen", "pgn"]),
    label: z.string().optional(),
    pgn: z.string().optional(),
});

export const trainingItemSchema = z.object({
    id: z.string(),
    kind: trainingKindSchema,
    title: z.string(),
    fen: z.string(),
    sideToMove: z.enum(["white", "black"]),
    objective: trainingObjectiveSchema,
    solutionMoves: z.array(z.string()),
    tags: z.array(z.string()),
    notes: z.string(),
    source: trainingSourceSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type TrainingItem = z.infer<typeof trainingItemSchema>;

export const trainingCollectionSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    kind: trainingCollectionKindSchema,
    itemIds: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type TrainingCollection = z.infer<typeof trainingCollectionSchema>;

export const trainingAttemptSchema = z.object({
    id: z.string(),
    itemId: z.string(),
    sessionId: z.string().nullable(),
    outcome: z.enum(["correct", "incorrect", "skipped", "incomplete"]),
    grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
    startedAt: z.string(),
    finishedAt: z.string(),
    timeMs: z.number().nonnegative(),
});
export type TrainingAttempt = z.infer<typeof trainingAttemptSchema>;

export const trainingSessionSchema = z.object({
    id: z.string(),
    collectionId: z.string(),
    mode: z.enum(["due", "all"]),
    itemIds: z.array(z.string()),
    attemptIds: z.array(z.string()),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
});
export type TrainingSession = z.infer<typeof trainingSessionSchema>;

export const trainingLibrarySchema = z.object({
    schemaVersion: z.literal(TRAINING_SCHEMA_VERSION),
    items: z.record(trainingItemSchema),
    collections: z.record(trainingCollectionSchema),
    attempts: z.array(trainingAttemptSchema),
    sessions: z.array(trainingSessionSchema),
});
export type TrainingLibrary = z.infer<typeof trainingLibrarySchema>;

export type TrainingAttemptOutcome = TrainingAttempt["outcome"];

export type TrainingCollectionStats = {
    total: number;
    practiced: number;
    correct: number;
    incorrect: number;
    skipped: number;
};

function now(): string {
    return new Date().toISOString();
}

export function trainingId(prefix: string): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createEmptyTrainingLibrary(): TrainingLibrary {
    const timestamp = now();
    return {
        schemaVersion: TRAINING_SCHEMA_VERSION,
        items: {},
        collections: {
            [DEFAULT_TRAINING_COLLECTION_ID]: {
                id: DEFAULT_TRAINING_COLLECTION_ID,
                name: "Mis posiciones",
                description: "Colección inicial para empezar a organizar tu entrenamiento.",
                kind: "mixed",
                itemIds: [],
                createdAt: timestamp,
                updatedAt: timestamp,
            },
        },
        attempts: [],
        sessions: [],
    };
}

export function addTrainingCollection(
    library: TrainingLibrary,
    collection: Pick<TrainingCollection, "id" | "name" | "description" | "kind">,
): TrainingLibrary {
    const timestamp = now();
    return {
        ...library,
        collections: {
            ...library.collections,
            [collection.id]: {
                ...collection,
                itemIds: [],
                createdAt: timestamp,
                updatedAt: timestamp,
            },
        },
    };
}

export function addTrainingItem(
    library: TrainingLibrary,
    item: TrainingItem,
    collectionId: string,
): TrainingLibrary {
    const collection = library.collections[collectionId];
    if (!collection) return library;

    return {
        ...library,
        items: {
            ...library.items,
            [item.id]: item,
        },
        collections: {
            ...library.collections,
            [collectionId]: {
                ...collection,
                itemIds: collection.itemIds.includes(item.id)
                    ? collection.itemIds
                    : [...collection.itemIds, item.id],
                updatedAt: now(),
            },
        },
    };
}

export function removeTrainingItem(library: TrainingLibrary, itemId: string): TrainingLibrary {
    const { [itemId]: _removed, ...items } = library.items;
    return {
        ...library,
        items,
        collections: Object.fromEntries(
            Object.entries(library.collections).map(([id, collection]) => [
                id,
                {
                    ...collection,
                    itemIds: collection.itemIds.filter((candidate) => candidate !== itemId),
                    updatedAt: collection.itemIds.includes(itemId) ? now() : collection.updatedAt,
                },
            ]),
        ),
        attempts: library.attempts.filter((attempt) => attempt.itemId !== itemId),
    };
}

export function createTrainingSession(
    library: TrainingLibrary,
    collectionId: string,
    mode: TrainingSession["mode"],
): { library: TrainingLibrary; session: TrainingSession } | null {
    const collection = library.collections[collectionId];
    if (!collection) return null;

    const itemIds = collection.itemIds.filter((itemId) => library.items[itemId]);
    if (itemIds.length === 0) return null;

    const session: TrainingSession = {
        id: trainingId("session"),
        collectionId,
        mode,
        itemIds,
        attemptIds: [],
        startedAt: now(),
        finishedAt: null,
    };

    return {
        library: {
            ...library,
            sessions: [...library.sessions, session],
        },
        session,
    };
}

export function recordTrainingAttempt(
    library: TrainingLibrary,
    attempt: Omit<TrainingAttempt, "id"> & { id?: string },
): TrainingLibrary {
    const nextAttempt: TrainingAttempt = {
        ...attempt,
        id: attempt.id ?? trainingId("attempt"),
    };
    const session = nextAttempt.sessionId
        ? library.sessions.find((s) => s.id === nextAttempt.sessionId)
        : null;

    return {
        ...library,
        attempts: [...library.attempts, nextAttempt],
        sessions: session
            ? library.sessions.map((candidate) =>
                  candidate.id === session.id
                      ? {
                            ...candidate,
                            attemptIds: candidate.attemptIds.includes(nextAttempt.id)
                                ? candidate.attemptIds
                                : [...candidate.attemptIds, nextAttempt.id],
                        }
                      : candidate,
              )
            : library.sessions,
    };
}

export function getTrainingCollectionStats(
    library: TrainingLibrary,
    collectionId: string,
): TrainingCollectionStats {
    const collection = library.collections[collectionId];
    if (!collection) {
        return { total: 0, practiced: 0, correct: 0, incorrect: 0, skipped: 0 };
    }

    const itemIds = new Set(collection.itemIds);
    const attempts = library.attempts.filter((attempt) => itemIds.has(attempt.itemId));
    const practiced = new Set(attempts.map((attempt) => attempt.itemId));

    return {
        total: itemIds.size,
        practiced: practiced.size,
        correct: attempts.filter((attempt) => attempt.outcome === "correct").length,
        incorrect: attempts.filter((attempt) => attempt.outcome === "incorrect").length,
        skipped: attempts.filter((attempt) => attempt.outcome === "skipped").length,
    };
}

export function serializeTrainingLibrary(library: TrainingLibrary): string {
    return JSON.stringify(library, null, 2);
}

export function parseTrainingBackup(raw: string): TrainingLibrary {
    const parsed: unknown = JSON.parse(raw);
    return trainingLibrarySchema.parse(parsed);
}

export function createTrainingItem({
    kind,
    title,
    fen,
    sideToMove,
    objective,
    solutionMoves,
    tags,
    notes,
    source,
}: Omit<TrainingItem, "id" | "createdAt" | "updatedAt">): TrainingItem {
    const timestamp = now();
    return {
        id: trainingId("item"),
        kind,
        title,
        fen,
        sideToMove,
        objective,
        solutionMoves,
        tags,
        notes,
        source,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}
