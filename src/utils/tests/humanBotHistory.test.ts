import { describe, expect, it } from "vitest";
import {
    buildHumanBotHistoryGame,
    clearHumanBotHistory,
    EMPTY_HUMAN_BOT_HISTORY,
    formatChessPoints,
    getHumanBotScore,
    resetHumanBotScore,
} from "../humanBotHistory";

function historyGame({
    id,
    recordedAt,
    result,
}: {
    id: string;
    recordedAt: string;
    result: "1-0" | "0-1" | "1/2-1/2";
}) {
    return buildHumanBotHistoryGame({
        id,
        backendGameId: `backend-${id}`,
        recordedAt,
        profileId: "luna",
        profileName: "Luna",
        botElo: 900,
        botColor: "black",
        playerName: "Player",
        result,
        timeControl: "180+2",
        plies: 20,
        pgn: `[Result "${result}"]\n\n${result}`,
    });
}

describe("human bot history", () => {
    it("stores the complete game and evaluates the result from the player's color", () => {
        const win = historyGame({
            id: "win",
            recordedAt: "2026-08-15T10:00:00.000Z",
            result: "1-0",
        });

        expect(win).toMatchObject({
            profileId: "luna",
            playerColor: "white",
            botColor: "black",
            playerResult: "win",
            pgn: '[Result "1-0"]\n\n1-0',
        });
    });

    it("derives chess scores and preserves games when a score is reset", () => {
        const games = [
            historyGame({
                id: "win",
                recordedAt: "2026-08-15T10:00:00.000Z",
                result: "1-0",
            }),
            historyGame({
                id: "draw",
                recordedAt: "2026-08-15T11:00:00.000Z",
                result: "1/2-1/2",
            }),
            historyGame({
                id: "loss",
                recordedAt: "2026-08-15T12:00:00.000Z",
                result: "0-1",
            }),
        ];
        const history = { ...EMPTY_HUMAN_BOT_HISTORY, games };

        expect(getHumanBotScore(history, "luna")).toMatchObject({
            games: 3,
            wins: 1,
            draws: 1,
            losses: 1,
            playerPoints: 1.5,
            botPoints: 1.5,
        });

        const reset = resetHumanBotScore(history, "luna", "2026-08-15T11:30:00.000Z");
        expect(reset.games).toHaveLength(3);
        expect(getHumanBotScore(reset, "luna")).toMatchObject({
            games: 1,
            wins: 0,
            draws: 0,
            losses: 1,
        });
    });

    it("clears saved games and formats half points", () => {
        const history = {
            ...EMPTY_HUMAN_BOT_HISTORY,
            games: [
                historyGame({
                    id: "draw",
                    recordedAt: "2026-08-15T11:00:00.000Z",
                    result: "1/2-1/2",
                }),
            ],
        };

        expect(clearHumanBotHistory(history)).toEqual(EMPTY_HUMAN_BOT_HISTORY);
        expect(formatChessPoints(0.5)).toBe("0½");
        expect(formatChessPoints(3)).toBe("3");
    });
});
