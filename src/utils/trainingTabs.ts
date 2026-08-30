import type { Tab } from "./tabs";

export function isTrainingPath(path: string): boolean {
    return path === "/training" || path.startsWith("/training/");
}

export function getTabPath(tab: Tab): string {
    return tab.type === "training" ? (tab.trainingPath ?? "/training") : "/";
}

export function getTrainingTabName(path: string): string {
    if (path.startsWith("/training/tactics")) return "Training.Tactics";
    if (path.startsWith("/training/openings")) return "Training.Openings";
    if (path.startsWith("/training/endgames")) return "Training.Endgames";
    return "SideBar.Training";
}

// Entering an area replaces the hub in the same tab, preserving other workspaces.
export function updateTrainingTab(tab: Tab, path: string): Tab {
    if (tab.type === "training" && tab.trainingPath === path) return tab;
    return { ...tab, type: "training", trainingPath: path, name: getTrainingTabName(path) };
}
