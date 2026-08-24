import { createFileRoute } from "@tanstack/react-router";
import TacticsDashboardPage from "@/components/training/TacticsDashboardV2Page";

export const Route = createFileRoute("/training/tactics/")({
  component: TacticsDashboardPage,
});
