import type { EngineSettings, LocalEngine } from "./engines";
import { RANDOM_SEED_PLACEHOLDER } from "./engines";

export const HUMAN_BOT_CONFIG_VERSION = 6;
export const HUMAN_BOT_CATALOG_VERSION = "4.4.0";
export const HUMAN_BOT_PROFILE_VERSION = 3;
export const HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION = 2;
export const HUMAN_BOT_MODEL_ID = "maia3";

export type HumanBotStyle = "adventurous" | "balanced" | "focused";
export type HumanBotStyleAxisLevel = "low" | "medium" | "high";
export type HumanBotOpeningLineSide = "white" | "black" | "both";
export type HumanBotRepertoireMode = "weighted" | "forcedLine" | "none";

export type HumanBotDecisionStyle = {
    aggression: HumanBotStyleAxisLevel;
    complexity: HumanBotStyleAxisLevel;
};

export type HumanBotOpeningStyle = {
    sharpness: HumanBotStyleAxisLevel;
    theory: HumanBotStyleAxisLevel;
};

export type HumanBotStyleEvidence = "unclassified" | "editorial" | "measured";

export type HumanBotLevel = {
    id: string;
    elo: number;
};

export type HumanBotSamplingStyle = {
    id: string;
    style: HumanBotStyle;
    temperature: number;
    topP: number;
};

export type HumanBotTiming = {
    id: string;
    minThinkTimeMs: number;
    averageThinkTimeMs: number;
    maxThinkTimeMs: number;
    repertoireTimePercent: number;
};

export type HumanBotOpeningLine = {
    id: string;
    moves: readonly string[];
    weight: number;
    side: HumanBotOpeningLineSide;
};

export type HumanBotRepertoire = {
    id: string;
    version: number;
    mode: HumanBotRepertoireMode;
    maxPly: number;
    lines: readonly HumanBotOpeningLine[];
};

export type HumanBotProfile = {
    id: string;
    name: string;
    profileVersion: number;
    levelId: string;
    samplingStyleId: string;
    timingId: string;
    repertoireId: HumanBotRepertoireId;
    elo: number;
    style: HumanBotStyle;
    temperature: number;
    topP: number;
    repertoire: HumanBotRepertoire;
    timing: HumanBotTiming;
    decisionStyle: HumanBotDecisionStyle | null;
    openingStyle: HumanBotOpeningStyle | null;
    styleEvidence: HumanBotStyleEvidence;
};

export type HumanBotOpeningRepertoireConfig = {
    id: string;
    version: number;
    mode: HumanBotRepertoireMode;
    maxPly: number;
    lines: { moves: string[]; weight: number; side: HumanBotOpeningLineSide }[];
};

export type HumanBotTimingConfig = Omit<HumanBotTiming, "id">;

export const HUMAN_BOT_LEVELS = [
    { id: "novice-900", elo: 900 },
    { id: "novice-1050", elo: 1050 },
    { id: "developing-1200", elo: 1200 },
    { id: "developing-1300", elo: 1300 },
    { id: "club-1450", elo: 1450 },
    { id: "club-1500", elo: 1500 },
    { id: "club-1650", elo: 1650 },
    { id: "club-1700", elo: 1700 },
    { id: "club-1800", elo: 1800 },
    { id: "expert-1900", elo: 1900 },
    { id: "expert-2000", elo: 2000 },
    { id: "expert-2100", elo: 2100 },
    { id: "advanced-2200", elo: 2200 },
    { id: "advanced-2300", elo: 2300 },
    { id: "master-2400", elo: 2400 },
] as const satisfies readonly HumanBotLevel[];

export const HUMAN_BOT_SAMPLING_STYLES = [
    { id: "adventurous-wide", style: "adventurous", temperature: 1.25, topP: 0.98 },
    { id: "adventurous", style: "adventurous", temperature: 1.12, topP: 0.96 },
    { id: "balanced", style: "balanced", temperature: 1, topP: 0.94 },
    { id: "balanced-selective", style: "balanced", temperature: 0.92, topP: 0.92 },
    { id: "focused", style: "focused", temperature: 0.82, topP: 0.88 },
    { id: "focused-narrow", style: "focused", temperature: 0.72, topP: 0.84 },
] as const satisfies readonly HumanBotSamplingStyle[];

