import type { EngineSettings, LocalEngine } from "./engines";
import { RANDOM_SEED_PLACEHOLDER } from "./engines";

export type HumanBotStyle = "adventurous" | "balanced" | "focused";

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
};

export type HumanBotRepertoire = {
    id: string;
    maxPly: number;
    lines: readonly HumanBotOpeningLine[];
};

export type HumanBotProfile = {
    id: string;
    name: string;
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
};

export type HumanBotOpeningRepertoireConfig = {
    id: string;
    maxPly: number;
    lines: { moves: string[]; weight: number }[];
};

export type HumanBotTimingConfig = Omit<HumanBotTiming, "id">;

export const HUMAN_BOT_LEVELS = [
    { id: "novice-900", elo: 900 },
    { id: "developing-1200", elo: 1200 },
    { id: "club-1500", elo: 1500 },
    { id: "club-1700", elo: 1700 },
    { id: "expert-1900", elo: 1900 },
    { id: "advanced-2200", elo: 2200 },
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

function openingLine(id: OpeningLineId, weight: number): HumanBotOpeningLine {
    return { id, moves: OPENING_LINES[id], weight };
}

export const HUMAN_BOT_REPERTOIRES = [
    {
        id: "luna-variety",
        maxPly: 12,
        lines: [
            openingLine("italian", 5),
            openingLine("twoKnights", 5),
            openingLine("scotch", 4),
            openingLine("ruyLopez", 2),
            openingLine("sicilian", 2),
            openingLine("london", 2),
        ],
    },
    {
        id: "nico-open-games",
        maxPly: 14,
        lines: [
            openingLine("italian", 4),
            openingLine("twoKnights", 4),
            openingLine("scotch", 4),
            openingLine("ruyLopez", 3),
            openingLine("sicilian", 3),
            openingLine("caroKann", 2),
            openingLine("queensGambit", 1),
        ],
    },
    {
        id: "vera-classical-mix",
        maxPly: 14,
        lines: [
            openingLine("italian", 3),
            openingLine("ruyLopez", 4),
            openingLine("queensGambit", 4),
            openingLine("slav", 3),
            openingLine("english", 2),
            openingLine("caroKann", 2),
        ],
    },
    {
        id: "marcos-queen-pawn",
        maxPly: 16,
        lines: [
            openingLine("queensGambit", 5),
            openingLine("slav", 4),
            openingLine("nimzoIndian", 4),
            openingLine("queensIndian", 3),
            openingLine("london", 2),
            openingLine("ruyLopez", 2),
        ],
    },
    {
        id: "irene-solid-classical",
        maxPly: 16,
        lines: [
            openingLine("queensGambit", 4),
            openingLine("nimzoIndian", 4),
            openingLine("caroKann", 4),
            openingLine("french", 3),
            openingLine("ruyLopez", 3),
            openingLine("kingsIndian", 2),
        ],
    },
    {
        id: "leo-flexible-mainlines",
        maxPly: 16,
        lines: [
            openingLine("ruyLopez", 4),
            openingLine("sicilian", 5),
            openingLine("nimzoIndian", 4),
            openingLine("kingsIndian", 3),
            openingLine("english", 3),
            openingLine("reti", 2),
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
        levelId: "novice-900",
        samplingStyleId: "adventurous-wide",
        timingId: "casual-fast",
        repertoireId: "luna-variety",
    },
    {
        id: "nico",
        name: "Nico",
        levelId: "developing-1200",
        samplingStyleId: "adventurous",
        timingId: "casual",
        repertoireId: "nico-open-games",
    },
    {
        id: "vera",
        name: "Vera",
        levelId: "club-1500",
        samplingStyleId: "balanced",
        timingId: "steady",
        repertoireId: "vera-classical-mix",
    },
    {
        id: "marcos",
        name: "Marcos",
        levelId: "club-1700",
        samplingStyleId: "balanced-selective",
        timingId: "deliberate",
        repertoireId: "marcos-queen-pawn",
    },
    {
        id: "irene",
        name: "Irene",
        levelId: "expert-1900",
        samplingStyleId: "focused",
        timingId: "patient",
        repertoireId: "irene-solid-classical",
    },
    {
        id: "leo",
        name: "Leo",
        levelId: "advanced-2200",
        samplingStyleId: "focused-narrow",
        timingId: "deep",
        repertoireId: "leo-flexible-mainlines",
    },
] as const satisfies readonly {
    id: string;
    name: string;
    levelId: HumanBotLevelId;
    samplingStyleId: HumanBotSamplingStyleId;
    timingId: HumanBotTimingId;
    repertoireId: HumanBotRepertoireId;
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

export const HUMAN_BOT_PROFILES: readonly HumanBotProfile[] =
    HUMAN_BOT_PROFILE_DEFINITIONS.map(resolveHumanBotProfile);

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
        maxPly: profile.repertoire.maxPly,
        lines: profile.repertoire.lines.map((line) => ({
            moves: [...line.moves],
            weight: line.weight,
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
): Record<string, string> {
    return {
        [`${color}BotProfile`]: profile.id,
        [`${color}BotLevel`]: profile.levelId,
        [`${color}BotStyle`]: profile.style,
        [`${color}BotSampling`]: profile.samplingStyleId,
        [`${color}BotTiming`]: humanTiming ? profile.timingId : "disabled",
        [`${color}BotRepertoire`]: profile.repertoireId,
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
