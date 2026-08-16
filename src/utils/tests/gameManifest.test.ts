import { describe, expect, it } from "vitest";
import { serializeGameManifest } from "../gameManifest";

describe("game manifest serialization", () => {
    it("serializes nested bigint durations as decimal strings", () => {
        const content = serializeGameManifest({
            schemaVersion: 1,
            moves: [{ clock: BigInt(12_345), thinkTimeMs: BigInt(678) }],
        } as never);

        expect(JSON.parse(content)).toMatchObject({
            schemaVersion: 1,
            moves: [{ clock: "12345", thinkTimeMs: "678" }],
        });
        expect(content.endsWith("\n")).toBe(true);
    });
});
