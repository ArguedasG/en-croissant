import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconFlask,
  IconPlayerPause,
  IconPlayerPlay,
  IconSettings,
  IconZoomCheck,
  IconX,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { GameResult, ModelGameBatchState } from "@/bindings";
import type { ModelGameBatchSettings } from "@/state/atoms";

function positiveInteger(value: string | number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.trunc(value))
    : fallback;
}

export function ModelGameBatchSetup({
  settings,
  setSettings,
}: {
  settings: ModelGameBatchSettings;
  setSettings: React.Dispatch<React.SetStateAction<ModelGameBatchSettings>>;
}) {
  const { t } = useTranslation();
  const update = (values: Partial<ModelGameBatchSettings>) =>
    setSettings((previous) => ({ ...previous, ...values }));

  return (
    <Paper withBorder p="sm">
      <Stack gap="sm">
        <Switch
          checked={settings.enabled}
          onChange={(event) => update({ enabled: event.currentTarget.checked })}
          label={t("ModelGame.Batch.Enable", "Run a batch")}
          description={t(
            "ModelGame.Batch.Enable.Desc",
            "Generate several games in the background from this same position.",
          )}
        />

        {settings.enabled && (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <NumberInput
                label={t("ModelGame.Batch.GameCount", "Number of games")}
                min={1}
                max={1000}
                value={settings.gameCount}
                onChange={(value) =>
                  update({ gameCount: Math.min(1000, positiveInteger(value, settings.gameCount)) })
                }
              />
              <NumberInput
                label={t("ModelGame.Batch.SeedStep", "Seed increment")}
                description={t(
                  "ModelGame.Batch.SeedStep.Desc",
                  "Added to each player's seed after every scheduled game.",
                )}
                min={0}
                max={4_294_967_295}
                value={settings.seedStep}
                onChange={(value) =>
                  update({
                    seedStep:
                      typeof value === "number" && Number.isFinite(value)
                        ? Math.max(0, Math.trunc(value))
                        : settings.seedStep,
                  })
                }
              />
            </SimpleGrid>
            <Switch
              checked={settings.alternateColors}
              onChange={(event) => update({ alternateColors: event.currentTarget.checked })}
              label={t("ModelGame.Batch.AlternateColors", "Alternate colors")}
              description={t(
                "ModelGame.Batch.AlternateColors.Desc",
                "Swap the complete player configurations in every second game.",
              )}
            />

            <Divider label={t("ModelGame.Batch.Resources", "Scheduling and resource budgets")} />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <NumberInput
                label={t("ModelGame.Batch.Concurrency", "Requested concurrency")}
                min={1}
                max={32}
                value={settings.concurrency}
                onChange={(value) =>
                  update({
                    concurrency: Math.min(32, positiveInteger(value, settings.concurrency)),
                  })
                }
              />
              <NumberInput
                label={t("ModelGame.Batch.Retries", "Retries per game")}
                min={0}
                max={5}
                value={settings.maxRetries}
                onChange={(value) =>
                  update({
                    maxRetries:
                      typeof value === "number" && Number.isFinite(value)
                        ? Math.max(0, Math.min(5, Math.trunc(value)))
                        : settings.maxRetries,
                  })
                }
              />
              <NumberInput
                label={t("ModelGame.Batch.CpuBudget", "CPU thread budget")}
                min={1}
                max={1024}
                value={settings.maxCpuThreads}
                onChange={(value) =>
                  update({ maxCpuThreads: positiveInteger(value, settings.maxCpuThreads) })
                }
              />
              <NumberInput
                label={t("ModelGame.Batch.MemoryBudget", "Hash memory budget (MB)")}
                min={1}
                max={1_048_576}
                value={settings.maxMemoryMb}
                onChange={(value) =>
                  update({ maxMemoryMb: positiveInteger(value, settings.maxMemoryMb) })
                }
              />
            </SimpleGrid>
            <Text size="xs" c="dimmed">
              {t(
                "ModelGame.Batch.Resources.Desc",
                "Chess Lab lowers concurrency when the combined Threads or Hash requested by active games would exceed these budgets. Hash is a scheduling estimate, not a hard limit on total process or GPU memory.",
              )}
            </Text>
          </>
        )}
      </Stack>
    </Paper>
  );
}

function statusLabel(
  status: ModelGameBatchState["status"],
  t: (key: string, fallback: string) => string,
) {
  switch (status) {
    case "running":
      return t("ModelGame.Batch.Status.Running", "Running");
    case "paused":
      return t("ModelGame.Batch.Status.Paused", "Paused");
    case "cancelling":
      return t("ModelGame.Batch.Status.Cancelling", "Cancelling");
    case "completed":
      return t("ModelGame.Batch.Status.Completed", "Completed");
    case "cancelled":
      return t("ModelGame.Batch.Status.Cancelled", "Cancelled");
  }
}

function resultLabel(result: GameResult | null): string {
  if (!result) return "*";
  if (result.type === "whiteWins") return "1-0";
  if (result.type === "blackWins") return "0-1";
  return "½-½";
}

