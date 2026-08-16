import type { GameManifest } from "@/bindings";

export function serializeGameManifest(manifest: GameManifest): string {
    return `${JSON.stringify(
        manifest,
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
        2,
    )}\n`;
}
