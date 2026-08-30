import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { ChildNode, defaultGame, makePgn, type Node, type PgnNodeData } from "chessops/pgn";
import { parseSan } from "chessops/san";
import type { TFunction } from "i18next";
import type { OpeningReport, ReportResults } from "@/bindings";

export function reportGames(results: ReportResults) {
    return results.white + results.draw + results.black + results.unknown;
}

export function reportScore(results: ReportResults) {
    const known = results.white + results.draw + results.black;
    return known ? ((results.white + results.draw / 2) / known) * 100 : null;
}

export function reportMoveLabel(fen: string, offset: number) {
    const setup = parseFen(fen).unwrap();
    const ply = (setup.fullmoves - 1) * 2 + (setup.turn === "black" ? 1 : 0) + offset;
    return `${Math.floor(ply / 2) + 1}${ply % 2 ? "..." : "."}`;
}

export function reportNotation(moves: string[], fen: string) {
    return moves.map((move, i) => `${reportMoveLabel(fen, i)} ${move}`).join(" ");
}

export function reportCommonPrefix(previous: string[], current: string[]) {
    let length = 0;
    while (
        length < Math.min(previous.length, current.length) &&
        previous[length] === current[length]
    )
        length++;
    return length;
}

export function reportFilterText(report: OpeningReport, t: TFunction): string {
    const filters = report.filters;
    const parts: string[] = [];
    if (filters.whitePlayer != null) parts.push(`${t("Fen.White")}: #${filters.whitePlayer}`);
    if (filters.blackPlayer != null) parts.push(`${t("Fen.Black")}: #${filters.blackPlayer}`);
    if (filters.anyPlayer != null)
        parts.push(`${t("OpeningReport.Player")}: #${filters.anyPlayer}`);
    const sameElo =
        filters.whiteElo &&
        filters.blackElo &&
        filters.whiteElo[0] === filters.blackElo[0] &&
        filters.whiteElo[1] === filters.blackElo[1];
    if (sameElo) parts.push(`ELO ${filters.whiteElo!.join("–")}`);
    else {
        if (filters.whiteElo) parts.push(`${t("Fen.White")} ELO ${filters.whiteElo.join("–")}`);
        if (filters.blackElo) parts.push(`${t("Fen.Black")} ELO ${filters.blackElo.join("–")}`);
    }
    if (filters.startDate || filters.endDate)
        parts.push(`${filters.startDate ?? "…"} → ${filters.endDate ?? "…"}`);
    if (filters.result) {
        const labels: Record<string, string> = {
            whitewon: "1-0",
            blackwon: "0-1",
            draw: "½-½",
            unknown: "*",
        };
        parts.push(
            `${t("Board.Database.Local.Result")}: ${labels[filters.result] ?? filters.result}`,
        );
    }
    return parts.join(" · ") || t("OpeningReport.NoFilters");
}

const headerValue = (value: string) => value.replaceAll("\0", " ").replace(/[\r\n]/g, " ");
function reportPgnBase(report: OpeningReport, fen: string) {
    const game = defaultGame<PgnNodeData>();
    game.headers.set("Event", "Opening report");
    game.headers.set("Date", report.generatedAt.slice(0, 10).replaceAll("-", "."));
    game.headers.set("Result", "*");
    game.headers.set("SetUp", "1");
    game.headers.set("FEN", headerValue(fen));
    game.headers.set("SourceDatabase", headerValue(report.databaseName));
    game.headers.set("ReportVersion", String(report.version));
    game.headers.set("ReportPosition", headerValue(report.options.displayFen));
    game.headers.set("ReportCohort", String(reportGames(report.cohort.results)));
    game.headers.set("ReportRevision", headerValue(report.position.fingerprint));
    game.headers.set("ReportGeneratedAt", headerValue(report.generatedAt));
    game.headers.set("ReportDepth", String(report.options.depth));
    game.headers.set("ReportTheoryLimit", String(report.options.theoryGames));
    game.headers.set("ReportLineLimit", String(report.options.maxLines));
    game.headers.set("ReportFilters", headerValue(JSON.stringify(report.filters)));
    return game;
}

