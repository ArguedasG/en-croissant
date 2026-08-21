import { createFileRoute } from "@tanstack/react-router";
import TrainingPage from "@/components/training/TrainingPage";

export const Route = createFileRoute("/training/library")({
  component: TrainingPage,
  loader: ({ context: { loadDirs } }) => loadDirs(),
});
