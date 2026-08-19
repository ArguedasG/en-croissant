import type { GameMove, Outcome } from "@/bindings";
import {
    HUMAN_BOT_CATALOG_VERSION,
    HUMAN_BOT_MODEL_ID,
    type HumanBotProfile,
    type HumanBotRepertoireMode,
    type HumanBotStyleAxisLevel,
    type HumanBotStyleEvidence,
} from "./humanBots";

export type HumanBotMeasurementPlayer = {
    profile: HumanBotProfile;
    modelVersion?: string | null;
    humanTimingEnabled: boolean;
    timeControl?: {
        seconds: number;
        increment?: number;
    };
};

export type HumanBotPlayerMeasurement = {
    color: "white" | "black";
    profileId: string;
    profileVersion?: number;
    catalogVersion?: string;
    levelId: string;
    samplingStyleId: string;
    repertoireId: string;
    repertoireVersion?: number;
    repertoireMode?: HumanBotRepertoireMode;
    modelId?: string;
    modelVersion?: string | null;
    styleEvidence?: HumanBotStyleEvidence;
    aggression?: HumanBotStyleAxisLevel | null;
    complexity?: HumanBotStyleAxisLevel | null;
    openingSharpness?: HumanBotStyleAxisLevel | null;
    openingTheory?: HumanBotStyleAxisLevel | null;
    timingId: string;
    elo: number;
    configuredRepertoireMaxPly: number;
    humanTimingEnabled: boolean;
    initialTimeMs: number | null;
    incrementMs: number | null;
    moveCount: number;
    repertoireMoves: number;
    maiaMoves: number;
    polyglotMoves: number;
    repertoireLastPly: number | null;
    repertoireLastBotMove: number | null;
    firstMaiaPly: number | null;
    firstMaiaBotMove: number | null;
    averageThinkTimeMs: number | null;
    maxThinkTimeMs: number | null;
};

export type HumanBotGameMeasurement = {
    schemaVersion: 1;
    id: string;
    gameId: string;
    recordedAt: string;
    result: Outcome;
    totalPly: number;
    bots: HumanBotPlayerMeasurement[];
};

export type HumanBotMeasurementSummary = {
    profileId: string;
    elo: number;
    games: number;
    configuredRepertoireMaxPly: number;
    averageRepertoireMoves: number;
    averageThinkTimeMs: number | null;
};

function measurePlayer(
    color: "white" | "black",
    player: HumanBotMeasurementPlayer,
    moves: GameMove[],
): HumanBotPlayerMeasurement {
    const botMoves = moves
        .map((move, index) => ({ move, ply: index + 1 }))
        .filter(
            ({ move }) =>
                move.color === color && move.source !== "human" && move.source !== "initial",
        )
        .map((entry, index) => ({ ...entry, botMove: index + 1 }));
    const repertoireMoves = botMoves.filter(({ move }) => move.source === "profileRepertoire");
    const maiaMoves = botMoves.filter(({ move }) => move.source === "engine");
    const polyglotMoves = botMoves.filter(({ move }) => move.source === "polyglot");
    const thinkTimes = botMoves
        .map(({ move }) => move.thinkTimeMs)
        .filter((value): value is bigint => value !== null)
        .map(Number);
    const repertoireLast = repertoireMoves.at(-1);
    const firstMaia = maiaMoves[0];

    return {
        color,
        profileId: player.profile.id,
        profileVersion: player.profile.profileVersion,
        catalogVersion: HUMAN_BOT_CATALOG_VERSION,
        levelId: player.profile.levelId,
        samplingStyleId: player.profile.samplingStyleId,
        repertoireId: player.profile.repertoireId,
        repertoireVersion: player.profile.repertoire.version,
        repertoireMode: player.profile.repertoire.mode,
        modelId: HUMAN_BOT_MODEL_ID,
        modelVersion: player.modelVersion ?? null,
        styleEvidence: player.profile.styleEvidence,
        aggression: player.profile.decisionStyle?.aggression ?? null,
        complexity: player.profile.decisionStyle?.complexity ?? null,
        openingSharpness: player.profile.openingStyle?.sharpness ?? null,
        openingTheory: player.profile.openingStyle?.theory ?? null,
        timingId: player.profile.timingId,
        elo: player.profile.elo,
        configuredRepertoireMaxPly: player.profile.repertoire.maxPly,
        humanTimingEnabled: player.humanTimingEnabled,
        initialTimeMs: player.timeControl?.seconds ?? null,
        incrementMs: player.timeControl?.increment ?? null,
        moveCount: botMoves.length,
        repertoireMoves: repertoireMoves.length,
        maiaMoves: maiaMoves.length,
        polyglotMoves: polyglotMoves.length,
        repertoireLastPly: repertoireLast?.ply ?? null,
        repertoireLastBotMove: repertoireLast?.botMove ?? null,
        firstMaiaPly: firstMaia?.ply ?? null,
        firstMaiaBotMove: firstMaia?.botMove ?? null,
        averageThinkTimeMs:
            thinkTimes.length > 0
                ? Math.round(
                      thinkTimes.reduce((total, value) => total + value, 0) / thinkTimes.length,
                  )
                : null,
        maxThinkTimeMs: thinkTimes.length > 0 ? Math.max(...thinkTimes) : null,
    };
}