function appendLine(root: Node<PgnNodeData>, moves: string[], fen: string) {
    const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    let node = root;
    for (const san of moves) {
        const move = parseSan(position, san);
        if (!move) throw new Error("Invalid report variation");
        position.play(move);
        let child = node.children.find((child) => child.data.san === san);
        if (!child) {
            child = new ChildNode<PgnNodeData>({ san });
            node.children.push(child);
        }
        node = child;
    }
    return node;
}

export function openingVariationPgn(
    report: OpeningReport,
    moves: string[],
    fen = report.options.displayFen,
) {
    const game = reportPgnBase(report, fen);
    appendLine(game.moves, moves, fen);
    return makePgn(game);
}

export function openingTheoryPgn(report: OpeningReport) {
    const game = reportPgnBase(report, report.options.displayFen);
    game.comments = [
        "Selected theory cohort ranked by mean Elo, year and game ID. Statistics describe played games, not engine evaluations.",
    ];
    for (const line of report.theory) {
        const node = appendLine(game.moves, line.moves, report.options.displayFen);
        const results = line.statistics.results;
        const comment = `Games ${reportGames(results)}; White ${results.white}; Draw ${results.draw}; Black ${results.black}; Unknown ${results.unknown}; Reference ID ${line.example.id}`;
        if (node instanceof ChildNode)
            node.data.comments = [...(node.data.comments ?? []), comment];
        else game.comments.push(comment);
    }
    return makePgn(game);
}

