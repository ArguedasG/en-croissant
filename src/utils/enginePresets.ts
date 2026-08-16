import type { GoMode } from "@/bindings";
import type { EngineSettings } from "./engines";

export type EnginePlayerPresetId = "custom" | "limited" | "strong" | "reference";

export type EnginePresetDefinition = {
    id: EnginePlayerPresetId;
    label: string;
    description: string;
};

export const ENGINE_PLAYER_PRESETS: EnginePresetDefinition[] = [
    {
        id: "custom",
        label: "Custom configuration",
        description: "Keeps the selected options and computation limit exactly as configured.",
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
): { settings: EngineSettings; go: GoMode } {
    if (presetId === "custom") {
        return { settings: [...settings], go };
    }

    const overrides = [...PRESET_OVERRIDES[presetId]];
    if (presetId === "limited") {
        overrides.push({
            name: "UCI_Elo",
            value: Math.max(1320, Math.min(3190, Math.trunc(targetElo))),
        });
    }

    const presetGo: GoMode =
        presetId === "reference"
            ? { t: "Depth", c: 24 }
            : presetId === "strong"
              ? { t: "Depth", c: 18 }
              : { t: "Depth", c: 16 };

    return {
        settings: upsertSettings(settings, overrides),
        go: presetGo,
    };
}

export function getEnginePresetDescription(presetId: EnginePlayerPresetId): string {
    return ENGINE_PLAYER_PRESETS.find((preset) => preset.id === presetId)?.description ?? "";
}