export function buildHumanBotGameMeasurement({
    gameId,
    recordedAt,
    result,
    moves,
    players,
}: {
    gameId: string;
    recordedAt: string;
    result: Outcome;
    moves: GameMove[];
    players: {
        white: HumanBotMeasurementPlayer | null;
        black: HumanBotMeasurementPlayer | null;
    };
}): HumanBotGameMeasurement {
    const bots: HumanBotPlayerMeasurement[] = [];
    if (players.white) bots.push(measurePlayer("white", players.white, moves));
    if (players.black) bots.push(measurePlayer("black", players.black, moves));

    return {
        schemaVersion: 1,
        id: `${gameId}-${recordedAt}`,
        gameId,
        recordedAt,
        result,
        totalPly: moves.length,
        bots,
    };
}

export function buildHumanBotMeasurementHeaders(
    measurement: HumanBotGameMeasurement,
): Record<string, string> {
    const headers: Record<string, string> = {};

    for (const bot of measurement.bots) {
        const prefix = bot.color === "white" ? "WhiteBot" : "BlackBot";
        headers[`${prefix}ProfileVersion`] = bot.profileVersion?.toString() ?? "-";
        headers[`${prefix}CatalogVersion`] = bot.catalogVersion ?? "-";
        headers[`${prefix}RepertoireVersion`] = bot.repertoireVersion?.toString() ?? "-";
        headers[`${prefix}RepertoireMode`] = bot.repertoireMode ?? "-";
        headers[`${prefix}Model`] = bot.modelId ?? "-";
        headers[`${prefix}ModelVersion`] = bot.modelVersion ?? "-";
        headers[`${prefix}StyleEvidence`] = bot.styleEvidence ?? "-";
        headers[`${prefix}Aggression`] = bot.aggression ?? "-";
        headers[`${prefix}Complexity`] = bot.complexity ?? "-";
        headers[`${prefix}OpeningSharpness`] = bot.openingSharpness ?? "-";
        headers[`${prefix}OpeningTheory`] = bot.openingTheory ?? "-";
        headers[`${prefix}Moves`] = bot.moveCount.toString();
        headers[`${prefix}RepertoireMoves`] = bot.repertoireMoves.toString();
        headers[`${prefix}RepertoireLastPly`] = bot.repertoireLastPly?.toString() ?? "-";
        headers[`${prefix}FirstMaiaPly`] = bot.firstMaiaPly?.toString() ?? "-";
        headers[`${prefix}AverageThinkMs`] = bot.averageThinkTimeMs?.toString() ?? "-";
        headers[`${prefix}MaxThinkMs`] = bot.maxThinkTimeMs?.toString() ?? "-";
    }

    return headers;
}

export function summarizeHumanBotMeasurements(
    measurements: HumanBotGameMeasurement[],
): HumanBotMeasurementSummary[] {
    const byProfile = new Map<
        string,
        {
            elo: number;
            games: number;
            configuredRepertoireMaxPly: number;
            repertoireMoves: number;
            thinkTimeTotal: number;
            thinkTimeGames: number;
        }
    >();

    for (const measurement of measurements) {
        for (const bot of measurement.bots) {
            const current = byProfile.get(bot.profileId) ?? {
                elo: bot.elo,
                games: 0,
                configuredRepertoireMaxPly: bot.configuredRepertoireMaxPly,
                repertoireMoves: 0,
                thinkTimeTotal: 0,
                thinkTimeGames: 0,
            };
            current.games += 1;
            current.repertoireMoves += bot.repertoireMoves;
            if (bot.averageThinkTimeMs !== null) {
                current.thinkTimeTotal += bot.averageThinkTimeMs;
                current.thinkTimeGames += 1;
            }
            byProfile.set(bot.profileId, current);
        }
    }

    return [...byProfile.entries()]
        .map(([profileId, summary]) => ({
            profileId,
            elo: summary.elo,
            games: summary.games,
            configuredRepertoireMaxPly: summary.configuredRepertoireMaxPly,
            averageRepertoireMoves: Math.round((summary.repertoireMoves / summary.games) * 10) / 10,
            averageThinkTimeMs:
                summary.thinkTimeGames > 0
                    ? Math.round(summary.thinkTimeTotal / summary.thinkTimeGames)
                    : null,
        }))
        .sort((left, right) => left.elo - right.elo);
}

function csvCell(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function humanBotMeasurementsToCsv(measurements: HumanBotGameMeasurement[]): string {
    const botColumns = [
        "color",
        "profileId",
        "profileVersion",
        "catalogVersion",
        "elo",
        "levelId",
        "samplingStyleId",
        "repertoireId",
        "repertoireVersion",
        "repertoireMode",
        "modelId",
        "modelVersion",
        "styleEvidence",
        "aggression",
        "complexity",
        "openingSharpness",
        "openingTheory",
        "configuredRepertoireMaxPly",
        "timingId",
        "humanTimingEnabled",
        "initialTimeMs",
        "incrementMs",
        "moveCount",
        "repertoireMoves",
        "maiaMoves",
        "polyglotMoves",
        "repertoireLastPly",
        "repertoireLastBotMove",
        "firstMaiaPly",
        "firstMaiaBotMove",
        "averageThinkTimeMs",
        "maxThinkTimeMs",
    ] as const;
    const columns = ["recordedAt", "gameId", "result", "totalPly", ...botColumns];
    const rows = measurements.flatMap((measurement) =>
        measurement.bots.map((bot) =>
            [
                measurement.recordedAt,
                measurement.gameId,
                measurement.result,
                measurement.totalPly,
                ...botColumns.map((column) => bot[column]),
            ]
                .map(csvCell)
                .join(","),
        ),
    );

    return [columns.join(","), ...rows].join("\n");
}
