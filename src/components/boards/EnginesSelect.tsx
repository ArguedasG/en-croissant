import { Select } from "@mantine/core";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { enginesAtom } from "@/state/atoms";
import type { LocalEngine } from "@/utils/engines";

export function EnginesSelect({
  engine,
  setEngine,
  filter,
  label,
  description,
}: {
  engine: LocalEngine | null;
  setEngine: (engine: LocalEngine | null) => void;
  filter?: (engine: LocalEngine) => boolean;
  label?: string;
  description?: string;
}) {
  const allEngines = useAtomValue(enginesAtom);
  const engines = (allEngines ?? [])
    .filter((e): e is LocalEngine => e.type === "local")
    .filter((engine) => filter?.(engine) ?? true);

  useEffect(() => {
    if (engines.length === 0) return;

    const updatedEngine = engine && engines.find((candidate) => candidate.id === engine.id);
    if (!updatedEngine) {
      setEngine(engines[0]);
    } else if (updatedEngine !== engine) {
      setEngine(updatedEngine);
    }
  }, [engine, engines, setEngine]);

  return (
    <Select
      label={label}
      description={description}
      allowDeselect={false}
      data={engines?.map((engine) => ({
        label: engine.name,
        value: engine.id,
      }))}
      value={engine?.id ?? ""}
      onChange={(e) => {
        setEngine(engines.find((engine) => engine.id === e) ?? null);
      }}
    />
  );
}
