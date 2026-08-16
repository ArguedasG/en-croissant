import { describe, expect, it } from "vitest";
import { Chess, parseUci } from "chessops";
import {
    buildHumanBotEngineArgs,
    buildHumanBotEngineSettings,
    buildHumanBotOpeningRepertoire,
    buildHumanBotTiming,
    buildHumanBotTraceHeaders,
    DEFAULT_HUMAN_BOT_PROFILE_ID,
    getHumanBotProfile,
    HUMAN_BOT_LEVELS,
    HUMAN_BOT_PROFILES,
    HUMAN_BOT_REPERTOIRES,
    HUMAN_BOT_SAMPLING_STYLES,
    HUMAN_BOT_TIMINGS,
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
            expect(HUMAN_BOT_LEVELS.some((level) => level.id === profile.levelId)).toBe(true);
            expect(
                HUMAN_BOT_SAMPLING_STYLES.some((style) => style.id === profile.samplingStyleId),
            ).toBe(true);
            expect(
                HUMAN_BOT_REPERTOIRES.some((repertoire) => repertoire.id === profile.repertoireId),
            ).toBe(true);
            expect(HUMAN_BOT_TIMINGS.some((timing) => timing.id === profile.timingId)).toBe(true);
        }
    });

    it("keeps every opening line legal from the initial position", () => {
        for (const repertoire of HUMAN_BOT_REPERTOIRES) {
            expect(repertoire.lines.length).toBeGreaterThan(0);

            for (const line of repertoire.lines) {
                const position = Chess.default();
                expect(line.weight).toBeGreaterThan(0);

                for (const uci of line.moves) {
                    const move = parseUci(uci);
                    if (!move) {
                        throw new Error(`${repertoire.id}/${line.id}: invalid UCI ${uci}`);
                    }
                    if (!position.isLegal(move)) {
                        throw new Error(`${repertoire.id}/${line.id}: illegal move ${uci}`);
                    }
                    position.play(move);
                }
            }
        }
    });

    it("builds a backend repertoire without exposing mutable catalog arrays", () => {
        const profile = getHumanBotProfile("marcos");
        const config = buildHumanBotOpeningRepertoire(profile);

        expect(config.id).toBe("marcos-queen-pawn");
        expect(config.maxPly).toBe(16);
        expect(config.lines).toHaveLength(profile.repertoire.lines.length);
        expect(config.lines[0].moves).toEqual(profile.repertoire.lines[0].moves);
        expect(config.lines[0].moves).not.toBe(profile.repertoire.lines[0].moves);
    });

    it("creates traceable PGN metadata for each bot component", () => {
        const luna = getHumanBotProfile("luna");
        expect(buildHumanBotTraceHeaders(luna, "Black", true)).toEqual({
            BlackBotProfile: "luna",
            BlackBotLevel: "novice-900",
            BlackBotStyle: "adventurous",
            BlackBotSampling: "adventurous-wide",
            BlackBotTiming: "casual-fast",
            BlackBotRepertoire: "luna-variety",
            BlackBotTemperature: "1.25",
            BlackBotTopP: "0.98",
        });
        expect(buildHumanBotTiming(luna)).toEqual({
            minThinkTimeMs: 450,
            averageThinkTimeMs: 1200,
            maxThinkTimeMs: 3500,
            repertoireTimePercent: 45,
        });
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
