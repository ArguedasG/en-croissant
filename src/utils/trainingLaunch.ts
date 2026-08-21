import type { Dispatch, SetStateAction } from "react";
import { defaultTree } from "@/utils/treeReducer";
import { createTab, type Tab } from "@/utils/tabs";

export async function launchTrainingPosition({
  fen,
  name,
  type,
  setTabs,
  setActiveTab,
  trainingArea,
}: {
  fen: string;
  name: string;
  type: "analysis" | "play" | "generator";
  setTabs: Dispatch<SetStateAction<Tab[]>>;
  setActiveTab: Dispatch<SetStateAction<string | null>>;
  trainingArea?: "tactics" | "openings" | "endgames";
}) {
  const baseHeaders = defaultTree(fen).headers;
  const headers = {
    ...baseHeaders,
    event: name,
    fen,
    ...(trainingArea
      ? { other: { ...baseHeaders.other, ChessLabTrainingArea: trainingArea } }
      : {}),
  };

  return createTab({
    tab: { name, type },
    setTabs,
    setActiveTab,
    pgn: "",
    headers,
  });
}
