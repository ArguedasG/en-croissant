import {
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { IconPlayerPlay } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EmpiricalWdlResult, EngineOption, GoMode } from "@/bindings";
import { commands } from "@/bindings";
import GoModeInput from "@/components/common/GoModeInput";
import { enginesAtom } from "@/state/atoms";
import type { LocalEngine } from "@/utils/engines";
import {
  clampMaiaElo,
  DEFAULT_MAIA_ELO,
  isMaiaEngine,
  MAIA_ELO_MAX,
  MAIA_ELO_MIN,
} from "@/utils/humanBots";
import { unwrap } from "@/utils/unwrap";

function percentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

function interval(value: EmpiricalWdlResult["observed"]["whiteWinInterval"]): string {
  return `${percentage(value.lower * 100)}–${percentage(value.upper * 100)}`;
}

function resultLine(
  values: Pick<EmpiricalWdlResult["prediction"], "whiteWin" | "draw" | "blackWin">,
): string {
  return `${percentage(values.whiteWin)} – ${percentage(values.draw)} – ${percentage(values.blackWin)}`;
}

export default function EmpiricalWdlPanel({ experimentId }: { experimentId: string }) {
  const { t } = useTranslation();
  const allEngines = useAtomValue(enginesAtom);
  const maiaEngines = useMemo(
    () =>
      (allEngines ?? []).filter(
        (engine): engine is LocalEngine => engine.type === "local" && isMaiaEngine(engine),
      ),
    [allEngines],
  );
  const [engineId, setEngineId] = useState("");
  const [maiaElo, setMaiaElo] = useState(DEFAULT_MAIA_ELO);
  const [goMode, setGoMode] = useState<GoMode>({ t: "Time", c: 200 });
  const [result, setResult] = useState<EmpiricalWdlResult | null>(null);
  const [loading, setLoading] = useState(false);
  const engine = maiaEngines.find((candidate) => candidate.id === engineId) ?? null;

  useEffect(() => {
    if (maiaEngines.length === 0) {
      setEngineId("");
      return;
    }
    if (!maiaEngines.some((candidate) => candidate.id === engineId)) {
      setEngineId(maiaEngines[0].id);
    }
  }, [engineId, maiaEngines]);

  useEffect(() => {
    let active = true;
    setResult(null);
    commands
      .getModelGameExperimentEmpiricalWdl(experimentId)
      .then((response) => {
        if (active) setResult(unwrap(response));
      })
      .catch(() => {
        // A missing empirical result is normal before the first benchmark.
      });
    return () => {
      active = false;
    };
  }, [experimentId]);

  useEffect(() => {
    const configuredElo = engine?.settings?.find((setting) => setting.name === "Elo")?.value;
    if (typeof configuredElo === "number") setMaiaElo(clampMaiaElo(configuredElo));
  }, [engine]);

  const runBenchmark = useCallback(async () => {
    if (!engine) return;
    const options: EngineOption[] = [
      ...(engine.settings ?? [])
        .filter((setting) => setting.name !== "Elo" && setting.name !== "MultiPV")
        .map((setting) => ({
          name: setting.name,
          value: setting.value == null ? "" : String(setting.value),
        })),
      { name: "Elo", value: String(clampMaiaElo(maiaElo)) },
      { name: "MultiPV", value: "1" },
    ];

    setLoading(true);
    try {
      const next = unwrap(
        await commands.analyzeModelGameExperimentEmpiricalWdl(
          experimentId,
          engine.path,
          engine.args ?? [],
          goMode,
          options,
        ),
      );
      setResult(next);
    } catch (error) {
      notifications.show({
        title: t("ModelGame.Experiments.Empirical.Error", "Empirical benchmark failed"),
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }, [engine, experimentId, goMode, maiaElo, t]);

  return (
    <Paper withBorder p="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={600}>
              {t("ModelGame.Experiments.Empirical.Title", "Empirical W/D/L benchmark")}
            </Text>
            <Text size="xs" c="dimmed">
              {t(
                "ModelGame.Experiments.Empirical.Description",
                "Compares Maia's initial-position prediction with the observed results of the saved games. This is a basic benchmark, not a human ELO calibration.",
              )}
            </Text>
          </div>
          {result && <Badge variant="light">{t("Common.Saved", "Saved")}</Badge>}
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 4 }}>
          <Select
            label={t("ModelGame.Experiments.Empirical.Engine", "Maia engine")}
            data={maiaEngines.map((candidate) => ({
              label: candidate.name,
              value: candidate.id,
            }))}
            value={engine?.id ?? ""}
            onChange={(value) => setEngineId(value ?? "")}
            disabled={loading || maiaEngines.length === 0}
            placeholder={t("ModelGame.Experiments.Empirical.NoEngine", "Add a Maia 3 engine first")}
          />
          <NumberInput
            label={t("HumanBots.MaiaElo", "Maia ELO")}
            min={MAIA_ELO_MIN}
            max={MAIA_ELO_MAX}
            step={100}
            value={maiaElo}
            onChange={(value) => {
              if (typeof value === "number") setMaiaElo(clampMaiaElo(value));
            }}
            disabled={loading || !engine}
          />
          <div>
            <Text size="sm" fw={500} mb={5}>
              {t("ModelGame.Experiments.Empirical.Limit", "Prediction limit")}
            </Text>
            <GoModeInput goMode={goMode} setGoMode={setGoMode} gameMode />
          </div>
          <Group align="end">
            <Button
              leftSection={<IconPlayerPlay size={15} />}
              loading={loading}
              disabled={!engine || loading}
              onClick={runBenchmark}
            >
              {t("ModelGame.Experiments.Empirical.Run", "Run benchmark")}
            </Button>
          </Group>
        </SimpleGrid>

        {!result ? (
          <Text size="sm" c="dimmed">
            {maiaEngines.length === 0
              ? t(
                  "ModelGame.Experiments.Empirical.NoEngineMessage",
                  "Register Maia 3, then use this benchmark on a completed Maia–Stockfish batch.",
                )
              : t(
                  "ModelGame.Experiments.Empirical.Empty",
                  "Run the benchmark to compare Maia's prediction with observed white-side results.",
                )}
          </Text>
        ) : (
          <Stack gap="sm">
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <MetricCard
                label={t("ModelGame.Experiments.Empirical.Predicted", "Maia predicted W-D-L")}
                value={resultLine(result.prediction)}
              />
              <MetricCard
                label={t("ModelGame.Experiments.Empirical.Observed", "Observed W-D-L")}
                value={`${result.observed.whiteWins}-${result.observed.draws}-${result.observed.blackWins} (${result.observed.sampleSize})`}
              />
              <MetricCard
                label={t("ModelGame.Experiments.Empirical.Metrics", "MAE / Brier")}
                value={`${result.calibration.meanAbsoluteError.toFixed(1)} pp / ${result.calibration.brierScore.toFixed(3)}`}
              />
            </SimpleGrid>
            <Text size="xs" c="dimmed">
              {t("ModelGame.Experiments.Empirical.Intervals", {
                defaultValue:
                  "Observed percentages (95% Wilson): White {{white}} [{{whiteInterval}}], Draw {{draw}} [{{drawInterval}}], Black {{black}} [{{blackInterval}}].",
                white: percentage(result.observed.whiteWin),
                whiteInterval: interval(result.observed.whiteWinInterval),
                draw: percentage(result.observed.draw),
                drawInterval: interval(result.observed.drawInterval),
                black: percentage(result.observed.blackWin),
                blackInterval: interval(result.observed.blackWinInterval),
              })}
            </Text>
            <Text size="xs" c="dimmed">
              {t(
                "ModelGame.Experiments.Empirical.Method",
                "W/D/L and intervals are from White's perspective. MAE is the mean absolute difference in percentage points; Brier is a multiclass probability score where lower is better.",
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
