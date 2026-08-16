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
  getEnginePresetDescription,
  type EnginePlayerPresetId,
} from "@/utils/enginePresets";
import {
  DEFAULT_HUMAN_BOT_PROFILE_ID,
  getHumanBotProfile,
  HUMAN_BOT_PROFILES,
  type HumanBotProfileId,
  type HumanBotRepertoireId,
  type HumanBotStyle,
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
      timeUnit?: TimeType;
      incrementUnit?: TimeType;
    }
  | {
      type: "humanBot";
      timeControl?: TimeControlField;
      engine: LocalEngine | null;
      profileId: HumanBotProfileId;
      humanTiming?: boolean;
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
}: {
  sameTimeControl: boolean;
  opponent: OpponentSettings;
  setOpponent: React.Dispatch<React.SetStateAction<OpponentSettings>>;
  setOtherOpponent: React.Dispatch<React.SetStateAction<OpponentSettings>>;
}) {
  const { t } = useTranslation();
  const humanBotProfile = getHumanBotProfile(
    opponent.type === "humanBot" ? opponent.profileId : DEFAULT_HUMAN_BOT_PROFILE_ID,
  );

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

  function getStyleLabel(style: HumanBotStyle): string {
    if (style === "adventurous") return t("HumanBots.Style.Adventurous", "Adventurous");
    if (style === "focused") return t("HumanBots.Style.Focused", "Focused");
    return t("HumanBots.Style.Balanced", "Balanced");
  }

  function getStyleDescription(style: HumanBotStyle): string {
    if (style === "adventurous") {
      return t(
        "HumanBots.Style.Adventurous.Desc",
        "Allows a wider variety of plausible human moves.",
      );
    }
    if (style === "focused") {
      return t(
        "HumanBots.Style.Focused.Desc",
        "Concentrates its choices on the most likely human moves.",
      );
    }
    return t(
      "HumanBots.Style.Balanced.Desc",
      "Balances move variety with preference for common human choices.",
    );
  }

  function getRepertoireLabel(repertoireId: HumanBotRepertoireId): string {
    if (repertoireId === "luna-variety") {
      return t("HumanBots.Repertoire.Luna", "Early variety");
    }
    if (repertoireId === "nico-open-games") {
      return t("HumanBots.Repertoire.Nico", "Open games");
    }
    if (repertoireId === "vera-classical-mix") {
      return t("HumanBots.Repertoire.Vera", "Classical mix");
    }
    if (repertoireId === "marcos-queen-pawn") {
      return t("HumanBots.Repertoire.Marcos", "Queen's pawn");
    }
    if (repertoireId === "irene-solid-classical") {
      return t("HumanBots.Repertoire.Irene", "Solid classical");
    }
    return t("HumanBots.Repertoire.Leo", "Flexible main lines");
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
        ]}
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
                const applied = applyEnginePlayerPreset(
                  engine?.settings ?? [],
                  prev.go,
                  presetId,
                  prev.targetElo ?? 1800,
                );
                return {
                  ...prev,
                  engine,
                  engineSettings: applied.settings,
                  go: applied.go,
                  presetId,
                };
              })
            }
          />
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
          {opponent.presetId === "limited" && (
            <NumberInput
              label={t("EnginePresets.RequestedElo", "ELO requested from the engine")}
              description={t(
                "EnginePresets.RequestedElo.Desc",
                "UCI target; it is not a playing strength calibrated by Chess Lab.",
              )}
              min={1320}
              max={3190}
              step={50}
              value={opponent.targetElo ?? 1800}
              onChange={(value) => {
                if (typeof value !== "number") return;
                setOpponent((prev) => {
                  if (prev.type !== "engine") return prev;
                  const targetElo = Math.max(1320, Math.min(3190, Math.trunc(value)));
                  const applied = applyEnginePlayerPreset(
                    prev.engineSettings ?? prev.engine?.settings ?? [],
                    prev.go,
                    "limited",
                    targetElo,
                  );
                  return {
                    ...prev,
                    targetElo,
                    engineSettings: applied.settings,
                    go: applied.go,
                  };
                });
              }}
            />
          )}
          <Text size="xs" c="dimmed">
            {t(
              `EnginePresets.${opponent.presetId ?? "custom"}.Desc`,
              getEnginePresetDescription(opponent.presetId ?? "custom"),
            )}
          </Text>
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
                {getStyleLabel(humanBotProfile.style)}
              </Badge>
              <Text size="sm">{getStyleDescription(humanBotProfile.style)}</Text>
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
                {t(
                  "HumanBots.Repertoire.Desc",
                  "The bot follows weighted preferences while the game remains in its repertoire, then Maia chooses normally.",
                )}
              </Text>
              <Text size="xs" c="dimmed">
                {t(
                  "HumanBots.EloDisclaimer",
                  "Profile ELO controls Maia's behavior and is also used as the human opponent ELO. It is not yet a calibrated playing-strength rating.",
                )}
              </Text>
            </Stack>
          </Paper>

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
        </Stack>
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
          {!opponent.timeControl && (
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
                    go,
                    presetId: "custom",
                  };
                })
              }
            />
          )}
          <Divider variant="dashed" label={t("Board.Opponent.EngineSettings", "Engine Settings")} />
          {opponent.engine && (
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
                    go: newSettings.go,
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
