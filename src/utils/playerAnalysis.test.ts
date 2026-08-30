import { describe, expect, it } from "vitest";
import type { MoveAnalysis, NormalizedGame } from "@/bindings";
import {
    aggregateEngineAnalysis,
    analyzePlayerGames,
    buildEngineGameMetrics,
    DEFAULT_PLAYER_ANALYSIS_FILTERS,
    selectPlayerEngineGames,
    type PlayerAnalysisGame,
    type PlayerAnalysisSource,
} from "./playerAnalysis";

const source: PlayerAnalysisSource = {
    databasePath: "lichess.db3",
    databaseTitle: "Player Lichess",
    playerId: 1,
    playerName: "Player",
};

function game(
    id: number,
    input: Partial<NormalizedGame> & Pick<NormalizedGame, "white" | "black" | "result">,
): PlayerAnalysisGame {
    return {
        key: `${source.databasePath}:${id}`,
        source,
        game: {
            id,
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            event: "Rated",
            event_id: 1,
            site: "https://lichess.org/game",
            site_id: 1,
            white_id: input.white === "Player" ? 1 : 2,
            black_id: input.black === "Player" ? 1 : 2,
            white_elo: 1800,
            black_elo: 1900,
            time_control: "600+0",
            eco: "B12 Caro-Kann",
            ply_count: 40,
            moves: "1. e4 c6 2. d4 d5 *",
            ...input,
        },
    };
}

describe("player metadata analysis", () => {
    it("uses the player's perspective and keeps evidence for weak cohorts", () => {
        const games = Array.from({ length: 10 }, (_, index) =>
            game(index + 1, {
                white: index % 2 === 0 ? "Player" : "Opponent",
                black: index % 2 === 0 ? "Opponent" : "Player",
                result: index < 2 ? (index % 2 === 0 ? "1-0" : "0-1") : "0-1",
                date: `2026.01.${String(index + 1).padStart(2, "0")}`,
            }),
        );
        const report = analyzePlayerGames(
            "Player",
            games,
            [source],
            DEFAULT_PLAYER_ANALYSIS_FILTERS,
            "2026-01-20T00:00:00.000Z",
        );
        expect(report.schemaVersion).toBe(2);
        expect(report.summary.games).toBe(10);
        expect(report.summary.wins).toBe(6);
        expect(report.summary.losses).toBe(4);
        expect(report.openings[0].references[0]).toMatchObject({
            databasePath: "lichess.db3",
            gameId: 1,
        });
        expect(report.findings.every((finding) => finding.sampleSize >= 5)).toBe(true);
    });

    it("applies date, color, opponent rating and time-control filters", () => {
        const games = [
            game(1, { white: "Player", black: "Opponent", result: "1-0", date: "2025.01.01" }),
            game(2, {
                white: "Opponent",
                black: "Player",
                result: "0-1",
                date: "2026.01.01",
                time_control: "180+2",
                white_elo: 2100,
            }),
        ];
        const report = analyzePlayerGames("Player", games, [source], {
            ...DEFAULT_PLAYER_ANALYSIS_FILTERS,
            startDate: "2026.01.01",
            color: "black",
            opponentEloMin: 2000,
            timeControl: "180+2",
        });
        expect(report.sampleSize).toBe(1);
        expect(report.summary.wins).toBe(1);
        expect(report.summary.averageOpponentElo).toBe(2100);
    });

    it("uses a derived opening name when the source PGN has no ECO header", () => {
        const report = analyzePlayerGames(
            "Player",
            [
                game(1, {
                    white: "Player",
                    black: "Opponent",
                    result: "1-0",
                    eco: null,
                    opening: "Caro-Kann Defense",
                }),
            ],
            [source],
        );

        expect(report.openings[0].key).toBe("Caro-Kann Defense");
    });

    it("selects either the requested newest games or the complete filtered sample", () => {
        const games = [
            game(1, { white: "Player", black: "A", result: "1-0", date: "2026.01.01" }),
            game(2, { white: "Player", black: "B", result: "1-0", date: "2026.03.01" }),
            game(3, { white: "Player", black: "C", result: "1-0", date: "2026.02.01" }),
        ];

        expect(
            selectPlayerEngineGames(games, DEFAULT_PLAYER_ANALYSIS_FILTERS, 2).map(
                (item) => item.game.id,
            ),
        ).toEqual([2, 3]);
        expect(selectPlayerEngineGames(games, DEFAULT_PLAYER_ANALYSIS_FILTERS, "all")).toHaveLength(
            3,
        );
    });
});

function moveAnalysis(
    score: MoveAnalysis["best"][number]["score"]["value"],
    bestMove = "e2e4",
): MoveAnalysis {
    return {
        novelty: false,
        is_sacrifice: false,
        best: [
            {
                nodes: 1,
                depth: 1,
                score: { value: score, wdl: null },
                uciMoves: [bestMove],
                sanMoves: ["e4"],
                multipv: 1,
                nps: 1,
            },
        ],
    };
}

describe("player engine analysis", () => {
    it("counts only the player's moves and exposes critical positions", () => {
        const item = game(1, { white: "Player", black: "Opponent", result: "0-1" });
        const metrics = buildEngineGameMetrics({
            item,
            uciMoves: ["e2e4", "e7e5", "g1f3"],
            preMoveFens: [
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
                "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
            ],
            analysis: [
                moveAnalysis({ type: "cp", value: 200 }),
                moveAnalysis({ type: "cp", value: -150 }),
                moveAnalysis({ type: "cp", value: 20 }, "g1f3"),
                moveAnalysis({ type: "cp", value: -100 }),
            ],
        });
        expect(metrics.moves).toBe(2);
        expect(metrics.blunders).toBe(1);
        expect(metrics.mistakes).toBe(1);
        expect(metrics.criticalPositions).toHaveLength(2);
        expect(metrics.criticalPositions[0]).toMatchObject({
            gameId: 1,
            ply: 0,
            classification: "blunder",
        });

        const aggregate = aggregateEngineAnalysis({
            engine: {
                name: "Stockfish",
                path: "stockfish",
                args: [],
                options: [],
                limit: "time:250ms",
            },
            requestedGames: 1,
            skippedGames: 0,
            games: [metrics],
            analyzedAt: "2026-01-20T00:00:00.000Z",
        });
        expect(aggregate.analyzedGames).toBe(1);
        expect(aggregate.moves).toBe(2);
        expect(aggregate.criticalPositions).toHaveLength(2);
        expect(aggregate.advantageGames).toBe(1);
        expect(aggregate.conversionRate).toBe(0);
    });
});
