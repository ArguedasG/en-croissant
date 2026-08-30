import { parsePgn } from "chessops/pgn";
import i18n from "i18next";
import { beforeEach, expect, it } from "vitest";
import es from "@/translation/es-ES.json";
import { openingReportFixture } from "./openingReport.fixture";
import {
    openingReportHtml,
    openingTheoryPgn,
    openingVariationPgn,
    reportCommonPrefix,
    reportGames,
    reportMoveLabel,
    reportScore,
} from "./openingReport";

beforeEach(async () => {
    await i18n.init({ lng: "es-ES", resources: { "es-ES": es } });
});

it("separates unknown outcomes from the score denominator", () => {
    const results = { white: 2, draw: 2, black: 1, unknown: 5 };
    expect(reportGames(results)).toBe(10);
    expect(reportScore(results)).toBe(60);
    expect(reportScore({ white: 0, draw: 0, black: 0, unknown: 4 })).toBeNull();
});

it("preserves FEN move numbering, including black to move", () => {
    const report = openingReportFixture();
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 12";
    expect(reportMoveLabel(fen, 0)).toBe("12...");
    expect(reportMoveLabel(fen, 1)).toBe("13.");
    const game = parsePgn(openingVariationPgn(report, ["e5", "Nf3"], fen))[0];
    expect(game.headers.get("FEN")).toBe(fen);
    expect([...game.moves.mainline()].map((node) => node.san)).toEqual(["e5", "Nf3"]);
    expect(() => openingVariationPgn(report, ["Qh7#"])).toThrow("Invalid report variation");
});

it("exports a legal PGN tree with shared prefixes and reference provenance", () => {
    const report = openingReportFixture();
    const game = parsePgn(openingTheoryPgn(report))[0];
    expect(game.headers.get("ReportCohort")).toBe("3");
    expect(game.headers.get("SourceDatabase")).toBe(report.databaseName);
    expect(game.moves.children.map((node) => node.data.san)).toEqual(["d4", "Nf3"]);
    expect(game.moves.children[0].children.map((node) => node.data.san)).toEqual(["d5", "Nf6"]);
    expect(openingTheoryPgn(report)).toContain("Reference ID 3");
    expect(reportCommonPrefix(["d4", "d5", "c4"], ["d4", "Nf6"])).toBe(1);
});

it("escapes imported text in a standalone HTML report and retains full versus cohort scope", () => {
    const report = openingReportFixture();
    report.databaseName = '<script>alert("source")</script>';
    report.theory[0].example.white = '<img src=x onerror="alert(1)">';
    report.mostPlayedPlayers[0].name = '<img src=x onerror="player()">';
    report.position.skippedGames = 2;
    report.statistics.results = { white: 0, draw: 0, black: 0, unknown: 4 };
    const html = openingReportHtml(report, i18n.t);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll("script,img,iframe")).toHaveLength(0);
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull();
    expect(doc.body.textContent).toContain(report.databaseName);
    expect(doc.body.textContent).toContain(
        i18n.t("OpeningReport.Cohort", { selected: 3, total: 4 }),
    );
    expect(doc.body.textContent).toContain(i18n.t("Board.Database.SkippedGames", { count: 2 }));
    expect(doc.body.textContent).toContain("synthetic-revision-1");
    expect(doc.body.textContent).toContain('<img src=x onerror="player()">');
    expect(doc.body.textContent).toContain(i18n.t("OpeningReport.FrequentPlayers"));
    expect(doc.body.textContent).toContain(i18n.t("OpeningReport.EloBands"));
    expect(doc.body.textContent).not.toContain("—%");
    expect(doc.querySelectorAll(".square")).toHaveLength(64);
});
