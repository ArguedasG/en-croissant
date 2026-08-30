import { Alert, Button, Group, Modal, NumberInput, ScrollArea, Stack, Text } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom, useStore } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type OpeningReport, type PositionSummary } from "@/bindings";
import { activeTabAtom, dbTabFamily, localOptionsFamily, tabFamily, tabsAtom } from "@/state/atoms";
import { openingReportHtml, openingTheoryPgn, openingVariationPgn } from "@/utils/openingReport";
import { openingReferenceGamesPgn, saveOpeningReport } from "@/utils/openingReportFiles";
import { createTab } from "@/utils/tabs";
import DatabaseLoader from "./DatabaseLoader";
import OpeningReportView from "./OpeningReportView";

export default function OpeningReportPanel({
  snapshot,
  displayFen,
  databasePath,
  owner,
  onGames,
  onExpired,
}: {
  snapshot: PositionSummary;
  displayFen: string;
  databasePath: string;
  owner: string;
  onGames: () => void;
  onExpired: () => void;
}) {
  const { t } = useTranslation();
  const setTabs = useSetAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const atomStore = useStore();
  const navigate = useNavigate();
  const [depth, setDepth] = useState(12);
  const [theoryGames, setTheoryGames] = useState(5000);
  const [report, setReport] = useState<OpeningReport | null>(null);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const running = useRef<AbortController | null>(null);
  const reportOwner = `report:${owner}`;

  useEffect(
    () => () => {
      running.current?.abort();
    },
    [],
  );
  const cancel = () => {
    running.current?.abort();
    running.current = null;
    setBusy(false);
  };
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (running.current) return;
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setMessage(null);
    setSaved(false);
    controller.signal.addEventListener(
      "abort",
      () => {
        void commands.cancelPositionSearch(reportOwner);
      },
      { once: true },
    );
    try {
      await action(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        const expired = error instanceof Error && error.message === "Position query expired";
        setMessage(t(expired ? "OpeningReport.Expired" : "OpeningReport.Failed"));
        if (expired) {
          setReport(null);
          setOpened(false);
          onExpired();
        }
      }
    } finally {
      if (running.current === controller) {
        running.current = null;
        setBusy(false);
      }
    }
  };
  const generate = () =>
    run(async (signal) => {
      const response = await commands.generateOpeningReport(
        snapshot.token,
        { depth, theoryGames, maxLines: 64, displayFen },
        reportOwner,
      );
      signal.throwIfAborted();
      if (response.status === "error") throw new Error(response.error);
      setReport(response.data);
      setOpened(true);
    });
  const game = (offset: number, extraPly = 0) =>
    run(async (signal) => {
      if (!report) return;
      const response = await commands.getPositionGame(report.position.token, offset);
      signal.throwIfAborted();
      if (response.status === "error") throw new Error(response.error);
      const { game, ply } = response.data;
      await createTab({
        tab: { name: `${game.white} - ${game.black}`, type: "analysis" },
        setTabs,
        setActiveTab,
        pgn: game.moves,
        headers: game,
        position: Array(ply + extraPly).fill(0),
        gameOrigin: { kind: "database", database: databasePath, gameId: game.id },
      });
      setOpened(false);
      navigate({ to: "/" });
    });
  const variant = (moves: string[], fen?: string) =>
    run(async (signal) => {
      if (!report) return;
      const pgn = openingVariationPgn(report, moves, fen);
      signal.throwIfAborted();
      await createTab({
        tab: { name: t("OpeningReport.Variation"), type: "analysis" },
        setTabs,
        setActiveTab,
        pgn,
        position: Array(moves.length).fill(0),
      });
      setOpened(false);
      navigate({ to: "/" });
    });
  const player = (id: number, name: string) =>
    run(async (signal) => {
      if (!report) return;
      const pgn = openingVariationPgn(report, []);
      signal.throwIfAborted();
      const tabId = await createTab({
        tab: { name: `${name} · ${t("Board.Database.Games")}`, type: "analysis" },
        setTabs,
        setActiveTab,
        pgn,
      });
      const sameElo =
        report.filters.whiteElo &&
        report.filters.blackElo &&
        report.filters.whiteElo[0] === report.filters.blackElo[0] &&
        report.filters.whiteElo[1] === report.filters.blackElo[1]
          ? report.filters.whiteElo
          : null;
      atomStore.set(localOptionsFamily(tabId), {
        path: databasePath,
        fen: report.options.displayFen,
        type: "exact",
        player: id,
        color: "any",
        result: (report.filters.result ?? "any") as "any" | "whitewon" | "draw" | "blackwon",
        start_date: report.filters.startDate ?? undefined,
        end_date: report.filters.endDate ?? undefined,
        elo_min: sameElo?.[0],
        elo_max: sameElo?.[1],
      });
      atomStore.set(tabFamily(tabId), "database");
      atomStore.set(dbTabFamily(tabId), "games");
      setOpened(false);
      navigate({ to: "/" });
    });
  const exportFile = (format: "html" | "theory" | "games") =>
    run(async (signal) => {
      if (!report) return;
      const content =
        format === "html"
          ? openingReportHtml(report, t)
          : format === "theory"
            ? openingTheoryPgn(report)
            : await openingReferenceGamesPgn(report, signal);
      const didSave = await saveOpeningReport(
        content,
        format === "html" ? "html" : "pgn",
        databasePath,
        t,
        signal,
      );
      if (!signal.aborted) setSaved(didSave);
    });
  const feedback = (
    <>
      {message && <Alert color="red">{message}</Alert>}
      {saved && <Alert color="green">{t("OpeningReport.Saved")}</Alert>}
    </>
  );
  return (
    <Stack p="sm" gap="md">
      <Text fw={600}>{t("OpeningReport.Title")}</Text>
      <Text size="sm" c="dimmed">
        {t("OpeningReport.Intro")}
      </Text>
      <Group grow align="start">
        <NumberInput
          label={t("OpeningReport.Depth")}
          min={1}
          max={16}
          allowDecimal={false}
          value={depth}
          disabled={busy}
          onChange={(value) => setDepth(Math.max(1, Math.min(16, Number(value) || 1)))}
        />
        <NumberInput
          label={t("OpeningReport.TheoryGames")}
          min={1}
          max={10000}
          step={500}
          allowDecimal={false}
          value={theoryGames}
          disabled={busy}
          onChange={(value) => setTheoryGames(Math.max(1, Math.min(10000, Number(value) || 1)))}
        />
      </Group>
      <Text size="xs" c="dimmed">
        {t("OpeningReport.Selection")}
      </Text>
      <Group>
        <Button
          onClick={() => {
            void generate();
          }}
          disabled={busy || !snapshot.total}
        >
          {t("OpeningReport.Generate")}
        </Button>
        {report && (
          <Button variant="default" onClick={() => setOpened(true)}>
            {t("OpeningReport.Open")}
          </Button>
        )}
        {busy && (
          <Button color="red" variant="light" onClick={cancel}>
            {t("Common.Cancel")}
          </Button>
        )}
      </Group>
      {!snapshot.total && <Text c="dimmed">{t("Board.Database.NoGames")}</Text>}
      <DatabaseLoader isLoading={busy} tab={reportOwner} />
      {!opened && feedback}
      <Modal
        opened={opened}
        onClose={() => {
          cancel();
          setOpened(false);
        }}
        size="95%"
        title={t("OpeningReport.Title")}
        scrollAreaComponent={ModalScrollArea}
      >
        {report && (
          <Stack gap="lg">
            <Group>
              <Button
                variant="light"
                onClick={() => {
                  setOpened(false);
                  onGames();
                }}
              >
                {t("Board.Database.Games")}
              </Button>
              <Button
                variant="default"
                disabled={busy}
                onClick={() => {
                  void exportFile("html");
                }}
              >
                {t("OpeningReport.ExportHtml")}
              </Button>
              <Button
                variant="default"
                disabled={busy || !report.theory.length}
                onClick={() => {
                  void exportFile("theory");
                }}
              >
                {t("OpeningReport.ExportTheory")}
              </Button>
              <Button
                variant="default"
                disabled={busy || !report.theory.length}
                onClick={() => {
                  void exportFile("games");
                }}
              >
                {t("OpeningReport.ExportGames")}
              </Button>
              {busy && (
                <Button color="red" variant="subtle" onClick={cancel}>
                  {t("Common.Cancel")}
                </Button>
              )}
            </Group>
            {feedback}
            <OpeningReportView
              report={report}
              onVariant={(moves, fen) => {
                void variant(moves, fen);
              }}
              onGame={(offset, ply) => {
                void game(offset, ply);
              }}
              onPlayer={(id, name) => {
                void player(id, name);
              }}
              busy={busy}
            />
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

// Mantine's native modal scroll area keeps the report usable with narrow or short windows.
const ModalScrollArea = ScrollArea.Autosize;
