import { describe, expect, it } from "vitest";
import { applyEnginePlayerPreset, normalizeEngineGoMode } from "../enginePresets";

describe("engine player presets", () => {
    it("preserves unrelated options while applying the reference preset", () => {
        const result = applyEnginePlayerPreset(
            [
                { name: "EvalFile", value: "nnue.bin" },
                { name: "MultiPV", value: 8 },
                { name: "Hash", value: 16 },
            ],
            { t: "Depth", c: 10 },
            "reference",
        );

        expect(result).toEqual({
            settings: [
                { name: "EvalFile", value: "nnue.bin" },
                { name: "MultiPV", value: 1 },
                { name: "Threads", value: 1 },
                { name: "Hash", value: 256 },
                { name: "UCI_LimitStrength", value: false },
                { name: "Skill Level", value: 20 },
            ],
            go: { t: "Depth", c: 24 },
        });
    });

    it("clamps the requested limited-engine ELO to the supported Stockfish range", () => {
        const low = applyEnginePlayerPreset([], { t: "Depth", c: 1 }, "limited", 900);
        const high = applyEnginePlayerPreset([], { t: "Depth", c: 1 }, "limited", 4000);

        expect(low.settings.find((option) => option.name === "UCI_Elo")?.value).toBe(1320);
        expect(high.settings.find((option) => option.name === "UCI_Elo")?.value).toBe(3190);
        expect(low.settings.find((option) => option.name === "UCI_LimitStrength")?.value).toBe(
            true,
        );
    });

    it("does not rewrite custom settings", () => {
        const settings = [{ name: "Hash", value: 32 }];
        expect(applyEnginePlayerPreset(settings, { t: "Nodes", c: 1000 }, "custom", 1800)).toEqual({
            settings,
            go: { t: "Nodes", c: 1000 },
        });
    });

    it("converts custom Lc0 depth settings to a finite node budget", () => {
        expect(normalizeEngineGoMode({ t: "Depth", c: 18 }, "Lc0 v0.32.1")).toEqual({
            t: "Nodes",
            c: 2_000,
        });
        expect(
            applyEnginePlayerPreset([], { t: "Depth", c: 18 }, "custom", 1800, "Leela Chess Zero")
                .go,
        ).toEqual({ t: "Nodes", c: 2_000 });
    });

    it("uses bounded node budgets for Lc0 instead of alpha-beta depths", () => {
        expect(
            applyEnginePlayerPreset([], { t: "Depth", c: 1 }, "limited", 1800, "Lc0 v0.32.1").go,
        ).toEqual({ t: "Nodes", c: 500 });
        expect(
            applyEnginePlayerPreset([], { t: "Depth", c: 1 }, "strong", 1800, "Leela Chess Zero")
                .go,
        ).toEqual({ t: "Nodes", c: 2_000 });
        expect(
            applyEnginePlayerPreset([], { t: "Depth", c: 1 }, "reference", 1800, "Stockfish").go,
        ).toEqual({ t: "Depth", c: 24 });
    });
});