export const HUMAN_BOT_TIMINGS = [
    {
        id: "casual-fast",
        minThinkTimeMs: 450,
        averageThinkTimeMs: 1200,
        maxThinkTimeMs: 3500,
        repertoireTimePercent: 45,
    },
    {
        id: "casual",
        minThinkTimeMs: 500,
        averageThinkTimeMs: 1450,
        maxThinkTimeMs: 4200,
        repertoireTimePercent: 43,
    },
    {
        id: "steady",
        minThinkTimeMs: 600,
        averageThinkTimeMs: 1750,
        maxThinkTimeMs: 5200,
        repertoireTimePercent: 40,
    },
    {
        id: "deliberate",
        minThinkTimeMs: 650,
        averageThinkTimeMs: 2000,
        maxThinkTimeMs: 6000,
        repertoireTimePercent: 38,
    },
    {
        id: "patient",
        minThinkTimeMs: 700,
        averageThinkTimeMs: 2250,
        maxThinkTimeMs: 6800,
        repertoireTimePercent: 35,
    },
    {
        id: "deep",
        minThinkTimeMs: 750,
        averageThinkTimeMs: 2500,
        maxThinkTimeMs: 7500,
        repertoireTimePercent: 32,
    },
] as const satisfies readonly HumanBotTiming[];

