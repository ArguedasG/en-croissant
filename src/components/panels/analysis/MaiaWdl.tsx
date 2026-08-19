import { Group, Stack, Text } from "@mantine/core";
import type { Score } from "@/bindings";
import { getWdlPercentages } from "@/utils/score";

export default function MaiaWdl({
  wdl,
  compact = false,
}: {
  wdl: Score["wdl"];
  compact?: boolean;
}) {
  const percentages = getWdlPercentages(wdl);
  if (!percentages) {
    return (
      <Text size="xs" c="dimmed">
        W/D/L —
      </Text>
    );
  }

  return (
    <Stack
      gap={compact ? 0 : 2}
      title="Predicción W/D/L de Maia desde la perspectiva de blancas; no es una simulación"
    >
      {!compact && (
        <Text size="0.7rem" tt="uppercase" fw={700} c="dimmed">
          Maia W/D/L
        </Text>
      )}
      <Group gap={compact ? 4 : 6} wrap="nowrap">
        <Text size={compact ? "xs" : "sm"} fw={700} c="teal">
          W {percentages.win.toFixed(0)}%
        </Text>
        <Text size={compact ? "xs" : "sm"} fw={700} c="gray">
          D {percentages.draw.toFixed(0)}%
        </Text>
        <Text size={compact ? "xs" : "sm"} fw={700} c="red">
          L {percentages.loss.toFixed(0)}%
        </Text>
      </Group>
    </Stack>
  );
}
