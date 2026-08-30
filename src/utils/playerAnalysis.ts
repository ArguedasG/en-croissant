import type { MoveAnalysis, NormalizedGame } from "@/bindings";
import { getCPLoss, normalizeScore } from "@/utils/score";
import { positionFromFen } from "@/utils/chessops";

export const PLAYER_ANALYSIS_SCHEMA_VERSION = 2;

export type PlayerAnalysisSource = {
    databasePath: string;
    databaseTitle: string;
    playerId: number;
    playerName: string;
};

export type PlayerAnalysisGame = {
    key: string;
    source: PlayerAnalysisSource;
    game: NormalizedGame;
};

export type PlayerAnalysisFilters = {
    startDate: string | null;
    endDate: string | null;
    color: "any" | "white" | "black";
    opponentEloMin: number | null;
    opponentEloMax: number | null;
    timeControl: string | null;
};

export type PlayerAnalysisReference = {
    key: string;
    databasePath: string;
    databaseTitle: string;
    gameId: number;
    playerId: number;
    ply: number | null;
};

export type PlayerAnalysisBucket = {
    key: string;
    games: number;
    wins: number;
    draws: number;
    losses: number;
    unknown: number;
    scorePercent: number | null;
    averagePlayerElo: number | null;
    averageOpponentElo: number | null;
    references: PlayerAnalysisReference[];
};

export type PlayerAnalysisFinding = {
    id: string;
    category: "opening" | "color" | "timeControl" | "rating" | "trend";
    priority: "high" | "medium" | "low";
    subject: string;
    sampleSize: number;
    scorePercent: number | null;
    references: PlayerAnalysisReference[];
};

export type PlayerMetadataAnalysis = {
    schemaVersion: number;
    generatedAt: string;
    playerName: string;
    sources: PlayerAnalysisSource[];
    filters: PlayerAnalysisFilters;
    sampleSize: number;
    summary: PlayerAnalysisBucket;
    byColor: PlayerAnalysisBucket[];
    byTimeControl: PlayerAnalysisBucket[];
    byOpponentRating: PlayerAnalysisBucket[];
    byRatingDifference: PlayerAnalysisBucket[];
    openings: PlayerAnalysisBucket[];
    opponents: PlayerAnalysisBucket[];
    byYear: PlayerAnalysisBucket[];
    findings: PlayerAnalysisFinding[];
};

export type PlayerAnalysisPhase = "opening" | "middlegame" | "endgame";
export type PlayerAnalysisClassification = "inaccuracy" | "mistake" | "blunder";

export type PlayerAnalysisCriticalPosition = PlayerAnalysisReference & {
    fen: string;
    playedMove: string;
    bestLine: string[];
    cpLoss: number;
    classification: PlayerAnalysisClassification;
    phase: PlayerAnalysisPhase;
    opening: string;
    gameLabel: string;
};

export type PlayerEngineGameMetrics = {
    key: string;
    reference: PlayerAnalysisReference;
    moves: number;
    acpl: number | null;
    inaccuracies: number;
    mistakes: number;
    blunders: number;
    hadAdvantage: boolean;
    convertedAdvantage: boolean;
    wasInferior: boolean;
    savedInferior: boolean;
    phases: Array<{
        phase: PlayerAnalysisPhase;
        moves: number;
        acpl: number | null;
        inaccuracies: number;
        mistakes: number;
        blunders: number;
    }>;
    criticalPositions: PlayerAnalysisCriticalPosition[];
};

export type PlayerEngineAnalysis = {
    schemaVersion: number;
    analyzedAt: string;
    engine: {
        name: string;
        path: string;
        args: string[];
        options: Array<{ name: string; value: string }>;
        limit: string;
    };
    requestedGames: number;
    analyzedGames: number;
    skippedGames: number;
    moves: number;
    acpl: number | null;
    inaccuracies: number;
    mistakes: number;
    blunders: number;
    advantageGames: number;
    convertedAdvantages: number;
    conversionRate: number | null;
    inferiorGames: number;
    savedInferiorGames: number;
    defenseRate: number | null;
    phases: PlayerEngineGameMetrics["phases"];
    recurringErrors: Array<{
        key: string;
        phase: PlayerAnalysisPhase;
        classification: PlayerAnalysisClassification;
        opening: string;
        count: number;
        averageLoss: number;
        references: PlayerAnalysisReference[];
    }>;
    games: PlayerEngineGameMetrics[];
    criticalPositions: PlayerAnalysisCriticalPosition[];
};

