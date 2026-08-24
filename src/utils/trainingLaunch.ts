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
    trainingContext,
}: {
    fen: string;
    name: string;
    type: "analysis" | "play" | "generator";
    setTabs: Dispatch<SetStateAction<Tab[]>>;
    setActiveTab: Dispatch<SetStateAction<string | null>>;
    trainingArea?: "tactics" | "openings" | "endgames";
    trainingContext?: Record<string, string>;
}) {
    const baseHeaders = defaultTree(fen).headers;
    const headers = {
        ...baseHeaders,
        event: name,
        fen,
        ...(trainingArea || trainingContext
            ? {
                  other: {
                      ...baseHeaders.other,
                      ...(trainingArea ? { ChessLabTrainingArea: trainingArea } : {}),
                      ...trainingContext,
                  },
              }
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
