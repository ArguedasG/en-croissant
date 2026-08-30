import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconChartDots,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EngineOption, GoMode, NormalizedGame } from "@/bindings";
import { commands } from "@/bindings";
import { activeTabAtom, enginesAtom, tabsAtom } from "@/state/atoms";
import {
  playerAnalysisAtom,
  playerAnalysisProfileId,
  type StoredPlayerAnalysis,
} from "@/state/playerAnalysis";
import { trainingAreasAtom } from "@/state/trainingAreas";
import { getMainLine, parsePGN } from "@/utils/chess";
import type { LocalEngine } from "@/utils/engines";
import { isMaiaEngine } from "@/utils/humanBots";
import {
  aggregateEngineAnalysis,
  analyzePlayerGames,
  buildEngineGameMetrics,
  DEFAULT_PLAYER_ANALYSIS_FILTERS,
  PLAYER_ANALYSIS_SCHEMA_VERSION,
  selectPlayerEngineGames,
  type PlayerAnalysisBucket,
  type PlayerAnalysisCriticalPosition,
  type PlayerAnalysisFilters,
  type PlayerAnalysisGame,
  type PlayerAnalysisReference,
  type PlayerAnalysisSource,
} from "@/utils/playerAnalysis";
import { createTab } from "@/utils/tabs";
import {
  addTacticsExerciseToSet,
  addTacticsSet,
  type ParsedTrainingRecord,
} from "@/utils/trainingAreas";
import { treeIteratorMainLine } from "@/utils/treeReducer";
import { unwrap } from "@/utils/unwrap";

const PAGE_SIZE = 250;