export function ModelGameBatchProgress({
  state,
  busy,
  onPause,
  onResume,
  onCancel,
  onEdit,
  onOpenExperiment,
  onAnalyze,
}: {
  state: ModelGameBatchState;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onEdit: () => void;
  onOpenExperiment: () => void;
  onAnalyze: (index: number) => void;
}) {
  const { t } = useTranslation();
  const finished = state.completedGames + state.failedGames;
  const progress = state.totalGames > 0 ? (finished / state.totalGames) * 100 : 0;
  const isTerminal = state.status === "completed" || state.status === "cancelled";

  return (
    <Stack h="100%" gap="sm">
      <Paper withBorder p="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600}>{t("ModelGame.Batch.Title", "Batch execution")}</Text>
            <Badge
              color={
                state.status === "completed"
                  ? "green"
                  : state.status === "cancelled"
                    ? "gray"
                    : state.status === "paused"
                      ? "yellow"
                      : "blue"
              }
            >
              {statusLabel(state.status, t)}
            </Badge>
          </Group>
          <Progress value={progress} animated={state.status === "running"} />
          <Text size="sm">
            {t("ModelGame.Batch.Progress", {
              defaultValue:
                "{{finished}} of {{total}} finished · {{active}} active · {{queued}} queued",
              finished,
              total: state.totalGames,
              active: state.activeGames.length,
              queued: state.queuedGames,
            })}
          </Text>
          <Text size="xs" c="dimmed">
            {t("ModelGame.Batch.EffectiveResources", {
              defaultValue:
                "Effective concurrency: {{concurrency}} · {{threads}} Threads/game · {{hash}} MB Hash/game",
              concurrency: state.effectiveConcurrency,
              threads: state.estimatedThreadsPerGame,
              hash: state.estimatedHashMbPerGame,
            })}
          </Text>
          {state.failedGames > 0 && (
            <Alert color="yellow" icon={<IconAlertTriangle size="1rem" />}>
              {t("ModelGame.Batch.Failures", {
                defaultValue: "{{count}} games exhausted their retry limit.",
                count: state.failedGames,
              })}
            </Alert>
          )}
          {!isTerminal && (
            <Group grow>
              {state.status === "paused" ? (
                <Button
                  variant="default"
                  leftSection={<IconPlayerPlay size="1rem" />}
                  onClick={onResume}
                  loading={busy}
                >
                  {t("ModelGame.Batch.Resume", "Resume")}
                </Button>
              ) : (
                <Button
                  variant="default"
                  leftSection={<IconPlayerPause size="1rem" />}
                  onClick={onPause}
                  disabled={state.status !== "running"}
                  loading={busy}
                >
                  {t("ModelGame.Batch.Pause", "Pause")}
                </Button>
              )}
              <Button
                color="red"
                variant="light"
                leftSection={<IconX size="1rem" />}
                onClick={onCancel}
                disabled={state.status === "cancelling"}
                loading={busy && state.status === "cancelling"}
              >
                {t("ModelGame.Batch.Cancel", "Cancel batch")}
              </Button>
            </Group>
          )}
          {isTerminal && (
            <Group grow>
              <Button
                variant="default"
                leftSection={<IconFlask size="1rem" />}
                onClick={onOpenExperiment}
              >
                {t("ModelGame.Experiments.Open", "Open experiment")}
              </Button>
              <Button variant="default" leftSection={<IconSettings size="1rem" />} onClick={onEdit}>
                {t("ModelGame.Batch.Edit", "Edit setup / new batch")}
              </Button>
            </Group>
          )}
          <Text size="xs" c="dimmed">
            {t(
              "ModelGame.Batch.Background",
              "The batch continues when you switch tabs. Closing this generator tab cancels it.",
            )}
          </Text>
        </Stack>
      </Paper>

      <Paper withBorder p="sm" flex={1} mih={0}>
        <Stack h="100%" gap="xs">
          <Text fw={600} size="sm">
            {t("ModelGame.Batch.Results", "Finished games")}
          </Text>
          {state.results.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t("ModelGame.Batch.NoResults", "No games have finished yet.")}
            </Text>
          ) : (
            <ScrollArea flex={1} type="auto">
              <Stack gap="xs">
                {state.results.map((result) => (
                  <Paper key={`${result.index}-${result.gameId}`} withBorder p="xs">
                    <Group justify="space-between" wrap="nowrap">
                      <div>
                        <Text size="sm" fw={500}>
                          #{result.index + 1} · {result.whitePlayer} – {result.blackPlayer}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {t("ModelGame.Batch.ResultDetails", {
                            defaultValue:
                              "Seeds {{whiteSeed}} / {{blackSeed}} · {{plies}} plies · {{attempts}} attempt(s)",
                            whiteSeed: result.whiteSeed ?? "—",
                            blackSeed: result.blackSeed ?? "—",
                            plies: result.plies,
                            attempts: result.attempts,
                          })}
                        </Text>
                        {result.error && (
                          <Text size="xs" c="red">
                            {result.error}
                          </Text>
                        )}
                      </div>
                      <Group gap="xs" wrap="nowrap">
                        <Tooltip label={t("Board.Action.AnalyzeGame", "Analizar partida")}>
                          <ActionIcon
                            variant="subtle"
                            disabled={result.status === "failed" && result.plies === 0}
                            aria-label={t("Board.Action.AnalyzeGame", "Analizar partida")}
                            onClick={() => onAnalyze(result.index)}
                          >
                            <IconZoomCheck size={17} />
                          </ActionIcon>
                        </Tooltip>
                        <Badge color={result.status === "completed" ? "green" : "red"}>
                          {result.status === "completed"
                            ? resultLabel(result.result)
                            : t("ModelGame.Batch.GameFailed", "Failed")}
                        </Badge>
                      </Group>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </ScrollArea>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
