import { createFileRoute } from "@tanstack/react-router";
import TacticsSessionPage from "@/components/training/TacticsSessionPage";

export const Route = createFileRoute("/training/tactics/practice/$setId")({
  component: TacticsSessionPage,
});
