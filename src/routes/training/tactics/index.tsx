import { createFileRoute } from "@tanstack/react-router";
import TacticsDashboardPage from "@/components/training/TacticsDashboardPage";

export const Route = createFileRoute("/training/tactics/")({
  component: TacticsDashboardPage,
});