function formatScore(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function formatCp(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)} cp`;
}

function findingTitle(
  category: "opening" | "color" | "timeControl" | "rating" | "trend",
  subject: string,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string,
): string {
  const labels = {
    opening: ["PlayerAnalysis.FindingOpening", "Opening to review: {{subject}}"],
    color: ["PlayerAnalysis.FindingColor", "Results to review with {{subject}}"],
    timeControl: ["PlayerAnalysis.FindingTime", "Time control to review: {{subject}}"],
    rating: ["PlayerAnalysis.FindingRating", "Opponent group to review: {{subject}}"],
    trend: ["PlayerAnalysis.FindingTrend", "Trend to review: {{subject}}"],
  } as const;
  const [key, fallback] = labels[category];
  return t(key, fallback, { subject });
}

function priorityLabel(
  value: "high" | "medium" | "low",
  t: (key: string, fallback: string) => string,
): string {
  return {
    high: t("PlayerAnalysis.PriorityHigh", "High"),
    medium: t("PlayerAnalysis.PriorityMedium", "Medium"),
    low: t("PlayerAnalysis.PriorityLow", "Low"),
  }[value];
}

function phaseLabel(
  value: "opening" | "middlegame" | "endgame",
  t: (key: string, fallback: string) => string,
): string {
  return {
    opening: t("PlayerAnalysis.PhaseOpening", "Opening"),
    middlegame: t("PlayerAnalysis.PhaseMiddlegame", "Middlegame"),
    endgame: t("PlayerAnalysis.PhaseEndgame", "Endgame"),
  }[value];
}

function classificationLabel(
  value: "inaccuracy" | "mistake" | "blunder",
  t: (key: string, fallback: string) => string,
): string {
  return {
    inaccuracy: t("PlayerAnalysis.Inaccuracy", "Inaccuracy"),
    mistake: t("PlayerAnalysis.Mistake", "Mistake"),
    blunder: t("PlayerAnalysis.Blunder", "Blunder"),
  }[value];
}

async function loadSourceGames(source: PlayerAnalysisSource): Promise<PlayerAnalysisGame[]> {
  const games: NormalizedGame[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (games.length < total) {
    const response = unwrap(
      await commands.getGames(source.databasePath, {
        player1: source.playerId,
        sides: "Any",
        options: {
          page,
          pageSize: PAGE_SIZE,
          skipCount: page > 1,
          sort: "date",
          direction: "desc",
        },
      }),
    );
    games.push(...response.data);
    if (page === 1) total = response.count ?? response.data.length;
    if (response.data.length < PAGE_SIZE) break;
    page += 1;
  }
  return games.map((game) => ({
    key: `${source.databasePath}:${game.id}`,
    source,
    game,
  }));
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} fz="lg">
        {value}
      </Text>
    </Paper>
  );
}

function BucketTable({
  rows,
  label,
  onOpen,
}: {
  rows: PlayerAnalysisBucket[];
  label: string;
  onOpen: (reference: PlayerAnalysisReference) => void;
}) {
  const { t } = useTranslation();
  return (
    <Table striped highlightOnHover withTableBorder>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{label}</Table.Th>
          <Table.Th ta="right">{t("PlayerAnalysis.Games", "Games")}</Table.Th>
          <Table.Th ta="right">{t("PlayerAnalysis.Score", "Score")}</Table.Th>
          <Table.Th>{t("PlayerAnalysis.Record", "W-D-L")}</Table.Th>
          <Table.Th ta="right">{t("PlayerAnalysis.OpponentElo", "Opponent Elo")}</Table.Th>
          <Table.Th />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.key}>
            <Table.Td>{row.key}</Table.Td>
            <Table.Td ta="right">{row.games}</Table.Td>
            <Table.Td ta="right">{formatScore(row.scorePercent)}</Table.Td>
            <Table.Td>{`${row.wins}-${row.draws}-${row.losses}`}</Table.Td>
            <Table.Td ta="right">{row.averageOpponentElo?.toFixed(0) ?? "—"}</Table.Td>
            <Table.Td ta="right">
              <Button
                size="compact-xs"
                variant="subtle"
                disabled={!row.references[0]}
                onClick={() => row.references[0] && onOpen(row.references[0])}
              >
                {t("PlayerAnalysis.Evidence", "Evidence")}
              </Button>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export default function PlayerAnalysisPanel({
  playerName,
  sources,
}: {
  playerName: string;
  sources: PlayerAnalysisSource[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [state, setState] = useAtom(playerAnalysisAtom);
  const [trainingAreas, setTrainingAreas] = useAtom(trainingAreasAtom);
  const [engines] = useAtom(enginesAtom);
  const setTabs = useSetAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const profileId = useMemo(
    () => playerAnalysisProfileId(playerName, sources),
    [playerName, sources],
  );
  const storedCandidate = state.profiles[profileId];
  const stored =
    storedCandidate?.schemaVersion === PLAYER_ANALYSIS_SCHEMA_VERSION ? storedCandidate : null;
  const [games, setGames] = useState<PlayerAnalysisGame[]>([]);
  const [filters, setFilters] = useState<PlayerAnalysisFilters>(
    stored?.metadata.filters ?? DEFAULT_PLAYER_ANALYSIS_FILTERS,
  );
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [engineId, setEngineId] = useState("");
  const [engineGames, setEngineGames] = useState(10);
  const [analyzeAllGames, setAnalyzeAllGames] = useState(false);
  const [engineTimeMs, setEngineTimeMs] = useState(250);
  const [engineLoading, setEngineLoading] = useState(false);
  const [engineProgress, setEngineProgress] = useState(0);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const cancelled = useRef(false);
  const activeAnalysisId = useRef<string | null>(null);

  const localEngines = useMemo(
    () =>
      (engines ?? []).filter(
        (engine): engine is LocalEngine => engine.type === "local" && !isMaiaEngine(engine),
      ),
    [engines],
  );
  useEffect(() => {
    if (!localEngines.some((engine) => engine.id === engineId)) {
      setEngineId(localEngines[0]?.id ?? "");
    }
  }, [engineId, localEngines]);

  const userTacticsSets = useMemo(
    () =>
      Object.values(trainingAreas.tactics.sets).filter(
        (set) => set.origin === "user" && set.source?.kind !== "pgnFile",
      ),
    [trainingAreas.tactics.sets],
  );
  useEffect(() => {
    if (!userTacticsSets.some((set) => set.id === selectedSetId)) {
      setSelectedSetId(userTacticsSets[0]?.id ?? null);
    }
  }, [selectedSetId, userTacticsSets]);

  const saveProfile = useCallback(
    (profile: StoredPlayerAnalysis) => {
      setState((previous) => ({
        ...previous,
        schemaVersion: PLAYER_ANALYSIS_SCHEMA_VERSION,
        profiles: { ...previous.profiles, [profileId]: profile },
      }));
    },
    [profileId, setState],
  );

  const generate = useCallback(async () => {
    setLoading(true);
    setLoadingProgress(0);
    try {
      const loaded: PlayerAnalysisGame[] = [];
      for (const [index, source] of sources.entries()) {
        loaded.push(...(await loadSourceGames(source)));
        setLoadingProgress(((index + 1) / sources.length) * 100);
      }
      const unique = [...new Map(loaded.map((game) => [game.key, game])).values()];
      setGames(unique);
      const metadata = analyzePlayerGames(playerName, unique, sources, filters);
      saveProfile({
        schemaVersion: PLAYER_ANALYSIS_SCHEMA_VERSION,
        profileId,
        playerName,
        updatedAt: metadata.generatedAt,
        metadata,
        engine: null,
      });
    } catch (error) {
      notifications.show({
        color: "red",
        title: t("PlayerAnalysis.Error", "Player analysis failed"),
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [filters, playerName, profileId, saveProfile, sources, t]);

  const openReference = useCallback(
    async (reference: PlayerAnalysisReference) => {
      try {
        const response = unwrap(
          await commands.getGames(reference.databasePath, {
            game_id: reference.gameId,
            options: {
              page: 1,
              pageSize: 1,
              skipCount: true,
              sort: "id",
              direction: "asc",
            },
          }),
        );
        const game = response.data[0];
        if (!game) throw new Error("Game not found");
        await createTab({
          tab: {
            name: `${game.white} - ${game.black}`,
            type: "analysis",
            returnPath: pathname === "/databases" ? "/databases" : "/accounts",
          },
          setTabs,
          setActiveTab,
          pgn: game.moves,
          headers: game,
          position: Array(reference.ply ?? 0).fill(0),
          gameOrigin: {
            kind: "database",
            database: reference.databasePath,
            gameId: reference.gameId,
          },
          preserveNewTab: true,
        });
        navigate({ to: "/" });
      } catch (error) {
        notifications.show({
          color: "red",
          title: t("PlayerAnalysis.GameError", "Could not open the evidence game"),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [navigate, pathname, setActiveTab, setTabs, t],
  );

  const runEngineAnalysis = useCallback(async () => {
    const engine = localEngines.find((candidate) => candidate.id === engineId);
    if (!engine || !stored || games.length === 0) return;
    const selected = selectPlayerEngineGames(
      games,
      stored.metadata.filters,
      analyzeAllGames ? "all" : engineGames,
    );
    const options: EngineOption[] = (engine.settings ?? []).map((setting) => ({
      name: setting.name,
      value: setting.value == null ? "" : String(setting.value),
    }));
    const limit = `time:${engineTimeMs}ms`;
    const reusable =
      stored.engine?.engine.path === engine.path && stored.engine.engine.limit === limit
        ? new Map(stored.engine.games.map((game) => [game.key, game]))
        : new Map();
    const analyzed = selected.flatMap((game) =>
      reusable.has(game.key) ? [reusable.get(game.key)!] : [],
    );
    let skipped = 0;
    cancelled.current = false;
    setEngineLoading(true);
    setEngineProgress(selected.length ? (analyzed.length / selected.length) * 100 : 0);
    try {
      for (const item of selected) {
        if (cancelled.current || reusable.has(item.key)) continue;
        const analysisId = `player-analysis-${profileId}-${item.game.id}`;
        activeAnalysisId.current = analysisId;
        try {
          const tree = await parsePGN(item.game.moves, item.game.fen);
          const uciMoves = getMainLine(tree.root);
          const nodes = [...treeIteratorMainLine(tree.root)].map((entry) => entry.node);
          const preMoveFens = nodes.slice(0, uciMoves.length).map((node) => node.fen);
          const goMode: GoMode = { t: "Time", c: engineTimeMs };
          const response = await commands.analyzeGame(
            analysisId,
            engine.path,
            engine.args ?? [],
            goMode,
            {
              fen: item.game.fen,
              moves: uciMoves,
              annotateNovelties: false,
              referenceDb: null,
              reversed: false,
            },
            options,
          );
          if (response.status === "error") throw new Error(response.error);
          const result = response.data;
          analyzed.push(buildEngineGameMetrics({ item, uciMoves, preMoveFens, analysis: result }));
        } catch (error) {
          if (cancelled.current) break;
          skipped += 1;
          console.warn("Player analysis skipped a game", item.key, error);
        }
        setEngineProgress((analyzed.length / selected.length) * 100);
      }
      const result = aggregateEngineAnalysis({
        engine: {
          name: engine.name,
          path: engine.path,
          args: engine.args ?? [],
          options,
          limit,
        },
        requestedGames: selected.length,
        skippedGames: skipped,
        games: analyzed,
      });
      saveProfile({ ...stored, updatedAt: result.analyzedAt, engine: result });
    } finally {
      activeAnalysisId.current = null;
      setEngineLoading(false);
    }
  }, [
    analyzeAllGames,
    engineGames,
    engineId,
    engineTimeMs,
    games,
    localEngines,
    profileId,
    saveProfile,
    stored,
  ]);

  const cancelEngine = useCallback(() => {
    cancelled.current = true;
    const id = activeAnalysisId.current;
    if (id) void commands.cancelAnalysis(id);
  }, []);

  const addCriticalToSet = useCallback(
    (critical: PlayerAnalysisCriticalPosition) => {
      const record: ParsedTrainingRecord = {
        fen: critical.fen,
        moves: critical.bestLine,
        title: `${critical.gameLabel} · ${critical.classification}`,
        hasExplicitFen: true,
        playerAnalysis: {
          databasePath: critical.databasePath,
          gameId: critical.gameId,
          ply: critical.ply ?? 0,
          cpLoss: critical.cpLoss,
          classification: critical.classification,
        },
      };
      if (selectedSetId) {
        setTrainingAreas((previous) => ({
          ...previous,
          tactics: addTacticsExerciseToSet(previous.tactics, selectedSetId, record, [
            "player-analysis",
            critical.classification,
            critical.phase,
          ]),
        }));
      } else {
        setTrainingAreas((previous) => ({
          ...previous,
          tactics: addTacticsSet(
            previous.tactics,
            t("PlayerAnalysis.ErrorSet", "My tactical errors"),
            t("PlayerAnalysis.ErrorSetDescription", "Positions added from Player Analysis."),
            [record],
          ),
        }));
      }
      notifications.show({
        color: "green",
        message: selectedSetId
          ? t("PlayerAnalysis.AddedToSet", "Position added to the tactical set.")
          : t("PlayerAnalysis.CreatedSet", "Tactical error set created."),
      });
    },
    [selectedSetId, setTrainingAreas, t],
  );

  if (!state.enabled) {
    return (
      <Stack p="sm">
        <Alert color="gray">
          {t("PlayerAnalysis.Disabled", "The local analytical profile is disabled.")}
        </Alert>
        <Button onClick={() => setState((previous) => ({ ...previous, enabled: true }))}>
          {t("PlayerAnalysis.Enable", "Enable Player Analysis")}
        </Button>
      </Stack>
    );
  }

  const metadata = stored?.metadata;
  const engine = stored?.engine;
  const timeControls = [...new Set(games.map((game) => game.game.time_control || "unknown"))];

  return (
    <Stack h="100%" gap="sm">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={4}>{t("PlayerAnalysis.Title", "Player Analysis")}</Title>
          <Text size="xs" c="dimmed">
            {t(
              "PlayerAnalysis.Scope",
              "Local, versioned analysis. Every conclusion keeps its sample and evidence games.",
            )}
          </Text>
        </div>
        <Group gap="xs">
          <Switch
            checked={state.enabled}
            label={t("PlayerAnalysis.LocalProfile", "Local profile")}
            onChange={(event) =>
              setState((previous) => ({ ...previous, enabled: event.currentTarget.checked }))
            }
          />
          <Button
            size="xs"
            variant="default"
            color="red"
            leftSection={<IconTrash size={14} />}
            disabled={!stored || loading || engineLoading}
            onClick={() =>
              setState((previous) => {
                const profiles = { ...previous.profiles };
                delete profiles[profileId];
                return { ...previous, profiles };
              })
            }
          >
            {t("PlayerAnalysis.Delete", "Delete profile")}
          </Button>
        </Group>
      </Group>

      <Paper withBorder p="sm">
        <SimpleGrid cols={{ base: 1, sm: 3, lg: 6 }}>
          <TextInput
            type="date"
            label={t("PlayerAnalysis.StartDate", "From")}
            value={filters.startDate ?? ""}
            onChange={(event) =>
              setFilters((previous) => ({
                ...previous,
                startDate: event.currentTarget.value || null,
              }))
            }
          />
          <TextInput
            type="date"
            label={t("PlayerAnalysis.EndDate", "To")}
            value={filters.endDate ?? ""}
            onChange={(event) =>
              setFilters((previous) => ({
                ...previous,
                endDate: event.currentTarget.value || null,
              }))
            }
          />
          <Select
            label={t("PlayerAnalysis.Color", "Color")}
            value={filters.color}
            allowDeselect={false}
            data={[
              { value: "any", label: t("PlayerAnalysis.Any", "Any") },
              { value: "white", label: t("Fen.White", "White") },
              { value: "black", label: t("Fen.Black", "Black") },
            ]}
            onChange={(value) =>
              setFilters((previous) => ({
                ...previous,
                color: (value as PlayerAnalysisFilters["color"]) ?? "any",
              }))
            }
          />
          <NumberInput
            label={t("PlayerAnalysis.MinOpponentElo", "Minimum opponent Elo")}
            value={filters.opponentEloMin ?? ""}
            onChange={(value) =>
              setFilters((previous) => ({
                ...previous,
                opponentEloMin: typeof value === "number" ? value : null,
              }))
            }
          />
          <NumberInput
            label={t("PlayerAnalysis.MaxOpponentElo", "Maximum opponent Elo")}
            value={filters.opponentEloMax ?? ""}
            onChange={(value) =>
              setFilters((previous) => ({
                ...previous,
                opponentEloMax: typeof value === "number" ? value : null,
              }))
            }
          />
          <Select
            clearable
            label={t("PlayerAnalysis.TimeControl", "Time control")}
            value={filters.timeControl}
            data={timeControls}
            onChange={(value) => setFilters((previous) => ({ ...previous, timeControl: value }))}
          />
        </SimpleGrid>
        <Group mt="sm">
          <Button
            leftSection={stored ? <IconRefresh size={16} /> : <IconChartDots size={16} />}
            loading={loading}
            disabled={sources.length === 0 || engineLoading}
            onClick={generate}
          >
            {stored
              ? t("PlayerAnalysis.Recalculate", "Recalculate")
              : t("PlayerAnalysis.Generate", "Generate analysis")}
          </Button>
          <Text size="xs" c="dimmed">
            {sources.length} {t("PlayerAnalysis.Sources", "local source(s)")}
            {metadata && ` · ${new Date(metadata.generatedAt).toLocaleString()}`}
          </Text>
        </Group>
        {loading && <Progress mt="sm" value={loadingProgress} animated />}
      </Paper>

      {!metadata ? (
        <Alert color="blue">
          {t(
            "PlayerAnalysis.Empty",
            "Generate the profile to calculate results, openings, opponent groups and evidence-backed findings.",
          )}
        </Alert>
      ) : (
        <Tabs defaultValue="summary" flex={1} style={{ overflow: "hidden" }}>
          <Tabs.List>
            <Tabs.Tab value="summary">{t("PlayerAnalysis.Summary", "Summary")}</Tabs.Tab>
            <Tabs.Tab value="openings">{t("PlayerAnalysis.Openings", "Openings")}</Tabs.Tab>
            <Tabs.Tab value="findings">{t("PlayerAnalysis.Findings", "Findings")}</Tabs.Tab>
            <Tabs.Tab value="engine">{t("PlayerAnalysis.Engine", "Engine")}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="summary" pt="sm">
            <ScrollArea h="calc(100vh - 360px)" offsetScrollbars>
              <Stack>
                <SimpleGrid cols={{ base: 2, sm: 4 }}>
                  <Metric
                    label={t("PlayerAnalysis.Games", "Games")}
                    value={`${metadata.sampleSize}`}
                  />
                  <Metric
                    label={t("PlayerAnalysis.Score", "Score")}
                    value={formatScore(metadata.summary.scorePercent)}
                  />
                  <Metric
                    label={t("PlayerAnalysis.Record", "W-D-L")}
                    value={`${metadata.summary.wins}-${metadata.summary.draws}-${metadata.summary.losses}`}
                  />
                  <Metric
                    label={t("PlayerAnalysis.OpponentElo", "Opponent Elo")}
                    value={metadata.summary.averageOpponentElo?.toFixed(0) ?? "—"}
                  />
                </SimpleGrid>
                <Title order={5}>{t("PlayerAnalysis.ByColor", "By color")}</Title>
                <BucketTable
                  rows={metadata.byColor}
                  label={t("PlayerAnalysis.Color", "Color")}
                  onOpen={openReference}
                />
                <Title order={5}>{t("PlayerAnalysis.ByRating", "By opponent strength")}</Title>
                <BucketTable
                  rows={metadata.byRatingDifference}
                  label={t("PlayerAnalysis.Group", "Group")}
                  onOpen={openReference}
                />
                <Title order={5}>{t("PlayerAnalysis.ByTimeControl", "By time control")}</Title>
                <BucketTable
                  rows={metadata.byTimeControl}
                  label={t("PlayerAnalysis.TimeControl", "Time control")}
                  onOpen={openReference}
                />
              </Stack>
            </ScrollArea>
          </Tabs.Panel>

          <Tabs.Panel value="openings" pt="sm">
            <ScrollArea h="calc(100vh - 360px)" offsetScrollbars>
              <BucketTable
                rows={metadata.openings}
                label={t("PlayerAnalysis.Opening", "Opening")}
                onOpen={openReference}
              />
            </ScrollArea>
          </Tabs.Panel>

          <Tabs.Panel value="findings" pt="sm">
            <ScrollArea h="calc(100vh - 360px)" offsetScrollbars>
              <Stack>
                {metadata.findings.length === 0 && (
                  <Alert color="green">
                    {t(
                      "PlayerAnalysis.NoFindings",
                      "No weakness crossed the current minimum sample and score thresholds.",
                    )}
                  </Alert>
                )}
                {metadata.findings.map((finding) => (
                  <Paper key={finding.id} withBorder p="sm">
                    <Group justify="space-between" align="flex-start">
                      <div>
                        <Group gap="xs">
                          <Badge color={finding.priority === "high" ? "red" : "orange"}>
                            {priorityLabel(finding.priority, t)}
                          </Badge>
                          <Text fw={600}>{findingTitle(finding.category, finding.subject, t)}</Text>
                        </Group>
                        <Text size="sm" c="dimmed">
                          {finding.sampleSize} {t("PlayerAnalysis.Games", "Games")} ·{" "}
                          {formatScore(finding.scorePercent)}
                        </Text>
                      </div>
                      <Button
                        size="xs"
                        variant="light"
                        disabled={!finding.references[0]}
                        onClick={() =>
                          finding.references[0] && openReference(finding.references[0])
                        }
                      >
                        {t("PlayerAnalysis.OpenEvidence", "Open evidence")}
                      </Button>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </ScrollArea>
          </Tabs.Panel>

          <Tabs.Panel value="engine" pt="sm">
            <ScrollArea h="calc(100vh - 360px)" offsetScrollbars>
              <Stack>
                <Alert color="blue">
                  {t(
                    "PlayerAnalysis.EngineScope",
                    "The engine analyzes the newest games in the filtered sample. Results are cached by game, engine and limit, so an interrupted run can continue.",
                  )}
                </Alert>
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                  <Select
                    label={t("PlayerAnalysis.Engine", "Engine")}
                    value={engineId}
                    allowDeselect={false}
                    data={localEngines.map((value) => ({ value: value.id, label: value.name }))}
                    onChange={(value) => setEngineId(value ?? "")}
                    placeholder={t("PlayerAnalysis.NoEngine", "Install a local reference engine")}
                  />
                  <NumberInput
                    label={t("PlayerAnalysis.EngineGames", "Most recent games to analyze")}
                    min={1}
                    max={Math.max(1, metadata.sampleSize)}
                    step={5}
                    value={engineGames}
                    disabled={analyzeAllGames}
                    onChange={(value) => setEngineGames(typeof value === "number" ? value : 10)}
                  />
                  <Switch
                    mt="xl"
                    checked={analyzeAllGames}
                    disabled={metadata.sampleSize === 0}
                    label={t(
                      "PlayerAnalysis.EngineAllGames",
                      "Analyze all filtered games ({{count}})",
                      {
                        count: metadata.sampleSize,
                      },
                    )}
                    onChange={(event) => setAnalyzeAllGames(event.currentTarget.checked)}
                  />
                  <NumberInput
                    label={t("PlayerAnalysis.EngineTime", "Milliseconds per position")}
                    min={50}
                    max={5000}
                    step={50}
                    value={engineTimeMs}
                    onChange={(value) => setEngineTimeMs(typeof value === "number" ? value : 250)}
                  />
                </SimpleGrid>
                <Group>
                  <Button
                    leftSection={<IconPlayerPlay size={16} />}
                    disabled={!engineId || games.length === 0 || engineLoading}
                    loading={engineLoading}
                    onClick={runEngineAnalysis}
                  >
                    {t("PlayerAnalysis.RunEngine", "Analyze sample")}
                  </Button>
                  <Button
                    variant="default"
                    leftSection={<IconPlayerPause size={16} />}
                    disabled={!engineLoading}
                    onClick={cancelEngine}
                  >
                    {t("Common.Cancel", "Cancel")}
                  </Button>
                  {games.length === 0 && (
                    <Text size="xs" c="dimmed">
                      {t(
                        "PlayerAnalysis.LoadFirst",
                        "Recalculate the metadata before running the engine.",
                      )}
                    </Text>
                  )}
                </Group>
                {engineLoading && <Progress value={engineProgress} animated />}
                {engine && (
                  <>
                    <Divider />
                    <SimpleGrid cols={{ base: 2, sm: 6 }}>
                      <Metric
                        label={t("PlayerAnalysis.AnalyzedGames", "Analyzed games")}
                        value={`${engine.analyzedGames}`}
                      />
                      <Metric label="ACPL" value={formatCp(engine.acpl)} />
                      <Metric
                        label={t("PlayerAnalysis.Mistakes", "Mistakes")}
                        value={`${engine.mistakes}`}
                      />
                      <Metric
                        label={t("PlayerAnalysis.Blunders", "Blunders")}
                        value={`${engine.blunders}`}
                      />
                      <Metric
                        label={t("PlayerAnalysis.Conversion", "Advantage conversion")}
                        value={formatScore(engine.conversionRate)}
                      />
                      <Metric
                        label={t("PlayerAnalysis.Defense", "Inferior positions saved")}
                        value={formatScore(engine.defenseRate)}
                      />
                    </SimpleGrid>
                    <Title order={5}>{t("PlayerAnalysis.ByPhase", "Quality by phase")}</Title>
                    <Table withTableBorder striped>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{t("PlayerAnalysis.Phase", "Phase")}</Table.Th>
                          <Table.Th ta="right">{t("PlayerAnalysis.Moves", "Moves")}</Table.Th>
                          <Table.Th ta="right">ACPL</Table.Th>
                          <Table.Th ta="right">?! / ? / ??</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {engine.phases.map((phase) => (
                          <Table.Tr key={phase.phase}>
                            <Table.Td>{phaseLabel(phase.phase, t)}</Table.Td>
                            <Table.Td ta="right">{phase.moves}</Table.Td>
                            <Table.Td ta="right">{formatCp(phase.acpl)}</Table.Td>
                            <Table.Td ta="right">{`${phase.inaccuracies} / ${phase.mistakes} / ${phase.blunders}`}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                    {engine.recurringErrors.length > 0 && (
                      <>
                        <Title order={5}>{t("PlayerAnalysis.Recurring", "Recurring errors")}</Title>
                        <Table withTableBorder striped>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>{t("PlayerAnalysis.Opening", "Opening")}</Table.Th>
                              <Table.Th>{t("PlayerAnalysis.Phase", "Phase")}</Table.Th>
                              <Table.Th>{t("PlayerAnalysis.Type", "Type")}</Table.Th>
                              <Table.Th ta="right">{t("PlayerAnalysis.Count", "Count")}</Table.Th>
                              <Table.Th ta="right">
                                {t("PlayerAnalysis.AverageLoss", "Average loss")}
                              </Table.Th>
                              <Table.Th />
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {engine.recurringErrors.map((error) => (
                              <Table.Tr key={error.key}>
                                <Table.Td>{error.opening}</Table.Td>
                                <Table.Td>{phaseLabel(error.phase, t)}</Table.Td>
                                <Table.Td>{classificationLabel(error.classification, t)}</Table.Td>
                                <Table.Td ta="right">{error.count}</Table.Td>
                                <Table.Td ta="right">{error.averageLoss.toFixed(0)} cp</Table.Td>
                                <Table.Td ta="right">
                                  <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    onClick={() => openReference(error.references[0])}
                                  >
                                    {t("PlayerAnalysis.Evidence", "Evidence")}
                                  </Button>
                                </Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      </>
                    )}
                    <Group justify="space-between" align="end">
                      <Title order={5}>{t("PlayerAnalysis.Critical", "Training candidates")}</Title>
                      <Select
                        label={t("PlayerAnalysis.TargetSet", "Tactical set")}
                        placeholder={t("PlayerAnalysis.CreateSet", "Create “My tactical errors”")}
                        clearable
                        value={selectedSetId}
                        data={userTacticsSets.map((set) => ({ value: set.id, label: set.name }))}
                        onChange={setSelectedSetId}
                      />
                    </Group>
                    <Table withTableBorder highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{t("PlayerAnalysis.Game", "Game")}</Table.Th>
                          <Table.Th>{t("PlayerAnalysis.Phase", "Phase")}</Table.Th>
                          <Table.Th>{t("PlayerAnalysis.Type", "Type")}</Table.Th>
                          <Table.Th ta="right">{t("PlayerAnalysis.Loss", "Loss")}</Table.Th>
                          <Table.Th />
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {engine.criticalPositions.slice(0, 100).map((critical) => (
                          <Table.Tr key={`${critical.key}:${critical.ply}`}>
                            <Table.Td>{critical.gameLabel}</Table.Td>
                            <Table.Td>{phaseLabel(critical.phase, t)}</Table.Td>
                            <Table.Td>{classificationLabel(critical.classification, t)}</Table.Td>
                            <Table.Td ta="right">{critical.cpLoss.toFixed(0)} cp</Table.Td>
                            <Table.Td>
                              <Group gap="xs" justify="flex-end">
                                <Button
                                  size="compact-xs"
                                  variant="subtle"
                                  onClick={() => openReference(critical)}
                                >
                                  {t("PlayerAnalysis.Evidence", "Evidence")}
                                </Button>
                                <Button
                                  size="compact-xs"
                                  disabled={critical.bestLine.length === 0}
                                  onClick={() => addCriticalToSet(critical)}
                                >
                                  {t("PlayerAnalysis.AddToSet", "Add to set")}
                                </Button>
                              </Group>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </>
                )}
              </Stack>
            </ScrollArea>
          </Tabs.Panel>
        </Tabs>
      )}
    </Stack>
  );
}
