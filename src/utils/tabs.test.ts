import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tab } from "./tabs";
import { createOrReuseBoardTab, createTab, isEmptyAnalysisTab } from "./tabs";
import { createDebouncedSessionStorage } from "@/state/store/debouncedStorage";
import { commands } from "@/bindings";
import { createTreeStore } from "@/state/store/tree";
import { buildModelGameSourcePgn } from "./modelGame";
import type { TreeState } from "./treeReducer";

function analysisTab(value = "analysis-tab"): Tab {
    return {
        name: "Analysis",
        value,
        type: "analysis",
        gameOrigin: { kind: "none" },
    };
}

describe("board shell tab reuse", () => {
    beforeEach(() => sessionStorage.clear());

    it("opens the selected repertoire branch in a fresh play tab with its own state and no file origin", async () => {
        const source = createTreeStore();
        source.getState().makeMoves({ payload: ["e4", "e5", "Nf3"] });
        source.getState().goToMove([0]);
        source.getState().makeMoves({ payload: ["c5", "Nf3"] });
        source.getState().goToMove([0, 1]);
        const state = source.getState();
        const selectedFen = state.currentNode().fen;
        const original = JSON.stringify(state);
        const lex = vi.spyOn(commands, "lexPgn").mockResolvedValue({
            status: "ok",
            data: [
                { type: "San", value: "e4" },
                { type: "San", value: "c5" },
                { type: "Outcome", value: "*" },
            ],
        });
        try {
            let tabs: Tab[] = [
                {
                    ...analysisTab("repertoire"),
                    gameOrigin: { kind: "database", database: "repertoire.db3", gameId: 1 },
                },
            ];
            let active: string | null = "repertoire";
            const id = await createTab({
                tab: { name: "New Game", type: "play" },
                pgn: buildModelGameSourcePgn(state.root, state.headers, state.position),
                position: state.position.map(() => 0),
                setTabs: (update) => {
                    tabs = typeof update === "function" ? update(tabs) : update;
                },
                setActiveTab: (update) => {
                    active = typeof update === "function" ? update(active) : update;
                },
            });
            const game: TreeState = JSON.parse(sessionStorage.getItem(id)!).state;
            expect(tabs).toHaveLength(2);
            expect(id).not.toBe("repertoire");
            expect(active).toBe(id);
            expect(tabs[1].gameOrigin.kind).toBe("none");
            expect(game.position).toEqual([0, 0]);
            expect(game.root.children[0].children[0].fen).toBe(selectedFen);
            expect(game.root.children[0].children[0].children).toHaveLength(0);
            expect(JSON.stringify(source.getState())).toBe(original);
            expect(lex.mock.calls[0][0]).toContain("1. e4 c5");
        } finally {
            lex.mockRestore();
        }
    });

    it("only treats analysis tabs without stored state or an origin as empty", () => {
        const tab = analysisTab();
        expect(isEmptyAnalysisTab(tab)).toBe(true);

        sessionStorage.setItem(tab.value, JSON.stringify({ state: { dirty: false } }));
        expect(isEmptyAnalysisTab(tab)).toBe(false);
        expect(
            isEmptyAnalysisTab({
                ...tab,
                gameOrigin: { kind: "database", database: "games.db3", gameId: 1 },
            }),
        ).toBe(false);
    });

    it("does not reuse a tab with an unflushed debounced tree update", async () => {
        const tab = analysisTab("pending-tab");
        const storage = createDebouncedSessionStorage<{ dirty: boolean }>(60_000);
        await storage.setItem(tab.value, { version: 0, state: { dirty: true } });

        expect(isEmptyAnalysisTab(tab)).toBe(false);
        await storage.removeItem(tab.value);
    });

    it("reuses the active empty analysis tab when the preference is enabled", async () => {
        let tabs = [analysisTab()];
        let activeTab: string | null = tabs[0].value;

        const id = await createOrReuseBoardTab({
            tabs,
            activeTab,
            type: "play",
            name: "New Game",
            reuseEmpty: true,
            setTabs: (update) => {
                tabs = typeof update === "function" ? update(tabs) : update;
            },
            setActiveTab: (update) => {
                activeTab = typeof update === "function" ? update(activeTab) : update;
            },
        });

        expect(id).toBe("analysis-tab");
        expect(tabs).toHaveLength(1);
        expect(tabs[0]).toMatchObject({ value: id, type: "play", name: "New Game" });
        expect(activeTab).toBe(id);
    });

    it("creates a new tab when reuse is disabled or the active tab has content", async () => {
        let tabs = [analysisTab()];
        let activeTab: string | null = tabs[0].value;
        sessionStorage.setItem(activeTab, JSON.stringify({ version: 0, state: { dirty: true } }));

        const id = await createOrReuseBoardTab({
            tabs,
            activeTab,
            type: "analysis",
            name: "Analysis",
            reuseEmpty: true,
            setTabs: (update) => {
                tabs = typeof update === "function" ? update(tabs) : update;
            },
            setActiveTab: (update) => {
                activeTab = typeof update === "function" ? update(activeTab) : update;
            },
        });

        expect(id).not.toBe("analysis-tab");
        expect(tabs).toHaveLength(2);
        expect(tabs[0].value).toBe("analysis-tab");
        expect(activeTab).toBe(id);
    });

    it("keeps a sole home tab when evidence explicitly opens beside it", async () => {
        let tabs: Tab[] = [
            { name: "Home", value: "home", type: "new", gameOrigin: { kind: "none" } },
        ];
        let activeTab: string | null = "home";

        const id = await createTab({
            tab: { name: "Evidence", type: "analysis", returnPath: "/accounts" },
            preserveNewTab: true,
            setTabs: (update) => {
                tabs = typeof update === "function" ? update(tabs) : update;
            },
            setActiveTab: (update) => {
                activeTab = typeof update === "function" ? update(activeTab) : update;
            },
        });

        expect(tabs.map((tab) => tab.value)).toEqual(["home", id]);
        expect(tabs[1].returnPath).toBe("/accounts");
        expect(activeTab).toBe(id);
    });
});
