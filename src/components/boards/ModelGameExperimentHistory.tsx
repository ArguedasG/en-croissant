import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  Pagination,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconArrowLeft,
  IconDownload,
  IconFlask,
  IconRefresh,
  IconTrash,
  IconZoomCheck,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelGameExperimentDetail, ModelGameExperimentSummary } from "@/bindings";
import { commands } from "@/bindings";
import ConfirmModal from "@/components/common/ConfirmModal";
import EmpiricalWdlPanel from "@/components/boards/EmpiricalWdlPanel";
import ExperimentAnalysisPanel from "@/components/boards/ExperimentAnalysisPanel";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { createTab } from "@/utils/tabs";
import { unwrap } from "@/utils/unwrap";

function statusColor(status: ModelGameExperimentSummary["status"]) {
  if (status === "completed") return "green";
  if (status === "cancelled") return "gray";
  return "blue";
}

function statusLabel(
  status: ModelGameExperimentSummary["status"],
  t: (key: string, fallback: string) => string,
) {
  if (status === "completed") {
    return t("ModelGame.Experiments.Status.Completed", "Completed");
  }
  if (status === "cancelled") {
    return t("ModelGame.Experiments.Status.Cancelled", "Cancelled");
  }
  return t("ModelGame.Experiments.Status.Running", "Running");
}

function resultLabel(result: ModelGameExperimentDetail["games"][number]["result"]): string {
  if (!result) return "*";
  if (result.type === "whiteWins") return "1-0";
  if (result.type === "blackWins") return "0-1";
  return "½-½";
}