const OPENING_LINES = {
    italian: [
        "e2e4",
        "e7e5",
        "g1f3",
        "b8c6",
        "f1c4",
        "f8c5",
        "c2c3",
        "g8f6",
        "d2d4",
        "e5d4",
        "c3d4",
        "c5b4",
        "b1c3",
        "f6e4",
    ],
    twoKnights: [
        "e2e4",
        "e7e5",
        "g1f3",
        "b8c6",
        "f1c4",
        "g8f6",
        "d2d3",
        "f8c5",
        "e1g1",
        "d7d6",
        "c2c3",
        "e8g8",
    ],
    ruyLopez: [
        "e2e4",
        "e7e5",
        "g1f3",
        "b8c6",
        "f1b5",
        "a7a6",
        "b5a4",
        "g8f6",
        "e1g1",
        "f8e7",
        "f1e1",
        "b7b5",
        "a4b3",
        "d7d6",
        "c2c3",
        "e8g8",
        "h2h3",
    ],
    scotch: [
        "e2e4",
        "e7e5",
        "g1f3",
        "b8c6",
        "d2d4",
        "e5d4",
        "f3d4",
        "g8f6",
        "d4c6",
        "b7c6",
        "e4e5",
        "d8e7",
        "d1e2",
        "f6d5",
    ],
    sicilian: [
        "e2e4",
        "c7c5",
        "g1f3",
        "d7d6",
        "d2d4",
        "c5d4",
        "f3d4",
        "g8f6",
        "b1c3",
        "a7a6",
        "c1e3",
        "g7g6",
        "f2f3",
        "f8g7",
    ],
    sicilianEnglishAttack: [
        "e2e4",
        "c7c5",
        "g1f3",
        "d7d6",
        "d2d4",
        "c5d4",
        "f3d4",
        "g8f6",
        "b1c3",
        "a7a6",
        "c1e3",
        "g7g6",
        "f2f3",
        "f8g7",
    ],
    scandinavian: ["e2e4", "d7d5", "e4d5", "d8d5", "b1c3", "d5d8", "d2d4", "g8f6"],
    caroKann: [
        "e2e4",
        "c7c6",
        "d2d4",
        "d7d5",
        "b1c3",
        "d5e4",
        "c3e4",
        "c8f5",
        "e4g3",
        "f5g6",
        "h2h4",
        "h7h6",
    ],
    french: [
        "e2e4",
        "e7e6",
        "d2d4",
        "d7d5",
        "b1c3",
        "g8f6",
        "e4e5",
        "f6d7",
        "f2f4",
        "c7c5",
        "g1f3",
        "b8c6",
    ],
    queensGambit: [
        "d2d4",
        "d7d5",
        "c2c4",
        "e7e6",
        "b1c3",
        "g8f6",
        "c1g5",
        "f8e7",
        "e2e3",
        "e8g8",
        "g1f3",
        "b8d7",
    ],
    slav: [
        "d2d4",
        "d7d5",
        "c2c4",
        "c7c6",
        "g1f3",
        "g8f6",
        "b1c3",
        "d5c4",
        "a2a4",
        "c8f5",
        "e2e3",
        "e7e6",
    ],
    london: [
        "d2d4",
        "d7d5",
        "g1f3",
        "g8f6",
        "c1f4",
        "e7e6",
        "e2e3",
        "c7c5",
        "c2c3",
        "b8c6",
        "b1d2",
        "f8d6",
    ],
    nimzoIndian: [
        "d2d4",
        "g8f6",
        "c2c4",
        "e7e6",
        "b1c3",
        "f8b4",
        "e2e3",
        "e8g8",
        "f1d3",
        "d7d5",
        "g1f3",
        "c7c5",
    ],
    queensIndian: [
        "d2d4",
        "g8f6",
        "c2c4",
        "e7e6",
        "g1f3",
        "b7b6",
        "g2g3",
        "c8a6",
        "b2b3",
        "f8b4",
        "c1d2",
        "b4e7",
    ],
    kingsIndian: [
        "d2d4",
        "g8f6",
        "c2c4",
        "g7g6",
        "b1c3",
        "f8g7",
        "e2e4",
        "d7d6",
        "g1f3",
        "e8g8",
        "f1e2",
        "e7e5",
    ],
    pirc: ["e2e4", "d7d6", "d2d4", "g8f6", "b1c3", "g7g6", "c1e3", "f8g7", "d1d2", "e8g8"],
    modern: ["e2e4", "g7g6", "d2d4", "f8g7", "b1c3", "d7d6", "c1e3", "c7c6", "d1d2"],
    kingsIndianAttack: [
        "e2e4",
        "e7e6",
        "d2d3",
        "d7d5",
        "b1d2",
        "g8f6",
        "g1f3",
        "f8e7",
        "g2g3",
        "e8g8",
        "f1g2",
    ],
    grunfeld: ["d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "d7d5", "c4d5", "f6d5", "e2e4", "d5c3"],
    english: [
        "c2c4",
        "e7e5",
        "b1c3",
        "g8f6",
        "g2g3",
        "d7d5",
        "c4d5",
        "f6d5",
        "f1g2",
        "d5b6",
        "g1f3",
        "b8c6",
    ],
    reti: [
        "g1f3",
        "d7d5",
        "g2g3",
        "g8f6",
        "f1g2",
        "g7g6",
        "e1g1",
        "f8g7",
        "d2d3",
        "e8g8",
        "b1d2",
        "c7c5",
    ],
} as const;

type OpeningLineId = keyof typeof OPENING_LINES;

function openingLine(
    id: OpeningLineId,
    weight: number,
    side: HumanBotOpeningLineSide = "both",
): HumanBotOpeningLine {
    return { id, moves: OPENING_LINES[id], weight, side };
}

export const HUMAN_BOT_REPERTOIRES = [
    {
        id: "luna-e4-explorer",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "weighted",
        maxPly: 12,
        lines: [
            openingLine("italian", 4, "white"),
            openingLine("scotch", 3, "white"),
            openingLine("french", 2, "black"),
            openingLine("scandinavian", 1, "black"),
        ],
    },
    {
        id: "nico-sicilian-attack",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "weighted",
        maxPly: 14,
        lines: [
            openingLine("italian", 4, "white"),
            openingLine("twoKnights", 4, "white"),
            openingLine("sicilianEnglishAttack", 5, "black"),
        ],
    },
    {
        id: "vera-classical-choices",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "weighted",
        maxPly: 14,
        lines: [
            openingLine("queensGambit", 4, "white"),
            openingLine("london", 3, "white"),
            openingLine("slav", 4, "black"),
        ],
    },
    {
        id: "gabriel-queen-pawn",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "weighted",
        maxPly: 16,
        lines: [
            openingLine("queensGambit", 4, "white"),
            openingLine("london", 4, "white"),
            openingLine("slav", 4, "black"),
            openingLine("queensIndian", 3, "black"),
        ],
    },
    {
        id: "irene-solid-classical",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "weighted",
        maxPly: 16,
        lines: [
            openingLine("queensGambit", 4, "white"),
            openingLine("english", 2, "white"),
            openingLine("caroKann", 5, "black"),
        ],
    },
    {
        id: "leo-flexible-mainlines",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "weighted",
        maxPly: 16,
        lines: [
            openingLine("ruyLopez", 4, "white"),
            openingLine("english", 2, "white"),
            openingLine("sicilian", 4, "black"),
            openingLine("nimzoIndian", 4, "black"),
            openingLine("kingsIndian", 3, "black"),
        ],
    },
    {
        id: "sofia-fixed-starter",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "forcedLine",
        maxPly: 6,
        lines: [openingLine("scandinavian", 1)],
    },
    {
        id: "daniela-french",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "weighted",
        maxPly: 14,
        lines: [openingLine("scotch", 3, "white"), openingLine("french", 5, "black")],
    },
    {
        id: "marcos-maia-natural",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "none",
        maxPly: 0,
        lines: [],
    },
    {
        id: "carlos-london-english",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "weighted",
        maxPly: 16,
        lines: [
            openingLine("london", 5, "white"),
            openingLine("english", 3, "white"),
            openingLine("slav", 4, "black"),
            openingLine("queensIndian", 2, "black"),
        ],
    },
    {
        id: "nelson-indian-defenses",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "weighted",
        maxPly: 16,
        lines: [
            openingLine("queensGambit", 3, "white"),
            openingLine("nimzoIndian", 4, "black"),
            openingLine("queensIndian", 3, "black"),
            openingLine("kingsIndian", 3, "black"),
            openingLine("grunfeld", 2, "black"),
        ],
    },
    {
        id: "mariann-classical-defenses",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "weighted",
        maxPly: 16,
        lines: [
            openingLine("ruyLopez", 3, "white"),
            openingLine("queensGambit", 3, "white"),
            openingLine("french", 4, "black"),
            openingLine("caroKann", 4, "black"),
        ],
    },
    {
        id: "valeria-pirc-modern",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "weighted",
        maxPly: 14,
        lines: [
            openingLine("italian", 3, "white"),
            openingLine("pirc", 4, "black"),
            openingLine("modern", 3, "black"),
        ],
    },
    {
        id: "tomas-kings-indian",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "weighted",
        maxPly: 16,
        lines: [
            openingLine("kingsIndianAttack", 5, "white"),
            openingLine("kingsIndian", 5, "black"),
        ],
    },
    {
        id: "atlas-mainline",
        version: HUMAN_BOT_REPERTOIRE_SCHEMA_VERSION,
        mode: "weighted",
        maxPly: 18,
        lines: [
            openingLine("ruyLopez", 5, "white"),
            openingLine("scotch", 2, "white"),
            openingLine("sicilian", 5, "black"),
            openingLine("nimzoIndian", 4, "black"),
            openingLine("grunfeld", 3, "black"),
        ],
    },
] as const satisfies readonly HumanBotRepertoire[];

type HumanBotLevelId = (typeof HUMAN_BOT_LEVELS)[number]["id"];
type HumanBotSamplingStyleId = (typeof HUMAN_BOT_SAMPLING_STYLES)[number]["id"];
type HumanBotTimingId = (typeof HUMAN_BOT_TIMINGS)[number]["id"];
export type HumanBotRepertoireId = (typeof HUMAN_BOT_REPERTOIRES)[number]["id"];

const HUMAN_BOT_PROFILE_DEFINITIONS = [
    {
        id: "luna",
        name: "Luna",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "novice-900",
        samplingStyleId: "adventurous-wide",
        timingId: "casual-fast",
        repertoireId: "luna-e4-explorer",
        decisionStyle: { aggression: "high", complexity: "high" },
        openingStyle: { sharpness: "medium", theory: "low" },
        styleEvidence: "editorial",
    },
    {
        id: "daniela",
        name: "Daniela",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "developing-1300",
        samplingStyleId: "adventurous",
        timingId: "casual",
        repertoireId: "daniela-french",
        decisionStyle: { aggression: "medium", complexity: "high" },
        openingStyle: { sharpness: "medium", theory: "medium" },
        styleEvidence: "editorial",
    },
    {
        id: "nico",
        name: "Nico",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "developing-1200",
        samplingStyleId: "adventurous",
        timingId: "casual",
        repertoireId: "nico-sicilian-attack",
        decisionStyle: { aggression: "high", complexity: "high" },
        openingStyle: { sharpness: "high", theory: "low" },
        styleEvidence: "editorial",
    },
    {
        id: "sofia",
        name: "Sofía",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "novice-1050",
        samplingStyleId: "adventurous-wide",
        timingId: "casual",
        repertoireId: "sofia-fixed-starter",
        decisionStyle: { aggression: "high", complexity: "medium" },
        openingStyle: { sharpness: "medium", theory: "low" },
        styleEvidence: "editorial",
    },
    {
        id: "gabriel",
        name: "Gabriel",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "club-1700",
        samplingStyleId: "balanced-selective",
        timingId: "deliberate",
        repertoireId: "gabriel-queen-pawn",
        decisionStyle: { aggression: "low", complexity: "low" },
        openingStyle: { sharpness: "low", theory: "medium" },
        styleEvidence: "editorial",
    },
    {
        id: "vera",
        name: "Vera",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "club-1500",
        samplingStyleId: "balanced",
        timingId: "steady",
        repertoireId: "vera-classical-choices",
        decisionStyle: { aggression: "medium", complexity: "medium" },
        openingStyle: { sharpness: "medium", theory: "medium" },
        styleEvidence: "editorial",
    },
    {
        id: "carlos",
        name: "Carlos",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "club-1650",
        samplingStyleId: "balanced-selective",
        timingId: "deliberate",
        repertoireId: "carlos-london-english",
        decisionStyle: { aggression: "medium", complexity: "high" },
        openingStyle: { sharpness: "medium", theory: "high" },
        styleEvidence: "editorial",
    },
    {
        id: "marcos",
        name: "Marcos",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "club-1450",
        samplingStyleId: "balanced",
        timingId: "steady",
        repertoireId: "marcos-maia-natural",
        decisionStyle: { aggression: "medium", complexity: "medium" },
        openingStyle: { sharpness: "medium", theory: "low" },
        styleEvidence: "editorial",
    },
    {
        id: "nelson",
        name: "Nelson",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "club-1800",
        samplingStyleId: "balanced-selective",
        timingId: "deliberate",
        repertoireId: "nelson-indian-defenses",
        decisionStyle: { aggression: "high", complexity: "high" },
        openingStyle: { sharpness: "high", theory: "high" },
        styleEvidence: "editorial",
    },
    {
        id: "irene",
        name: "Irene",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "expert-1900",
        samplingStyleId: "focused",
        timingId: "patient",
        repertoireId: "irene-solid-classical",
        decisionStyle: { aggression: "low", complexity: "low" },
        openingStyle: { sharpness: "low", theory: "high" },
        styleEvidence: "editorial",
    },
    {
        id: "mariann",
        name: "Mariann",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "expert-2000",
        samplingStyleId: "focused",
        timingId: "patient",
        repertoireId: "mariann-classical-defenses",
        decisionStyle: { aggression: "low", complexity: "medium" },
        openingStyle: { sharpness: "low", theory: "high" },
        styleEvidence: "editorial",
    },
    {
        id: "valeria",
        name: "Valeria",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "expert-2100",
        samplingStyleId: "focused",
        timingId: "patient",
        repertoireId: "valeria-pirc-modern",
        decisionStyle: { aggression: "high", complexity: "high" },
        openingStyle: { sharpness: "high", theory: "medium" },
        styleEvidence: "editorial",
    },
    {
        id: "leo",
        name: "Leo",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "advanced-2200",
        samplingStyleId: "focused-narrow",
        timingId: "deep",
        repertoireId: "leo-flexible-mainlines",
        decisionStyle: { aggression: "medium", complexity: "medium" },
        openingStyle: { sharpness: "medium", theory: "high" },
        styleEvidence: "editorial",
    },
    {
        id: "tomas",
        name: "Tomás",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "advanced-2300",
        samplingStyleId: "focused-narrow",
        timingId: "deep",
        repertoireId: "tomas-kings-indian",
        decisionStyle: { aggression: "medium", complexity: "high" },
        openingStyle: { sharpness: "medium", theory: "high" },
        styleEvidence: "editorial",
    },
    {
        id: "atlas",
        name: "Atlas",
        profileVersion: HUMAN_BOT_PROFILE_VERSION,
        levelId: "master-2400",
        samplingStyleId: "focused-narrow",
        timingId: "deep",
        repertoireId: "atlas-mainline",
        decisionStyle: { aggression: "medium", complexity: "medium" },
        openingStyle: { sharpness: "high", theory: "high" },
        styleEvidence: "editorial",
    },
] as const satisfies readonly {
    id: string;
    name: string;
    profileVersion: number;
    levelId: HumanBotLevelId;
    samplingStyleId: HumanBotSamplingStyleId;
    timingId: HumanBotTimingId;
    repertoireId: HumanBotRepertoireId;
    decisionStyle: HumanBotDecisionStyle | null;
    openingStyle: HumanBotOpeningStyle | null;
    styleEvidence: HumanBotStyleEvidence;
}[];

export type HumanBotProfileId = (typeof HUMAN_BOT_PROFILE_DEFINITIONS)[number]["id"];

function resolveHumanBotProfile(
    definition: (typeof HUMAN_BOT_PROFILE_DEFINITIONS)[number],
): HumanBotProfile {
    const level = HUMAN_BOT_LEVELS.find((candidate) => candidate.id === definition.levelId)!;
    const style = HUMAN_BOT_SAMPLING_STYLES.find(
        (candidate) => candidate.id === definition.samplingStyleId,
    )!;
    const repertoire = HUMAN_BOT_REPERTOIRES.find(
        (candidate) => candidate.id === definition.repertoireId,
    )!;
    const timing = HUMAN_BOT_TIMINGS.find((candidate) => candidate.id === definition.timingId)!;

    return {
        ...definition,
        elo: level.elo,
        style: style.style,
        temperature: style.temperature,
        topP: style.topP,
        repertoire,
        timing,
    };
}

export const HUMAN_BOT_PROFILES: readonly HumanBotProfile[] = HUMAN_BOT_PROFILE_DEFINITIONS.map(
    resolveHumanBotProfile,
).sort((left, right) => left.elo - right.elo);

export const DEFAULT_HUMAN_BOT_PROFILE_ID: HumanBotProfileId = "vera";

export const MAIA_ELO_MIN = 600;
export const MAIA_ELO_MAX = 2600;
export const DEFAULT_MAIA_ELO = 1500;

export function clampMaiaElo(value: number): number {
    return Math.max(MAIA_ELO_MIN, Math.min(MAIA_ELO_MAX, Math.trunc(value)));
}

export function buildMaiaEngineSettings(
    elo: number,
    baseSettings: EngineSettings = [],
): EngineSettings {
    const maiaOptionNames = new Set([
        "Elo",
        "SelfElo",
        "OppoElo",
        "Temperature",
        "TopP",
        "MultiPV",
    ]);
    const preservedSettings = baseSettings.filter((setting) => maiaOptionNames.has(setting.name));

    return [
        ...preservedSettings.filter(
            (setting) => setting.name !== "Elo" && setting.name !== "MultiPV",
        ),
        { name: "Elo", value: clampMaiaElo(elo) },
        { name: "MultiPV", value: 1 },
    ];
}

export function getHumanBotProfile(profileId: string | null | undefined): HumanBotProfile {
    return (
        HUMAN_BOT_PROFILES.find((profile) => profile.id === profileId) ??
        HUMAN_BOT_PROFILES.find((profile) => profile.id === DEFAULT_HUMAN_BOT_PROFILE_ID)!
    );
}

export function buildHumanBotOpeningRepertoire(
    profile: HumanBotProfile,
): HumanBotOpeningRepertoireConfig {
    return {
        id: profile.repertoire.id,
        version: profile.repertoire.version,
        mode: profile.repertoire.mode,
        maxPly: profile.repertoire.maxPly,
        lines: profile.repertoire.lines.map((line) => ({
            moves: [...line.moves],
            weight: line.weight,
            side: line.side,
        })),
    };
}

export function buildHumanBotTiming(profile: HumanBotProfile): HumanBotTimingConfig {
    return {
        minThinkTimeMs: profile.timing.minThinkTimeMs,
        averageThinkTimeMs: profile.timing.averageThinkTimeMs,
        maxThinkTimeMs: profile.timing.maxThinkTimeMs,
        repertoireTimePercent: profile.timing.repertoireTimePercent,
    };
}

export function buildHumanBotTraceHeaders(
    profile: HumanBotProfile,
    color: "White" | "Black",
    humanTiming = true,
    modelVersion = "",
): Record<string, string> {
    return {
        [`${color}BotProfile`]: profile.id,
        [`${color}BotProfileVersion`]: profile.profileVersion.toString(),
        [`${color}BotCatalogVersion`]: HUMAN_BOT_CATALOG_VERSION,
        [`${color}BotLevel`]: profile.levelId,
        [`${color}BotStyle`]: profile.style,
        [`${color}BotStyleEvidence`]: profile.styleEvidence,
        [`${color}BotAggression`]: profile.decisionStyle?.aggression ?? "unclassified",
        [`${color}BotComplexity`]: profile.decisionStyle?.complexity ?? "unclassified",
        [`${color}BotOpeningSharpness`]: profile.openingStyle?.sharpness ?? "unclassified",
        [`${color}BotOpeningTheory`]: profile.openingStyle?.theory ?? "unclassified",
        [`${color}BotSampling`]: profile.samplingStyleId,
        [`${color}BotTiming`]: humanTiming ? profile.timingId : "disabled",
        [`${color}BotRepertoire`]: profile.repertoireId,
        [`${color}BotRepertoireVersion`]: profile.repertoire.version.toString(),
        [`${color}BotRepertoireMode`]: profile.repertoire.mode,
        [`${color}BotModel`]: HUMAN_BOT_MODEL_ID,
        [`${color}BotModelVersion`]: modelVersion || "unknown",
        [`${color}BotTemperature`]: profile.temperature.toString(),
        [`${color}BotTopP`]: profile.topP.toString(),
    };
}

export function isMaiaEngine(engine: LocalEngine): boolean {
    const identity = `${engine.name} ${engine.path}`.toLowerCase();
    return (
        identity.includes("maia3") ||
        identity.includes("maia 3") ||
        (engine.args ?? []).some(
            (arg) => arg === "--use-uci-history" || arg === "--use_uci_history",
        )
    );
}

export function buildHumanBotEngineArgs(args: readonly string[]): string[] {
    const result = [...args];
    const usesHistory = result.some(
        (arg) => arg === "--use-uci-history" || arg === "--use_uci_history",
    );
    const hasSeed = result.some((arg) => arg === "--seed" || arg.startsWith("--seed="));

    if (!usesHistory) {
        result.push("--use-uci-history");
    }
    if (!hasSeed) {
        result.push("--seed", RANDOM_SEED_PLACEHOLDER);
    }

    return result;
}

export function buildHumanBotEngineSettings(
    profile: HumanBotProfile,
    opponentElo: number,
    baseSettings: EngineSettings = [],
): EngineSettings {
    const controlledOptions = new Set([
        "Elo",
        "SelfElo",
        "OppoElo",
        "Temperature",
        "TopP",
        "MultiPV",
    ]);
    const preservedSettings = baseSettings.filter(
        (setting) => !controlledOptions.has(setting.name),
    );

    return [
        ...preservedSettings,
        { name: "Elo", value: profile.elo },
        { name: "SelfElo", value: profile.elo },
        { name: "OppoElo", value: opponentElo },
        { name: "Temperature", value: profile.temperature },
        { name: "TopP", value: profile.topP },
        { name: "MultiPV", value: 1 },
    ];
}
