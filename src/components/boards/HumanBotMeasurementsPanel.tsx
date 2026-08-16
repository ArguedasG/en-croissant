import { ActionIcon, Badge, Button, Group, Stack, Table, Text, Tooltip } from "@mantine/core";
import { useToggle } from "@mantine/hooks";
import { IconDownload, IconTrash } from "@tabler/icons-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import ConfirmModal from "@/components/common/ConfirmModal";
import { humanBotMeasurementsAtom } from "@/state/atoms";
import {
  humanBotMeasurementsToCsv,
  summarizeHumanBotMeasurements,
} from "@/utils/humanBotMeasurements";

export default function HumanBotMeasurementsPanel() {
  const { t } = useTranslation();
  const [measurements, setMeasurements] = useAtom(humanBotMeasurementsAtom);
  const [confirmClear, toggleConfirmClear] = useToggle();
  const summaries = summarizeHumanBotMeasurements(measurements);

  async function exportMeasurements(format: "json" | "csv") {
    const file = await save({
      defaultPath: `human-bot-measurements.${format}`,
      filters: [
        {
          name: format === "json" ? "JSON" : "CSV",
          extensions: [format],
        },
      ],
    });
    if (!file) return;

    const content =
      format === "json"
        ? JSON.stringify(measurements, null, 2)
        : humanBotMeasurementsToCsv(measurements);
    await writeTextFile(file, content);
  }

  return (
    <>
      <ConfirmModal
        title={t("HumanBots.Measurements.Clear", "Clear human bot measurements")}
        description={t(
          "HumanBots.Measurements.Clear.Desc",
          "This removes all locally collected human bot game measurements.",
        )}
        opened={confirmClear}
        onClose={toggleConfirmClear}
        confirmLabel={t("HumanBots.Measurements.Clear.Action", "Clear")}
        onConfirm={() => {
          setMeasurements([]);
          toggleConfirmClear();
        }}
      />

      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600}>{t("HumanBots.Measurements", "Calibration measurements")}</Text>
          <Badge variant="light">
            {t("HumanBots.Measurements.Games", "{{count}} games", {
              count: measurements.length,
            })}
          </Badge>
        </Group>
        <Text size="xs" c="dimmed">
          {t(
            "HumanBots.Measurements.Desc",
            "Finished games record repertoire depth, move source and observed thinking time locally.",
          )}
        </Text>
        {summaries.length > 0 && (
          <Table.ScrollContainer minWidth={430}>
            <Table striped withRowBorders={false} fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("HumanBots.Measurements.Bot", "Bot")}</Table.Th>
                  <Table.Th ta="right">{t("HumanBots.Measurements.Games.Short", "Games")}</Table.Th>
                  <Table.Th ta="right">
                    {t("HumanBots.Measurements.TheoryMoves", "Avg. theory moves")}
                  </Table.Th>
                  <Table.Th ta="right">
                    {t("HumanBots.Measurements.ThinkTime", "Avg. think")}
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {summaries.map((summary) => (
                  <Table.Tr key={summary.profileId}>
                    <Table.Td tt="capitalize">{summary.profileId}</Table.Td>
                    <Table.Td ta="right">{summary.games}</Table.Td>
                    <Table.Td ta="right">{summary.averageRepertoireMoves}</Table.Td>
                    <Table.Td ta="right">
                      {summary.averageThinkTimeMs === null
                        ? "–"
                        : `${(summary.averageThinkTimeMs / 1000).toFixed(1)} s`}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            leftSection={<IconDownload size={14} />}
            disabled={measurements.length === 0}
            onClick={() => exportMeasurements("json")}
          >
            JSON
          </Button>
          <Button
            size="xs"
            variant="default"
            leftSection={<IconDownload size={14} />}
            disabled={measurements.length === 0}
            onClick={() => exportMeasurements("csv")}
          >
            CSV
          </Button>
          <Tooltip label={t("HumanBots.Measurements.Clear", "Clear human bot measurements")}>
            <ActionIcon
              ml="auto"
              color="red"
              variant="subtle"
              disabled={measurements.length === 0}
              onClick={() => toggleConfirmClear()}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Stack>
    </>
  );
}
