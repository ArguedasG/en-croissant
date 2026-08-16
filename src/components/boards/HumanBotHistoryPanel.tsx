import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  Pagination,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconHistory, IconRefresh, IconTrash, IconZoomCheck } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import ConfirmModal from "@/components/common/ConfirmModal";
import { activeTabAtom, humanBotHistoryAtom, tabsAtom } from "@/state/atoms";
import {
  clearHumanBotHistory,
  EMPTY_HUMAN_BOT_HISTORY,
  formatChessPoints,
  getHumanBotScore,
  type HumanBotHistoryState,
  resetAllHumanBotScores,
  resetHumanBotScore,
} from "@/utils/humanBotHistory";
import { HUMAN_BOT_PROFILES } from "@/utils/humanBots";
import { createTab } from "@/utils/tabs";

type PendingAction =
  | { type: "deleteAll" }
  | { type: "deleteGame"; gameId: string }
  | { type: "resetAllScores" }
  | { type: "resetScore"; profileId: string }
  | null;

export default function HumanBotHistoryPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [history, setHistory] = useAtom(humanBotHistoryAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const [opened, { open, close }] = useDisclosure(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [page, setPage] = useState(1);

  function updateHistory(updater: (current: HumanBotHistoryState) => HumanBotHistoryState) {
    setHistory(async (previous) => updater((await previous) ?? EMPTY_HUMAN_BOT_HISTORY));
  }

  async function analyzeGame(gameId: string) {
    const game = history.games.find((candidate) => candidate.id === gameId);
    if (!game) return;
    await createTab({
      tab: {
        name: `${game.playerName} - ${game.profileName}`,
        type: "analysis",
      },
      setTabs,
      setActiveTab,
      pgn: game.pgn,
    });
    close();
    navigate({ to: "/" });
  }

  function confirmAction() {
    if (!pendingAction) return;
    const now = new Date().toISOString();
    if (pendingAction.type === "deleteAll") {
      updateHistory(clearHumanBotHistory);
    } else if (pendingAction.type === "deleteGame") {
      updateHistory((current) => ({
        ...current,
        games: current.games.filter((game) => game.id !== pendingAction.gameId),
      }));
    } else if (pendingAction.type === "resetAllScores") {
      updateHistory((current) => resetAllHumanBotScores(current, now));
    } else {
      updateHistory((current) => resetHumanBotScore(current, pendingAction.profileId, now));
    }
    setPendingAction(null);
  }

  const confirmCopy = (() => {
    if (pendingAction?.type === "deleteAll") {
      return {
        title: t("HumanBots.History.DeleteAll", "Delete bot game history"),
        description: t(
          "HumanBots.History.DeleteAll.Desc",
          "This permanently removes every saved game against human bots and clears their scores.",
        ),
        label: t("Common.Delete", "Delete"),
      };
    }
    if (pendingAction?.type === "deleteGame") {
      return {
        title: t("HumanBots.History.DeleteGame", "Delete saved game"),
        description: t(
          "HumanBots.History.DeleteGame.Desc",
          "This permanently removes this game from the bot history and recalculates its score.",
        ),
        label: t("Common.Delete", "Delete"),
      };
    }
    if (pendingAction?.type === "resetScore") {
      return {
        title: t("HumanBots.History.ResetScore", "Reset bot score"),
        description: t(
          "HumanBots.History.ResetScore.Desc",
          "The saved games remain available, but this bot's score starts again from zero.",
        ),
        label: t("Common.Reset", "Reset"),
      };
    }
    return {
      title: t("HumanBots.History.ResetAllScores", "Reset all bot scores"),
      description: t(
        "HumanBots.History.ResetAllScores.Desc",
        "Saved games remain available, but every human bot score starts again from zero.",
      ),
      label: t("Common.Reset", "Reset"),
    };
  })();

  const games = [...history.games].sort((left, right) =>
    right.recordedAt.localeCompare(left.recordedAt),
  );
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(games.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleGames = games.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <>
      <ConfirmModal
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.label}
        opened={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        onConfirm={confirmAction}
      />

      <Modal
        opened={opened}
        onClose={close}
        title={t("HumanBots.History", "Games against human bots")}
        size="xl"
      >
        {games.length === 0 ? (
          <Text c="dimmed">{t("HumanBots.History.Empty", "No saved games yet.")}</Text>
        ) : (
          <Table.ScrollContainer minWidth={720} maxHeight={500}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("Common.Date", "Date")}</Table.Th>
                  <Table.Th>{t("HumanBots.History.Bot", "Bot")}</Table.Th>
                  <Table.Th>{t("HumanBots.History.Color", "Your color")}</Table.Th>
                  <Table.Th>{t("HumanBots.History.Result", "Result")}</Table.Th>
                  <Table.Th>{t("HumanBots.History.Actions", "Actions")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visibleGames.map((game) => (
                  <Table.Tr key={game.id}>
                    <Table.Td>{new Date(game.recordedAt).toLocaleString()}</Table.Td>
                    <Table.Td>
                      {game.profileName} ({game.botElo})
                    </Table.Td>
                    <Table.Td>
                      {game.playerColor === "white"
                        ? t("Common.WHITE", "White")
                        : t("Common.BLACK", "Black")}
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={
                          game.playerResult === "win"
                            ? "green"
                            : game.playerResult === "loss"
                              ? "red"
                              : "gray"
                        }
                        variant="light"
                      >
                        {game.playerResult === "win"
                          ? t("HumanBots.History.Win", "Win")
                          : game.playerResult === "loss"
                            ? t("HumanBots.History.Loss", "Loss")
                            : t("HumanBots.History.Draw", "Draw")}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Tooltip label={t("Board.Action.AnalyzeGame", "Analyze game")}>
                          <ActionIcon variant="subtle" onClick={() => analyzeGame(game.id)}>
                            <IconZoomCheck size={17} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={t("Common.Delete", "Delete")}>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            onClick={() =>
                              setPendingAction({ type: "deleteGame", gameId: game.id })
                            }
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
        )}
        {totalPages > 1 && (
          <Pagination mt="md" value={safePage} total={totalPages} onChange={setPage} />
        )}
      </Modal>

      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600}>{t("HumanBots.History", "Games against human bots")}</Text>
          <Badge variant="light">
            {history.games.length} {t("Common.Games", "games")}
          </Badge>
        </Group>
        <Text size="xs" c="dimmed">
          {t(
            "HumanBots.History.Desc",
            "Finished player-versus-bot games are saved locally and can be reopened for analysis.",
          )}
        </Text>

        <Table.ScrollContainer minWidth={430}>
          <Table striped withRowBorders={false} fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("HumanBots.History.Bot", "Bot")}</Table.Th>
                <Table.Th ta="right">{t("HumanBots.History.Score", "Score")}</Table.Th>
                <Table.Th ta="right">{t("HumanBots.History.Record", "W-D-L")}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {HUMAN_BOT_PROFILES.map((profile) => {
                const score = getHumanBotScore(history, profile.id);
                return (
                  <Table.Tr key={profile.id}>
                    <Table.Td>{profile.name}</Table.Td>
                    <Table.Td ta="right">
                      {formatChessPoints(score.playerPoints)}–{formatChessPoints(score.botPoints)}
                    </Table.Td>
                    <Table.Td ta="right">
                      {score.wins}-{score.draws}-{score.losses}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Tooltip label={t("HumanBots.History.ResetScore", "Reset bot score")}>
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          disabled={score.games === 0}
                          onClick={() =>
                            setPendingAction({ type: "resetScore", profileId: profile.id })
                          }
                        >
                          <IconRefresh size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            leftSection={<IconHistory size={14} />}
            onClick={open}
          >
            {t("HumanBots.History.Open", "View games")}
          </Button>
          <Tooltip label={t("HumanBots.History.ResetAllScores", "Reset all bot scores")}>
            <ActionIcon
              ml="auto"
              variant="subtle"
              disabled={history.games.length === 0}
              onClick={() => setPendingAction({ type: "resetAllScores" })}
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("HumanBots.History.DeleteAll", "Delete bot game history")}>
            <ActionIcon
              color="red"
              variant="subtle"
              disabled={history.games.length === 0}
              onClick={() => setPendingAction({ type: "deleteAll" })}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Stack>
    </>
  );
}
