import { atomWithStorage } from "jotai/utils";
import { createZodStorage } from "./utils";
import {
    createEmptyTrainingLibrary,
    trainingLibrarySchema,
    type TrainingLibrary,
} from "@/utils/training";

export const trainingLibraryAtom = atomWithStorage<TrainingLibrary>(
    "training-library-v1",
    createEmptyTrainingLibrary(),
    createZodStorage(trainingLibrarySchema, localStorage),
);
