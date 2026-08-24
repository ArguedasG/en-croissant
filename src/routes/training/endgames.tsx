import { createFileRoute } from "@tanstack/react-router";
import EndgameTrainingPage from "@/components/training/EndgameTrainingV2Page";

export const Route = createFileRoute("/training/endgames")({
  component: EndgameTrainingPage,
});
