import { atomWithStorage } from "jotai/utils";
import { createZodStorage } from "./utils";
import {
    createEmptyTrainingAreas,
    persistedTrainingAreasSchema,
    type TrainingAreasState,
} from "@/utils/trainingAreas";

export const trainingAreasAtom = atomWithStorage<TrainingAreasState>(
    "training-areas-v1",
    createEmptyTrainingAreas(),
    createZodStorage(persistedTrainingAreasSchema, localStorage),
);
