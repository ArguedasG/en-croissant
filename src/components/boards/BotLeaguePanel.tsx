import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  MultiSelect,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconDownload,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconTrophy,
  IconX,
  IconZoomCheck,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  BotLeagueConfig,
  BotLeagueDetail,
  BotLeagueGameResult,
  BotLeagueState,
  BotLeagueStatus,
  BotLeagueSummary,
  EngineOption,
  PlayerConfig,
} from "@/bindings";
import { commands, events } from "@/bindings";
import { activeTabAtom, enginesAtom, tabsAtom } from "@/state/atoms";
import type { LocalEngine } from "@/utils/engines";
import {
  buildHumanBotEngineArgs,
  buildHumanBotEngineSettings,
  buildHumanBotOpeningRepertoire,
  HUMAN_BOT_CATALOG_VERSION,
  HUMAN_BOT_PROFILES,
  isMaiaEngine,
} from "@/utils/humanBots";
import { createTab } from "@/utils/tabs";
import { unwrap } from "@/utils/unwrap";
import { EnginesSelect } from "./EnginesSelect";

const DEFAULT_PROFILE_IDS = ["luna", "nico", "vera", "gabriel", "irene", "leo"];

function resultLabel(result: BotLeagueGameResult["result"]): string {
  if (!result) return "*";
  if (result.type === "whiteWins") return "1-0";
  if (result.type === "blackWins") return "0-1";
  return "½-½";
}

function statusLabel(status: BotLeagueStatus, t: (key: string, fallback: string) => string) {
  switch (status) {
    case "running":
      return t("BotLeague.Status.Running", "En ejecución");
    case "paused":
      return t("BotLeague.Status.Paused", "Pausada");
    case "cancelling":
      return t("BotLeague.Status.Cancelling", "Cancelando");
    case "completed":
      return t("BotLeague.Status.Completed", "Completada");
    case "cancelled":
      return t("BotLeague.Status.Cancelled", "Cancelada");
  }
}

function statusColor(status: BotLeagueStatus) {
  if (status === "completed") return "green";
  if (status === "cancelled") return "gray";
  if (status === "paused") return "yellow";
  return "blue";
}

function stateFromDetail(detail: BotLeagueDetail): BotLeagueState {
  return {
    leagueId: detail.summary.leagueId,
    ownerId: detail.summary.ownerId,
    status: detail.summary.status,
    totalGames: detail.summary.totalGames,
    completedGames: detail.summary.completedGames,
    failedGames: detail.summary.failedGames,
    activeGames: [],
    queuedGames: Math.max(0, detail.summary.totalGames - detail.summary.recordedGames),
    effectiveConcurrency: 0,
    estimatedThreadsPerGame: 0,
    estimatedHashMbPerGame: 0,
    results: detail.results,
    standings: detail.standings,
  };
}

function positiveInteger(value: string | number, fallback: number, max?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const result = Math.max(1, Math.trunc(value));
  return max === undefined ? result : Math.min(max, result);
}

