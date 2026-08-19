import {
  Alert,
  Badge,
  Center,
  Divider,
  Group,
  InputWrapper,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconAlertTriangle, IconCpu, IconRobot, IconUser } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GoMode } from "@/bindings";
import GoModeInput from "@/components/common/GoModeInput";
import TimeInput, { type TimeType } from "@/components/common/TimeInput";
import EngineSettingsForm from "@/components/panels/analysis/EngineSettingsForm";
import type { TimeControlField } from "@/utils/clock";
import type { EngineSettings, LocalEngine } from "@/utils/engines";
import {
  applyEnginePlayerPreset,
  ENGINE_PLAYER_PRESETS,
  getEnginePresetNodeBudget,
  getEnginePresetDescription,
  normalizeEngineGoMode,
  type EnginePlayerPresetId,
} from "@/utils/enginePresets";
import {
  buildMaiaEngineSettings,
  clampMaiaElo,
  DEFAULT_HUMAN_BOT_PROFILE_ID,
  DEFAULT_MAIA_ELO,
  getHumanBotProfile,
  HUMAN_BOT_PROFILES,
  MAIA_ELO_MAX,
  MAIA_ELO_MIN,
  type HumanBotProfileId,
  type HumanBotRepertoireId,
  type HumanBotStyleAxisLevel,
  isMaiaEngine,
} from "@/utils/humanBots";
import { EnginesSelect } from "./EnginesSelect";

export type OpponentSettings =
  | {
      type: "human";
      timeControl?: TimeControlField;
      name?: string;
      timeUnit?: TimeType;
      incrementUnit?: TimeType;
    }
  | {
      type: "engine";
      timeControl?: TimeControlField;
      engine: LocalEngine | null;
      go: GoMode;
      engineSettings?: EngineSettings;
      presetId?: EnginePlayerPresetId;
      targetElo?: number;
      seed?: number;
      timeUnit?: TimeType;
      incrementUnit?: TimeType;
    }
  | {
      type: "humanBot";
      timeControl?: TimeControlField;
      engine: LocalEngine | null;
      profileId: HumanBotProfileId;
      humanTiming?: boolean;
      seed?: number;
      timeUnit?: TimeType;
      incrementUnit?: TimeType;
    };

type OpponentType = OpponentSettings["type"];

export const DEFAULT_TIME_CONTROL: TimeControlField = {
  seconds: 180_000,
  increment: 2_000,
};

