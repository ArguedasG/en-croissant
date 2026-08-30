import { Button, Card, Group, Stack, Text } from "@mantine/core";
import { IconFileImport, IconPlayerPlay, IconZoomCheck } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useBoardShellActions } from "@/hooks/useBoardShellActions";

export default function BoardStartPanel() {
  const { t } = useTranslation();
  const { startGame, importGame, openTraining } = useBoardShellActions();

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group gap="xs">
          <IconZoomCheck size="1.2rem" />
          <Text fw={600}>{t("Board.Start.Title", "Ready to analyze")}</Text>
        </Group>
        <Text size="sm" c="dimmed">
          {t(
            "Board.Start.Desc",
            "Move a piece to explore the position, or choose how you want to begin.",
          )}
        </Text>
        <Group grow align="stretch">
          <Button variant="light" leftSection={<IconPlayerPlay size="1rem" />} onClick={startGame}>
            {t("SideBar.Play", "Play")}
          </Button>
          <Button variant="light" leftSection={<IconFileImport size="1rem" />} onClick={importGame}>
            {t("SideBar.Import", "Import")}
          </Button>
        </Group>
        <Button variant="subtle" onClick={openTraining}>
          {t("Board.Start.Training", "Choose a training activity")}
        </Button>
      </Stack>
    </Card>
  );
}
