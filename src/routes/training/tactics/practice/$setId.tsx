import { createFileRoute } from "@tanstack/react-router";
import TacticsSessionPage from "@/components/training/TacticsSessionV2Page";

export const Route = createFileRoute("/training/tactics/practice/$setId")({
  validateSearch: (search: Record<string, unknown>) => {
    const problem = Number(search.problem);
    return {
      problem: Number.isInteger(problem) && problem > 0 ? problem : undefined,
    };
  },
  component: TacticsSessionPage,
});
