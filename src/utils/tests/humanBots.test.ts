import { describe, expect, it } from "vitest";
import { Chess, parseUci } from "chessops";
import {
    buildMaiaEngineSettings,
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
        expect(HUMAN_BOT_PROFILES).toHaveLength(15);
        expect(new Set(HUMAN_BOT_PROFILES.map((profile) => profile.id)).size).toBe(
            HUMAN_BOT_PROFILES.length,
        );

        for (const profile of HUMAN_BOT_PROFILES) {
            expect(profile.elo).toBeGreaterThan(0);
            expect(profile.profileVersion).toBe(3);
            expect(profile.repertoire.version).toBe(2);
            expect(["weighted", "forcedLine", "none"]).toContain(profile.repertoire.mode);
            expect(profile.decisionStyle).not.toBeNull();
            expect(profile.openingStyle).not.toBeNull();
            expect(profile.styleEvidence).toBe("editorial");
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

    it("keeps the approved editorial style classification explicit", () => {
        expect(
            Object.fromEntries(
                HUMAN_BOT_PROFILES.map((profile) => [
                    profile.id,
                    {
                        decision: profile.decisionStyle,
                        opening: profile.openingStyle,
                        evidence: profile.styleEvidence,
                    },
                ]),
            ),
        ).toEqual({
            luna: {
                decision: { aggression: "high", complexity: "high" },
                opening: { sharpness: "medium", theory: "low" },
                evidence: "editorial",
            },
            daniela: {
                decision: { aggression: "medium", complexity: "high" },
                opening: { sharpness: "medium", theory: "medium" },
                evidence: "editorial",
            },
            nico: {
                decision: { aggression: "high", complexity: "high" },
                opening: { sharpness: "high", theory: "low" },
                evidence: "editorial",
            },
            sofia: {
                decision: { aggression: "high", complexity: "medium" },
                opening: { sharpness: "medium", theory: "low" },
                evidence: "editorial",
            },
            gabriel: {
                decision: { aggression: "low", complexity: "low" },
                opening: { sharpness: "low", theory: "medium" },
                evidence: "editorial",
            },
            vera: {
                decision: { aggression: "medium", complexity: "medium" },
                opening: { sharpness: "medium", theory: "medium" },
                evidence: "editorial",
            },
            carlos: {
                decision: { aggression: "medium", complexity: "high" },
                opening: { sharpness: "medium", theory: "high" },
                evidence: "editorial",
            },
            marcos: {
                decision: { aggression: "medium", complexity: "medium" },
                opening: { sharpness: "medium", theory: "low" },
                evidence: "editorial",
            },
            nelson: {
                decision: { aggression: "high", complexity: "high" },
                opening: { sharpness: "high", theory: "high" },
                evidence: "editorial",
            },
            irene: {
                decision: { aggression: "low", complexity: "low" },
                opening: { sharpness: "low", theory: "high" },
                evidence: "editorial",
            },
            mariann: {
                decision: { aggression: "low", complexity: "medium" },
                opening: { sharpness: "low", theory: "high" },
                evidence: "editorial",
            },
            valeria: {
                decision: { aggression: "high", complexity: "high" },
                opening: { sharpness: "high", theory: "medium" },
                evidence: "editorial",
            },
            leo: {
                decision: { aggression: "medium", complexity: "medium" },
                opening: { sharpness: "medium", theory: "high" },
                evidence: "editorial",
            },
            tomas: {
                decision: { aggression: "medium", complexity: "high" },
                opening: { sharpness: "medium", theory: "high" },
                evidence: "editorial",
            },
            atlas: {
                decision: { aggression: "medium", complexity: "medium" },
                opening: { sharpness: "high", theory: "high" },
                evidence: "editorial",
            },
        });
    });

    it("keeps every opening line legal from the initial position", () => {
        for (const repertoire of HUMAN_BOT_REPERTOIRES) {
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

        expect(
            HUMAN_BOT_REPERTOIRES.filter((repertoire) => repertoire.mode === "none").every(
                (repertoire) => repertoire.lines.length === 0,
            ),
        ).toBe(true);
        for (const repertoire of HUMAN_BOT_REPERTOIRES.filter(
            (candidate) => candidate.mode !== "none",
        )) {
            expect(repertoire.lines.length).toBeGreaterThan(0);
        }
    });

    it("keeps opening choices narrow and exposes the two special repertoire modes", () => {
        const ownFirstMoves = (profileId: string, side: "white" | "black") => {
            const repertoire = getHumanBotProfile(profileId).repertoire;
            const offset = side === "white" ? 0 : 1;
            return new Set(
                repertoire.lines
                    .filter((line) => line.side === side || line.side === "both")
                    .map((line) => line.moves[offset]),
            );
        };

        expect(ownFirstMoves("luna", "white")).toEqual(new Set(["e2e4"]));
        expect(ownFirstMoves("gabriel", "white")).toEqual(new Set(["d2d4"]));
        expect(ownFirstMoves("carlos", "white")).toEqual(new Set(["d2d4", "c2c4"]));
        expect(getHumanBotProfile("marcos").repertoire).toMatchObject({
            mode: "none",
            lines: [],
        });
        expect(getHumanBotProfile("sofia").repertoire).toMatchObject({
            mode: "forcedLine",
            maxPly: 6,
            lines: [{ id: "scandinavian" }],
        });
        expect(getHumanBotProfile("daniela").repertoire.lines).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: "french", side: "black" })]),
        );
    });

    it("keeps the approved identity swaps and focused defense assignments", () => {
        expect(getHumanBotProfile("gabriel").elo).toBe(1700);
        expect(getHumanBotProfile("marcos").elo).toBe(1450);
        expect(getHumanBotProfile("sofia").elo).toBe(1050);
        expect(getHumanBotProfile("daniela").elo).toBe(1300);

        const blackLineIds = (profileId: string) =>
            getHumanBotProfile(profileId)
                .repertoire.lines.filter((line) => line.side === "black" || line.side === "both")
                .map((line) => line.id);

        expect(blackLineIds("mariann")).toEqual(["french", "caroKann"]);
        expect(blackLineIds("daniela")).toEqual(["french"]);
        expect(blackLineIds("irene")).toEqual(["caroKann"]);
        expect(blackLineIds("nico")).toEqual(["sicilianEnglishAttack"]);
    });

    it("builds a backend repertoire without exposing mutable catalog arrays", () => {
        const profile = getHumanBotProfile("gabriel");
        const config = buildHumanBotOpeningRepertoire(profile);

        expect(config.id).toBe("gabriel-queen-pawn");
        expect(config.version).toBe(2);
        expect(config.mode).toBe("weighted");
        expect(config.maxPly).toBe(16);
        expect(config.lines).toHaveLength(profile.repertoire.lines.length);
        expect(config.lines[0].moves).toEqual(profile.repertoire.lines[0].moves);
        expect(config.lines[0].moves).not.toBe(profile.repertoire.lines[0].moves);
        expect(config.lines[0].side).toBe("white");
    });

    it("creates traceable PGN metadata for each bot component", () => {
        const luna = getHumanBotProfile("luna");
        expect(buildHumanBotTraceHeaders(luna, "Black", true)).toEqual({
            BlackBotProfile: "luna",
            BlackBotProfileVersion: "3",
            BlackBotCatalogVersion: "4.4.0",
            BlackBotLevel: "novice-900",
            BlackBotStyle: "adventurous",
            BlackBotStyleEvidence: "editorial",
            BlackBotAggression: "high",
            BlackBotComplexity: "high",
            BlackBotOpeningSharpness: "medium",
            BlackBotOpeningTheory: "low",
            BlackBotSampling: "adventurous-wide",
            BlackBotTiming: "casual-fast",
            BlackBotRepertoire: "luna-e4-explorer",
            BlackBotRepertoireVersion: "2",
            BlackBotRepertoireMode: "weighted",
            BlackBotModel: "maia3",
            BlackBotModelVersion: "unknown",
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

    it("builds a bounded direct Maia configuration from a requested ELO", () => {
        expect(
            buildMaiaEngineSettings(300, [
                { name: "Hash", value: 128 },
                { name: "Temperature", value: 1.1 },
                { name: "MultiPV", value: 8 },
            ]),
        ).toEqual([
            { name: "Temperature", value: 1.1 },
            { name: "Elo", value: 600 },
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
