import { describe, expect, it } from "vitest";
import { engineSchema } from "../engines";

describe("engine schema", () => {
    it("adds empty executable arguments to existing local engine records", () => {
        const engine = engineSchema.parse({
            type: "local",
            id: "legacy-engine",
            name: "Legacy engine",
            version: "1.0",
            path: "engine.exe",
        });

        expect(engine).toMatchObject({
            type: "local",
            args: [],
        });
    });
});