export function OpponentForm({
  sameTimeControl,
  opponent,
  setOpponent,
  setOtherOpponent,
  allowedTypes = ["human", "engine", "humanBot"],
  showSeed = false,
  humanTimingEnabled = true,
}: {
  sameTimeControl: boolean;
  opponent: OpponentSettings;
  setOpponent: React.Dispatch<React.SetStateAction<OpponentSettings>>;
  setOtherOpponent: React.Dispatch<React.SetStateAction<OpponentSettings>>;
  allowedTypes?: OpponentType[];
  showSeed?: boolean;
  humanTimingEnabled?: boolean;
}) {
  const { t } = useTranslation();
  const [eloDraft, setEloDraft] = useState<string | null>(null);
  const humanBotProfile = getHumanBotProfile(
    opponent.type === "humanBot" ? opponent.profileId : DEFAULT_HUMAN_BOT_PROFILE_ID,
  );
  const maiaEngine =
    opponent.type === "engine" && opponent.engine && isMaiaEngine(opponent.engine)
      ? opponent.engine
      : null;
  const opponentEnginePath = "engine" in opponent ? opponent.engine?.path : undefined;
  const opponentPresetId = opponent.type === "engine" ? opponent.presetId : undefined;

  useEffect(() => {
    setEloDraft(null);
  }, [opponentEnginePath, opponentPresetId, opponent.type]);

  function handleEloInput(
    value: string | number,
    minimum: number,
    maximum: number,
    onValidValue: (value: number) => void,
  ) {
    const draft = typeof value === "number" ? String(value) : value;
    setEloDraft(draft);
    const numeric = Number(draft);
    if (Number.isInteger(numeric) && numeric >= minimum && numeric <= maximum) {
      onValidValue(numeric);
    }
  }

  function commitEloDraft(
    minimum: number,
    maximum: number,
    fallback: number,
    onValue: (value: number) => void,
  ) {
    if (eloDraft === null) return;
    const numeric = Number(eloDraft);
    const value = Number.isFinite(numeric)
      ? Math.max(minimum, Math.min(maximum, Math.trunc(numeric)))
      : fallback;
    setEloDraft(null);
    onValue(value);
  }

  function applyMaiaElo(targetElo: number) {
    setOpponent((prev) => {
      if (prev.type !== "engine" || !prev.engine || !isMaiaEngine(prev.engine)) return prev;
      return {
        ...prev,
        targetElo,
        presetId: "custom",
        engineSettings: buildMaiaEngineSettings(
          targetElo,
          prev.engineSettings ?? prev.engine.settings ?? [],
        ),
        go: { t: "Depth", c: 1 },
      };
    });
  }

  function applyEngineElo(targetElo: number) {
    setOpponent((prev) => {
      if (prev.type !== "engine") return prev;
      const applied = applyEnginePlayerPreset(
        prev.engineSettings ?? prev.engine?.settings ?? [],
        prev.go,
        "limited",
        targetElo,
        prev.engine?.name,
      );
      return {
        ...prev,
        targetElo,
        engineSettings: applied.settings,
        go: applied.go,
      };
    });
  }

  function updateType(type: OpponentType) {
    if (type === "human") {
      setOpponent((prev) => ({
        ...prev,
        type: "human",
        name: "Player",
      }));
    } else if (type === "engine") {
      setOpponent((prev) => ({
        ...prev,
        type: "engine",
        engine: "engine" in prev ? prev.engine : null,
        go: ("go" in prev && prev.go) || { t: "Depth", c: 24 },
        presetId: prev.type === "engine" ? (prev.presetId ?? "custom") : "custom",
        targetElo: prev.type === "engine" ? (prev.targetElo ?? 1800) : 1800,
      }));
    } else {
      setOpponent((prev) => {
        const previousEngine = "engine" in prev ? prev.engine : null;
        return {
          ...prev,
          type: "humanBot",
          engine: previousEngine && isMaiaEngine(previousEngine) ? previousEngine : null,
          profileId: prev.type === "humanBot" ? prev.profileId : DEFAULT_HUMAN_BOT_PROFILE_ID,
          humanTiming: prev.type === "humanBot" ? (prev.humanTiming ?? true) : true,
        };
      });
    }
  }

  function getAxisLabel(
    axis: "aggression" | "complexity" | "sharpness" | "theory",
    level: HumanBotStyleAxisLevel,
  ): string {
    const labels = {
      aggression: {
        low: t("HumanBots.Style.Aggression.Low", "Defensive"),
        medium: t("HumanBots.Style.Aggression.Medium", "Balanced"),
        high: t("HumanBots.Style.Aggression.High", "Aggressive"),
      },
      complexity: {
        low: t("HumanBots.Style.Complexity.Low", "Simplifying"),
        medium: t("HumanBots.Style.Complexity.Medium", "Balanced"),
        high: t("HumanBots.Style.Complexity.High", "Complicating"),
      },
      sharpness: {
        low: t("HumanBots.Style.Sharpness.Low", "Solid"),
        medium: t("HumanBots.Style.Sharpness.Medium", "Balanced"),
        high: t("HumanBots.Style.Sharpness.High", "Sharp"),
      },
      theory: {
        low: t("HumanBots.Style.Theory.Low", "Less theoretical"),
        medium: t("HumanBots.Style.Theory.Medium", "Balanced theory"),
        high: t("HumanBots.Style.Theory.High", "Theoretical"),
      },
    };
    return labels[axis][level];
  }

  function getEditorialStyleLabel(): string {
    const { decisionStyle, openingStyle } = humanBotProfile;
    if (!decisionStyle || !openingStyle) {
      return t("HumanBots.Style.Unclassified", "Unclassified style");
    }
    return `${getAxisLabel("aggression", decisionStyle.aggression)} · ${getAxisLabel("complexity", decisionStyle.complexity)}`;
  }

  function getEditorialStyleDescription(): string {
    const { decisionStyle, openingStyle } = humanBotProfile;
    if (!decisionStyle || !openingStyle) {
      return t(
        "HumanBots.Style.Unclassified.Desc",
        "This profile does not have an editorial style classification yet.",
      );
    }
    return t("HumanBots.Style.Editorial.Desc", {
      defaultValue:
        "Editorial hypothesis: {{aggression}} decisions, {{complexity}} positions, {{sharpness}} openings and {{theory}} theory.",
      aggression: getAxisLabel("aggression", decisionStyle.aggression),
      complexity: getAxisLabel("complexity", decisionStyle.complexity),
      sharpness: getAxisLabel("sharpness", openingStyle.sharpness),
      theory: getAxisLabel("theory", openingStyle.theory),
    });
  }

  function getRepertoireLabel(repertoireId: HumanBotRepertoireId): string {
    const labels: Record<HumanBotRepertoireId, string> = {
      "luna-e4-explorer": t("HumanBots.Repertoire.Luna", "E4 explorer"),
      "sofia-fixed-starter": t("HumanBots.Repertoire.Sofia", "Fixed three-move starter"),
      "nico-sicilian-attack": t("HumanBots.Repertoire.Nico", "Sicilian attack"),
      "daniela-french": t("HumanBots.Repertoire.Daniela", "French specialist"),
      "marcos-maia-natural": t("HumanBots.Repertoire.Marcos", "Maia natural; no repertoire"),
      "vera-classical-choices": t("HumanBots.Repertoire.Vera", "Classical choices"),
      "carlos-london-english": t("HumanBots.Repertoire.Carlos", "London and English"),
      "gabriel-queen-pawn": t("HumanBots.Repertoire.Gabriel", "Queen's pawn"),
      "nelson-indian-defenses": t("HumanBots.Repertoire.Nelson", "Indian defenses"),
      "irene-solid-classical": t("HumanBots.Repertoire.Irene", "Solid classical"),
      "mariann-classical-defenses": t("HumanBots.Repertoire.Mariann", "Classical defenses"),
      "valeria-pirc-modern": t("HumanBots.Repertoire.Valeria", "Pirc and Modern"),
      "leo-flexible-mainlines": t("HumanBots.Repertoire.Leo", "Flexible main lines"),
      "tomas-kings-indian": t("HumanBots.Repertoire.Tomas", "King's Indian systems"),
      "atlas-mainline": t("HumanBots.Repertoire.Atlas", "Grandmaster main lines"),
    };
    return labels[repertoireId];
  }

  function getRepertoireDescription(): string {
    if (humanBotProfile.repertoire.mode === "none") {
      return t(
        "HumanBots.Repertoire.None.Desc",
        "This bot has no profile opening repertoire; Maia's normal selection drives its openings.",
      );
    }
    if (humanBotProfile.repertoire.mode === "forcedLine") {
      return t(
        "HumanBots.Repertoire.ForcedLine.Desc",
        "Follows one initial opening line for three full moves, then Maia improvises normally.",
      );
    }
    return t(
      "HumanBots.Repertoire.Desc",
      "The bot follows weighted preferences while the game remains in its repertoire, then Maia chooses normally.",
    );
  }

  return (
    <Stack flex={1}>
      <SegmentedControl
        data={[
          {
            value: "human",
            label: (
              <Center style={{ gap: 10 }}>
                <IconUser size={16} />
                <span>{t("Board.Opponent.Human")}</span>
              </Center>
            ),
          },
          {
            value: "engine",
            label: (
              <Center style={{ gap: 10 }}>
                <IconCpu size={16} />
                <span>{t("Common.Engine")}</span>
              </Center>
            ),
          },
          {
            value: "humanBot",
            label: (
              <Center style={{ gap: 6 }}>
                <IconRobot size={16} />
                <span>{t("HumanBots.Title", "Human bot")}</span>
              </Center>
            ),
          },
        ].filter((option) => allowedTypes.includes(option.value as OpponentType))}
        fullWidth
        size="xs"
        value={opponent.type}
        onChange={(v) => updateType(v as OpponentType)}
      />

      {opponent.type === "human" && (
        <TextInput
          value={opponent.name ?? ""}
          onChange={(e) => setOpponent((prev) => ({ ...prev, name: e.target.value }))}
        />
      )}

      {opponent.type === "engine" && (
        <Stack gap="sm">
          <EnginesSelect
            engine={opponent.engine}
            setEngine={(engine) =>
              setOpponent((prev) => {
                if (prev.type !== "engine") return prev;
                const presetId = prev.presetId ?? "custom";
                const maia = Boolean(engine && isMaiaEngine(engine));
                const previousMaia = Boolean(prev.engine && isMaiaEngine(prev.engine));
                const targetElo = maia
                  ? previousMaia
                    ? (prev.targetElo ?? DEFAULT_MAIA_ELO)
                    : DEFAULT_MAIA_ELO
                  : (prev.targetElo ?? 1800);
                const applied = maia
                  ? {
                      settings: buildMaiaEngineSettings(targetElo, engine?.settings ?? []),
                      go: { t: "Depth", c: 1 } as GoMode,
                    }
                  : applyEnginePlayerPreset(
                      engine?.settings ?? [],
                      prev.go,
                      presetId,
                      targetElo,
                      engine?.name,
                    );
                return {
                  ...prev,
                  engine,
                  engineSettings: applied.settings,
                  go: applied.go,
                  presetId: maia ? "custom" : presetId,
                  targetElo: maia ? targetElo : prev.targetElo,
                };
              })
            }
          />
          {!maiaEngine && (
            <Select
              allowDeselect={false}
              label={t("EnginePresets.Category", "Player/engine category")}
              data={ENGINE_PLAYER_PRESETS.map((preset) => ({
                value: preset.id,
                label: t(`EnginePresets.${preset.id}.Label`, preset.label),
              }))}
              value={opponent.presetId ?? "custom"}
              onChange={(value) =>
                setOpponent((prev) => {
                  if (prev.type !== "engine" || !value) return prev;
                  const presetId = value as EnginePlayerPresetId;
                  const applied = applyEnginePlayerPreset(
                    prev.engineSettings ?? prev.engine?.settings ?? [],
                    prev.go,
                    presetId,
                    prev.targetElo ?? 1800,
                    prev.engine?.name,
                  );
                  return {
                    ...prev,
                    presetId,
                    engineSettings: applied.settings,
                    go: applied.go,
                  };
                })
              }
            />
          )}
          {maiaEngine && (
            <NumberInput
              label={t("HumanBots.MaiaElo", "Maia ELO")}
              description={t(
                "HumanBots.MaiaElo.Desc",
                "Controls Maia's requested model level. Depth, nodes and Stockfish presets are not used.",
              )}
              min={MAIA_ELO_MIN}
              max={MAIA_ELO_MAX}
              step={100}
              value={eloDraft ?? opponent.targetElo ?? DEFAULT_MAIA_ELO}
              onChange={(value) => {
                handleEloInput(value, MAIA_ELO_MIN, MAIA_ELO_MAX, (targetElo) =>
                  applyMaiaElo(clampMaiaElo(targetElo)),
                );
              }}
              onBlur={() =>
                commitEloDraft(
                  MAIA_ELO_MIN,
                  MAIA_ELO_MAX,
                  opponent.targetElo ?? DEFAULT_MAIA_ELO,
                  (targetElo) => applyMaiaElo(clampMaiaElo(targetElo)),
                )
              }
            />
          )}
          {!maiaEngine && opponent.presetId === "limited" && (
            <NumberInput
              label={t("EnginePresets.RequestedElo", "ELO requested from the engine")}
              description={t(
                "EnginePresets.RequestedElo.Desc",
                "UCI target; it is not a playing strength calibrated by Chess Lab.",
              )}
              min={1320}
              max={3190}
              step={50}
              value={eloDraft ?? opponent.targetElo ?? 1800}
              onChange={(value) => {
                handleEloInput(value, 1320, 3190, applyEngineElo);
              }}
              onBlur={() => commitEloDraft(1320, 3190, opponent.targetElo ?? 1800, applyEngineElo)}
            />
          )}
          {!maiaEngine && (
            <Text size="xs" c="dimmed">
              {t(
                `EnginePresets.${opponent.presetId ?? "custom"}.Desc`,
                getEnginePresetDescription(opponent.presetId ?? "custom"),
              )}
            </Text>
          )}
          {!maiaEngine &&
            getEnginePresetNodeBudget(opponent.presetId ?? "custom", opponent.engine?.name) && (
              <Text size="xs" c="blue">
                {t("EnginePresets.MctsBudget", {
                  defaultValue: "Lc0/MCTS budget: {{nodes}} nodes per move.",
                  nodes: getEnginePresetNodeBudget(
                    opponent.presetId ?? "custom",
                    opponent.engine?.name,
                  )?.toLocaleString(),
                })}
              </Text>
            )}
        </Stack>
      )}

      {opponent.type === "humanBot" && (
        <Stack gap="sm">
          <EnginesSelect
            engine={opponent.engine && isMaiaEngine(opponent.engine) ? opponent.engine : null}
            filter={isMaiaEngine}
            label={t("HumanBots.MaiaEngine", "Maia 3 engine")}
            description={t(
              "HumanBots.MaiaEngine.Desc",
              "Local Maia 3 installation used by this profile.",
            )}
            setEngine={(engine) =>
              setOpponent((prev) => (prev.type === "humanBot" ? { ...prev, engine } : prev))
            }
          />

          {(!opponent.engine || !isMaiaEngine(opponent.engine)) && (
            <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
              {t(
                "HumanBots.NoMaiaEngine",
                "No Maia 3 engine was found. Add it from the Engines section first.",
              )}
            </Alert>
          )}

          <Select
            allowDeselect={false}
            label={t("HumanBots.Profile", "Bot profile")}
            data={HUMAN_BOT_PROFILES.map((profile) => ({
              value: profile.id,
              label: `${profile.name} · ${profile.elo} ELO`,
            }))}
            value={humanBotProfile.id}
            onChange={(profileId) =>
              setOpponent((prev) =>
                prev.type === "humanBot" && profileId
                  ? { ...prev, profileId: profileId as HumanBotProfileId }
                  : prev,
              )
            }
          />

          <Paper withBorder p="sm">
            <Stack gap={6}>
              <Group justify="space-between">
                <Text fw={600}>{humanBotProfile.name}</Text>
                <Badge variant="light">{humanBotProfile.elo} ELO</Badge>
              </Group>
              <Badge variant="outline" w="fit-content">
                {getEditorialStyleLabel()}
              </Badge>
              <Text size="sm">{getEditorialStyleDescription()}</Text>
              <Divider />
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Text size="xs" c="dimmed">
                  {t("HumanBots.Repertoire", "Opening repertoire")}
                </Text>
                <Text size="sm" fw={500} ta="right">
                  {getRepertoireLabel(humanBotProfile.repertoireId)}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                {getRepertoireDescription()}
              </Text>
              <Text size="xs" c="dimmed">
                {t(
                  "HumanBots.EloDisclaimer",
                  "Profile ELO controls Maia's behavior and is also used as the human opponent ELO. It is not yet a calibrated playing-strength rating.",
                )}
              </Text>
            </Stack>
          </Paper>

          {humanTimingEnabled && (
            <Switch
              checked={opponent.humanTiming ?? true}
              label={t("HumanBots.Timing", "Human thinking time")}
              description={t(
                "HumanBots.Timing.Desc",
                "Adds variable, clock-aware pauses and records the observed decision time.",
              )}
              onChange={(event) =>
                setOpponent((prev) =>
                  prev.type === "humanBot"
                    ? { ...prev, humanTiming: event.currentTarget.checked }
                    : prev,
                )
              }
            />
          )}
        </Stack>
      )}

      {showSeed && opponent.type !== "human" && (
        <NumberInput
          label={t("ModelGame.Seed", "Launch seed")}
          description={t(
            "ModelGame.Seed.Desc",
            "Used when an engine argument contains {{randomSeed}}; it is still recorded for every player.",
          )}
          min={0}
          max={4_294_967_295}
          step={1}
          value={opponent.seed ?? 1}
          onChange={(value) => {
            if (typeof value !== "number" || !Number.isFinite(value)) return;
            setOpponent((prev) =>
              prev.type === "human"
                ? prev
                : {
                    ...prev,
                    seed: Math.max(0, Math.min(4_294_967_295, Math.trunc(value))),
                  },
            );
          }}
        />
      )}

      <Divider variant="dashed" label={t("Board.Opponent.TimeSettings")} />
      <SegmentedControl
        data={[
          { value: "time", label: t("GoMode.Time") },
          { value: "unlimited", label: t("Board.Opponent.Unlimited") },
        ]}
        value={opponent.timeControl ? "time" : "unlimited"}
        onChange={(v) => {
          setOpponent((prev) => ({
            ...prev,
            timeControl: v === "time" ? DEFAULT_TIME_CONTROL : undefined,
          }));
          if (sameTimeControl) {
            setOtherOpponent((prev) => ({
              ...prev,
              timeControl: v === "time" ? DEFAULT_TIME_CONTROL : undefined,
            }));
          }
        }}
      />
      <Group grow wrap="nowrap">
        {opponent.timeControl && (
          <>
            <InputWrapper label={t("GoMode.Time")}>
              <TimeInput
                defaultType="m"
                type={opponent.timeUnit}
                onTypeChange={(t) => {
                  setOpponent((prev) => ({ ...prev, timeUnit: t }));
                  if (sameTimeControl) {
                    setOtherOpponent((prev) => ({ ...prev, timeUnit: t }));
                  }
                }}
                value={opponent.timeControl.seconds}
                setValue={(v) => {
                  setOpponent((prev) => ({
                    ...prev,
                    timeControl: {
                      seconds: v.t === "Time" ? v.c : 0,
                      increment: prev.timeControl?.increment ?? 0,
                    },
                  }));
                  if (sameTimeControl) {
                    setOtherOpponent((prev) => ({
                      ...prev,
                      timeControl: {
                        seconds: v.t === "Time" ? v.c : 0,
                        increment: prev.timeControl?.increment ?? 0,
                      },
                    }));
                  }
                }}
              />
            </InputWrapper>
            <InputWrapper label={t("Board.Opponent.Increment")}>
              <TimeInput
                defaultType="s"
                type={opponent.incrementUnit}
                onTypeChange={(t) => {
                  setOpponent((prev) => ({ ...prev, incrementUnit: t }));
                  if (sameTimeControl) {
                    setOtherOpponent((prev) => ({ ...prev, incrementUnit: t }));
                  }
                }}
                value={opponent.timeControl.increment ?? 0}
                setValue={(v) => {
                  setOpponent((prev) => ({
                    ...prev,
                    timeControl: {
                      seconds: prev.timeControl?.seconds ?? 0,
                      increment: v.t === "Time" ? v.c : 0,
                    },
                  }));
                  if (sameTimeControl) {
                    setOtherOpponent((prev) => ({
                      ...prev,
                      timeControl: {
                        seconds: prev.timeControl?.seconds ?? 0,
                        increment: v.t === "Time" ? v.c : 0,
                      },
                    }));
                  }
                }}
              />
            </InputWrapper>
          </>
        )}
      </Group>

      {opponent.type === "engine" && (
        <Stack>
          {!opponent.timeControl && !maiaEngine && (
            <GoModeInput
              gameMode
              goMode={opponent.go}
              setGoMode={(go) =>
                setOpponent((prev) => {
                  if (prev.type !== "engine") {
                    return prev;
                  }
                  return {
                    ...prev,
                    go: normalizeEngineGoMode(go, prev.engine?.name),
                    presetId: "custom",
                  };
                })
              }
            />
          )}
          {maiaEngine && (
            <Text size="xs" c="dimmed">
              {t(
                "HumanBots.MaiaGameSettings",
                "Maia games use one bounded model decision per move; adjust the ELO above instead of Depth or Nodes.",
              )}
            </Text>
          )}
          <Divider variant="dashed" label={t("Board.Opponent.EngineSettings", "Engine Settings")} />
          {opponent.engine && !maiaEngine && (
            <EngineSettingsForm
              engine={opponent.engine}
              remote={false}
              gameMode
              settings={{
                go: opponent.go,
                settings: opponent.engineSettings || opponent.engine.settings || [],
                enabled: true,
                synced: false,
              }}
              setSettings={(fn) =>
                setOpponent((prev) => {
                  if (prev.type !== "engine") {
                    return prev;
                  }
                  const newSettings = fn({
                    go: prev.go,
                    settings: prev.engineSettings || prev.engine?.settings || [],
                    enabled: true,
                    synced: false,
                  });
                  return {
                    ...prev,
                    go: normalizeEngineGoMode(newSettings.go, prev.engine?.name),
                    engineSettings: newSettings.settings,
                    presetId: "custom",
                  };
                })
              }
              minimal={true}
            />
          )}
        </Stack>
      )}
    </Stack>
  );
}
