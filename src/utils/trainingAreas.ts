import { z } from "zod";
import { getMainLine, parsePGN } from "@/utils/chess";
import { positionFromFen } from "@/utils/chessops";
import { getGameName } from "@/utils/treeReducer";

export const TRAINING_AREAS_SCHEMA_VERSION = 8;
const TACTICS_ACCEPTANCE_THRESHOLD_CP = 30;

const timestamp = () => new Date().toISOString();

export const trainingObjectiveSchema = z.enum(["win", "draw", "loss", "unknown"]);
export type TrainingObjective = z.infer<typeof trainingObjectiveSchema>;

const sourceSchema = z.object({
    label: z.string().optional(),
    pgn: z.string().optional(),
});

const tacticsExerciseSchema = z.object({
    id: z.string(),
    title: z.string(),
    fen: z.string(),
    solutionMoves: z.array(z.string()),
    tags: z.array(z.string()),
    source: sourceSchema,
    createdAt: z.string(),
});
export type TacticsExercise = z.infer<typeof tacticsExerciseSchema>;

export const tacticsStartingActorSchema = z.enum(["student", "opponent"]);
export type TacticsStartingActor = z.infer<typeof tacticsStartingActorSchema>;

export const tacticsVariationPolicySchema = z.enum(["mainline", "opponentResponses", "all"]);
export type TacticsVariationPolicy = z.infer<typeof tacticsVariationPolicySchema>;

export const tacticsValidationModeSchema = z.enum(["auto", "prepared", "engine"]);
export type TacticsValidationMode = z.infer<typeof tacticsValidationModeSchema>;

const tacticsSourceSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("pgnFile"),
        path: z.string(),
        filename: z.string(),
        recordCount: z.number().int().nonnegative(),
    }),
    z.object({
        kind: z.literal("embedded"),
    }),
]);
export type TacticsSource = z.infer<typeof tacticsSourceSchema>;

const tacticsCycleSummarySchema = z.object({
    id: z.string(),
    number: z.number().int().positive(),
    exerciseCount: z.number().int().nonnegative(),
    completedCount: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    timeMs: z.number().nonnegative(),
    completedAt: z.string(),
});
export type TacticsCycleSummary = z.infer<typeof tacticsCycleSummarySchema>;

const tacticsActiveCycleSchema = z.object({
    number: z.number().int().positive(),
    queue: z.array(z.number().int().nonnegative()),
    position: z.number().int().nonnegative(),
    failedIndexes: z.array(z.number().int().nonnegative()),
    failures: z.number().int().nonnegative(),
    timeMs: z.number().nonnegative(),
});
export type TacticsActiveCycle = z.infer<typeof tacticsActiveCycleSchema>;

const tacticsSetProgressSchema = z.object({
    nextExerciseIndex: z.number().int().nonnegative(),
    autoAdvance: z.boolean(),
    activeCycle: tacticsActiveCycleSchema.nullable(),
    cycles: z.array(tacticsCycleSummarySchema),
});
export type TacticsSetProgress = z.infer<typeof tacticsSetProgressSchema>;

const tacticsSetSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    exerciseIds: z.array(z.string()),
    source: tacticsSourceSchema.optional(),
    origin: z.enum(["bundled", "user"]),
    recommendedRating: z.object({
        min: z.number().int().nonnegative().nullable(),
        max: z.number().int().nonnegative().nullable(),
    }),
    progress: tacticsSetProgressSchema,
    config: z.object({
        acceptanceThresholdCp: z.number().nonnegative(),
        mode: z.enum(["guided", "woodpecker"]),
        startingActor: tacticsStartingActorSchema,
        variationPolicy: tacticsVariationPolicySchema,
        validationMode: tacticsValidationModeSchema,
    }),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type TacticsSet = z.infer<typeof tacticsSetSchema>;

const tacticsAttemptSchema = z.object({
    id: z.string(),
    setId: z.string(),
    exerciseId: z.string(),
    playedMove: z.string().nullable(),
    outcome: z.enum(["correct", "incorrect", "unsupported"]),
    timeMs: z.number().nonnegative(),
    cycleNumber: z.number().int().positive().nullable().optional(),
    createdAt: z.string(),
});
export type TacticsAttempt = z.infer<typeof tacticsAttemptSchema>;

const tacticsStateSchema = z.object({
    sets: z.record(tacticsSetSchema),
    exercises: z.record(tacticsExerciseSchema),
    attempts: z.array(tacticsAttemptSchema),
});
export type TacticsState = z.infer<typeof tacticsStateSchema>;

const openingMoveProgressSchema = z.object({
    attempts: z.number().int().nonnegative(),
    successes: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    totalTimeMs: z.number().nonnegative(),
    lastAttemptAt: z.string(),
});
export type OpeningMoveProgress = z.infer<typeof openingMoveProgressSchema>;

const openingLineSessionSchema = z.object({
    attempts: z.number().int().nonnegative(),
    completions: z.number().int().nonnegative(),
    flawless: z.number().int().nonnegative(),
    totalTimeMs: z.number().nonnegative(),
    lastAttemptAt: z.string().optional(),
});
export type OpeningLineSession = z.infer<typeof openingLineSessionSchema>;

const openingLineSchema = z.object({
    id: z.string(),
    variantId: z.string(),
    name: z.string(),
    fen: z.string(),
    moves: z.array(z.string()),
    sourcePgn: z.string().optional(),
    path: z.array(z.number().int().nonnegative()),
    plyCount: z.number().int().nonnegative(),
    trainable: z.boolean(),
    sourceRecordIndex: z.number().int().nonnegative().nullable(),
    moveProgress: z.record(openingMoveProgressSchema),
    session: openingLineSessionSchema,
});
export type OpeningLine = z.infer<typeof openingLineSchema>;

const openingVariantSchema = z.object({
    id: z.string(),
    repertoireId: z.string(),
    name: z.string(),
    lineIds: z.array(z.string()),
    sourceRecordIndex: z.number().int().nonnegative(),
    trainingRecordIndex: z.number().int().nonnegative(),
    contentType: z.enum(["theory", "modelGame"]),
    commentCount: z.number().int().nonnegative(),
    hasVariations: z.boolean(),
});
export type OpeningVariant = z.infer<typeof openingVariantSchema>;

