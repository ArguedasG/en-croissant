import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/training/tactics")({
  component: Outlet,
});