export const escapeReportHtml = (value: unknown) =>
    String(value ?? "").replace(
        /[&<>"']/g,
        (character) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
    );

export function openingReportHtml(report: OpeningReport, t: TFunction) {
    const escape = escapeReportHtml;
    const label = (key: string) => escape(t(`OpeningReport.${key}`));
    const count = reportGames;
    const score = (results: ReportResults) => {
        const value = reportScore(results);
        return value == null ? "—" : `${value.toFixed(1)}%`;
    };
    const outcomes = (results: ReportResults) =>
        `${results.white} / ${results.draw} / ${results.black} / ${results.unknown}`;
    const resultRates = (results: ReportResults) => {
        const known = results.white + results.draw + results.black;
        return known
            ? [results.white, results.draw, results.black]
                  .map((value) => `${((value / known) * 100).toFixed(1)}%`)
                  .join(" / ")
            : "—";
    };
    const playerRows = (players: OpeningReport["mostPlayedPlayers"]) =>
        players
            .map((player) => {
                const known = player.wins + player.draws + player.losses;
                const playerScore = known
                    ? `${(((player.wins + player.draws / 2) / known) * 100).toFixed(1)}%`
                    : "—";
                const winRate = known ? `${((player.wins / known) * 100).toFixed(1)}%` : "—";
                return `<tr><td>${escape(player.name)}</td><td>${player.games}</td><td>${player.whiteGames} / ${player.blackGames}</td><td>${player.wins} / ${player.draws} / ${player.losses} / ${player.unknown}</td><td>${playerScore}</td><td>${winRate}</td><td>${player.averageElo?.toFixed(0) ?? "—"} / ${player.peakElo ?? "—"}</td></tr>`;
            })
            .join("");
    const playerTable = (players: OpeningReport["mostPlayedPlayers"]) =>
        `<div class="scroll"><table><thead><tr><th>${label("Player")}</th><th>${label("Games")}</th><th>${label("Colors")}</th><th>${label("PlayerResults")}</th><th>${label("Score")}</th><th>${label("WinRate")}</th><th>${label("PlayerElo")}</th></tr></thead><tbody>${playerRows(players)}</tbody></table></div>`;
    const head = report.position.openings
        .map((move) => ({
            move: move.move,
            results: {
                white: move.white,
                draw: move.draw,
                black: move.black,
                unknown: move.unknown,
            },
        }))
        .sort((a, b) => count(b.results) - count(a.results) || a.move.localeCompare(b.move));
    const rows = report.theory
        .map((line, i) => {
            const common = reportCommonPrefix(report.theory[i - 1]?.moves ?? [], line.moves);
            return `<tr><th>${i + 1}</th>${Array.from({ length: report.options.depth }, (_, ply) => `<td title="${escape(line.moves[ply])}">${ply < common ? "…" : escape(line.moves[ply] ?? "—")}</td>`).join("")}<td>${count(line.statistics.results)}</td><td>${score(line.statistics.results)}</td><td>${escape(`${line.example.white} – ${line.example.black}`)}<br>${escape(line.example.date)} · #${line.example.id}</td></tr>`;
        })
        .join("");
    const board = parseFen(report.options.displayFen).unwrap().board;
    const symbols = {
        white: { king: "♔", queen: "♕", rook: "♖", bishop: "♗", knight: "♘", pawn: "♙" },
        black: { king: "♚", queen: "♛", rook: "♜", bishop: "♝", knight: "♞", pawn: "♟" },
    };
    const squares = Array.from({ length: 64 }, (_, i) => {
        const file = i % 8,
            rank = 7 - Math.floor(i / 8);
        const piece = board.get(rank * 8 + file);
        return `<span class="square ${(file + rank) % 2 ? "light" : "dark"}">${piece ? symbols[piece.color][piece.role] : ""}</span>`;
    }).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${label("Title")}</title><style>
body{font:15px system-ui,sans-serif;background:#f5f5f2;color:#232826;margin:0}main{max-width:1200px;margin:auto;padding:36px}h1{font-size:32px;margin:0 0 12px}h2{margin-top:32px}p{line-height:1.6}header{display:flex;gap:28px;align-items:center;flex-wrap:wrap}.board{display:grid;grid-template-columns:repeat(8,28px);border:1px solid #777}.square{width:28px;height:28px;text-align:center;font-size:25px;line-height:28px}.light{background:#ede9de}.dark{background:#9ea897}.scroll{overflow:auto}table{border-collapse:collapse;background:white;width:100%;font-size:13px}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left;white-space:nowrap}th{background:#e9eee9}code{overflow-wrap:anywhere;white-space:normal}aside{background:#e7eee9;padding:14px;border-left:3px solid #526b57}small{color:#5a645e}@media print{body{background:white}main{padding:0}table{font-size:10px}th,td{padding:4px}tr{break-inside:avoid}.scroll{overflow:visible}}
</style></head><body><main><header><div class="board" aria-label="FEN">${squares}</div><div><h1>${label("Title")}</h1><p>${escape(report.databaseName)} · ${escape(report.generatedAt)}<br>${escape(reportFilterText(report, t))}</p><code>${escape(report.options.displayFen)}</code></div></header>
<h2>${label("Overview")}</h2><p>${label("Matching")}: <strong>${report.position.total}</strong> / ${report.databaseGames}<br>${label("WhiteScore")}: ${score(report.statistics.results)} · ${label("Outcomes")}: ${outcomes(report.statistics.results)}<br>${label("AverageElo")}: ${report.statistics.averageWhiteElo?.toFixed(0) ?? "—"} / ${report.statistics.averageBlackElo?.toFixed(0) ?? "—"}</p><small>${label("Denominators")}</small>
${report.position.skippedGames ? `<aside>${escape(t("Board.Database.SkippedGames", { count: report.position.skippedGames }))}</aside>` : ""}
<h2>${label("Continuations")}</h2><table><thead><tr><th>${label("Move")}</th><th>${label("Games")}</th><th>${label("WhiteScore")}</th><th>${label("Outcomes")}</th></tr></thead><tbody>${head.map((row) => `<tr><td>${escape(row.move)}</td><td>${count(row.results)}</td><td>${score(row.results)}</td><td>${outcomes(row.results)}</td></tr>`).join("")}</tbody></table>
<h2>${label("History")}</h2><table><thead><tr><th>${label("Year")}</th><th>${label("Games")}</th><th>${label("WhiteScore")}</th></tr></thead><tbody>${report.years.map((row) => `<tr><td>${row.year}</td><td>${count(row.results)}</td><td>${score(row.results)}</td></tr>`).join("")}</tbody></table><p>${label("UnknownYear")}: ${report.unknownYearGames}</p>
<h2>${label("EloBands")}</h2><p>${escape(t("OpeningReport.EloBandsScope", { unknown: report.unknownEloGames }))}</p><table><thead><tr><th>${label("EloBand")}</th><th>${label("Games")}</th><th>${label("Frequency")}</th><th>${label("WhiteScore")}</th><th>${label("ResultRates")}</th><th>${label("Outcomes")}</th></tr></thead><tbody>${report.eloBands.map((band) => `<tr><td>${band.maxElo >= 32767 ? `${band.minElo}+` : `${band.minElo}–${band.maxElo}`}</td><td>${count(band.results)}</td><td>${report.position.total ? ((count(band.results) / report.position.total) * 100).toFixed(1) : "0"}%</td><td>${score(band.results)}</td><td>${resultRates(band.results)}</td><td>${outcomes(band.results)}</td></tr>`).join("")}</tbody></table>
<h2>${label("FrequentPlayers")}</h2><p>${escape(t("OpeningReport.PlayersScope", { count: report.playerCount }))}</p>${playerTable(report.mostPlayedPlayers)}
<h2>${label("StrongestPlayers")}</h2><p>${label("StrongestPlayersScope")}</p>${playerTable(report.strongestPlayers)}
<h2>${label("Theory")}</h2><aside>${escape(t("OpeningReport.Cohort", { selected: count(report.cohort.results), total: report.position.total }))}<br>${label("Selection")}<br>${escape(t("OpeningReport.LinesShown", { shown: report.theory.length, total: report.theoryLineCount, games: report.displayedTheoryGames }))}<br>${label("ExcludedTheory")}: ${report.excludedTheoryGames}</aside><p>${label("CommonPrefix")}</p><div class="scroll"><table><thead><tr><th>#</th>${Array.from({ length: report.options.depth }, (_, ply) => `<th>${escape(reportMoveLabel(report.options.displayFen, ply))}</th>`).join("")}<th>${label("Games")}</th><th>${label("WhiteScore")}</th><th>${label("Reference")}</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>${label("MoveOrders")}</h2><p>${label("CohortOnly")} ${escape(t("OpeningReport.OrdersShown", { shown: report.moveOrders.length, total: report.moveOrderCount }))}</p><ol>${report.moveOrders.map((order) => `<li><p>${escape(reportNotation(order.moves, order.startFen) || t("OpeningReport.StartsHere"))} · ${count(order.statistics.results)} ${label("Games")}</p><small>FEN: ${escape(order.startFen)}</small></li>`).join("")}</ol>
<h2>${label("Transpositions")}</h2><p>${label("TranspositionScope")} ${escape(t("OpeningReport.TranspositionsShown", { shown: report.transpositions.length, total: report.transpositionCount }))}</p>${report.transpositions.map((group, i) => `<section id="transposition-${i}"><h3>${group.ply}: ${group.games} ${label("Games")}</h3><code>${escape(group.fen)}</code><ul>${group.routes.map((route) => `<li>${escape(reportNotation(route.moves, report.options.displayFen))} · ${count(route.results)}</li>`).join("")}</ul><small>${escape(t("OpeningReport.RoutesShown", { shown: group.routes.length, total: group.routeCount }))}</small></section>`).join("") || `<p>${label("NoTranspositions")}</p>`}
<footer><h2>${label("Provenance")}</h2><p>${label("Method")}</p><p>${label("Version")}: ${report.version} · ${report.elapsedMs.toFixed(0)} ms</p><code>${escape(report.position.fingerprint)}</code></footer></main></body></html>`;
}