export default function BotLeaguePanel({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const engines = useAtomValue(enginesAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const [engine, setEngine] = useState<LocalEngine | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(DEFAULT_PROFILE_IDS);
  const [gamesPerPair, setGamesPerPair] = useState(2);
  const [alternateColors, setAlternateColors] = useState(true);
  const [baseSeed, setBaseSeed] = useState(1);
  const [seedStep, setSeedStep] = useState(1);
  const [concurrency, setConcurrency] = useState(1);
  const [maxCpuThreads, setMaxCpuThreads] = useState(
    Math.max(1, Math.min(32, navigator.hardwareConcurrency || 4)),
  );
  const [maxMemoryMb, setMaxMemoryMb] = useState(512);
  const [maxRetries, setMaxRetries] = useState(1);
  const [initialSeconds, setInitialSeconds] = useState(180);
  const [incrementSeconds, setIncrementSeconds] = useState(2);
  const [useClock, setUseClock] = useState(true);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [state, setState] = useState<BotLeagueState | null>(null);
  const [savedLeagues, setSavedLeagues] = useState<BotLeagueSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maiaEngines = useMemo(
    () =>
      (engines ?? []).filter(
        (candidate): candidate is LocalEngine => candidate.type === "local" && isMaiaEngine(candidate),
      ),
    [engines],
  );

  const selectedProfiles = useMemo(
    () => HUMAN_BOT_PROFILES.filter((profile) => selectedIds.includes(profile.id)),
    [selectedIds],
  );

  const refreshSaved = useCallback(async () => {
    try {
      setSavedLeagues(unwrap(await commands.listBotLeagues()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    void refreshSaved();
  }, [refreshSaved]);

  useEffect(() => {
    if (!leagueId) return;
    let disposed = false;
    commands.getBotLeague(leagueId).then((result) => {
      if (!disposed && result.status === "ok") setState(result.data);
    });
    const unlisten = events.botLeagueEvent.listen(({ payload }) => {
      if (payload.state.leagueId === leagueId) setState(payload.state);
    });
    const poll = window.setInterval(() => {
      void commands.getBotLeague(leagueId).then((result) => {
        if (!disposed && result.status === "ok") setState(result.data);
      });
    }, 1500);
    return () => {
      disposed = true;
      window.clearInterval(poll);
      unlisten.then((dispose) => dispose());
    };
  }, [leagueId]);

  const buildPlayer = useCallback(
    (profile: (typeof HUMAN_BOT_PROFILES)[number], opponentElo: number): PlayerConfig => {
      const settings = buildHumanBotEngineSettings(profile, opponentElo, engine?.settings ?? []);
      const options: EngineOption[] = settings.map((setting) => ({
        name: setting.name,
        value: setting.value == null ? "" : String(setting.value),
      }));
      return {
        type: "engine",
        name: profile.name,
        path: engine?.path ?? "",
        version: engine?.version ?? "",
        presetCategory: "humanLike",
        targetElo: profile.elo,
        seed: baseSeed,
        args: buildHumanBotEngineArgs(engine?.args ?? []),
        options,
        openingRepertoire: buildHumanBotOpeningRepertoire(profile),
        humanTiming: null,
        go: useClock ? null : { t: "Depth", c: 1 },
      };
    },
    [baseSeed, engine, useClock],
  );

  const buildConfig = useCallback((): BotLeagueConfig => {
    const opponentElo = selectedProfiles.length
      ? Math.round(selectedProfiles.reduce((sum, profile) => sum + profile.elo, 0) / selectedProfiles.length)
      : 1500;
    return {
      ownerId: id,
      players: selectedProfiles.map((profile) => ({
        profileId: profile.id,
        name: profile.name,
        targetElo: profile.elo,
        profileVersion: profile.profileVersion,
        catalogVersion: HUMAN_BOT_CATALOG_VERSION,
        config: buildPlayer(profile, opponentElo),
      })),
      gamesPerPair,
      alternateColors,
      baseSeed,
      seedStep,
      requestedConcurrency: concurrency,
      maxCpuThreads,
      maxMemoryMb,
      maxRetries,
      timeControl: useClock
        ? ({
            // Tauri's IPC payload is JSON; Rust deserializes these u64 values from numbers.
            initialTime: initialSeconds * 1000,
            increment: incrementSeconds * 1000,
          } as unknown as BotLeagueConfig["timeControl"])
        : null,
      openingBook: null,
    };
  }, [
    alternateColors,
    baseSeed,
    buildPlayer,
    concurrency,
    gamesPerPair,
    id,
    incrementSeconds,
    initialSeconds,
    maxCpuThreads,
    maxMemoryMb,
    maxRetries,
    selectedProfiles,
    seedStep,
    useClock,
  ]);

  async function startLeague() {
    setError(null);
    if (!engine) {
      setError(t("BotLeague.Errors.Engine", "Selecciona un motor Maia 3 instalado."));
      return;
    }
    if (selectedProfiles.length < 2) {
      setError(t("BotLeague.Errors.Players", "Selecciona al menos dos bots."));
      return;
    }
    setBusy(true);
    try {
      const newLeagueId = `bot-league-${Date.now()}`;
      const result = unwrap(await commands.startBotLeague(newLeagueId, buildConfig()));
      setLeagueId(result.leagueId);
      setState(result);
      await refreshSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function updateLeague(action: "pause" | "resume" | "cancel") {
    if (!leagueId) return;
    setBusy(true);
    try {
      const result =
        action === "pause"
          ? await commands.pauseBotLeague(leagueId)
          : action === "resume"
            ? await commands.resumeBotLeague(leagueId)
            : await commands.cancelBotLeague(leagueId);
      setState(unwrap(result));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function openSaved(summary: BotLeagueSummary) {
    setBusy(true);
    try {
      const detail = unwrap(await commands.getBotLeagueDetail(summary.leagueId));
      setLeagueId(null);
      setState(stateFromDetail(detail));
      setLeagueId(summary.leagueId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function openGameByIndex(result: BotLeagueGameResult) {
    if (!leagueId) return;
    try {
      const artifact = unwrap(await commands.readBotLeagueGame(leagueId, result.index));
      await createTab({
        tab: { name: `${result.whitePlayer} - ${result.blackPlayer}`, type: "analysis" },
        setTabs,
        setActiveTab,
        pgn: artifact.pgn,
      });
      navigate({ to: "/" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function exportLeague() {
    if (!leagueId) return;
    const destination = await openDialog({ directory: true, multiple: false });
    if (typeof destination !== "string") return;
    try {
      const exported = unwrap(
        await commands.exportBotLeague(leagueId, destination, `chess-lab-league-${leagueId}`),
      );
      notifications.show({
        title: t("BotLeague.Export.Success", "Liga exportada"),
        message: exported,
        color: "green",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const finished = state ? state.completedGames + state.failedGames : 0;
  const progress = state && state.totalGames > 0 ? (finished / state.totalGames) * 100 : 0;
  const terminal = state?.status === "completed" || state?.status === "cancelled";

  return (
    <ScrollArea h={embedded ? "70vh" : "100%"} type="auto">
      <Stack gap="md" p="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <IconTrophy />
            <Text fw={600} size="lg">
              {t("BotLeague.Title", "Liga de bots")}
            </Text>
          </Group>
          <Button variant="subtle" leftSection={<IconRefresh size="1rem" />} onClick={refreshSaved}>
            {t("BotLeague.Refresh", "Actualizar")}
          </Button>
        </Group>

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size="1rem" />} withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {!state && (
          <Paper withBorder p="md">
            <Stack gap="sm">
              <Text fw={600}>{t("BotLeague.Setup", "Configurar liga automática")}</Text>
              <EnginesSelect
                engine={engine}
                setEngine={setEngine}
                filter={isMaiaEngine}
                label={t("BotLeague.Engine", "Motor Maia 3")}
                description={
                  maiaEngines.length === 0
                    ? t("BotLeague.Engine.Missing", "Instala o activa un motor Maia 3 antes de comenzar.")
                    : t("BotLeague.Engine.Desc", "Todos los bots usarán este mismo motor con sus parámetros de perfil.")
                }
              />
              <MultiSelect
                label={t("BotLeague.Players", "Bots participantes")}
                description={t("BotLeague.Players.Desc", "El valor inicial usa seis bots de referencia para una prueba manejable.")}
                data={HUMAN_BOT_PROFILES.map((profile) => ({
                  value: profile.id,
                  label: `${profile.name} (${profile.elo})`,
                }))}
                value={selectedIds}
                onChange={setSelectedIds}
                searchable
                clearable
              />
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                <NumberInput
                  label={t("BotLeague.GamesPerPair", "Partidas por pareja")}
                  min={1}
                  max={20}
                  value={gamesPerPair}
                  onChange={(value) => setGamesPerPair(positiveInteger(value, gamesPerPair, 20))}
                />
                <NumberInput
                  label={t("BotLeague.BaseSeed", "Semilla inicial")}
                  min={0}
                  max={4_294_967_295}
                  value={baseSeed}
                  onChange={(value) => setBaseSeed(typeof value === "number" ? Math.max(0, Math.trunc(value)) : baseSeed)}
                />
                <NumberInput
                  label={t("BotLeague.SeedStep", "Paso de semilla")}
                  min={0}
                  max={4_294_967_295}
                  value={seedStep}
                  onChange={(value) => setSeedStep(typeof value === "number" ? Math.max(0, Math.trunc(value)) : seedStep)}
                />
                <NumberInput
                  label={t("BotLeague.Concurrency", "Concurrencia")}
                  min={1}
                  max={16}
                  value={concurrency}
                  onChange={(value) => setConcurrency(positiveInteger(value, concurrency, 16))}
                />
              </SimpleGrid>
              <Checkbox
                checked={alternateColors}
                onChange={(event) => setAlternateColors(event.currentTarget.checked)}
                label={t("BotLeague.AlternateColors", "Alternar colores entre partidas de cada pareja")}
              />
              <Checkbox
                checked={useClock}
                onChange={(event) => setUseClock(event.currentTarget.checked)}
                label={t("BotLeague.UseClock", "Usar reloj 3+2 para que el tiempo forme parte del comportamiento")}
              />
              {useClock && (
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <NumberInput
                    label={t("BotLeague.InitialTime", "Tiempo inicial (segundos)")}
                    min={10}
                    value={initialSeconds}
                    onChange={(value) => setInitialSeconds(positiveInteger(value, initialSeconds))}
                  />
                  <NumberInput
                    label={t("BotLeague.Increment", "Incremento (segundos)")}
                    min={0}
                    value={incrementSeconds}
                    onChange={(value) => setIncrementSeconds(typeof value === "number" ? Math.max(0, Math.trunc(value)) : incrementSeconds)}
                  />
                </SimpleGrid>
              )}
              <Divider label={t("BotLeague.Resources", "Recursos y reintentos")} />
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                <NumberInput label={t("BotLeague.Cpu", "Hilos máximos")} min={1} max={1024} value={maxCpuThreads} onChange={(value) => setMaxCpuThreads(positiveInteger(value, maxCpuThreads))} />
                <NumberInput label={t("BotLeague.Memory", "Hash máximo (MB)")} min={1} max={1_048_576} value={maxMemoryMb} onChange={(value) => setMaxMemoryMb(positiveInteger(value, maxMemoryMb))} />
                <NumberInput label={t("BotLeague.Retries", "Reintentos por partida")} min={0} max={5} value={maxRetries} onChange={(value) => setMaxRetries(typeof value === "number" ? Math.max(0, Math.min(5, Math.trunc(value))) : maxRetries)} />
              </SimpleGrid>
              <Text size="xs" c="dimmed">
                {t("BotLeague.Resources.Desc", "La concurrencia efectiva se reduce automáticamente si Threads o Hash exceden estos presupuestos. La estimación de ELO de la tabla es interna y relativa; no pretende ser un ELO oficial.")}
              </Text>
              <Button leftSection={<IconPlayerPlay size="1rem" />} onClick={startLeague} loading={busy} disabled={!engine || selectedProfiles.length < 2}>
                {t("BotLeague.Start", "Iniciar liga")}
              </Button>
            </Stack>
          </Paper>
        )}

        {state && (
          <Paper withBorder p="md">
            <Stack gap="sm">
              <Group justify="space-between">
                <Text fw={600}>{t("BotLeague.Progress.Title", "Progreso de la liga")}</Text>
                <Badge color={statusColor(state.status)}>{statusLabel(state.status, t)}</Badge>
              </Group>
              <Progress value={progress} animated={state.status === "running"} />
              <Text size="sm">
                {t("BotLeague.Progress.Summary", "{{finished}} de {{total}} partidas · {{active}} activas · {{queued}} en cola", {
                  finished,
                  total: state.totalGames,
                  active: state.activeGames.length,
                  queued: state.queuedGames,
                })}
              </Text>
              <Text size="xs" c="dimmed">
                {t("BotLeague.Progress.Resources", "Concurrencia efectiva: {{concurrency}} · {{threads}} Threads/partida · {{hash}} MB Hash/partida", {
                  concurrency: state.effectiveConcurrency,
                  threads: state.estimatedThreadsPerGame,
                  hash: state.estimatedHashMbPerGame,
                })}
              </Text>
              <Group>
                {!terminal && state.status === "running" && <Button variant="light" leftSection={<IconPlayerPause size="1rem" />} onClick={() => updateLeague("pause")} loading={busy}>{t("BotLeague.Pause", "Pausar")}</Button>}
                {!terminal && state.status === "paused" && <Button variant="light" leftSection={<IconPlayerPlay size="1rem" />} onClick={() => updateLeague("resume")} loading={busy}>{t("BotLeague.Resume", "Continuar")}</Button>}
                {!terminal && <Button color="red" variant="light" leftSection={<IconX size="1rem" />} onClick={() => updateLeague("cancel")} loading={busy}>{t("BotLeague.Cancel", "Cancelar")}</Button>}
                {terminal && <Button leftSection={<IconDownload size="1rem" />} onClick={exportLeague}>{t("BotLeague.Export", "Exportar paquete")}</Button>}
                {terminal && <Button variant="subtle" onClick={() => { setState(null); setLeagueId(null); void refreshSaved(); }}>{t("BotLeague.New", "Nueva liga")}</Button>}
              </Group>
            </Stack>
          </Paper>
        )}

        {state && (
          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <Paper withBorder p="md">
              <Text fw={600} mb="sm">{t("BotLeague.Standings", "Tabla de posiciones")}</Text>
              <ScrollArea>
                <Table striped highlightOnHover withTableBorder miw={650}>
                  <Table.Thead><Table.Tr><Table.Th>#</Table.Th><Table.Th>{t("BotLeague.Bot", "Bot")}</Table.Th><Table.Th>{t("BotLeague.Target", "Objetivo")}</Table.Th><Table.Th>{t("BotLeague.WhiteBlack", "B/N")}</Table.Th><Table.Th>W/D/L</Table.Th><Table.Th>{t("BotLeague.Points", "Puntos")}</Table.Th><Table.Th>{t("BotLeague.Estimated", "Estimación")}</Table.Th></Table.Tr></Table.Thead>
                  <Table.Tbody>
                    {state.standings.map((standing, index) => (
                      <Table.Tr key={standing.profileId}><Table.Td>{index + 1}</Table.Td><Table.Td>{standing.name}</Table.Td><Table.Td>{standing.targetElo}</Table.Td><Table.Td>{standing.whiteGames}/{standing.blackGames}</Table.Td><Table.Td>{standing.wins}/{standing.draws}/{standing.losses}</Table.Td><Table.Td>{standing.points.toFixed(1)}</Table.Td><Table.Td>{standing.estimatedElo ?? "—"}</Table.Td></Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Paper>
            <Paper withBorder p="md">
              <Text fw={600} mb="sm">{t("BotLeague.Results", "Resultados")}</Text>
              <ScrollArea h={320}>
                <Stack gap="xs">
                  {state.results.map((result) => (
                    <Group key={result.index} justify="space-between" wrap="nowrap">
                      <Text size="sm" truncate>{result.index + 1}. {result.whitePlayer} — {result.blackPlayer}</Text>
                      <Group gap="xs" wrap="nowrap"><Text size="sm" fw={600}>{resultLabel(result.result)}</Text>{result.artifactAvailable && <Button size="compact-xs" variant="subtle" leftSection={<IconZoomCheck size="0.8rem" />} onClick={() => openGameByIndex(result)}>{t("BotLeague.Open", "Abrir")}</Button>}</Group>
                    </Group>
                  ))}
                </Stack>
              </ScrollArea>
            </Paper>
          </SimpleGrid>
        )}

        <Paper withBorder p="md">
          <Text fw={600} mb="sm">{t("BotLeague.Saved", "Ligas guardadas")}</Text>
          {savedLeagues.length === 0 ? <Text size="sm" c="dimmed">{t("BotLeague.Saved.Empty", "Todavía no hay ligas guardadas.")}</Text> : (
            <Stack gap="xs">
              {savedLeagues.slice(0, 12).map((summary) => (
                <Group key={summary.leagueId} justify="space-between" wrap="nowrap">
                  <Text size="sm" truncate>{summary.leagueId} · {summary.completedGames}/{summary.totalGames}</Text>
                  <Group gap="xs" wrap="nowrap"><Badge color={statusColor(summary.status)}>{statusLabel(summary.status, t)}</Badge><Button size="compact-xs" variant="subtle" onClick={() => openSaved(summary)} loading={busy}>{t("BotLeague.View", "Ver")}</Button></Group>
                </Group>
              ))}
            </Stack>
          )}
        </Paper>
      </Stack>
    </ScrollArea>
  );
}
