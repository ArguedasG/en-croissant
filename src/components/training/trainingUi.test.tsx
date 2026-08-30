import { MantineProvider } from "@mantine/core";
import i18n from "i18next";
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/translation/en-US.json";
import es from "@/translation/es-ES.json";
import TacticsAdvanceControl from "./TacticsAdvanceControl";
import TrainingHubPage from "./TrainingHubPage";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/state/trainingAreas", async () => {
  const { atom } = await import("jotai");
  return {
    trainingAreasAtom: atom({
      tactics: { sets: {} },
      openings: { repertoires: {} },
      endgames: { sets: {} },
    }),
  };
});

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    resources: { "en-US": en, "es-ES": es },
    lng: "en-US",
    fallbackLng: "en-US",
    returnEmptyString: false,
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render(node: ReactNode) {
  await act(async () => root.render(<MantineProvider>{node}</MantineProvider>));
}
function advanceProps(): ComponentProps<typeof TacticsAdvanceControl> {
  return {
    autoAdvance: true,
    solved: true,
    completesCycle: false,
    browsing: false,
    exerciseKey: "set:0",
    onNext: vi.fn(),
  };
}

describe("tactics completion control", () => {
  it("hides Next in automatic mode and advances exactly once after the delay", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const props = advanceProps();
    await render(<TacticsAdvanceControl {...props} />);
    expect(container.querySelector("button")).toBeNull();
    await act(async () => vi.advanceTimersByTime(649));
    expect(props.onNext).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(props.onNext).toHaveBeenCalledOnce();
  });
  it("cancels a pending advance when manual navigation changes the exercise", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const props = advanceProps();
    await render(<TacticsAdvanceControl {...props} />);
    await act(async () => vi.advanceTimersByTime(300));
    await render(<TacticsAdvanceControl {...props} exerciseKey="set:4" solved={false} />);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(props.onNext).not.toHaveBeenCalled();
  });
  it("shows the manual button, enables it only after solving, and cancels automatic mode", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const props = advanceProps();
    await render(<TacticsAdvanceControl {...props} />);
    await render(<TacticsAdvanceControl {...props} autoAdvance={false} solved={false} />);
    expect(container.querySelector("button")?.disabled).toBe(true);
    await render(<TacticsAdvanceControl {...props} autoAdvance={false} />);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(props.onNext).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Next puzzle");
    await act(async () => container.querySelector("button")?.click());
    expect(props.onNext).toHaveBeenCalledOnce();
  });
  it("cancels its timer on unmount", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const props = advanceProps();
    await render(<TacticsAdvanceControl {...props} />);
    await render(null);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(props.onNext).not.toHaveBeenCalled();
  });
});

describe("reference languages", () => {
  it("updates the training hub and its cards when switching languages without remounting", async () => {
    await render(<TrainingHubPage />);
    expect(container.textContent).toContain("Opening repertoires".toLowerCase());
    expect(container.textContent).toContain("Endgames");
    await act(async () => {
      await i18n.changeLanguage("es-ES");
    });
    expect(container.textContent).toContain("Entrenamiento");
    expect(container.textContent).toContain("Aperturas");
    expect(container.textContent).toContain("Practica tus sets tácticos");
    expect(container.textContent).not.toContain("Endgames");
  });
  it("has complete reference catalogs and falls back to English for empty translations", async () => {
    expect(Object.keys(en.translation).sort()).toEqual(Object.keys(es.translation).sort());
    expect(Object.values(es.translation).every((text) => text.trim().length > 0)).toBe(true);
    i18n.addResourceBundle("fr-FR", "translation", { "Pgn.SaveAs": "" });
    await i18n.changeLanguage("fr-FR");
    expect(i18n.t("Pgn.SaveAs")).toBe(en.translation["Pgn.SaveAs"]);
    await i18n.changeLanguage("es-ES");
    expect(i18n.t("Pgn.Overwrite", { path: "example.pgn" })).toContain("example.pgn");
    expect(i18n.t("Pgn.Overwrite", { path: "example.pgn" })).not.toContain("{{");
  });
});
