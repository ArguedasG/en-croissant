import { Alert, Group, SegmentedControl, Select, Text } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { DataTable } from "mantine-datatable";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import {
  commands,
  type PositionGameSort,
  type PositionSummary,
  type SortDirection,
} from "@/bindings";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { isTransientPositionError } from "@/utils/db";
import { createTab } from "@/utils/tabs";

export default function PositionGamesTable({
  snapshot,
  databasePath,
  onExpired,
  owner,
}: {
  snapshot: PositionSummary;
  databasePath: string;
  onExpired: () => void;
  owner: string;
}) {
  const { t } = useTranslation();
  const setTabs = useSetAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const navigate = useNavigate();
  const [pagination, setPagination] = useState({ token: snapshot.token, page: 1 });
  const page = pagination.token === snapshot.token ? pagination.page : 1;
  const offset = (page - 1) * 20;
  const [opening, setOpening] = useState(false);
  const [sort, setSort] = useState<PositionGameSort>("index");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [openError, setOpenError] = useState(false);
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    ["position-page", snapshot.token, offset, sort, direction, owner],
    async ([, token, start, order, orderDirection]) => {
      if (order === "index") await commands.cancelPositionSearch(`games-sort:${owner}`);
      const result = await commands.getPositionGames(
        token,
        start,
        20,
        order,
        orderDirection,
        `games-sort:${owner}`,
      );
      if (result.status === "error") throw new Error(result.error);
      return result.data;
    },
    { shouldRetryOnError: false, revalidateOnFocus: false, keepPreviousData: true },
  );
  const expired = error?.message === "Position query expired";
  const transientError = isTransientPositionError(error);
  const refreshed = useRef<string | null>(null);
  const retried = useRef<string | null>(null);
  useEffect(() => {
    setOpenError(false);
  }, [snapshot.token]);
  useEffect(
    () => () => {
      void commands.cancelPositionSearch(`games-sort:${owner}`);
    },
    [owner],
  );
  useEffect(
    () => setPagination({ token: snapshot.token, page: 1 }),
    [snapshot.token, sort, direction],
  );
  useEffect(() => {
    if (expired && refreshed.current !== snapshot.token) {
      refreshed.current = snapshot.token;
      onExpired();
    }
  }, [expired, snapshot.token, onExpired]);
  useEffect(() => {
    const retryKey = `${snapshot.token}:${offset}:${sort}:${direction}`;
    if (transientError && retried.current !== retryKey) {
      retried.current = retryKey;
      void mutate();
    }
  }, [transientError, snapshot.token, offset, sort, direction, mutate]);

  if ((error && !transientError) || openError) {
    return <Alert color="red">{t("Board.Database.QueryFailed")}</Alert>;
  }
  return (
    <>
      <Group justify="space-between" align="end" mb="xs">
        <Select
          label={t("Board.Database.SortBy")}
          value={sort}
          onChange={(value) => setSort(value as PositionGameSort)}
          data={[
            { value: "index", label: t("Board.Database.Sort.Index") },
            { value: "date", label: t("Board.Database.Sort.Date") },
            { value: "averageElo", label: t("Board.Database.Sort.AverageElo") },
            { value: "whiteElo", label: t("Board.Database.Sort.WhiteElo") },
            { value: "blackElo", label: t("Board.Database.Sort.BlackElo") },
          ]}
        />
        <SegmentedControl
          value={direction}
          onChange={(value) => setDirection(value as SortDirection)}
          data={[
            { value: "asc", label: t("Board.Database.Sort.Asc") },
            { value: "desc", label: t("Board.Database.Sort.Desc") },
          ]}
        />
      </Group>
      <Text size="xs" c="dimmed">
        {t("Board.Database.SortScope")}
      </Text>
      <DataTable
        withTableBorder
        highlightOnHover
        records={data ?? []}
        fetching={isLoading || isValidating || transientError || opening}
        totalRecords={snapshot.total}
        recordsPerPage={20}
        page={page}
        onPageChange={(next) => setPagination({ token: snapshot.token, page: next })}
        noRecordsText={t("Board.Database.NoGames")}
        onRowClick={async ({ index }) => {
          if (opening) return;
          setOpening(true);
          try {
            const selected = data?.[index];
            if (!selected) return;
            const result = await commands.getPositionGame(snapshot.token, selected.snapshotOffset);
            if (result.status === "error") {
              if (result.error === "Position query expired") {
                onExpired();
                return;
              }
              throw new Error(result.error);
            }
            const { game, ply } = result.data;
            await createTab({
              tab: { name: `${game.white} - ${game.black}`, type: "analysis" },
              setTabs,
              setActiveTab,
              pgn: game.moves,
              headers: game,
              position: Array(ply).fill(0),
              gameOrigin: { kind: "database", database: databasePath, gameId: game.id },
            });
            navigate({ to: "/" });
          } catch {
            setOpenError(true);
          } finally {
            setOpening(false);
          }
        }}
        columns={[
          {
            accessor: "white",
            title: t("Fen.White"),
            render: (g) => `${g.white} (${g.whiteElo || "—"})`,
          },
          {
            accessor: "black",
            title: t("Fen.Black"),
            render: (g) => `${g.black} (${g.blackElo || "—"})`,
          },
          { accessor: "date", title: t("Board.Database.Date") },
          { accessor: "result", title: t("Board.Database.Local.Result") },
          { accessor: "event", title: t("Board.Database.Event") },
          { accessor: "nextMove", title: t("Board.Database.Continuation") },
        ]}
      />
    </>
  );
}
