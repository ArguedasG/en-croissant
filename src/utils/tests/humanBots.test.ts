import { describe, expect, it } from "vitest";
import {
    buildHumanBotEngineArgs,
    buildHumanBotEngineSettings,
    DEFAULT_HUMAN_BOT_PROFILE_ID,
    getHumanBotProfile,
    HUMAN_BOT_PROFILES,
    isMaiaEngine,
} from "../humanBots";

describe("human bot profiles", () => {
    it("has unique identifiers and valid sampling values", () => {
        expect(new Set(HUMAN_BOT_PROFILES.map((profile) => profile.id)).size).toBe(
            HUMAN_BOT_PROFILES.length,
        );

        for (const profile of HUMAN_BOT_PROFILES) {
            expect(profile.elo).toBeGreaterThan(0);
            expect(profile.temperature).toBeGreaterThan(0);
            expect(profile.topP).toBeGreaterThan(0);
            expect(profile.topP).toBeLessThanOrEqual(1);
        }
    });

    it("falls back to the default profile for an unknown identifier", () => {
        expect(getHumanBotProfile("missing").id).toBe(DEFAULT_HUMAN_BOT_PROFILE_ID);
    });

    it("overrides Maia options while preserving unrelated engine settings", () => {
        const profile = getHumanBotProfile("luna");
        const settings = buildHumanBotEngineSettings(profile, 1500, [
            { name: "Hash", value: 128 },
            { name: "Temperature", value: 0 },
            { name: "MultiPV", value: 9 },
        ]);

        expect(settings).toEqual([
            { name: "Hash", value: 128 },
            { name: "Elo", value: 900 },
            { name: "SelfElo", value: 900 },
            { name: "OppoElo", value: 1500 },
            { name: "Temperature", value: 1.25 },
            { name: "TopP", value: 0.98 },
            { name: "MultiPV", value: 1 },
        ]);
    });

    it("adds history and a random seed without duplicating existing arguments", () => {
        expect(buildHumanBotEngineArgs(["--device", "cpu"])).toEqual([
            "--device",
            "cpu",
            "--use-uci-history",
            "--seed",
            "{{randomSeed}}",
        ]);
        expect(
            buildHumanBotEngineArgs(["--use_uci_history", "--seed=7", "--device", "cpu"]),
        ).toEqual(["--use_uci_history", "--seed=7", "--device", "cpu"]);
    });

    it("recognizes Maia registrations by executable identity or history argument", () => {
        const baseEngine = {
            type: "local" as const,
            id: "engine",
            version: "",
            loaded: true,
        };

        expect(
            isMaiaEngine({
                ...baseEngine,
                name: "Maia3 5M",
                path: "engine.exe",
                args: [],
            }),
        ).toBe(true);
        expect(
            isMaiaEngine({
                ...baseEngine,
                name: "Custom human engine",
                path: "engine.exe",
                args: ["--use-uci-history"],
            }),
        ).toBe(true);
        expect(
            isMaiaEngine({
                ...baseEngine,
                name: "Stockfish",
                path: "stockfish.exe",
                args: [],
            }),
        ).toBe(false);
    });
});
