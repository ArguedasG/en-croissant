import { expect, it } from "vitest";
import {
    addTacticsExerciseToSet,
    addTacticsSet,
    createEmptyTrainingAreas,
    persistedTrainingAreasSchema,
    type ParsedTrainingRecord,
} from "./trainingAreas";

const record: ParsedTrainingRecord = {
    title: "Player – Opponent · blunder",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    moves: ["e2e4", "e7e5"],
    hasExplicitFen: true,
    playerAnalysis: {
        databasePath: "lichess.db3",
        gameId: 42,
        ply: 12,
        cpLoss: 250,
        classification: "blunder",
    },
};

it("adds a Player Analysis position to an embedded user set and deduplicates its origin", () => {
    const empty = createEmptyTrainingAreas();
    const tactics = addTacticsSet(empty.tactics, "My errors", "", []);
    const setId = Object.keys(tactics.sets)[0];
    const added = addTacticsExerciseToSet(tactics, setId, record, ["player-analysis", "blunder"]);
    const duplicate = addTacticsExerciseToSet(added, setId, record, ["player-analysis"]);
    expect(added.sets[setId].exerciseIds).toHaveLength(1);
    expect(duplicate.sets[setId].exerciseIds).toHaveLength(1);
    const exercise = duplicate.exercises[duplicate.sets[setId].exerciseIds[0]];
    expect(exercise.source.playerAnalysis).toEqual(record.playerAnalysis);
    expect(exercise.tags).toContain("player-analysis");
});

it("migrates training state v8 to the provenance-aware v9 schema", () => {
    const current = createEmptyTrainingAreas();
    const migrated = persistedTrainingAreasSchema.parse({ ...current, schemaVersion: 8 });
    expect(migrated.schemaVersion).toBe(9);
    expect(migrated.tactics.sets).toEqual({});
});
