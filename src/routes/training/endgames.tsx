import { createFileRoute } from "@tanstack/react-router";
import EndgameTrainingPage from "@/components/training/EndgameTrainingPage";

export const Route = createFileRoute("/training/endgames")({
  component: EndgameTrainingPage,
});
