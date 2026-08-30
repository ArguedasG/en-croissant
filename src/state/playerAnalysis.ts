import { atomWithStorage } from "jotai/utils";
import {
    PLAYER_ANALYSIS_SCHEMA_VERSION,
    type PlayerEngineAnalysis,
    type PlayerMetadataAnalysis,
} from "@/utils/playerAnalysis";

export type StoredPlayerAnalysis = {
    schemaVersion: typeof PLAYER_ANALYSIS_SCHEMA_VERSION;
    profileId: string;
    playerName: string;
    updatedAt: string;
    metadata: PlayerMetadataAnalysis;
    engine: PlayerEngineAnalysis | null;
};

export type PlayerAnalysisState = {
    schemaVersion: typeof PLAYER_ANALYSIS_SCHEMA_VERSION;
    enabled: boolean;
    profiles: Record<string, StoredPlayerAnalysis>;
};

export const playerAnalysisAtom = atomWithStorage<PlayerAnalysisState>("player-analysis-v1", {
    schemaVersion: PLAYER_ANALYSIS_SCHEMA_VERSION,
    enabled: true,
    profiles: {},
});

export function playerAnalysisProfileId(
    playerName: string,
    sources: Array<{ databasePath: string; playerId: number }>,
): string {
    const sourceKey = sources
        .map((source) => `${source.databasePath}:${source.playerId}`)
        .sort()
        .join("|");
    let hash = 2166136261;
    for (const character of `${playerName}|${sourceKey}`) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return `player-${(hash >>> 0).toString(16)}`;
}
