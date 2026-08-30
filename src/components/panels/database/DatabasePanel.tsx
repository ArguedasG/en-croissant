import {
  Alert,
  Button,
  Group,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { Link } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import { memo, useContext, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr/immutable";
import { match } from "ts-pattern";
import { useStore } from "zustand";
import { commands, type NormalizedGame, type PositionSummary } from "@/bindings";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
  currentDbTabAtom,
  currentDbTypeAtom,
  currentLocalOptionsAtom,
  currentTabAtom,
  lichessOptionsAtom,
  masterOptionsAtom,
  referenceDbAtom,
  sessionsAtom,
} from "@/state/atoms";
import { getDatabases, isTransientPositionError, type Opening, queryPosition } from "@/utils/db";
import PositionGamesTable from "./PositionGamesTable";
import { formatNumber } from "@/utils/format";
import { convertToNormalized, getLichessGames, getMasterGames } from "@/utils/lichess/api";
import type { LichessGamesOptions, MasterGamesOptions } from "@/utils/lichess/explorer";
import DatabaseLoader from "./DatabaseLoader";
import GamesTable from "./GamesTable";
import NoDatabaseWarning from "./NoDatabaseWarning";
import OpeningsTable from "./OpeningsTable";
import OpeningReportPanel from "./OpeningReportPanel";
import LichessOptionsPanel from "./options/LichessOptionsPanel";
import LocalOptionsPanel from "./options/LocalOptionsPanel";
import MasterOptionsPanel from "./options/MastersOptionsPanel";

type DBType =
  | { type: "local"; options: LocalOptions }
  | {
      type: "lch_all";
      options: LichessGamesOptions;
      fen: string;
      token: string;
    }
  | {
      type: "lch_master";
      options: MasterGamesOptions;
      fen: string;
      token: string;
    };

export type LocalOptions = {
  path: string | null;
  fen: string;
  type: "exact" | "partial";
  player: number | null;
  color: "white" | "black" | "any";
  elo_min?: number;
  elo_max?: number;
  start_date?: string;
  end_date?: string;
  result: "any" | "whitewon" | "draw" | "blackwon";
};

function sortOpenings(openings: Opening[]) {
  return openings.sort(
    (a, b) =>
      b.black +
        b.draw +
        b.white +
        (b.unknown ?? 0) -
        (a.black + a.draw + a.white + (a.unknown ?? 0)) || a.move.localeCompare(b.move),
  );
}

async function fetchOpening(
  db: DBType,
  tab: string,
  signal?: AbortSignal,
): Promise<{ openings: Opening[]; games: NormalizedGame[]; snapshot?: PositionSummary }> {
  return match(db)
    .with({ type: "lch_all" }, async ({ fen, options, token }) => {
      const data = await getLichessGames(fen, options, token);
      return {
        openings: data.moves.map((move) => ({
          move: move.san,
          white: move.white,
          black: move.black,
          draw: move.draws,
        })),
        games: await convertToNormalized(data.topGames || data.recentGames || []),
      };
    })
    .with({ type: "lch_master" }, async ({ fen, options, token }) => {
      const data = await getMasterGames(fen, options, token);
      return {
        openings: data.moves.map((move) => ({
          move: move.san,
          white: move.white,
          black: move.black,
          draw: move.draws,
        })),
        games: await convertToNormalized(data.topGames || data.recentGames || []),
      };
    })
    .with({ type: "local" }, async ({ options }) => {
      if (!options.path) throw Error("Missing reference database");
      const positionData = await queryPosition(options, tab, signal);
      return {
        openings: sortOpenings(positionData.openings),
        games: [],
        snapshot: positionData,
      };
    })
    .exhaustive();
}

function DatabasePanel() {
  const { t } = useTranslation();

  const store = useContext(TreeStateContext)!;
  const fen = useStore(store, (s) => s.currentNode().fen);
  const [referenceDatabase, setReferenceDatabase] = useAtom(referenceDbAtom);
  const sessions = useAtomValue(sessionsAtom);
  const [debouncedFen] = useDebouncedValue(fen, 50);
  const [lichessOptions, setLichessOptions] = useAtom(lichessOptionsAtom);
  const [masterOptions, setMasterOptions] = useAtom(masterOptionsAtom);
  const [localOptions, setLocalOptions] = useAtom(currentLocalOptionsAtom);
  const [db, setDb] = useAtom(currentDbTypeAtom);
  const explorerToken = sessions.find((session) => session.lichess?.accessToken)?.lichess
    ?.accessToken;
  const missingExplorerToken = db !== "local" && !explorerToken;

  const { data: databases } = useSWR(db === "local" ? "databases" : null, () => getDatabases());

  const dbSelectData = (databases ?? [])
    .filter((d) => d.type === "success")
    .map((d) => ({ value: d.file, label: d.title || d.filename }));

  useEffect(() => {
    if (db === "local") {
      setLocalOptions((q) => ({ ...q, fen: debouncedFen }));
    }
  }, [debouncedFen, setLocalOptions, setMasterOptions, setLichessOptions, db]);

  useEffect(() => {
    if (db === "local") {
      setLocalOptions((q) => ({ ...q, path: referenceDatabase }));
    }
  }, [referenceDatabase, setLocalOptions, db]);

  const dbType: DBType = match(db)
    .with("local", (v) => ({
      type: v,
      options: localOptions,
    }))
    .with("lch_all", (v) => ({
      type: v,
      options: lichessOptions,
      fen: debouncedFen,
      token: explorerToken ?? "",
    }))
    .with("lch_master", (v) => ({
      type: v,
      options: masterOptions,
      fen: debouncedFen,
      token: explorerToken ?? "",
    }))
    .exhaustive();

  const tab = useAtomValue(currentTabAtom);
  const [tabType, setTabType] = useAtom(currentDbTabAtom);
  const tabId = tab?.value;
  const queryKey = JSON.stringify([dbType, tabId]);
  const activeQuery = useRef<{ key: string; controller: AbortController } | null>(null);

  useEffect(() => {
    return () => {
      activeQuery.current?.controller.abort();
    };
  }, []);

  useEffect(() => {
    const active = activeQuery.current;
    // Also cancel when SWR already has the new position cached and does not run its fetcher.
    // A fetcher for this render may have run already; never cancel that new controller.
    if (active && (active.key !== queryKey || tabType === "options" || db !== "local")) {
      active.controller.abort();
    }
  }, [db, queryKey, tabType]);

  const {
    data: openingData,
    isLoading: initialLoading,
    isValidating,
    error,
    mutate,
  } = useSWR(
    tabType !== "options" && !missingExplorerToken ? [dbType, tabId] : null,
    async ([source, owner]: [DBType, string | undefined]) => {
      activeQuery.current?.controller.abort();
      const controller = new AbortController();
      activeQuery.current = { key: JSON.stringify([source, owner]), controller };
      return fetchOpening(source, owner || "", controller.signal);
    },
    { keepPreviousData: true },
  );

  const transientError = isTransientPositionError(error);
  const retriedQuery = useRef<string | null>(null);
  useEffect(() => {
    if (transientError && retriedQuery.current !== queryKey) {
      retriedQuery.current = queryKey;
      void mutate();
    }
  }, [transientError, queryKey, mutate]);
  const isLoading = initialLoading || isValidating || transientError;
  const grandTotal = openingData?.openings?.reduce(
    (acc, curr) => acc + curr.black + curr.white + curr.draw + (curr.unknown ?? 0),
    0,
  );

  const header = (
    <>
      <Group justify="space-between" w="100%" wrap="nowrap">
        <Group>
          <SegmentedControl
            data={[
              { label: t("Board.Database.Local"), value: "local" },
              { label: t("Board.Database.LichessAll"), value: "lch_all" },
              { label: t("Board.Database.LichessMaster"), value: "lch_master" },
            ]}
            value={db}
            onChange={(value) => setDb(value as "local" | "lch_all" | "lch_master")}
          />

          {db === "local" && (
            <Select
              data={dbSelectData}
              value={referenceDatabase}
              onChange={async (value) => {
                await commands.clearGames();
                setReferenceDatabase(value);
              }}
              placeholder={t("Board.Database.SelectReference")}
              size="sm"
              flex={1}
              maw={200}
              allowDeselect={false}
            />
          )}
          {db === "local" && tabType !== "options" && (
            <Button
              size="xs"
              variant="subtle"
              loading={isLoading}
              onClick={() => {
                void mutate();
              }}
            >
              {t("Board.Database.Refresh")}
            </Button>
          )}
        </Group>

        {tabType !== "options" && (
          <Text style={{ whiteSpace: "nowrap" }}>
            {t("Board.Database.Matches", {
              matches: formatNumber(Math.max(grandTotal || 0, openingData?.games.length || 0)),
            })}
          </Text>
        )}
      </Group>
      <DatabaseLoader isLoading={isLoading} tab={tab?.value ?? null} />
      {!!openingData?.snapshot?.skippedGames && (
        <Alert color="yellow">
          {t("Board.Database.SkippedGames", { count: openingData.snapshot.skippedGames })}
        </Alert>
      )}
    </>
  );

  return (
    <Stack h="100%" gap={0}>
      <Tabs
        defaultValue="stats"
        orientation="vertical"
        placement="right"
        value={tabType}
        onChange={(v) => setTabType(v!)}
        display="flex"
        flex={1}
        style={{ overflow: "hidden" }}
      >
        <Tabs.List>
          <Tabs.Tab
            value="stats"
            disabled={dbType.type === "local" && dbType.options.type === "partial"}
          >
            {t("Board.Database.Stats")}
          </Tabs.Tab>
          <Tabs.Tab value="games">{t("Board.Database.Games")}</Tabs.Tab>
          <Tabs.Tab
            value="report"
            disabled={dbType.type !== "local" || dbType.options.type !== "exact"}
          >
            {t("OpeningReport.Tab")}
          </Tabs.Tab>
          <Tabs.Tab value="options">{t("Board.Database.Options")}</Tabs.Tab>
        </Tabs.List>

        <PanelWithError
          value="stats"
          error={transientError ? undefined : error}
          type={db}
          header={header}
          missingExplorerToken={missingExplorerToken}
        >
          <OpeningsTable openings={openingData?.openings || []} loading={isLoading} />
        </PanelWithError>
        <PanelWithError
          value="games"
          error={transientError ? undefined : error}
          type={db}
          header={header}
          missingExplorerToken={missingExplorerToken}
        >
          {dbType.type === "local" && openingData?.snapshot ? (
            <PositionGamesTable
              snapshot={openingData.snapshot}
              databasePath={dbType.options.path!}
              owner={tabId ?? ""}
              onExpired={() => {
                void mutate();
              }}
            />
          ) : (
            <GamesTable
              games={openingData?.games || []}
              loading={isLoading}
              databasePath={dbType.type === "local" ? dbType.options.path : null}
            />
          )}
        </PanelWithError>
        <PanelWithError
          value="report"
          error={transientError ? undefined : error}
          type={db}
          header={header}
          missingExplorerToken={missingExplorerToken}
        >
          {tabType === "report" &&
          dbType.type === "local" &&
          dbType.options.type === "exact" &&
          openingData?.snapshot &&
          !isLoading ? (
            <OpeningReportPanel
              key={`${openingData.snapshot.token}:${dbType.options.fen}`}
              snapshot={openingData.snapshot}
              displayFen={dbType.options.fen}
              databasePath={dbType.options.path!}
              owner={tabId ?? ""}
              onGames={() => setTabType("games")}
              onExpired={() => {
                void mutate();
              }}
            />
          ) : (
            <Text p="sm" c="dimmed">
              {t("OpeningReport.WaitForQuery")}
            </Text>
          )}
        </PanelWithError>
        <PanelWithError
          value="options"
          error={transientError ? undefined : error}
          type={db}
          header={header}
          missingExplorerToken={missingExplorerToken}
        >
          <ScrollArea flex={1} offsetScrollbars pt="sm">
            {match(db)
              .with("local", () => <LocalOptionsPanel boardFen={debouncedFen} />)
              .with("lch_all", () => <LichessOptionsPanel />)
              .with("lch_master", () => <MasterOptionsPanel />)
              .exhaustive()}
          </ScrollArea>
        </PanelWithError>
      </Tabs>
    </Stack>
  );
}

function PanelWithError(props: {
  value: string;
  error: unknown;
  type: string;
  header: React.ReactNode;
  children: React.ReactNode;
  missingExplorerToken: boolean;
}) {
  const referenceDatabase = useAtomValue(referenceDbAtom);
  const { t } = useTranslation();
  let children = props.children;
  if (props.type === "local" && !referenceDatabase) {
    children = <NoDatabaseWarning />;
  }
  if (props.missingExplorerToken && props.type !== "local") {
    children = (
      <Alert color="yellow">
        {t("Board.Database.ExplorerAuthRequired1")} <Link to="/accounts">Users</Link>{" "}
        {t("Board.Database.ExplorerAuthRequired2")}
      </Alert>
    );
  }
  if (props.error) {
    children = <Alert color="red">{t("Board.Database.QueryFailed")}</Alert>;
  }

  return (
    <Tabs.Panel
      py="xs"
      px="sm"
      value={props.value}
      flex={1}
      style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      {props.header}
      {children}
    </Tabs.Panel>
  );
}

export default memo(DatabasePanel);