export const DEFAULT_PLAYER_ANALYSIS_FILTERS: PlayerAnalysisFilters = {
    startDate: null,
    endDate: null,
    color: "any",
    opponentEloMin: null,
    opponentEloMax: null,
    timeControl: null,
};

type Perspective = {
    isWhite: boolean;
    player: string;
    opponent: string;
    playerElo: number | null;
    opponentElo: number | null;
    outcome: "win" | "draw" | "loss" | "unknown";
};

function perspective(item: PlayerAnalysisGame): Perspective {
    const isWhite = item.game.white_id === item.source.playerId;
    const result = item.game.result;
    const outcome =
        result === "1/2-1/2"
            ? "draw"
            : result === "*"
              ? "unknown"
              : (result === "1-0") === isWhite
                ? "win"
                : "loss";
    return {
        isWhite,
        player: isWhite ? item.game.white : item.game.black,
        opponent: isWhite ? item.game.black : item.game.white,
        playerElo: isWhite ? (item.game.white_elo ?? null) : (item.game.black_elo ?? null),
        opponentElo: isWhite ? (item.game.black_elo ?? null) : (item.game.white_elo ?? null),
        outcome,
    };
}

function reference(item: PlayerAnalysisGame, ply: number | null = null): PlayerAnalysisReference {
    return {
        key: item.key,
        databasePath: item.source.databasePath,
        databaseTitle: item.source.databaseTitle,
        gameId: item.game.id,
        playerId: item.source.playerId,
        ply,
    };
}

