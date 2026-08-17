import type { GoMode } from "@/bindings";
import type { EngineSettings } from "./engines";

export type EnginePlayerPresetId = "custom" | "limited" | "strong" | "reference";

export type EnginePresetDefinition = {
    id: EnginePlayerPresetId;
    label: string;
    description: string;
};

const MCTS_ENGINE_PATTERN = /(?:\blc0\b|\bleela\b)/i;
const MCTS_CUSTOM_NODE_BUDGET = 2_000;

const MCTS_PRESET_NODES: Record<Exclude<EnginePlayerPresetId, "custom">, number> = {
    limited: 500,
    strong: 2_000,
    reference: 8_000,
};

export const ENGINE_PLAYER_PRESETS: EnginePresetDefinition[] = [
    {
        id: "custom",
        label: "Custom configuration",
        description:
            "Keeps the selected options and computation limit as configured; Lc0 Depth is converted to a finite node budget.",
    },
    {
        id: "limited",
        label: "Limited engine",
        description:
            "Requests an ELO through UCI_LimitStrength/UCI_Elo. The value is an engine target, not a Chess Lab calibration.",
    },
    {
        id: "strong",
        label: "Strong engine",
        description:
            "Uses full strength with a moderate reproducible budget; it does not represent a declared human ELO.",
    },
    {
        id: "reference",
        label: "Reference engine",
        description:
            "Uses full strength and a high budget as a superhuman reference, not as a human-like bot.",
    },
];

export function isMctsEngine(engineName = ""): boolean {
    return MCTS_ENGINE_PATTERN.test(engineName);
}

/**
 * Lc0 accepts the UCI depth command, but its MCTS depth is not comparable to
 * alpha-beta depth and can leave a model game waiting indefinitely. Keep the
 * custom setting usable by translating a stale/accidental depth selection to
 * the same conservative node budget used by the strong preset.
 */
export function normalizeEngineGoMode(go: GoMode, engineName = ""): GoMode {
    if (isMctsEngine(engineName) && go.t === "Depth") {
        return { t: "Nodes", c: MCTS_CUSTOM_NODE_BUDGET };
    }
    return go;
}

const PRESET_OVERRIDES: Record<Exclude<EnginePlayerPresetId, "custom">, EngineSettings> = {
    limited: [
        { name: "MultiPV", value: 1 },
        { name: "Threads", value: 1 },
        { name: "Hash", value: 64 },
        { name: "UCI_LimitStrength", value: true },
    ],
    strong: [
        { name: "MultiPV", value: 1 },
        { name: "Threads", value: 1 },
        { name: "Hash", value: 64 },
        { name: "UCI_LimitStrength", value: false },
        { name: "Skill Level", value: 20 },
    ],
    reference: [
        { name: "MultiPV", value: 1 },
        { name: "Threads", value: 1 },
        { name: "Hash", value: 256 },
        { name: "UCI_LimitStrength", value: false },
        { name: "Skill Level", value: 20 },
    ],
};

function upsertSettings(base: EngineSettings, overrides: EngineSettings): EngineSettings {
    const overriddenNames = new Set(overrides.map((option) => option.name));
    return [...base.filter((option) => !overriddenNames.has(option.name)), ...overrides];
}

export function applyEnginePlayerPreset(
    settings: EngineSettings,
    go: GoMode,
    presetId: EnginePlayerPresetId,
    targetElo = 1800,
    engineName = "",
): { settings: EngineSettings; go: GoMode } {
    if (presetId === "custom") {
        return { settings: [...settings], go: normalizeEngineGoMode(go, engineName) };
    }

    const overrides = [...PRESET_OVERRIDES[presetId]];
    if (presetId === "limited") {
        overrides.push({
            name: "UCI_Elo",
            value: Math.max(1320, Math.min(3190, Math.trunc(targetElo))),
        });
    }

    const presetGo: GoMode = isMctsEngine(engineName)
        ? { t: "Nodes", c: MCTS_PRESET_NODES[presetId] }
        : presetId === "reference"
          ? { t: "Depth", c: 24 }
          : presetId === "strong"
            ? { t: "Depth", c: 18 }
            : { t: "Depth", c: 16 };

    return {
        settings: upsertSettings(settings, overrides),
        go: presetGo,
    };
}

export function getEnginePresetNodeBudget(
    presetId: EnginePlayerPresetId,
    engineName = "",
): number | null {
    if (presetId === "custom" || !isMctsEngine(engineName)) return null;
    return MCTS_PRESET_NODES[presetId];
}

export function getEnginePresetDescription(presetId: EnginePlayerPresetId): string {
    return ENGINE_PLAYER_PRESETS.find((preset) => preset.id === presetId)?.description ?? "";
}
