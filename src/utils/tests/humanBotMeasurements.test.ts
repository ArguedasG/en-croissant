import { describe, expect, it } from "vitest";
import type { GameMove, GameMoveSource } from "@/bindings";
import { getHumanBotProfile } from "../humanBots";
import {
    buildHumanBotGameMeasurement,
    buildHumanBotMeasurementHeaders,
    humanBotMeasurementsToCsv,
    summarizeHumanBotMeasurements,
} from "../humanBotMeasurements";

function gameMove(
    color: "white" | "black",
    source: GameMoveSource,
    thinkTimeMs: number | null,
): GameMove {
    return {
        uci: "e2e4",
        san: "e4",
        fenAfter: "fen",
        clock: null,
        whiteTime: null,
        blackTime: null,
        color,
        source,
        thinkTimeMs: thinkTimeMs === null ? null : BigInt(thinkTimeMs),
    };
}

describe("human bot measurements", () => {
    it("measures observed repertoire depth and thinking time", () => {
        const measurement = buildHumanBotGameMeasurement({
            gameId: "game-1",
            recordedAt: "2026-08-15T12:00:00.000Z",
            result: "1-0",
            moves: [
                gameMove("white", "profileRepertoire", 500),
                gameMove("black", "human", null),
                gameMove("white", "profileRepertoire", 700),
                gameMove("black", "human", null),
                gameMove("white", "engine", 1500),
            ],
            players: {
                white: {
                    profile: getHumanBotProfile("nico"),
                    humanTimingEnabled: true,
                    timeControl: { seconds: 180_000, increment: 2000 },
                },
                black: null,
            },
        });

        expect(measurement.bots).toHaveLength(1);
        expect(measurement.bots[0]).toMatchObject({
            profileId: "nico",
            moveCount: 3,
            repertoireMoves: 2,
            maiaMoves: 1,
            repertoireLastPly: 3,
            repertoireLastBotMove: 2,
            firstMaiaPly: 5,
            firstMaiaBotMove: 3,
            averageThinkTimeMs: 900,
            maxThinkTimeMs: 1500,
        });
    });

    it("builds PGN summary headers and a flat CSV row", () => {
        const measurement = buildHumanBotGameMeasurement({
            gameId: "game-1",
            recordedAt: "2026-08-15T12:00:00.000Z",
            result: "0-1",
            moves: [gameMove("black", "profileRepertoire", 600)],
            players: {
                white: null,
                black: {
                    profile: getHumanBotProfile("luna"),
                    humanTimingEnabled: false,
                },
            },
        });

        expect(buildHumanBotMeasurementHeaders(measurement)).toMatchObject({
            BlackBotProfileVersion: "3",
            BlackBotCatalogVersion: "4.4.0",
            BlackBotRepertoireMode: "weighted",
            BlackBotAggression: "high",
            BlackBotComplexity: "high",
            BlackBotOpeningSharpness: "medium",
            BlackBotOpeningTheory: "low",
            BlackBotMoves: "1",
            BlackBotRepertoireMoves: "1",
            BlackBotRepertoireLastPly: "1",
            BlackBotFirstMaiaPly: "-",
            BlackBotAverageThinkMs: "600",
            BlackBotMaxThinkMs: "600",
        });

        const csv = humanBotMeasurementsToCsv([measurement]);
        expect(csv).toContain("repertoireLastBotMove");
        expect(csv).toContain(",black,luna,3,4.4.0,900,novice-900,");
        expect(csv).toContain("repertoireMode");
    });

    it("summarizes observed repertoire use and thinking time by profile", () => {
        const measurement = buildHumanBotGameMeasurement({
            gameId: "game-1",
            recordedAt: "2026-08-15T12:00:00.000Z",
            result: "1-0",
            moves: [
                gameMove("black", "profileRepertoire", 1000),
                gameMove("black", "profileRepertoire", 1000),
            ],
            players: {
                white: null,
                black: {
                    profile: getHumanBotProfile("luna"),
                    humanTimingEnabled: true,
                },
            },
        });
        const secondMeasurement = {
            ...measurement,
            id: "game-2-now",
            gameId: "game-2",
            bots: [
                {
                    ...measurement.bots[0],
                    repertoireMoves: 1,
                    averageThinkTimeMs: 2000,
                },
            ],
        };

        expect(summarizeHumanBotMeasurements([measurement, secondMeasurement])).toEqual([
            {
                profileId: "luna",
                elo: 900,
                games: 2,
                configuredRepertoireMaxPly: 12,
                averageRepertoireMoves: 1.5,
                averageThinkTimeMs: 1500,
            },
        ]);
    });
});
