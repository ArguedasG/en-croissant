import { createFileRoute } from "@tanstack/react-router";
import TrainingHubPage from "@/components/training/TrainingHubPage";

export const Route = createFileRoute("/training/")({
  component: TrainingHubPage,
});