const openingRepertoireSchema = z.object({
    id: z.string(),
    name: z.string(),
    color: z.enum(["white", "black", "both"]),
    description: z.string(),
    path: z.string(),
    sourcePath: z.string(),
    recordCount: z.number().int().nonnegative(),
    variantIds: z.array(z.string()),
    acceptanceThresholdCp: z.number().nonnegative(),
    subvariationPolicy: z.enum(["mainline", "all"]),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type OpeningRepertoire = z.infer<typeof openingRepertoireSchema>;

const openingsStateSchema = z.object({
    repertoires: z.record(openingRepertoireSchema),
    variants: z.record(openingVariantSchema),
    lines: z.record(openingLineSchema),
    settings: z.object({
        askLineDifficulty: z.boolean(),
        evaluateOutsideRepertoire: z.boolean(),
    }),
});
export type OpeningsState = z.infer<typeof openingsStateSchema>;

const endgamePositionSchema = z.object({
    id: z.string(),
    title: z.string(),
    fen: z.string(),
    objective: trainingObjectiveSchema,
    objectiveSource: z.enum(["pending", "tablebase", "stockfish", "manual"]),
    category: z.string().optional(),
    theme: z.enum(["pawn", "rook", "minorPiece", "queen", "mixed", "other"]),
    sourcePgn: z.string().optional(),
    progress: z.object({
        attempts: z.number().int().nonnegative(),
        successes: z.number().int().nonnegative(),
        completed: z.boolean(),
        totalTimeMs: z.number().nonnegative(),
        lastOutcome: z.enum(["1-0", "0-1", "1/2-1/2", "*"]).nullable(),
        lastPlayedAt: z.string().nullable(),
    }),
    createdAt: z.string(),
});
export type EndgamePosition = z.infer<typeof endgamePositionSchema>;
export type EndgameTheme = EndgamePosition["theme"];

const endgameSetSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    positionIds: z.array(z.string()),
    origin: z.enum(["bundled", "user"]),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type EndgameSet = z.infer<typeof endgameSetSchema>;

const endgamesStateSchema = z.object({
    sets: z.record(endgameSetSchema),
    positions: z.record(endgamePositionSchema),
    bundledContentVersion: z.number().int().nonnegative(),
});
export type EndgamesState = z.infer<typeof endgamesStateSchema>;

export function inferEndgameTheme(title: string, fen: string): EndgameTheme {
    const normalized = title.toLowerCase();
    if (/queen|dama/.test(normalized)) return "queen";
    if (/rook|torre/.test(normalized)) return "rook";
    if (/knight|bishop|minor|caballo|alfil/.test(normalized)) return "minorPiece";
    if (/pawn|pe[oó]n/.test(normalized)) return "pawn";

    const board = fen.split(" ")[0]?.toLowerCase() ?? "";
    const groups = [
        board.includes("q"),
        board.includes("r"),
        board.includes("b") || board.includes("n"),
    ].filter(Boolean).length;
    if (groups > 1) return "mixed";
    if (board.includes("q")) return "queen";
    if (board.includes("r")) return "rook";
    if (board.includes("b") || board.includes("n")) return "minorPiece";
    if (board.includes("p")) return "pawn";
    return "other";
}

export const trainingAreasSchema = z.object({
    schemaVersion: z.literal(TRAINING_AREAS_SCHEMA_VERSION),
    tactics: tacticsStateSchema,
    openings: openingsStateSchema,
    endgames: endgamesStateSchema,
});
export type TrainingAreasState = z.infer<typeof trainingAreasSchema>;

export const persistedTrainingAreasSchema = z.preprocess((value) => {
    if (!value || typeof value !== "object") return value;
    let migrated = { ...(value as Record<string, unknown>) };

    if (migrated.schemaVersion === 1) {
        const tactics = migrated.tactics as Record<string, unknown> | undefined;
        const sets = (tactics?.sets as Record<string, Record<string, unknown>> | undefined) ?? {};
        const migratedSets = Object.fromEntries(
            Object.entries(sets).map(([id, set]) => {
                const config = (set.config as Record<string, unknown> | undefined) ?? {};
                return [
                    id,
                    {
                        ...set,
                        source: set.source ?? { kind: "embedded" },
                        config: {
                            ...config,
                            startingActor: config.startingActor ?? "student",
                            variationPolicy: config.variationPolicy ?? "mainline",
                            validationMode: config.validationMode ?? "auto",
                        },
                    },
                ];
            }),
        );
        migrated = { ...migrated, schemaVersion: 2, tactics: { ...tactics, sets: migratedSets } };
    }

    if (migrated.schemaVersion === 2) {
        const openings = migrated.openings as Record<string, unknown> | undefined;
        const repertoires =
            (openings?.repertoires as Record<string, Record<string, unknown>> | undefined) ?? {};
        const variants =
            (openings?.variants as Record<string, Record<string, unknown>> | undefined) ?? {};
        const lines =
            (openings?.lines as Record<string, Record<string, unknown>> | undefined) ?? {};
        const variantOrder = new Map<string, number>();
        Object.values(repertoires).forEach((repertoire) => {
            ((repertoire.variantIds as string[] | undefined) ?? []).forEach((id, index) =>
                variantOrder.set(id, index),
            );
        });

        migrated = {
            ...migrated,
            schemaVersion: 3,
            openings: {
                ...openings,
                repertoires: Object.fromEntries(
                    Object.entries(repertoires).map(([id, repertoire]) => [
                        id,
                        {
                            ...repertoire,
                            sourcePath: repertoire.sourcePath ?? repertoire.path ?? "",
                            recordCount:
                                repertoire.recordCount ??
                                (repertoire.variantIds as string[] | undefined)?.length ??
                                0,
                            subvariationPolicy: repertoire.subvariationPolicy ?? "mainline",
                        },
                    ]),
                ),
                variants: Object.fromEntries(
                    Object.entries(variants).map(([id, variant]) => {
                        const recordIndex = variantOrder.get(id) ?? 0;
                        return [
                            id,
                            {
                                ...variant,
                                sourceRecordIndex: variant.sourceRecordIndex ?? recordIndex,
                                trainingRecordIndex: variant.trainingRecordIndex ?? recordIndex,
                                contentType: variant.contentType ?? "theory",
                                commentCount: variant.commentCount ?? 0,
                                hasVariations: variant.hasVariations ?? false,
                            },
                        ];
                    }),
                ),
                lines: Object.fromEntries(
                    Object.entries(lines).map(([id, line]) => [
                        id,
                        {
                            ...line,
                            path: line.path ?? [],
                            plyCount:
                                line.plyCount ?? (line.moves as string[] | undefined)?.length ?? 0,
                            trainable: line.trainable ?? true,
                        },
                    ]),
                ),
            },
        };
    }

    if (migrated.schemaVersion === 3) {
        const endgames = migrated.endgames as Record<string, unknown> | undefined;
        migrated = {
            ...migrated,
            schemaVersion: 4,
            endgames: { ...endgames, bundledContentVersion: 0 },
        };
    }

    if (migrated.schemaVersion === 4) {
        const openings = migrated.openings as Record<string, unknown> | undefined;
        const variants =
            (openings?.variants as Record<string, Record<string, unknown>> | undefined) ?? {};
        const lines =
            (openings?.lines as Record<string, Record<string, unknown>> | undefined) ?? {};
        migrated = {
            ...migrated,
            schemaVersion: 5,
            openings: {
                ...openings,
                settings: { askLineDifficulty: true },
                lines: Object.fromEntries(
                    Object.entries(lines).map(([id, line]) => {
                        const variant = variants[line.variantId as string];
                        return [
                            id,
                            {
                                ...line,
                                sourceRecordIndex:
                                    line.sourceRecordIndex ?? variant?.sourceRecordIndex ?? null,
                                moveProgress: line.moveProgress ?? {},
                                session: line.session ?? {
                                    attempts: 0,
                                    completions: 0,
                                    flawless: 0,
                                    totalTimeMs: 0,
                                },
                            },
                        ];
                    }),
                ),
            },
        };
    }

    if (migrated.schemaVersion === 5) {
        const tactics = migrated.tactics as Record<string, unknown> | undefined;
        const sets = (tactics?.sets as Record<string, Record<string, unknown>> | undefined) ?? {};
        const attempts = (tactics?.attempts as Array<Record<string, unknown>> | undefined) ?? [];
        const migratedSets = Object.fromEntries(
            Object.entries(sets).map(([id, set]) => {
                const source = set.source as Record<string, unknown> | undefined;
                const exerciseIds = (set.exerciseIds as string[] | undefined) ?? [];
                const total =
                    source?.kind === "pgnFile"
                        ? Number(source.recordCount ?? 0)
                        : exerciseIds.length;
                const completedIds = new Set(
                    attempts
                        .filter((attempt) => attempt.setId === id && attempt.outcome === "correct")
                        .map((attempt) => String(attempt.exerciseId)),
                );
                let nextExerciseIndex = 0;
                while (nextExerciseIndex < total) {
                    const exerciseId =
                        source?.kind === "pgnFile"
                            ? `record-${nextExerciseIndex}`
                            : exerciseIds[nextExerciseIndex];
                    if (!exerciseId || !completedIds.has(exerciseId)) break;
                    nextExerciseIndex += 1;
                }
                if (nextExerciseIndex >= total) nextExerciseIndex = 0;
                return [
                    id,
                    {
                        ...set,
                        origin: set.origin ?? "user",
                        recommendedRating: set.recommendedRating ?? { min: null, max: null },
                        progress: set.progress ?? {
                            nextExerciseIndex,
                            autoAdvance: false,
                            activeCycle: null,
                            cycles: [],
                        },
                    },
                ];
            }),
        );
        migrated = {
            ...migrated,
            schemaVersion: 6,
            tactics: { ...tactics, sets: migratedSets },
        };
    }

    if (migrated.schemaVersion === 6) {
        const endgames = migrated.endgames as Record<string, unknown> | undefined;
        const sets = (endgames?.sets as Record<string, Record<string, unknown>> | undefined) ?? {};
        const positions =
            (endgames?.positions as Record<string, Record<string, unknown>> | undefined) ?? {};
        const bundledSetIds = new Set(
            Object.entries(sets)
                .filter(([, set]) =>
                    String(set.name ?? "")
                        .toLowerCase()
                        .startsWith("finales incluidos"),
                )
                .map(([id]) => id),
        );
        migrated = {
            ...migrated,
            schemaVersion: 7,
            endgames: {
                ...endgames,
                sets: Object.fromEntries(
                    Object.entries(sets).map(([id, set]) => [
                        id,
                        {
                            ...set,
                            origin: set.origin ?? (bundledSetIds.has(id) ? "bundled" : "user"),
                        },
                    ]),
                ),
                positions: Object.fromEntries(
                    Object.entries(positions).map(([id, position]) => [
                        id,
                        {
                            ...position,
                            theme:
                                position.theme ??
                                inferEndgameTheme(
                                    String(position.title ?? ""),
                                    String(position.fen ?? ""),
                                ),
                            progress: position.progress ?? {
                                attempts: 0,
                                successes: 0,
                                completed: false,
                                totalTimeMs: 0,
                                lastOutcome: null,
                                lastPlayedAt: null,
                            },
                        },
                    ]),
                ),
            },
        };
    }

    if (migrated.schemaVersion === 7) {
        const openings = migrated.openings as Record<string, unknown> | undefined;
        migrated = {
            ...migrated,
            schemaVersion: TRAINING_AREAS_SCHEMA_VERSION,
            openings: {
                ...openings,
                settings: {
                    askLineDifficulty: false,
                    evaluateOutsideRepertoire: false,
                },
            },
        };
    }

    return migrated;
}, trainingAreasSchema);

export type ParsedTrainingRecord = {
    fen: string;
    moves: string[];
    title: string;
    sourcePgn?: string;
    hasExplicitFen: boolean;
};

export type ParseTrainingRecordsOptions = {
    requireExplicitFen?: boolean;
    skipInvalid?: boolean;
};

export function areaId(prefix: string): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createEmptyTrainingAreas(): TrainingAreasState {
    return {
        schemaVersion: TRAINING_AREAS_SCHEMA_VERSION,
        tactics: { sets: {}, exercises: {}, attempts: [] },
        openings: {
            repertoires: {},
            variants: {},
            lines: {},
            settings: {
                askLineDifficulty: false,
                evaluateOutsideRepertoire: false,
            },
        },
        endgames: { sets: {}, positions: {}, bundledContentVersion: 0 },
    };
}

function isFenLine(value: string): boolean {
    return positionFromFen(value.trim())[0] !== null;
}

function splitPgnRecords(raw: string): string[] {
    const lines = raw.replace(/\r/g, "").split("\n");
    const blocks: string[] = [];
    let current: string[] = [];

    for (const line of lines) {
        const isHeaderStart = /^\s*\[Event\s+"/i.test(line);
        if (isHeaderStart && current.some((entry) => entry.trim())) {
            blocks.push(current.join("\n").trim());
            current = [];
        }
        current.push(line);
    }

    if (current.some((entry) => entry.trim())) {
        blocks.push(current.join("\n").trim());
    }

    return blocks.filter(Boolean);
}

export async function parseTrainingRecords(
    raw: string,
    options: ParseTrainingRecordsOptions = {},
): Promise<ParsedTrainingRecord[]> {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error("El archivo está vacío.");

    const nonEmptyLines = trimmed
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (nonEmptyLines.length > 0 && nonEmptyLines.every(isFenLine)) {
        return nonEmptyLines.map((fen, index) => ({
            fen,
            moves: [],
            title: `Posición ${index + 1}`,
            hasExplicitFen: true,
        }));
    }

    const records: ParsedTrainingRecord[] = [];
    for (const [index, block] of splitPgnRecords(trimmed).entries()) {
        const explicitFen = /^\s*\[FEN\s+"([^"]*)"\s*\]/im.exec(block)?.[1]?.trim();
        if (options.requireExplicitFen && (!explicitFen || !positionFromFen(explicitFen)[0])) {
            if (options.skipInvalid) continue;
            throw new Error(`El registro ${index + 1} no contiene una posición FEN válida.`);
        }

        try {
            const tree = await parsePGN(block);
            const fen = tree.headers.fen.trim();
            if (!positionFromFen(fen)[0]) {
                throw new Error(`El registro ${index + 1} no contiene una posición FEN válida.`);
            }

            records.push({
                fen,
                moves: getMainLine(tree.root),
                title:
                    tree.headers.other?.ChapterName?.trim() ||
                    getGameName(tree.headers) ||
                    `Posición ${index + 1}`,
                sourcePgn: block,
                hasExplicitFen: explicitFen !== undefined,
            });
        } catch (error) {
            if (!options.skipInvalid) throw error;
        }
    }

    return records;
}

export function addTacticsSet(
    state: TacticsState,
    name: string,
    description: string,
    records: ParsedTrainingRecord[],
): TacticsState {
    const setId = areaId("tactics-set");
    const createdAt = timestamp();
    const exercises = { ...state.exercises };
    const exerciseIds = records.map((record) => {
        const id = areaId("tactic");
        exercises[id] = {
            id,
            title: record.title,
            fen: record.fen,
            solutionMoves: record.moves,
            tags: [],
            source: { label: record.title, pgn: record.sourcePgn },
            createdAt,
        };
        return id;
    });

    return {
        ...state,
        exercises,
        sets: {
            ...state.sets,
            [setId]: {
                id: setId,
                name,
                description,
                exerciseIds,
                source: { kind: "embedded" },
                origin: "user",
                recommendedRating: { min: null, max: null },
                progress: {
                    nextExerciseIndex: 0,
                    autoAdvance: false,
                    activeCycle: null,
                    cycles: [],
                },
                config: {
                    acceptanceThresholdCp: TACTICS_ACCEPTANCE_THRESHOLD_CP,
                    mode: "guided",
                    startingActor: "student",
                    variationPolicy: "mainline",
                    validationMode: "auto",
                },
                createdAt,
                updatedAt: createdAt,
            },
        },
    };
}

export function addTacticsFileSet(
    state: TacticsState,
    input: {
        name: string;
        description: string;
        path: string;
        filename: string;
        recordCount: number;
        config: TacticsSet["config"];
        recommendedRating?: TacticsSet["recommendedRating"];
    },
): TacticsState {
    const setId = areaId("tactics-set");
    const createdAt = timestamp();
    return {
        ...state,
        sets: {
            ...state.sets,
            [setId]: {
                id: setId,
                name: input.name,
                description: input.description,
                exerciseIds: [],
                source: {
                    kind: "pgnFile",
                    path: input.path,
                    filename: input.filename,
                    recordCount: input.recordCount,
                },
                origin: "user",
                recommendedRating: input.recommendedRating ?? { min: null, max: null },
                progress: {
                    nextExerciseIndex: 0,
                    autoAdvance: false,
                    activeCycle: null,
                    cycles: [],
                },
                config: input.config,
                createdAt,
                updatedAt: createdAt,
            },
        },
    };
}

export function updateTacticsSetConfig(
    state: TacticsState,
    setId: string,
    config: TacticsSet["config"],
): TacticsState {
    const set = state.sets[setId];
    if (!set) return state;
    return {
        ...state,
        sets: {
            ...state.sets,
            [setId]: { ...set, config, updatedAt: timestamp() },
        },
    };
}

export function updateTacticsSetMetadata(
    state: TacticsState,
    setId: string,
    input: Pick<TacticsSet, "name" | "description" | "recommendedRating">,
): TacticsState {
    const set = state.sets[setId];
    if (!set || !input.name.trim()) return state;
    return {
        ...state,
        sets: {
            ...state.sets,
            [setId]: {
                ...set,
                name: input.name.trim(),
                description: input.description.trim(),
                recommendedRating: input.recommendedRating,
                updatedAt: timestamp(),
            },
        },
    };
}

export function setTacticsResumeIndex(
    state: TacticsState,
    setId: string,
    nextExerciseIndex: number,
): TacticsState {
    const set = state.sets[setId];
    if (!set) return state;
    return {
        ...state,
        sets: {
            ...state.sets,
            [setId]: {
                ...set,
                progress: {
                    ...set.progress,
                    nextExerciseIndex: Math.max(0, Math.floor(nextExerciseIndex)),
                },
                updatedAt: timestamp(),
            },
        },
    };
}

export function getTacticsExerciseIndex(set: TacticsSet, exerciseId: string): number {
    if (set.source?.kind === "pgnFile") {
        const match = /^record-(\d+)$/.exec(exerciseId);
        return match ? Number(match[1]) : -1;
    }
    return set.exerciseIds.indexOf(exerciseId);
}

export function getTacticsCompletedIndexes(
    state: TacticsState,
    setId: string,
    cycleNumber?: number | null,
): number[] {
    const set = state.sets[setId];
    if (!set) return [];
    const total = getTacticsSetSize(set);
    return Array.from(
        new Set(
            state.attempts
                .filter(
                    (attempt) =>
                        attempt.setId === setId &&
                        attempt.outcome === "correct" &&
                        (cycleNumber == null || attempt.cycleNumber === cycleNumber),
                )
                .map((attempt) => getTacticsExerciseIndex(set, attempt.exerciseId))
                .filter((index) => index >= 0 && index < total),
        ),
    ).sort((left, right) => left - right);
}

export function getTacticsFirstIncompleteIndex(
    state: TacticsState,
    setId: string,
    cycleNumber?: number | null,
): number {
    const set = state.sets[setId];
    if (!set) return 0;
    const completed = new Set(getTacticsCompletedIndexes(state, setId, cycleNumber));
    const total = getTacticsSetSize(set);
    for (let index = 0; index < total; index += 1) {
        if (!completed.has(index)) return index;
    }
    return 0;
}

export function updateTacticsAutoAdvance(
    state: TacticsState,
    setId: string,
    autoAdvance: boolean,
): TacticsState {
    const set = state.sets[setId];
    if (!set) return state;
    return {
        ...state,
        sets: {
            ...state.sets,
            [setId]: {
                ...set,
                progress: { ...set.progress, autoAdvance },
                updatedAt: timestamp(),
            },
        },
    };
}

export function saveTacticsActiveCycle(
    state: TacticsState,
    setId: string,
    activeCycle: TacticsActiveCycle | null,
): TacticsState {
    const set = state.sets[setId];
    if (!set) return state;
    return {
        ...state,
        sets: {
            ...state.sets,
            [setId]: {
                ...set,
                progress: { ...set.progress, activeCycle },
                updatedAt: timestamp(),
            },
        },
    };
}

export function completeTacticsCycle(
    state: TacticsState,
    setId: string,
    summary: Omit<TacticsCycleSummary, "id" | "completedAt">,
): TacticsState {
    const set = state.sets[setId];
    if (!set) return state;
    return {
        ...state,
        sets: {
            ...state.sets,
            [setId]: {
                ...set,
                progress: {
                    ...set.progress,
                    activeCycle: null,
                    cycles: [
                        ...set.progress.cycles,
                        {
                            ...summary,
                            id: areaId("tactics-cycle"),
                            completedAt: timestamp(),
                        },
                    ],
                },
                updatedAt: timestamp(),
            },
        },
    };
}

export function deleteTacticsSet(state: TacticsState, setId: string): TacticsState {
    const set = state.sets[setId];
    if (!set || set.origin === "bundled") return state;
    const sets = { ...state.sets };
    const exercises = { ...state.exercises };
    delete sets[setId];
    for (const exerciseId of set.exerciseIds) delete exercises[exerciseId];
    return {
        sets,
        exercises,
        attempts: state.attempts.filter((attempt) => attempt.setId !== setId),
    };
}

export function getTacticsSetSize(set: TacticsSet): number {
    return set.source?.kind === "pgnFile" ? set.source.recordCount : set.exerciseIds.length;
}

export function recordTacticsAttempt(
    state: TacticsState,
    attempt: Omit<TacticsAttempt, "id" | "createdAt">,
): TacticsState {
    return {
        ...state,
        attempts: [
            ...state.attempts,
            { ...attempt, id: areaId("tactic-attempt"), createdAt: timestamp() },
        ],
    };
}

export function addOpeningRepertoire(
    state: OpeningsState,
    input: {
        name: string;
        color: OpeningRepertoire["color"];
        description: string;
        path: string;
        sourcePath: string;
        recordCount: number;
        subvariationPolicy: OpeningRepertoire["subvariationPolicy"];
        variants: Array<{
            name: string;
            sourceRecordIndex: number;
            trainingRecordIndex: number;
            contentType: OpeningVariant["contentType"];
            commentCount: number;
            hasVariations: boolean;
            lines: Array<{
                name: string;
                fen: string;
                moves: string[];
                path: number[];
                plyCount: number;
                trainable: boolean;
            }>;
        }>;
    },
): OpeningsState {
    const repertoireId = areaId("repertoire");
    const createdAt = timestamp();
    const variants = { ...state.variants };
    const lines = { ...state.lines };
    const variantIds: string[] = [];

    for (const importedVariant of input.variants) {
        const variantId = areaId("variant");
        const lineIds = importedVariant.lines.map((importedLine) => {
            const lineId = areaId("line");
            lines[lineId] = {
                id: lineId,
                variantId,
                name: importedLine.name,
                fen: importedLine.fen,
                moves: importedLine.moves,
                path: importedLine.path,
                plyCount: importedLine.plyCount,
                trainable: importedLine.trainable,
                sourceRecordIndex: importedVariant.sourceRecordIndex,
                moveProgress: {},
                session: {
                    attempts: 0,
                    completions: 0,
                    flawless: 0,
                    totalTimeMs: 0,
                },
            };
            return lineId;
        });
        variants[variantId] = {
            id: variantId,
            repertoireId,
            name: importedVariant.name,
            lineIds,
            sourceRecordIndex: importedVariant.sourceRecordIndex,
            trainingRecordIndex: importedVariant.trainingRecordIndex,
            contentType: importedVariant.contentType,
            commentCount: importedVariant.commentCount,
            hasVariations: importedVariant.hasVariations,
        };
        variantIds.push(variantId);
    }

    return {
        ...state,
        variants,
        lines,
        repertoires: {
            ...state.repertoires,
            [repertoireId]: {
                id: repertoireId,
                name: input.name,
                color: input.color,
                description: input.description,
                path: input.path,
                sourcePath: input.sourcePath,
                recordCount: input.recordCount,
                variantIds,
                acceptanceThresholdCp: TACTICS_ACCEPTANCE_THRESHOLD_CP,
                subvariationPolicy: input.subvariationPolicy,
                createdAt,
                updatedAt: createdAt,
            },
        },
    };
}

export function addBlankOpeningVariant(
    state: OpeningsState,
    repertoireId: string,
    name: string,
): OpeningsState {
    const repertoire = state.repertoires[repertoireId];
    if (!repertoire) return state;
    const variantId = areaId("variant");
    const recordIndex = repertoire.variantIds.length;
    return {
        ...state,
        repertoires: {
            ...state.repertoires,
            [repertoireId]: {
                ...repertoire,
                recordCount: repertoire.recordCount + 1,
                variantIds: [...repertoire.variantIds, variantId],
                updatedAt: timestamp(),
            },
        },
        variants: {
            ...state.variants,
            [variantId]: {
                id: variantId,
                repertoireId,
                name,
                lineIds: [],
                sourceRecordIndex: recordIndex,
                trainingRecordIndex: recordIndex,
                contentType: "theory",
                commentCount: 0,
                hasVariations: false,
            },
        },
    };
}

export function addOpeningVariantFolder(
    state: OpeningsState,
    repertoireId: string,
    name: string,
): OpeningsState {
    const repertoire = state.repertoires[repertoireId];
    if (!repertoire || !name.trim()) return state;
    const variantId = areaId("variant");
    const fallbackSourceRecordIndex =
        repertoire.variantIds.map((id) => state.variants[id]).find(Boolean)?.sourceRecordIndex ?? 0;
    return touchOpeningRepertoire(
        {
            ...state,
            repertoires: {
                ...state.repertoires,
                [repertoireId]: {
                    ...repertoire,
                    variantIds: [...repertoire.variantIds, variantId],
                },
            },
            variants: {
                ...state.variants,
                [variantId]: {
                    id: variantId,
                    repertoireId,
                    name: name.trim(),
                    lineIds: [],
                    sourceRecordIndex: fallbackSourceRecordIndex,
                    trainingRecordIndex: repertoire.variantIds.length,
                    contentType: "theory",
                    commentCount: 0,
                    hasVariations: false,
                },
            },
        },
        repertoireId,
    );
}

export function updateOpeningRepertoire(
    state: OpeningsState,
    repertoireId: string,
    input: Pick<OpeningRepertoire, "name" | "description">,
): OpeningsState {
    const repertoire = state.repertoires[repertoireId];
    if (!repertoire) return state;
    return {
        ...state,
        repertoires: {
            ...state.repertoires,
            [repertoireId]: {
                ...repertoire,
                name: input.name,
                description: input.description,
                updatedAt: timestamp(),
            },
        },
    };
}

export function updateOpeningVariant(
    state: OpeningsState,
    variantId: string,
    input: Pick<OpeningVariant, "name" | "contentType">,
): OpeningsState {
    const variant = state.variants[variantId];
    if (!variant) return state;
    const lines = { ...state.lines };
    if (input.contentType === "modelGame") {
        for (const lineId of variant.lineIds) {
            const line = lines[lineId];
            if (line) lines[lineId] = { ...line, trainable: false };
        }
    }
    return {
        ...state,
        lines,
        variants: {
            ...state.variants,
            [variantId]: { ...variant, ...input },
        },
        repertoires: {
            ...state.repertoires,
            [variant.repertoireId]: {
                ...state.repertoires[variant.repertoireId],
                updatedAt: timestamp(),
            },
        },
    };
}

export function updateOpeningLineTrainable(
    state: OpeningsState,
    lineId: string,
    trainable: boolean,
): OpeningsState {
    const line = state.lines[lineId];
    if (!line) return state;
    const variant = state.variants[line.variantId];
    if (!variant || variant.contentType === "modelGame") return state;
    return {
        ...state,
        lines: { ...state.lines, [lineId]: { ...line, trainable } },
        repertoires: {
            ...state.repertoires,
            [variant.repertoireId]: {
                ...state.repertoires[variant.repertoireId],
                updatedAt: timestamp(),
            },
        },
    };
}

export function moveOpeningVariant(
    state: OpeningsState,
    repertoireId: string,
    variantId: string,
    direction: "up" | "down",
): OpeningsState {
    const repertoire = state.repertoires[repertoireId];
    if (!repertoire) return state;
    const index = repertoire.variantIds.indexOf(variantId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= repertoire.variantIds.length) return state;
    const variantIds = [...repertoire.variantIds];
    [variantIds[index], variantIds[target]] = [variantIds[target], variantIds[index]];
    return {
        ...state,
        repertoires: {
            ...state.repertoires,
            [repertoireId]: { ...repertoire, variantIds, updatedAt: timestamp() },
        },
    };
}

function touchOpeningRepertoire(state: OpeningsState, repertoireId: string): OpeningsState {
    const repertoire = state.repertoires[repertoireId];
    if (!repertoire) return state;
    return {
        ...state,
        repertoires: {
            ...state.repertoires,
            [repertoireId]: { ...repertoire, updatedAt: timestamp() },
        },
    };
}

function normalizeOpeningVariantOrder(state: OpeningsState, repertoireId: string): OpeningsState {
    const repertoire = state.repertoires[repertoireId];
    if (!repertoire) return state;
    const variants = { ...state.variants };
    repertoire.variantIds.forEach((variantId, trainingRecordIndex) => {
        const variant = variants[variantId];
        if (variant) variants[variantId] = { ...variant, trainingRecordIndex };
    });
    return { ...state, variants };
}

export function reorderOpeningVariant(
    state: OpeningsState,
    repertoireId: string,
    sourceIndex: number,
    destinationIndex: number,
): OpeningsState {
    const repertoire = state.repertoires[repertoireId];
    if (
        !repertoire ||
        sourceIndex === destinationIndex ||
        sourceIndex < 0 ||
        destinationIndex < 0 ||
        sourceIndex >= repertoire.variantIds.length ||
        destinationIndex >= repertoire.variantIds.length
    ) {
        return state;
    }
    const variantIds = [...repertoire.variantIds];
    const [variantId] = variantIds.splice(sourceIndex, 1);
    variantIds.splice(destinationIndex, 0, variantId);
    const reordered = touchOpeningRepertoire(
        {
            ...state,
            repertoires: {
                ...state.repertoires,
                [repertoireId]: { ...repertoire, variantIds },
            },
        },
        repertoireId,
    );
    return normalizeOpeningVariantOrder(reordered, repertoireId);
}

export function addOpeningLine(
    state: OpeningsState,
    variantId: string,
    input: Pick<OpeningLine, "name" | "fen" | "moves">,
): OpeningsState {
    const variant = state.variants[variantId];
    if (!variant) return state;
    const lineId = areaId("line");
    return touchOpeningRepertoire(
        {
            ...state,
            variants: {
                ...state.variants,
                [variantId]: { ...variant, lineIds: [...variant.lineIds, lineId] },
            },
            lines: {
                ...state.lines,
                [lineId]: {
                    id: lineId,
                    variantId,
                    name: input.name,
                    fen: input.fen,
                    moves: input.moves,
                    path: [],
                    plyCount: input.moves.length,
                    trainable: variant.contentType === "theory",
                    sourceRecordIndex: null,
                    moveProgress: {},
                    session: {
                        attempts: 0,
                        completions: 0,
                        flawless: 0,
                        totalTimeMs: 0,
                    },
                },
            },
        },
        variant.repertoireId,
    );
}

export function renameOpeningLine(
    state: OpeningsState,
    lineId: string,
    name: string,
): OpeningsState {
    const line = state.lines[lineId];
    const variant = line ? state.variants[line.variantId] : undefined;
    if (!line || !variant || !name.trim()) return state;
    return touchOpeningRepertoire(
        { ...state, lines: { ...state.lines, [lineId]: { ...line, name: name.trim() } } },
        variant.repertoireId,
    );
}

export function moveOpeningLine(
    state: OpeningsState,
    lineId: string,
    targetVariantId: string,
    destinationIndex: number,
): OpeningsState {
    const line = state.lines[lineId];
    const sourceVariant = line ? state.variants[line.variantId] : undefined;
    const targetVariant = state.variants[targetVariantId];
    if (
        !line ||
        !sourceVariant ||
        !targetVariant ||
        sourceVariant.repertoireId !== targetVariant.repertoireId
    ) {
        return state;
    }
    const variants = { ...state.variants };
    const sourceLineIds = sourceVariant.lineIds.filter((id) => id !== lineId);
    const targetLineIds =
        sourceVariant.id === targetVariant.id ? sourceLineIds : [...targetVariant.lineIds];
    targetLineIds.splice(Math.min(Math.max(destinationIndex, 0), targetLineIds.length), 0, lineId);
    variants[sourceVariant.id] = { ...sourceVariant, lineIds: sourceLineIds };
    variants[targetVariant.id] = { ...targetVariant, lineIds: targetLineIds };
    return touchOpeningRepertoire(
        {
            ...state,
            variants,
            lines: { ...state.lines, [lineId]: { ...line, variantId: targetVariantId } },
        },
        targetVariant.repertoireId,
    );
}

export function deleteOpeningLine(state: OpeningsState, lineId: string): OpeningsState {
    const line = state.lines[lineId];
    const variant = line ? state.variants[line.variantId] : undefined;
    if (!line || !variant) return state;
    const lines = { ...state.lines };
    delete lines[lineId];
    return touchOpeningRepertoire(
        {
            ...state,
            lines,
            variants: {
                ...state.variants,
                [variant.id]: {
                    ...variant,
                    lineIds: variant.lineIds.filter((id) => id !== lineId),
                },
            },
        },
        variant.repertoireId,
    );
}

export function deleteOpeningVariant(state: OpeningsState, variantId: string): OpeningsState {
    const variant = state.variants[variantId];
    if (!variant) return state;
    const repertoire = state.repertoires[variant.repertoireId];
    if (!repertoire) return state;
    const variants = { ...state.variants };
    const lines = { ...state.lines };
    delete variants[variantId];
    variant.lineIds.forEach((lineId) => delete lines[lineId]);
    const next = touchOpeningRepertoire(
        {
            ...state,
            variants,
            lines,
            repertoires: {
                ...state.repertoires,
                [repertoire.id]: {
                    ...repertoire,
                    variantIds: repertoire.variantIds.filter((id) => id !== variantId),
                },
            },
        },
        repertoire.id,
    );
    return normalizeOpeningVariantOrder(next, repertoire.id);
}

export function updateOpeningPracticeSettings(
    state: OpeningsState,
    settings: Partial<OpeningsState["settings"]>,
): OpeningsState {
    return { ...state, settings: { ...state.settings, ...settings } };
}

export function recordOpeningMoveAttempt(
    state: OpeningsState,
    lineId: string,
    plyIndex: number,
    success: boolean,
    timeMs: number,
): OpeningsState {
    const line = state.lines[lineId];
    if (!line) return state;
    const key = String(plyIndex);
    const previous = line.moveProgress[key] ?? {
        attempts: 0,
        successes: 0,
        failures: 0,
        totalTimeMs: 0,
        lastAttemptAt: timestamp(),
    };
    const progress: OpeningMoveProgress = {
        attempts: previous.attempts + 1,
        successes: previous.successes + (success ? 1 : 0),
        failures: previous.failures + (success ? 0 : 1),
        totalTimeMs: previous.totalTimeMs + Math.max(0, timeMs),
        lastAttemptAt: timestamp(),
    };
    return {
        ...state,
        lines: {
            ...state.lines,
            [lineId]: { ...line, moveProgress: { ...line.moveProgress, [key]: progress } },
        },
    };
}

export function recordOpeningLineSession(
    state: OpeningsState,
    lineId: string,
    mistakes: number,
    timeMs: number,
): OpeningsState {
    const line = state.lines[lineId];
    if (!line) return state;
    return {
        ...state,
        lines: {
            ...state.lines,
            [lineId]: {
                ...line,
                session: {
                    attempts: line.session.attempts + 1,
                    completions: line.session.completions + 1,
                    flawless: line.session.flawless + (mistakes === 0 ? 1 : 0),
                    totalTimeMs: line.session.totalTimeMs + Math.max(0, timeMs),
                    lastAttemptAt: timestamp(),
                },
            },
        },
    };
}

export type OpeningProgressMetrics = {
    progress: number;
    difficulty: number;
    attempts: number;
};

export function getOpeningLineMetrics(line: OpeningLine): OpeningProgressMetrics {
    const moves = Object.values(line.moveProgress);
    const attempts = moves.reduce((sum, move) => sum + move.attempts, 0);
    if (attempts === 0) return { progress: 0, difficulty: 0, attempts: 0 };
    const progress =
        moves.reduce((sum, move) => sum + move.successes / Math.max(1, move.attempts), 0) /
        moves.length;
    const failures = moves.reduce((sum, move) => sum + move.failures, 0);
    const averageTimeMs = moves.reduce((sum, move) => sum + move.totalTimeMs, 0) / attempts;
    const difficulty = (failures / attempts) * 0.75 + Math.min(1, averageTimeMs / 12_000) * 0.25;
    return {
        progress: Math.round(progress * 100),
        difficulty: Math.round(difficulty * 100),
        attempts,
    };
}

function aggregateOpeningMetrics(metrics: OpeningProgressMetrics[]): OpeningProgressMetrics {
    const attempted = metrics.filter((metric) => metric.attempts > 0);
    if (attempted.length === 0) return { progress: 0, difficulty: 0, attempts: 0 };
    const attempts = attempted.reduce((sum, metric) => sum + metric.attempts, 0);
    return {
        progress: Math.round(
            attempted.reduce((sum, metric) => sum + metric.progress * metric.attempts, 0) /
                attempts,
        ),
        difficulty: Math.round(
            attempted.reduce((sum, metric) => sum + metric.difficulty * metric.attempts, 0) /
                attempts,
        ),
        attempts,
    };
}

export function getOpeningVariantMetrics(
    state: OpeningsState,
    variantId: string,
): OpeningProgressMetrics {
    const variant = state.variants[variantId];
    return aggregateOpeningMetrics(
        (variant?.lineIds ?? []).flatMap((lineId) => {
            const line = state.lines[lineId];
            return line ? [getOpeningLineMetrics(line)] : [];
        }),
    );
}

export function getOpeningRepertoireMetrics(
    state: OpeningsState,
    repertoireId: string,
): OpeningProgressMetrics {
    const repertoire = state.repertoires[repertoireId];
    return aggregateOpeningMetrics(
        (repertoire?.variantIds ?? []).map((variantId) =>
            getOpeningVariantMetrics(state, variantId),
        ),
    );
}

export function automaticOpeningLineGrade(mistakes: number, timeMs: number, plyCount: number) {
    if (mistakes > 0) return mistakes / Math.max(1, plyCount) >= 0.25 ? (1 as const) : (2 as const);
    const averagePlyTime = timeMs / Math.max(1, Math.ceil(plyCount / 2));
    return averagePlyTime <= 4_000
        ? (4 as const)
        : averagePlyTime <= 10_000
          ? (3 as const)
          : (2 as const);
}

export function addEndgameSet(
    state: EndgamesState,
    name: string,
    description: string,
    records: ParsedTrainingRecord[],
    options: { origin?: EndgameSet["origin"] } = {},
): EndgamesState {
    const setId = areaId("endgame-set");
    const createdAt = timestamp();
    const positions = { ...state.positions };
    const positionIds = records.map((record, index) => {
        const id = areaId("endgame");
        positions[id] = {
            id,
            title: record.title || `Final ${index + 1}`,
            fen: record.fen,
            objective: "unknown",
            objectiveSource: "pending",
            theme: inferEndgameTheme(record.title, record.fen),
            sourcePgn: record.sourcePgn,
            progress: {
                attempts: 0,
                successes: 0,
                completed: false,
                totalTimeMs: 0,
                lastOutcome: null,
                lastPlayedAt: null,
            },
            createdAt,
        };
        return id;
    });

    return {
        ...state,
        positions,
        sets: {
            ...state.sets,
            [setId]: {
                id: setId,
                name,
                description,
                positionIds,
                origin: options.origin ?? "user",
                createdAt,
                updatedAt: createdAt,
            },
        },
    };
}

export function installBundledEndgameSets(
    state: EndgamesState,
    bundles: Array<{ name: string; description: string; records: ParsedTrainingRecord[] }>,
    version: number,
): EndgamesState {
    if (state.bundledContentVersion >= version) return state;
    let next = state;
    for (const bundle of bundles) {
        next = addEndgameSet(next, bundle.name, bundle.description, bundle.records, {
            origin: "bundled",
        });
    }
    return { ...next, bundledContentVersion: version };
}

export function updateEndgameObjective(
    state: EndgamesState,
    positionId: string,
    objective: TrainingObjective,
    source: "tablebase" | "stockfish" | "manual",
    category?: string,
): EndgamesState {
    const position = state.positions[positionId];
    if (!position) return state;
    return {
        ...state,
        positions: {
            ...state.positions,
            [positionId]: { ...position, objective, objectiveSource: source, category },
        },
    };
}

export function isEndgameObjectiveMet(
    objective: TrainingObjective,
    outcome: "1-0" | "0-1" | "1/2-1/2" | "*",
    studentColor: "white" | "black",
): boolean | null {
    if (objective === "unknown" || outcome === "*") return null;
    const studentWon =
        (studentColor === "white" && outcome === "1-0") ||
        (studentColor === "black" && outcome === "0-1");
    const actual = studentWon ? 2 : outcome === "1/2-1/2" ? 1 : 0;
    const expected = objective === "win" ? 2 : objective === "draw" ? 1 : 0;
    return actual >= expected;
}

export function recordEndgameAttempt(
    state: EndgamesState,
    positionId: string,
    input: {
        outcome: "1-0" | "0-1" | "1/2-1/2" | "*";
        success: boolean | null;
        timeMs: number;
    },
): EndgamesState {
    const position = state.positions[positionId];
    if (!position) return state;
    return {
        ...state,
        positions: {
            ...state.positions,
            [positionId]: {
                ...position,
                progress: {
                    attempts: position.progress.attempts + 1,
                    successes: position.progress.successes + (input.success ? 1 : 0),
                    completed: position.progress.completed || input.success === true,
                    totalTimeMs: position.progress.totalTimeMs + Math.max(0, input.timeMs),
                    lastOutcome: input.outcome,
                    lastPlayedAt: timestamp(),
                },
            },
        },
    };
}

export function deleteEndgameSet(state: EndgamesState, setId: string): EndgamesState {
    const set = state.sets[setId];
    if (!set || set.origin === "bundled") return state;
    const sets = { ...state.sets };
    const positions = { ...state.positions };
    delete sets[setId];
    set.positionIds.forEach((positionId) => delete positions[positionId]);
    return { ...state, sets, positions };
}

export function getEndgameSetProgress(state: EndgamesState, setId: string) {
    const set = state.sets[setId];
    const positions = (set?.positionIds ?? []).flatMap((id) => {
        const position = state.positions[id];
        return position ? [position] : [];
    });
    const completed = positions.filter((position) => position.progress.completed).length;
    return {
        total: positions.length,
        completed,
        attempted: positions.filter((position) => position.progress.attempts > 0).length,
        percent: positions.length > 0 ? Math.round((completed / positions.length) * 100) : 0,
    };
}

export function getTacticsSetProgress(state: TacticsState, setId: string) {
    const set = state.sets[setId];
    if (!set) {
        return { total: 0, attempted: 0, completed: 0, correct: 0, incorrect: 0, percent: 0 };
    }
    const attempts = state.attempts.filter((attempt) => attempt.setId === setId);
    const total = getTacticsSetSize(set);
    const completed = new Set(
        attempts
            .filter((attempt) => attempt.outcome === "correct")
            .map((attempt) => attempt.exerciseId),
    ).size;
    return {
        total,
        attempted: new Set(attempts.map((attempt) => attempt.exerciseId)).size,
        completed,
        correct: attempts.filter((attempt) => attempt.outcome === "correct").length,
        incorrect: attempts.filter((attempt) => attempt.outcome === "incorrect").length,
        percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
}
