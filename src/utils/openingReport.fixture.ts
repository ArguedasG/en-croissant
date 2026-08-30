import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import type { OpeningReport, ReportResults, ReportStatistics } from "@/bindings";

/** Synthetic four-game database, matching the native report test's move orders. */
export function openingReportFixture(): OpeningReport {
    const fen = makeFen(Chess.default().toSetup());
    const statistics = (results: ReportResults, elo = 2500): ReportStatistics => ({
        results,
        averageWhiteElo: elo,
        averageBlackElo: elo,
        ratedWhite: results.white + results.draw + results.black + results.unknown,
        ratedBlack: results.white + results.draw + results.black + results.unknown,
    });
    const results = { white: 1, draw: 1, black: 1, unknown: 0 };
    const paths = ["d4 d5 Nf3 Nf6 c4 e6", "Nf3 d5 d4 Nf6 c4 e6", "d4 Nf6 Nf3 d5 c4 e6"];
    const after = (moves: string[]) => {
        const chess = Chess.default();
        for (const san of moves) chess.play(parseSan(chess, san)!);
        return makeFen(chess.toSetup());
    };
    const theory = paths.map((path, i) => {
        const moves = path.split(" ");
        const outcome = { white: +(i === 0), draw: +(i === 1), black: +(i === 2), unknown: 0 };
        return {
            moves,
            fen: after(moves),
            statistics: statistics(outcome),
            exampleOffset: i,
            example: {
                snapshotOffset: i,
                id: i + 1,
                white: ["Ana", "Beatriz", "Carlos"][i],
                black: "Diego",
                whiteElo: 2500,
                blackElo: 2500,
                date: i === 2 ? null : `${i === 0 ? 2022 : 2024}.01.01`,
                result: ["1-0", "1/2-1/2", "0-1"][i],
                event: "Local test",
                ply: 0,
                nextMove: moves[0],
            },
        };
    });
    return {
        version: 2,
        generatedAt: "2026-08-28T12:00:00Z",
        databaseName: "Local test.db3",
        databaseGames: 4,
        position: {
            token: "fixture",
            fingerprint: "synthetic-revision-1",
            fen,
            total: 4,
            skippedGames: 0,
            scanMs: 1,
            cacheHit: false,
            openings: [
                { move: "d4", white: 1, draw: 0, black: 1, unknown: 0 },
                { move: "Nf3", white: 0, draw: 1, black: 0, unknown: 0 },
                { move: "e4", white: 0, draw: 0, black: 0, unknown: 1 },
            ],
        },
        options: { depth: 6, theoryGames: 3, maxLines: 64, displayFen: fen },
        filters: {
            whitePlayer: null,
            blackPlayer: null,
            anyPlayer: null,
            whiteElo: null,
            blackElo: null,
            startDate: null,
            endDate: null,
            result: null,
        },
        statistics: statistics({ ...results, unknown: 1 }, 2125),
        years: [
            { year: 2022, results: theory[0].statistics.results },
            { year: 2024, results: theory[1].statistics.results },
        ],
        unknownYearGames: 2,
        eloBands: [
            {
                minElo: 2000,
                maxElo: 2199,
                results: { white: 0, draw: 0, black: 0, unknown: 1 },
            },
            { minElo: 2400, maxElo: 2599, results },
        ],
        unknownEloGames: 0,
        mostPlayedPlayers: [
            {
                id: 1,
                name: "Ana",
                games: 3,
                whiteGames: 2,
                blackGames: 1,
                wins: 2,
                draws: 1,
                losses: 0,
                unknown: 0,
                averageElo: 2517,
                peakElo: 2600,
            },
        ],
        strongestPlayers: [
            {
                id: 1,
                name: "Ana",
                games: 3,
                whiteGames: 2,
                blackGames: 1,
                wins: 2,
                draws: 1,
                losses: 0,
                unknown: 0,
                averageElo: 2517,
                peakElo: 2600,
            },
        ],
        playerCount: 4,
        cohort: statistics(results),
        excludedTheoryGames: 0,
        theory,
        theoryLineCount: 3,
        displayedTheoryGames: 3,
        moveOrders: [
            { startFen: fen, moves: [], statistics: statistics(results), exampleOffset: 1 },
        ],
        moveOrderCount: 1,
        transpositions: [
            {
                fen: after(theory[0].moves.slice(0, 4)),
                ply: 4,
                games: 3,
                routeCount: 3,
                routes: theory.map((line) => ({
                    moves: line.moves.slice(0, 4),
                    results: line.statistics.results,
                    exampleOffset: line.exampleOffset,
                })),
            },
        ],
        transpositionCount: 1,
        elapsedMs: 12,
        cacheHit: false,
    };
}