function mean(values: Array<number | null>): number | null {
    const known = values.filter((value): value is number => value != null);
    return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

function bucket(key: string, games: PlayerAnalysisGame[]): PlayerAnalysisBucket {
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let unknown = 0;
    const views = games.map(perspective);
    for (const view of views) {
        if (view.outcome === "win") wins += 1;
        else if (view.outcome === "draw") draws += 1;
        else if (view.outcome === "loss") losses += 1;
        else unknown += 1;
    }
    const known = wins + draws + losses;
    return {
        key,
        games: games.length,
        wins,
        draws,
        losses,
        unknown,
        scorePercent: known ? ((wins + draws / 2) / known) * 100 : null,
        averagePlayerElo: mean(views.map((view) => view.playerElo)),
        averageOpponentElo: mean(views.map((view) => view.opponentElo)),
        references: games.slice(0, 100).map((game) => reference(game)),
    };
}

function group(
    games: PlayerAnalysisGame[],
    getKey: (game: PlayerAnalysisGame, view: Perspective) => string,
): PlayerAnalysisBucket[] {
    const groups = new Map<string, PlayerAnalysisGame[]>();
    for (const game of games) {
        const key = getKey(game, perspective(game));
        const values = groups.get(key) ?? [];
        values.push(game);
        groups.set(key, values);
    }
    return [...groups.entries()]
        .map(([key, values]) => bucket(key, values))
        .sort((a, b) => b.games - a.games || a.key.localeCompare(b.key));
}

function opponentRatingBand(elo: number | null): string {
    if (elo == null) return "unknown";
    if (elo < 1200) return "<1200";
    if (elo < 1600) return "1200–1599";
    if (elo < 1800) return "1600–1799";
    if (elo < 2000) return "1800–1999";
    if (elo < 2200) return "2000–2199";
    if (elo < 2400) return "2200–2399";
    return "2400+";
}

function ratingDifferenceBand(view: Perspective): string {
    if (view.playerElo == null || view.opponentElo == null) return "unknown";
    const difference = view.opponentElo - view.playerElo;
    if (difference <= -200) return "opponent ≤ -200";
    if (difference <= -50) return "opponent -199…-50";
    if (difference < 50) return "similar rating";
    if (difference < 200) return "opponent +50…+199";
    return "opponent ≥ +200";
}

export function filtersPlayerAnalysisGame(
    game: PlayerAnalysisGame,
    filters: PlayerAnalysisFilters,
): boolean {
    const view = perspective(game);
    if (filters.color === "white" && !view.isWhite) return false;
    if (filters.color === "black" && view.isWhite) return false;
    if (filters.startDate && (!game.game.date || game.game.date < filters.startDate)) return false;
    if (filters.endDate && (!game.game.date || game.game.date > filters.endDate)) return false;
    if (filters.timeControl && (game.game.time_control || "unknown") !== filters.timeControl) {
        return false;
    }
    if (filters.opponentEloMin != null && (view.opponentElo ?? -1) < filters.opponentEloMin) {
        return false;
    }
    if (
        filters.opponentEloMax != null &&
        (view.opponentElo ?? Number.MAX_VALUE) > filters.opponentEloMax
    ) {
        return false;
    }
    return true;
}

export function selectPlayerEngineGames(
    games: PlayerAnalysisGame[],
    filters: PlayerAnalysisFilters,
    limit: number | "all",
): PlayerAnalysisGame[] {
    const eligible = games
        .filter((game) => filtersPlayerAnalysisGame(game, filters))
        .sort(
            (a, b) => (b.game.date ?? "").localeCompare(a.game.date ?? "") || b.game.id - a.game.id,
        );
    return limit === "all" ? eligible : eligible.slice(0, Math.max(1, limit));
}

function findingPriority(
    scorePercent: number | null,
    sample: number,
): PlayerAnalysisFinding["priority"] {
    if (sample >= 10 && scorePercent != null && scorePercent < 35) return "high";
    if (sample >= 5 && scorePercent != null && scorePercent < 45) return "medium";
    return "low";
}

function buildFindings(
    summary: PlayerAnalysisBucket,
    byColor: PlayerAnalysisBucket[],
    byTimeControl: PlayerAnalysisBucket[],
    openings: PlayerAnalysisBucket[],
    byRating: PlayerAnalysisBucket[],
): PlayerAnalysisFinding[] {
    const findings: PlayerAnalysisFinding[] = [];
    const weak = (
        category: PlayerAnalysisFinding["category"],
        values: PlayerAnalysisBucket[],
        minimum: number,
    ) => {
        for (const value of values) {
            if (value.games < minimum || value.scorePercent == null || value.scorePercent >= 45)
                continue;
            findings.push({
                id: `${category}:${value.key}`,
                category,
                priority: findingPriority(value.scorePercent, value.games),
                subject: value.key,
                sampleSize: value.games,
                scorePercent: value.scorePercent,
                references: value.references,
            });
        }
    };
    weak("opening", openings, 5);
    weak("timeControl", byTimeControl, 8);
    weak("rating", byRating, 8);
    if (summary.games >= 10) weak("color", byColor, 5);
    return findings.sort(
        (a, b) =>
            ({ high: 0, medium: 1, low: 2 })[a.priority] -
                { high: 0, medium: 1, low: 2 }[b.priority] || b.sampleSize - a.sampleSize,
    );
}

export function analyzePlayerGames(
    playerName: string,
    games: PlayerAnalysisGame[],
    sources: PlayerAnalysisSource[],
    filters: PlayerAnalysisFilters = DEFAULT_PLAYER_ANALYSIS_FILTERS,
    generatedAt = new Date().toISOString(),
): PlayerMetadataAnalysis {
    const filtered = games.filter((game) => filtersPlayerAnalysisGame(game, filters));
    const byColor = group(filtered, (_game, view) => (view.isWhite ? "white" : "black"));
    const byTimeControl = group(filtered, (game) => game.game.time_control || "unknown");
    const byOpponentRating = group(filtered, (_game, view) => opponentRatingBand(view.opponentElo));
    const byRatingDifference = group(filtered, (_game, view) => ratingDifferenceBand(view));
    const openings = group(
        filtered,
        (game) => game.game.opening || game.game.eco || "Unknown opening",
    );
    const opponents = group(filtered, (_game, view) => view.opponent || "Unknown opponent");
    const byYear = group(filtered, (game) => game.game.date?.slice(0, 4) || "unknown");
    const summary = bucket("all", filtered);
    return {
        schemaVersion: PLAYER_ANALYSIS_SCHEMA_VERSION,
        generatedAt,
        playerName,
        sources,
        filters,
        sampleSize: filtered.length,
        summary,
        byColor,
        byTimeControl,
        byOpponentRating,
        byRatingDifference,
        openings,
        opponents,
        byYear,
        findings: buildFindings(summary, byColor, byTimeControl, openings, byRatingDifference),
    };
}

function classifyPhase(fen: string, ply: number): PlayerAnalysisPhase {
    const board = fen.split(" ")[0]?.toLowerCase() ?? "";
    const queens = (board.match(/q/g) ?? []).length;
    const nonPawnPieces = (board.match(/[qrbn]/g) ?? []).length;
    if (ply < 20 && queens > 0 && nonPawnPieces >= 10) return "opening";
    if (queens === 0 && nonPawnPieces <= 6) return "endgame";
    return "middlegame";
}

function classification(loss: number): PlayerAnalysisClassification | null {
    if (loss >= 200) return "blunder";
    if (loss >= 100) return "mistake";
    if (loss >= 40) return "inaccuracy";
    return null;
}

export function buildEngineGameMetrics(input: {
    item: PlayerAnalysisGame;
    uciMoves: string[];
    preMoveFens: string[];
    analysis: MoveAnalysis[];
}): PlayerEngineGameMetrics {
    const { item, uciMoves, preMoveFens, analysis } = input;
    const losses: Array<{ loss: number; phase: PlayerAnalysisPhase }> = [];
    const criticalPositions: PlayerAnalysisCriticalPosition[] = [];
    let hadAdvantage = false;
    let wasInferior = false;
    for (let ply = 0; ply < uciMoves.length; ply += 1) {
        const preFen = preMoveFens[ply];
        const [position] = positionFromFen(preFen);
        if (!position) continue;
        const playerTurn =
            (position.turn === "white" && item.game.white_id === item.source.playerId) ||
            (position.turn === "black" && item.game.black_id === item.source.playerId);
        if (!playerTurn || !analysis[ply]?.best[0] || !analysis[ply + 1]?.best[0]) continue;
        const playerScore = normalizeScore(analysis[ply].best[0].score.value, position.turn);
        if (playerScore >= 150) hadAdvantage = true;
        if (playerScore <= -150) wasInferior = true;
        const loss = getCPLoss(
            analysis[ply].best[0].score.value,
            analysis[ply + 1].best[0].score.value,
            position.turn,
        );
        const phase = classifyPhase(preFen, ply);
        losses.push({ loss, phase });
        const label = classification(loss);
        if (label) {
            criticalPositions.push({
                ...reference(item, ply),
                fen: preFen,
                playedMove: uciMoves[ply],
                bestLine: analysis[ply].best[0].uciMoves.slice(0, 8),
                cpLoss: loss,
                classification: label,
                phase,
                opening: item.game.opening || item.game.eco || "Unknown opening",
                gameLabel: `${item.game.white} – ${item.game.black}`,
            });
        }
    }
    const summarize = (values: typeof losses) => ({
        moves: values.length,
        acpl: values.length
            ? values.reduce((sum, value) => sum + value.loss, 0) / values.length
            : null,
        inaccuracies: values.filter((value) => value.loss >= 40 && value.loss < 100).length,
        mistakes: values.filter((value) => value.loss >= 100 && value.loss < 200).length,
        blunders: values.filter((value) => value.loss >= 200).length,
    });
    return {
        key: item.key,
        reference: reference(item),
        ...summarize(losses),
        hadAdvantage,
        convertedAdvantage: hadAdvantage && perspective(item).outcome === "win",
        wasInferior,
        savedInferior: wasInferior && ["win", "draw"].includes(perspective(item).outcome),
        phases: (["opening", "middlegame", "endgame"] as PlayerAnalysisPhase[]).map((phase) => ({
            phase,
            ...summarize(losses.filter((value) => value.phase === phase)),
        })),
        criticalPositions,
    };
}

export function aggregateEngineAnalysis(input: {
    engine: PlayerEngineAnalysis["engine"];
    requestedGames: number;
    skippedGames: number;
    games: PlayerEngineGameMetrics[];
    analyzedAt?: string;
}): PlayerEngineAnalysis {
    const metrics = input.games;
    const moves = metrics.reduce((sum, game) => sum + game.moves, 0);
    const weightedLoss = metrics.reduce((sum, game) => sum + (game.acpl ?? 0) * game.moves, 0);
    const phases = (["opening", "middlegame", "endgame"] as PlayerAnalysisPhase[]).map((phase) => {
        const values = metrics.map((game) => game.phases.find((value) => value.phase === phase)!);
        const phaseMoves = values.reduce((sum, value) => sum + value.moves, 0);
        return {
            phase,
            moves: phaseMoves,
            acpl: phaseMoves
                ? values.reduce((sum, value) => sum + (value.acpl ?? 0) * value.moves, 0) /
                  phaseMoves
                : null,
            inaccuracies: values.reduce((sum, value) => sum + value.inaccuracies, 0),
            mistakes: values.reduce((sum, value) => sum + value.mistakes, 0),
            blunders: values.reduce((sum, value) => sum + value.blunders, 0),
        };
    });
    const advantageGames = metrics.filter((game) => game.hadAdvantage).length;
    const convertedAdvantages = metrics.filter((game) => game.convertedAdvantage).length;
    const inferiorGames = metrics.filter((game) => game.wasInferior).length;
    const savedInferiorGames = metrics.filter((game) => game.savedInferior).length;
    const criticalPositions = metrics
        .flatMap((game) => game.criticalPositions)
        .sort((a, b) => b.cpLoss - a.cpLoss);
    const recurring = new Map<string, PlayerAnalysisCriticalPosition[]>();
    for (const critical of criticalPositions) {
        const key = `${critical.phase}:${critical.classification}:${critical.opening}`;
        recurring.set(key, [...(recurring.get(key) ?? []), critical]);
    }
    return {
        schemaVersion: PLAYER_ANALYSIS_SCHEMA_VERSION,
        analyzedAt: input.analyzedAt ?? new Date().toISOString(),
        engine: input.engine,
        requestedGames: input.requestedGames,
        analyzedGames: metrics.length,
        skippedGames: input.skippedGames,
        moves,
        acpl: moves ? weightedLoss / moves : null,
        inaccuracies: metrics.reduce((sum, game) => sum + game.inaccuracies, 0),
        mistakes: metrics.reduce((sum, game) => sum + game.mistakes, 0),
        blunders: metrics.reduce((sum, game) => sum + game.blunders, 0),
        advantageGames,
        convertedAdvantages,
        conversionRate: advantageGames ? (convertedAdvantages / advantageGames) * 100 : null,
        inferiorGames,
        savedInferiorGames,
        defenseRate: inferiorGames ? (savedInferiorGames / inferiorGames) * 100 : null,
        phases,
        recurringErrors: [...recurring.entries()]
            .filter(([, values]) => values.length >= 2)
            .map(([key, values]) => ({
                key,
                phase: values[0].phase,
                classification: values[0].classification,
                opening: values[0].opening,
                count: values.length,
                averageLoss: values.reduce((sum, value) => sum + value.cpLoss, 0) / values.length,
                references: values.slice(0, 20).map((value) => ({
                    key: value.key,
                    databasePath: value.databasePath,
                    databaseTitle: value.databaseTitle,
                    gameId: value.gameId,
                    playerId: value.playerId,
                    ply: value.ply,
                })),
            }))
            .sort((a, b) => b.count - a.count || b.averageLoss - a.averageLoss),
        games: metrics,
        criticalPositions,
    };
}
