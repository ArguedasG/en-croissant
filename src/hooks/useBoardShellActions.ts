import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
    activeTabAtom,
    importModalOpenAtom,
    reuseEmptyAnalysisTabAtom,
    tabsAtom,
} from "@/state/atoms";
import { createOrReuseBoardTab } from "@/utils/tabs";

export function useBoardShellActions() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [tabs, setTabs] = useAtom(tabsAtom);
    const [activeTab, setActiveTab] = useAtom(activeTabAtom);
    const reuseEmpty = useAtomValue(reuseEmptyAnalysisTabAtom);
    const setImportModalOpen = useSetAtom(importModalOpenAtom);

    const openMode = useCallback(
        async (type: "analysis" | "play" | "generator", name: string, allowReuse: boolean) => {
            await navigate({ to: "/" });
            return createOrReuseBoardTab({
                tabs,
                activeTab,
                type,
                name,
                reuseEmpty: allowReuse,
                setTabs,
                setActiveTab,
            });
        },
        [activeTab, navigate, setActiveTab, setTabs, tabs],
    );

    const openBoard = useCallback(async () => {
        await navigate({ to: "/" });
        if (tabs.length === 0) {
            await openMode("analysis", t("Home.Card.AnalysisBoard.Title"), true);
        }
    }, [navigate, openMode, t, tabs.length]);

    const startGame = useCallback(
        () => openMode("play", t("Home.NewGame", "New Game"), reuseEmpty),
        [openMode, reuseEmpty, t],
    );

    const importGame = useCallback(async () => {
        await openMode("analysis", t("Home.Card.AnalysisBoard.Title"), reuseEmpty);
        setImportModalOpen(true);
    }, [openMode, reuseEmpty, setImportModalOpen, t]);

    const openLaboratory = useCallback(
        () => openMode("generator", t("ModelGame.Title", "Model Game Generator"), true),
        [openMode, t],
    );

    const openTraining = useCallback(() => navigate({ to: "/training" }), [navigate]);

    return { openBoard, startGame, importGame, openLaboratory, openTraining };
}
