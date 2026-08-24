import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Group,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { IconArrowLeft, IconPlayerPlay, IconPuzzle, IconUpload } from "@tabler/icons-react";
import { useAtom } from "jotai";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { trainingAreasAtom } from "@/state/trainingAreas";
import { addTacticsSet, getTacticsSetProgress, parseTrainingRecords } from "@/utils/trainingAreas";
import { createTab } from "@/utils/tabs";

function filename(path: string): string {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || "Set de táctica"
  );
}

export default function TacticsTrainingPage() {
  const navigate = useNavigate();
  const [areas, setAreas] = useAtom(trainingAreasAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const [setName, setSetName] = useState("");
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; color?: string } | null>(null);
  const sets = useMemo(() => Object.values(areas.tactics.sets), [areas.tactics.sets]);

  async function openLichessTrainer() {
    await navigate({ to: "/" });
    await createTab({
      tab: { name: "Entrenamiento de Táctica", type: "puzzles" },
      setTabs,
      setActiveTab,
    });
  }

  async function importSet() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PGN o texto de posiciones", extensions: ["pgn", "txt"] }],
    });
    if (typeof selected !== "string") return;

    try {
      const records = await parseTrainingRecords(await readTextFile(selected));
      const usable = records.filter((record) => record.hasExplicitFen);
      if (usable.length === 0) {
        throw new Error(
          "No se encontraron posiciones con FEN explícito. El primer importador no interpreta partidas completas.",
        );
      }

      const name = setName.trim() || filename(selected);
      setAreas((previous) => ({
        ...previous,
        tactics: addTacticsSet(previous.tactics, name, description.trim(), usable),
      }));
      setSetName("");
      setDescription("");
      const skipped = records.length - usable.length;
      setFeedback({
        text: `Set «${name}» importado con ${usable.length} ejercicios${skipped > 0 ? `; ${skipped} registros sin FEN fueron omitidos` : ""}.`,
      });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "No se pudo importar el set.",
        color: "red",
      });
    }
  }

  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Group align="flex-start">
            <Button component={Link} to="/training" variant="subtle" p="xs" aria-label="Volver">
              <IconArrowLeft size={20} />
            </Button>
            <div>
              <Title order={2}>Entrenamiento de Táctica</Title>
              <Text c="dimmed" mt={4}>
                Mantén el flujo Lichess y organiza tus propios sets de posiciones tácticas.
              </Text>
            </div>
          </Group>
          <Button leftSection={<IconPlayerPlay size={16} />} onClick={openLichessTrainer}>
            Abrir entrenador Lichess
          </Button>
        </Group>

        {feedback && (
          <Alert color={feedback.color} withCloseButton onClose={() => setFeedback(null)}>
            {feedback.text}
          </Alert>
        )}

        <Card withBorder>
          <Stack>
            <Group>
              <IconUpload size={24} color="var(--mantine-color-orange-6)" />
              <div>
                <Text fw={600}>Importar set propio</Text>
                <Text size="sm" c="dimmed">
                  Cada registro con FEN representa una posición. La solución puede estar en sus
                  jugadas o calcularse bajo demanda al responder.
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <TextInput
                label="Nombre del set"
                placeholder="Ej. Tácticas de cálculo"
                value={setName}
                onChange={(event) => setSetName(event.currentTarget.value)}
              />
              <TextInput
                label="Descripción"
                placeholder="Origen, nivel o tema"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
            </SimpleGrid>
            <Button leftSection={<IconUpload size={16} />} color="orange" onClick={importSet}>
              Seleccionar PGN o archivo de posiciones
            </Button>
          </Stack>
        </Card>

        {sets.length === 0 ? (
          <Card withBorder>
            <Stack align="center" py="xl">
              <IconPuzzle size={42} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">Todavía no hay sets propios.</Text>
            </Stack>
          </Card>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }}>
            {sets.map((set) => {
              const progress = getTacticsSetProgress(areas.tactics, set.id);
              return (
                <Card key={set.id} withBorder>
                  <Stack h="100%" justify="space-between">
                    <div>
                      <Group justify="space-between" align="flex-start">
                        <Title order={4}>{set.name}</Title>
                        <Badge color="orange" variant="light">
                          {progress.attempted}/{progress.total}
                        </Badge>
                      </Group>
                      <Text size="sm" c="dimmed" mt="xs" mih={42}>
                        {set.description || "Set de posiciones tácticas."}
                      </Text>
                      <Text size="sm" mt="md">
                        Correctas: {progress.correct} · Incorrectas: {progress.incorrect}
                      </Text>
                      <Text size="xs" c="dimmed" mt={4}>
                        Umbral de equivalencia: {set.config.acceptanceThresholdCp} cp
                      </Text>
                    </div>
                    <Button
                      color="orange"
                      variant="light"
                      leftSection={<IconPlayerPlay size={16} />}
                      onClick={() =>
                        navigate({
                          to: "/training/tactics/practice/$setId",
                          params: { setId: set.id },
                          search: { problem: undefined },
                        })
                      }
                    >
                      Practicar set
                    </Button>
                  </Stack>
                </Card>
              );
            })}
          </SimpleGrid>
        )}
      </Stack>
    </Container>
  );
}
