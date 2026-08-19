import {
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { notifications } from "@mantine/notifications";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ExperimentAnalysisResult, EngineOption, GoMode } from "@/bindings";
import { commands, events } from "@/bindings";
import GoModeInput from "@/components/common/GoModeInput";
import { enginesAtom } from "@/state/atoms";
import type { LocalEngine } from "@/utils/engines";
import { isMaiaEngine } from "@/utils/humanBots";
import { unwrap } from "@/utils/unwrap";

function metric(value: number | null): string {
  return value === null ? "–" : `${value.toFixed(1)} cp`;
}

function record(wins: number, draws: number, losses: number): string {
  return `${wins}-${draws}-${losses}`;
}

function phaseLabel(phase: string, t: (key: string, fallback: string) => string): string {
  const labels: Record<string, string> = {
    opening: t("ModelGame.Experiments.Analysis.Opening", "Opening"),
    middlegame: t("ModelGame.Experiments.Analysis.Middlegame", "Middlegame"),
    endgame: t("ModelGame.Experiments.Analysis.Endgame", "Endgame"),
  };
  return labels[phase] ?? phase;
}

export default function ExperimentAnalysisPanel({ experimentId }: { experimentId: string }) {
  const { t } = useTranslation();
  const allEngines = useAtomValue(enginesAtom);
  const localEngines = useMemo(
    () =>
      (allEngines ?? []).filter(
        (engine): engine is LocalEngine => engine.type === "local" && !isMaiaEngine(engine),
      ),
    [allEngines],
  );
  const [engineId, setEngineId] = useState("");
  const [goMode, setGoMode] = useState<GoMode>({ t: "Time", c: 500 });
  const [analysis, setAnalysis] = useState<ExperimentAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const analysisId = `experiment_analysis_${experimentId}`;
  const engine = localEngines.find((candidate) => candidate.id === engineId) ?? null;

  useEffect(() => {
    if (localEngines.length === 0) {
      setEngineId("");
      return;
    }
    if (!localEngines.some((candidate) => candidate.id === engineId)) {
      setEngineId(localEngines[0].id);
    }
  }, [engineId, localEngines]);

  useEffect(() => {
    let active = true;
    setAnalysis(null);
    setProgress(0);
    commands
      .getModelGameExperimentAnalysis(experimentId)
      .then((result) => {
        if (active) setAnalysis(unwrap(result));
      })
      .catch(() => {
        // A missing analysis is the normal state before the first run.
      });
    return () => {
      active = false;
    };
  }, [experimentId]);

  useEffect(() => {
    const unlisten = events.progressEvent.listen((event) => {
      if (event.payload.id !== analysisId) return;
      setProgress(event.payload.progress);
    });
    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, [analysisId]);

  const runAnalysis = useCallback(async () => {
    if (!engine) return;
    const uciOptions: EngineOption[] = (engine.settings ?? []).map((setting) => ({
      name: setting.name,
      value: setting.value == null ? "" : String(setting.value),
    }));

    setLoading(true);
    setProgress(0);
    try {
      const result = unwrap(
        await commands.analyzeModelGameExperiment(
          analysisId,
          experimentId,
          engine.path,
          engine.args ?? [],
          goMode,
          uciOptions,
        ),
      );
      setAnalysis(result);
      setProgress(100);
    } catch (error) {
      // Keep the cached result visible if a new run fails or is cancelled.
      if (error instanceof Error && error.message.toLowerCase().includes("cancel")) return;
      notifications.show({
        title: t("ModelGame.Experiments.Analysis.Error", "Analysis failed"),
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }, [analysisId, engine, experimentId, goMode, t]);

  const cancelAnalysis = useCallback(async () => {
    try {
      unwrap(await commands.cancelAnalysis(analysisId));
    } catch {
      // The analysis command will report its own engine error if cancellation races with exit.
    }
  }, [analysisId]);

  const summary = analysis?.summary;
  return (
    <Paper withBorder p="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={600}>{t("ModelGame.Experiments.Analysis.Title", "Experiment analysis")}</Text>
            <Text size="xs" c="dimmed">
              {t(
                "ModelGame.Experiments.Analysis.Description",
                "Objective ACPL, inaccuracies, mistakes and blunders for completed games. Maia is kept separate from this objective evaluator.",
              )}
            </Text>
          </div>
          {analysis && (
            <Badge variant="light">
              {t("ModelGame.Experiments.Analysis.Cached", "Saved result")}
            </Badge>
          )}
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            label={t("ModelGame.Experiments.Analysis.Engine", "Evaluation engine")}
            description={t(
              "ModelGame.Experiments.Analysis.Engine.Desc",
              "Uses a local engine and excludes Maia from objective metrics.",
            )}
            allowDeselect={false}
            data={localEngines.map((candidate) => ({
              label: candidate.name,
              value: candidate.id,
            }))}
            value={engine?.id ?? ""}
            onChange={(value) => setEngineId(value ?? "")}
            disabled={loading || localEngines.length === 0}
            placeholder={t("ModelGame.Experiments.Analysis.NoEngine", "Add a local engine first")}
          />
          <div>
            <Text size="sm" fw={500} mb={5}>
              {t("ModelGame.Experiments.Analysis.Limit", "Limit per position")}
            </Text>
            <GoModeInput goMode={goMode} setGoMode={setGoMode} gameMode />
          </div>
          <Group align="end" gap="xs">
            <Button
              leftSection={<IconPlayerPlay size={15} />}
              loading={loading}
              disabled={!engine || loading}
              onClick={runAnalysis}
            >
              {t("ModelGame.Experiments.Analysis.Run", "Analyze")}
            </Button>
            <Button
              variant="default"
              leftSection={<IconPlayerPause size={15} />}
              disabled={!loading}
              onClick={cancelAnalysis}
            >
              {t("Common.Cancel", "Cancel")}
            </Button>
          </Group>
        </SimpleGrid>

        {loading && (
          <Stack gap={3}>
            <Progress value={progress} animated />
            <Text size="xs" c="dimmed">
              {progress.toFixed(0)}% ·{" "}
              {t("ModelGame.Experiments.Analysis.Running", "Analyzing positions…")}
            </Text>
          </Stack>
        )}

        {!summary ? (
          <Text size="sm" c="dimmed">
            {t(
              "ModelGame.Experiments.Analysis.Empty",
              "Run the analysis to calculate reproducible metrics for this experiment.",
            )}
          </Text>
        ) : (
          <Stack gap="sm">
            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              <MetricCard label={t("Common.Games", "Games")} value={`${summary.sampleSize}`} />
              <MetricCard
                label={t("ModelGame.Experiments.Analysis.Plies", "Analyzed plies")}
                value={`${summary.analyzedPlies}`}
              />
              <MetricCard
                label={t("ModelGame.Experiments.Analysis.Record", "White W-D-L")}
                value={record(summary.whiteWins, summary.draws, summary.blackWins)}
              />
              <MetricCard
                label={t("ModelGame.Experiments.Analysis.AveragePlies", "Avg. plies")}
                value={summary.averagePlies === null ? "–" : summary.averagePlies.toFixed(1)}
              />
            </SimpleGrid>

            <Table.ScrollContainer minWidth={560}>
              <Table striped withRowBorders={false} fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("ModelGame.Experiments.Analysis.Side", "Side")}</Table.Th>
                    <Table.Th ta="right">ACPL</Table.Th>
                    <Table.Th ta="right">
                      {t("ModelGame.Experiments.Analysis.Moves", "Moves")}
                    </Table.Th>
                    <Table.Th ta="right">
                      {t("ModelGame.Experiments.Analysis.Inaccuracies", "Inaccuracies")}
                    </Table.Th>
                    <Table.Th ta="right">
                      {t("ModelGame.Experiments.Analysis.Mistakes", "Mistakes")}
                    </Table.Th>
                    <Table.Th ta="right">
                      {t("ModelGame.Experiments.Analysis.Blunders", "Blunders")}
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <AnalysisSideRow label={t("Common.White", "White")} metrics={summary.white} />
                  <AnalysisSideRow label={t("Common.Black", "Black")} metrics={summary.black} />
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>

            <Table.ScrollContainer minWidth={680}>
              <Table striped withRowBorders={false} fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("ModelGame.Experiments.Analysis.Player", "Player")}</Table.Th>
                    <Table.Th ta="right">{t("Common.Games", "Games")}</Table.Th>
                    <Table.Th ta="right">W-D-L</Table.Th>
                    <Table.Th ta="right">ACPL</Table.Th>
                    <Table.Th ta="right">
                      {t("ModelGame.Experiments.Analysis.Inaccuracies", "Inaccuracies")}
                    </Table.Th>
                    <Table.Th ta="right">
                      {t("ModelGame.Experiments.Analysis.Mistakes", "Mistakes")}
                    </Table.Th>
                    <Table.Th ta="right">
                      {t("ModelGame.Experiments.Analysis.Blunders", "Blunders")}
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {summary.players.map((player) => (
                    <Table.Tr key={player.name}>
                      <Table.Td>{player.name}</Table.Td>
                      <Table.Td ta="right">{player.games}</Table.Td>
                      <Table.Td ta="right">
                        {record(player.wins, player.draws, player.losses)}
                      </Table.Td>
                      <Table.Td ta="right">{metric(player.acpl)}</Table.Td>
                      <Table.Td ta="right">{player.inaccuracies}</Table.Td>
                      <Table.Td ta="right">{player.mistakes}</Table.Td>
                      <Table.Td ta="right">{player.blunders}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>

            <Table.ScrollContainer minWidth={560}>
              <Table striped withRowBorders={false} fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("ModelGame.Experiments.Analysis.Phase", "Phase")}</Table.Th>
                    <Table.Th ta="right">ACPL</Table.Th>
                    <Table.Th ta="right">
                      {t("ModelGame.Experiments.Analysis.Moves", "Moves")}
                    </Table.Th>
                    <Table.Th ta="right">
                      {t("ModelGame.Experiments.Analysis.Inaccuracies", "Inaccuracies")}
                    </Table.Th>
                    <Table.Th ta="right">
                      {t("ModelGame.Experiments.Analysis.Mistakes", "Mistakes")}
                    </Table.Th>
                    <Table.Th ta="right">
                      {t("ModelGame.Experiments.Analysis.Blunders", "Blunders")}
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {summary.phases.map((phase) => (
                    <Table.Tr key={phase.phase}>
                      <Table.Td>{phaseLabel(phase.phase, t)}</Table.Td>
                      <Table.Td ta="right">{metric(phase.acpl)}</Table.Td>
                      <Table.Td ta="right">{phase.moves}</Table.Td>
                      <Table.Td ta="right">{phase.inaccuracies}</Table.Td>
                      <Table.Td ta="right">{phase.mistakes}</Table.Td>
                      <Table.Td ta="right">{phase.blunders}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>

            <Text size="xs" c="dimmed">
              {t(
                "ModelGame.Experiments.Analysis.Method",
                "Method: >40 cp is an inaccuracy, >100 cp is a mistake and >200 cp is a blunder; ACPL and phase labels depend on the selected engine and limit.",
              )}
            </Text>
            <Text size="xs" c="dimmed">
              {t(
                "ModelGame.Experiments.Analysis.AcplMeaning",
                "ACPL: Average CentiPawn Loss — average loss in centipawns per analyzed move.",
              )}
            </Text>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder p="xs">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600}>{value}</Text>
    </Paper>
  );
}

function AnalysisSideRow({
  label,
  metrics,
}: {
  label: string;
  metrics: ExperimentAnalysisResult["summary"]["white"];
}) {
  return (
    <Table.Tr>
      <Table.Td>{label}</Table.Td>
      <Table.Td ta="right">{metric(metrics.acpl)}</Table.Td>
      <Table.Td ta="right">{metrics.moves}</Table.Td>
      <Table.Td ta="right">{metrics.inaccuracies}</Table.Td>
      <Table.Td ta="right">{metrics.mistakes}</Table.Td>
      <Table.Td ta="right">{metrics.blunders}</Table.Td>
    </Table.Tr>
  );
}
