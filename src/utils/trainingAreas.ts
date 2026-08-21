import { z } from "zod";
import { getMainLine, parsePGN } from "@/utils/chess";
import { positionFromFen } from "@/utils/chessops";
import { getGameName } from "@/utils/treeReducer";

export const TRAINING_AREAS_SCHEMA_VERSION = 4;
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

const tacticsSetSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    exerciseIds: z.array(z.string()),
    source: tacticsSourceSchema.optional(),
    config: z.object({
        acceptanceThresholdCp: z.number().nonnegative(),
        mode: z.enum(["guided", "woodpecker"]),
        maxFailuresPerCycle: z.number().int().positive(),
        timeLimitSeconds: z.number().int().positive().nullable(),
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
    createdAt: z.string(),
});
export type TacticsAttempt = z.infer<typeof tacticsAttemptSchema>;

const tacticsStateSchema = z.object({
    sets: z.record(tacticsSetSchema),
    exercises: z.record(tacticsExerciseSchema),
    attempts: z.array(tacticsAttemptSchema),
});
export type TacticsState = z.infer<typeof tacticsStateSchema>;

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
});
export type OpeningsState = z.infer<typeof openingsStateSchema>;

const endgamePositionSchema = z.object({
    id: z.string(),
    title: z.string(),
    fen: z.string(),
    objective: trainingObjectiveSchema,
    objectiveSource: z.enum(["pending", "tablebase", "stockfish", "manual"]),
    category: z.string().optional(),
    sourcePgn: z.string().optional(),
    createdAt: z.string(),
});
export type EndgamePosition = z.infer<typeof endgamePositionSchema>;

const endgameSetSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    positionIds: z.array(z.string()),
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
            schemaVersion: TRAINING_AREAS_SCHEMA_VERSION,
            endgames: { ...endgames, bundledContentVersion: 0 },
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
        openings: { repertoires: {}, variants: {}, lines: {} },
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
                config: {
                    acceptanceThresholdCp: TACTICS_ACCEPTANCE_THRESHOLD_CP,
                    mode: "guided",
                    maxFailuresPerCycle: 3,
                    timeLimitSeconds: null,
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

export function addEndgameSet(
    state: EndgamesState,
    name: string,
    description: string,
    records: ParsedTrainingRecord[],
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
            sourcePgn: record.sourcePgn,
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
        next = addEndgameSet(next, bundle.name, bundle.description, bundle.records);
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

export function getTacticsSetProgress(state: TacticsState, setId: string) {
    const set = state.sets[setId];
    if (!set) return { total: 0, attempted: 0, correct: 0, incorrect: 0 };
    const attempts = state.attempts.filter((attempt) => attempt.setId === setId);
    return {
        total: getTacticsSetSize(set),
        attempted: new Set(attempts.map((attempt) => attempt.exerciseId)).size,
        correct: attempts.filter((attempt) => attempt.outcome === "correct").length,
        incorrect: attempts.filter((attempt) => attempt.outcome === "incorrect").length,
    };
}