export default function ModelGameExperimentHistory({
  requestedExperimentId,
  showPanel = true,
}: {
  requestedExperimentId?: string | null;
  showPanel?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const [opened, { open, close }] = useDisclosure(false);
  const [summaries, setSummaries] = useState<ModelGameExperimentSummary[]>([]);
  const [detail, setDetail] = useState<ModelGameExperimentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const lastRequestedExperimentId = useRef<string | null>(null);
  const [exportRequest, setExportRequest] = useState<{
    experimentId: string;
    destinationDirectory: string;
  } | null>(null);
  const [exportFolderName, setExportFolderName] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportModalOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSummaries(unwrap(await commands.listModelGameExperiments()));
    } catch (error) {
      notifications.show({
        title: t("ModelGame.Experiments.LoadError", "Could not load experiments"),
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openExperiment = useCallback(
    async (experimentId: string) => {
      setLoading(true);
      try {
        setDetail(unwrap(await commands.getModelGameExperiment(experimentId)));
      } catch (error) {
        notifications.show({
          title: t("ModelGame.Experiments.LoadError", "Could not load experiments"),
          message: error instanceof Error ? error.message : String(error),
          color: "red",
        });
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (!requestedExperimentId || requestedExperimentId === lastRequestedExperimentId.current)
      return;
    lastRequestedExperimentId.current = requestedExperimentId;
    open();
    void openExperiment(requestedExperimentId);
  }, [open, openExperiment, requestedExperimentId]);

  async function openHistory() {
    await refresh();
    setDetail(null);
    open();
  }

  async function analyzeGame(experimentId: string, index: number, title: string) {
    try {
      const artifact = unwrap(await commands.readModelGameExperimentGame(experimentId, index));
      await createTab({
        tab: { name: title, type: "analysis" },
        setTabs,
        setActiveTab,
        pgn: artifact.pgn,
      });
      close();
      navigate({ to: "/" });
    } catch (error) {
      notifications.show({
        title: t("ModelGame.Experiments.OpenGameError", "Could not open the saved game"),
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    }
  }

  async function exportExperiment(experimentId: string) {
    const destination = await openDialog({ directory: true, multiple: false });
    if (typeof destination !== "string") return;

    setExportRequest({ experimentId, destinationDirectory: destination });
    setExportFolderName(`chess-lab-experiment-${experimentId}`);
    openExportModal();
  }

  async function confirmExport() {
    if (!exportRequest || !exportFolderName.trim()) return;
    setExporting(true);
    try {
      const exportedPath = unwrap(
        await commands.exportModelGameExperiment(
          exportRequest.experimentId,
          exportRequest.destinationDirectory,
          exportFolderName.trim(),
        ),
      );
      notifications.show({
        title: t("ModelGame.Experiments.Exported", "Experiment exported"),
        message: exportedPath,
        color: "green",
      });
      closeExportModal();
      setExportRequest(null);
    } catch (error) {
      notifications.show({
        title: t("ModelGame.Experiments.ExportError", "Could not export the experiment"),
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setExporting(false);
    }
  }

  async function deleteExperiment() {
    if (!pendingDelete) return;
    try {
      unwrap(await commands.deleteModelGameExperiment(pendingDelete));
      if (detail?.summary.experimentId === pendingDelete) setDetail(null);
      setPendingDelete(null);
      await refresh();
    } catch (error) {
      notifications.show({
        title: t("ModelGame.Experiments.DeleteError", "Could not delete the experiment"),
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    }
  }

  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(summaries.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleSummaries = summaries.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <>
      <ConfirmModal
        title={t("ModelGame.Experiments.Delete", "Delete experiment")}
        description={t(
          "ModelGame.Experiments.Delete.Desc",
          "This permanently removes the saved PGNs, manifests, logs, results, and metrics for this experiment.",
        )}
        confirmLabel={t("Common.Delete", "Delete")}
        opened={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={deleteExperiment}
      />

      <Modal
        opened={exportModalOpened}
        zIndex={1000}
        onClose={() => {
          if (!exporting) closeExportModal();
        }}
        title={t("ModelGame.Experiments.ExportName", "Name exported folder")}
      >
        <Stack>
          <TextInput
            label={t("ModelGame.Experiments.ExportName.Label", "Folder name")}
            description={t(
              "ModelGame.Experiments.ExportName.Desc",
              "Use a simple folder name without path separators.",
            )}
            value={exportFolderName}
            onChange={(event) => setExportFolderName(event.currentTarget.value)}
            autoFocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeExportModal} disabled={exporting}>
              {t("Common.Cancel", "Cancel")}
            </Button>
            <Button onClick={confirmExport} loading={exporting} disabled={!exportFolderName.trim()}>
              {t("Common.Export", "Export")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={opened}
        onClose={close}
        title={t("ModelGame.Experiments", "Model game experiments")}
        size="xl"
      >
        {detail ? (
          <Stack>
            <Group justify="space-between">
              <Button
                variant="subtle"
                size="xs"
                leftSection={<IconArrowLeft size={15} />}
                onClick={() => setDetail(null)}
              >
                {t("Common.Back", "Back")}
              </Button>
              <Group gap="xs">
                <Button
                  variant="default"
                  size="xs"
                  leftSection={<IconDownload size={15} />}
                  disabled={detail.summary.status === "running"}
                  onClick={() => exportExperiment(detail.summary.experimentId)}
                >
                  {t("Common.Export", "Export")}
                </Button>
                <Button
                  color="red"
                  variant="light"
                  size="xs"
                  leftSection={<IconTrash size={15} />}
                  disabled={detail.summary.status === "running"}
                  onClick={() => setPendingDelete(detail.summary.experimentId)}
                >
                  {t("Common.Delete", "Delete")}
                </Button>
              </Group>
            </Group>
            <Paper withBorder p="sm">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text fw={600}>
                    {detail.summary.whitePlayer} – {detail.summary.blackPlayer}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {new Date(detail.summary.createdAt).toLocaleString()} ·{" "}
                    {detail.summary.totalGames} {t("Common.Games", "games")}
                  </Text>
                </div>
                <Badge color={statusColor(detail.summary.status)}>
                  {statusLabel(detail.summary.status, t)}
                </Badge>
              </Group>
            </Paper>
            {detail.summary.status !== "running" && (
              <ExperimentAnalysisPanel experimentId={detail.summary.experimentId} />
            )}
            {detail.summary.status !== "running" && (
              <EmpiricalWdlPanel experimentId={detail.summary.experimentId} />
            )}
            <ScrollArea h={430} type="auto">
              <Stack gap="xs">
                {detail.games.length === 0 ? (
                  <Text c="dimmed" size="sm">
                    {t("ModelGame.Experiments.NoRecordedGames", "No games were recorded.")}
                  </Text>
                ) : (
                  detail.games.map((game) => (
                    <Paper key={`${game.index}-${game.gameId}`} withBorder p="xs">
                      <Group justify="space-between" wrap="nowrap">
                        <div>
                          <Text size="sm" fw={500}>
                            #{game.index + 1} · {game.whitePlayer} – {game.blackPlayer}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {resultLabel(game.result)} · {game.plies}{" "}
                            {t("ModelGame.Experiments.Plies", "plies")} · {game.attempts}{" "}
                            {t("ModelGame.Experiments.Attempts", "attempt(s)")}
                          </Text>
                        </div>
                        <Tooltip label={t("Board.Action.AnalyzeGame", "Analizar partida")}>
                          <ActionIcon
                            variant="light"
                            disabled={!game.artifactAvailable}
                            onClick={() =>
                              analyzeGame(
                                detail.summary.experimentId,
                                game.index,
                                `${game.whitePlayer} - ${game.blackPlayer}`,
                              )
                            }
                          >
                            <IconZoomCheck size={17} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Paper>
                  ))
                )}
              </Stack>
            </ScrollArea>
          </Stack>
        ) : summaries.length === 0 ? (
          <Text c="dimmed">
            {t("ModelGame.Experiments.Empty", "No saved model game experiments yet.")}
          </Text>
        ) : (
          <>
            <Table.ScrollContainer minWidth={740} maxHeight={500}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("Common.Date", "Date")}</Table.Th>
                    <Table.Th>{t("ModelGame.Experiments.Players", "Players")}</Table.Th>
                    <Table.Th>{t("Common.Games", "Games")}</Table.Th>
                    <Table.Th>{t("Common.Status", "Status")}</Table.Th>
                    <Table.Th>{t("HumanBots.History.Actions", "Actions")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {visibleSummaries.map((summary) => (
                    <Table.Tr key={summary.experimentId}>
                      <Table.Td>{new Date(summary.createdAt).toLocaleString()}</Table.Td>
                      <Table.Td>
                        {summary.whitePlayer} – {summary.blackPlayer}
                      </Table.Td>
                      <Table.Td>
                        {summary.recordedGames}/{summary.totalGames}
                      </Table.Td>
                      <Table.Td>
                        <Badge color={statusColor(summary.status)} variant="light">
                          {statusLabel(summary.status, t)}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs" wrap="nowrap">
                          <Tooltip label={t("ModelGame.Experiments.Open", "Open experiment")}>
                            <ActionIcon
                              variant="subtle"
                              onClick={() => openExperiment(summary.experimentId)}
                            >
                              <IconFlask size={17} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={t("Common.Export", "Export")}>
                            <ActionIcon
                              variant="subtle"
                              disabled={summary.status === "running"}
                              onClick={() => exportExperiment(summary.experimentId)}
                            >
                              <IconDownload size={17} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={t("Common.Delete", "Delete")}>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              disabled={summary.status === "running"}
                              onClick={() => setPendingDelete(summary.experimentId)}
                            >
                              <IconTrash size={17} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {totalPages > 1 && (
              <Pagination mt="md" value={safePage} total={totalPages} onChange={setPage} />
            )}
          </>
        )}
      </Modal>

      {showPanel && (
        <Paper withBorder p="sm">
          <Group justify="space-between">
            <div>
              <Text fw={600}>{t("ModelGame.Experiments", "Model game experiments")}</Text>
              <Text size="xs" c="dimmed">
                {t(
                  "ModelGame.Experiments.Desc",
                  "Finished games are saved locally and can be reopened for analysis.",
                )}
              </Text>
            </div>
            <Group gap="xs">
              <Badge variant="light">{summaries.length}</Badge>
              <Tooltip label={t("ModelGame.Experiments.Refresh", "Refresh experiments")}>
                <ActionIcon
                  variant="subtle"
                  aria-label={t("ModelGame.Experiments.Refresh", "Refresh experiments")}
                  onClick={refresh}
                  loading={loading}
                >
                  <IconRefresh size={16} />
                </ActionIcon>
              </Tooltip>
              <Button
                size="xs"
                variant="default"
                leftSection={<IconFlask size={15} />}
                onClick={openHistory}
              >
                {t("ModelGame.Experiments.View", "View experiments")}
              </Button>
            </Group>
          </Group>
        </Paper>
      )}
    </>
  );
}
