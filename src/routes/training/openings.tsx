import { createFileRoute } from "@tanstack/react-router";
import OpeningDashboardPage from "@/components/training/OpeningDashboardPage";

export const Route = createFileRoute("/training/openings")({
  component: OpeningDashboardPage,
  loader: ({ context: { loadDirs } }) => loadDirs(),
});
