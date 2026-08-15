import type { EngineSettings, LocalEngine } from "./engines";
import { RANDOM_SEED_PLACEHOLDER } from "./engines";

export type HumanBotStyle = "adventurous" | "balanced" | "focused";

export type HumanBotProfile = {
    id: string;
    name: string;
    elo: number;
    style: HumanBotStyle;
    temperature: number;
    topP: number;
};

export const HUMAN_BOT_PROFILES = [
    {
        id: "luna",
        name: "Luna",
        elo: 900,
        style: "adventurous",
        temperature: 1.25,
        topP: 0.98,
    },
    {
        id: "nico",
        name: "Nico",
        elo: 1200,
        style: "adventurous",
        temperature: 1.12,
        topP: 0.96,
    },
    {
        id: "vera",
        name: "Vera",
        elo: 1500,
        style: "balanced",
        temperature: 1,
        topP: 0.94,
    },
    {
        id: "marcos",
        name: "Marcos",
        elo: 1700,
        style: "balanced",
        temperature: 0.92,
        topP: 0.92,
    },
    {
        id: "irene",
        name: "Irene",
        elo: 1900,
        style: "focused",
        temperature: 0.82,
        topP: 0.88,
    },
    {
        id: "leo",
        name: "Leo",
        elo: 2200,
        style: "focused",
        temperature: 0.72,
        topP: 0.84,
    },
] as const satisfies readonly HumanBotProfile[];

export type HumanBotProfileId = (typeof HUMAN_BOT_PROFILES)[number]["id"];

export const DEFAULT_HUMAN_BOT_PROFILE_ID: HumanBotProfileId = "vera";

export function getHumanBotProfile(profileId: string | null | undefined): HumanBotProfile {
    return (
        HUMAN_BOT_PROFILES.find((profile) => profile.id === profileId) ??
        HUMAN_BOT_PROFILES.find((profile) => profile.id === DEFAULT_HUMAN_BOT_PROFILE_ID)!
    );
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
