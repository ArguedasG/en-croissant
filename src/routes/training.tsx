import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/training")({
  component: Outlet,
  loader: ({ context: { loadDirs } }) => loadDirs(),
});
