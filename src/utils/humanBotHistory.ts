import { z } from "zod";
import type { Outcome } from "@/bindings";

export type HumanBotHistoryResult = "win" | "draw" | "loss";

export const humanBotHistoryGameSchema = z.object({
    schemaVersion: z.literal(1),
    id: z.string(),
    backendGameId: z.string(),
    recordedAt: z.string(),
    profileId: z.string(),
    profileName: z.string(),
    botElo: z.number(),
    botColor: z.enum(["white", "black"]),
    playerName: z.string(),
    playerColor: z.enum(["white", "black"]),
    result: z.enum(["1-0", "0-1", "1/2-1/2", "*"]),
    playerResult: z.enum(["win", "draw", "loss"]),
    timeControl: z.string().nullable(),
    plies: z.number().int().nonnegative(),
    pgn: z.string(),
});

export type HumanBotHistoryGame = z.infer<typeof humanBotHistoryGameSchema>;

export const humanBotHistoryStateSchema = z.object({
    schemaVersion: z.literal(1),
    games: z.array(humanBotHistoryGameSchema),
    scoreResetAt: z.string().nullable(),
    scoreResetAtByProfile: z.record(z.string(), z.string()),
});

export type HumanBotHistoryState = z.infer<typeof humanBotHistoryStateSchema>;

export const EMPTY_HUMAN_BOT_HISTORY: HumanBotHistoryState = {
    schemaVersion: 1,
    games: [],
    scoreResetAt: null,
    scoreResetAtByProfile: {},
};

export type HumanBotScore = {
    profileId: string;
    games: number;
    wins: number;
    draws: number;
    losses: number;
    playerPoints: number;
    botPoints: number;
};

export function getHumanBotPlayerResult(
    result: Outcome,
    playerColor: "white" | "black",
): HumanBotHistoryResult {
    if (result === "1/2-1/2" || result === "*") return "draw";
    const playerWon =
        (result === "1-0" && playerColor === "white") ||
        (result === "0-1" && playerColor === "black");
    return playerWon ? "win" : "loss";
}

export function buildHumanBotHistoryGame({
    id,
    backendGameId,
    recordedAt,
    profileId,
    profileName,
    botElo,
    botColor,
    playerName,
    result,
    timeControl,
    plies,
    pgn,
}: {
    id: string;
    backendGameId: string;
    recordedAt: string;
    profileId: string;
    profileName: string;
    botElo: number;
    botColor: "white" | "black";
    playerName: string;
    result: Outcome;
    timeControl: string | null;
    plies: number;
    pgn: string;
}): HumanBotHistoryGame {
    const playerColor = botColor === "white" ? "black" : "white";
    return {
        schemaVersion: 1,
        id,
        backendGameId,
        recordedAt,
        profileId,
        profileName,
        botElo,
        botColor,
        playerName,
        playerColor,
        result,
        playerResult: getHumanBotPlayerResult(result, playerColor),
        timeControl,
        plies,
        pgn,
    };
}

function scoreCutoff(history: HumanBotHistoryState, profileId: string): string | null {
    const candidates = [history.scoreResetAt, history.scoreResetAtByProfile[profileId]].filter(
        (value): value is string => value !== null && value !== undefined,
    );
    return candidates.length > 0 ? candidates.sort().at(-1)! : null;
}

export function getHumanBotScore(history: HumanBotHistoryState, profileId: string): HumanBotScore {
    const cutoff = scoreCutoff(history, profileId);
    const games = history.games.filter(
        (game) => game.profileId === profileId && (!cutoff || game.recordedAt > cutoff),
    );
    const wins = games.filter((game) => game.playerResult === "win").length;
    const draws = games.filter((game) => game.playerResult === "draw").length;
    const losses = games.filter((game) => game.playerResult === "loss").length;

    return {
        profileId,
        games: games.length,
        wins,
        draws,
        losses,
        playerPoints: wins + draws / 2,
        botPoints: losses + draws / 2,
    };
}

export function resetHumanBotScore(
    history: HumanBotHistoryState,
    profileId: string,
    resetAt: string,
): HumanBotHistoryState {
    return {
        ...history,
        scoreResetAtByProfile: {
            ...history.scoreResetAtByProfile,
            [profileId]: resetAt,
        },
    };
}

export function resetAllHumanBotScores(
    history: HumanBotHistoryState,
    resetAt: string,
): HumanBotHistoryState {
    return {
        ...history,
        scoreResetAt: resetAt,
        scoreResetAtByProfile: {},
    };
}

export function clearHumanBotHistory(history: HumanBotHistoryState): HumanBotHistoryState {
    return {
        ...history,
        games: [],
        scoreResetAt: null,
        scoreResetAtByProfile: {},
    };
}

export function formatChessPoints(points: number): string {
    return Number.isInteger(points) ? points.toString() : `${Math.floor(points)}½`;
}
