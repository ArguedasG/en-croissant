import { describe, expect, it } from "vitest";
import { tabSchema, type Tab } from "./tabs";
import { getTabPath, isTrainingPath, updateTrainingTab } from "./trainingTabs";

describe("training workspace tabs", () => {
    const hub: Tab = {
        value: "training-1",
        name: "SideBar.Training",
        type: "training",
        trainingPath: "/training",
        gameOrigin: { kind: "none" },
    };

    it.each(["tactics", "openings", "endgames"])(
        "converts the hub to %s without changing its identity",
        (area) => {
            const tab = updateTrainingTab(hub, `/training/${area}`);
            expect(tab.value).toBe(hub.value);
            expect(tab.gameOrigin).toEqual({ kind: "none" });
            expect(tab.name).not.toBe(hub.name);
            expect(getTabPath(tab)).toBe(`/training/${area}`);
            expect(tabSchema.parse(tab)).toEqual(tab);
            expect(hub.trainingPath).toBe("/training");
        },
    );

    it("restores a tactical practice route and returns board tabs to the board route", () => {
        const practice = updateTrainingTab(hub, "/training/tactics/practice/my-set");
        expect(getTabPath(tabSchema.parse(practice))).toBe("/training/tactics/practice/my-set");
        expect(getTabPath({ ...hub, type: "analysis" })).toBe("/");
        expect(isTrainingPath("/training-other")).toBe(false);
        expect(isTrainingPath("/training/tactics")).toBe(true);
    });
});
