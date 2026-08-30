import { Button } from "@mantine/core";
import { IconPlayerSkipForward } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export default function TacticsAdvanceControl({
  autoAdvance,
  solved,
  completesCycle,
  browsing,
  exerciseKey,
  onNext,
}: {
  autoAdvance: boolean;
  solved: boolean;
  completesCycle: boolean;
  browsing: boolean;
  exerciseKey: string;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const next = useRef(onNext);
  next.current = onNext;
  const shouldAdvance = solved && (autoAdvance || completesCycle);
  useEffect(() => {
    if (!shouldAdvance) return;
    const timer = setTimeout(() => next.current(), 650);
    return () => clearTimeout(timer);
  }, [shouldAdvance, exerciseKey]);

  if (autoAdvance) return null;
  return (
    <Button disabled={!solved} leftSection={<IconPlayerSkipForward size={16} />} onClick={onNext}>
      {completesCycle
        ? t("Training.Copy.Completingcycle.e256b723", "Completing cycle…")
        : browsing
          ? t("Training.Copy.Returntoresumepoint.2f1842e1", "Return to resume point")
          : t("Training.Copy.Nextpuzzle.1e26b52b", "Next puzzle")}
    </Button>
  );
}
