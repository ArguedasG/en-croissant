import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { IconArrowLeft, IconBook2, IconPlayerPlay, IconUpload } from "@tabler/icons-react";
import { useAtom } from "jotai";
import { Link, useLoaderData, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { trainingAreasAtom } from "@/state/trainingAreas";
import { addOpeningRepertoire, parseTrainingRecords } from "@/utils/trainingAreas";
import { createFile, openFile } from "@/utils/files";

function filename(path: string): string {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || "Repertorio"
  );
}

export default function OpeningTrainingPage() {
  const navigate = useNavigate();
  const { documentDir } = useLoaderData({ from: "/training/openings" });
  const [areas, setAreas] = useAtom(trainingAreasAtom);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<"white" | "black" | "both">("white");
  const [feedback, setFeedback] = useState<{ text: string; color?: string } | null>(null);
  const repertoires = useMemo(
    () => Object.values(areas.openings.repertoires),
    [areas.openings.repertoires],
  );

  async function importRepertoire() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (typeof selected !== "string") return;

    try {
      const raw = await readTextFile(selected);
      const records = await parseTrainingRecords(raw);
      if (records.length === 0) throw new Error("El PGN no contiene líneas importables.");

      const repertoireName = name.trim() || filename(selected);
      const created = await createFile({
        filename: repertoireName,
        filetype: "repertoire",
        pgn: raw,
        dir: documentDir,
      });
      if (created.isErr) throw created.error;

      setAreas((previous) => ({
        ...previous,
        openings: addOpeningRepertoire(previous.openings, {
          name: repertoireName,
          color,
          description: description.trim(),
          path: created.value.path,
          sourcePath: selected,
          recordCount: records.length,
          subvariationPolicy: "mainline",
          variants: records.map((record, index) => ({
            name: record.title,
            sourceRecordIndex: index,
            trainingRecordIndex: index,
            contentType: "theory",
            commentCount: 0,
            hasVariations: false,
            lines: [
              {
                name: record.title,
                fen: record.fen,
                moves: record.moves,
                path: [],
                plyCount: record.moves.length,
                trainable: true,
              },
            ],
          })),
        }),
      }));
      setName("");
      setDescription("");
      setFeedback({
        text: `Repertorio «${repertoireName}» importado con ${records.length} líneas.`,
      });
      await navigate({ to: "/" });
      await openFile(created.value, setTabs, setActiveTab);
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "No se pudo importar el repertorio.",
        color: "red",
      });
    }
  }

  async function practiceRepertoire(repertoire: (typeof repertoires)[number]) {
    const lineCount = repertoire.variantIds.reduce(
      (total, variantId) => total + (areas.openings.variants[variantId]?.lineIds.length ?? 0),
      0,
    );
    await navigate({ to: "/" });
    await openFile(
      {
        type: "file",
        name: repertoire.name,
        path: repertoire.path,
        numGames: lineCount,
        metadata: { type: "repertoire", tags: [] },
        lastModified: Date.now(),
      },
      setTabs,
      setActiveTab,
    );
  }

  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group align="flex-start">
          <Button component={Link} to="/training" variant="subtle" p="xs" aria-label="Volver">
            <IconArrowLeft size={20} />
          </Button>
          <div>
            <Title order={2}>Entrenamiento de Aperturas</Title>
            <Text c="dimmed" mt={4}>
              Importa repertorios y practícalos con la experiencia existente de líneas completas y
              repetición espaciada.
            </Text>
          </div>
        </Group>

        {feedback && (
          <Alert color={feedback.color} withCloseButton onClose={() => setFeedback(null)}>
            {feedback.text}
          </Alert>
        )}

        <Card withBorder>
          <Stack>
            <Group>
              <IconUpload size={24} color="var(--mantine-color-blue-6)" />
              <div>
                <Text fw={600}>Importar repertorio PGN</Text>
                <Text size="sm" c="dimmed">
                  Se conserva el archivo como repertorio del proyecto y se organiza en variantes y
                  líneas para la práctica.
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 3 }}>
              <TextInput
                label="Nombre"
                placeholder="Ej. Francesa con blancas"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <TextInput
                label="Descripción"
                placeholder="Objetivo del repertorio"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
              <Select
                label="Color"
                data={[
                  { value: "white", label: "Blancas" },
                  { value: "black", label: "Negras" },
                  { value: "both", label: "Ambos colores" },
                ]}
                value={color}
                onChange={(value) => value && setColor(value as typeof color)}
              />
            </SimpleGrid>
            <Button color="blue" leftSection={<IconUpload size={16} />} onClick={importRepertoire}>
              Seleccionar PGN de repertorio
            </Button>
          </Stack>
        </Card>

        {repertoires.length === 0 ? (
          <Card withBorder>
            <Stack align="center" py="xl">
              <IconBook2 size={42} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">Todavía no hay repertorios registrados.</Text>
            </Stack>
          </Card>
        ) : (
          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            {repertoires.map((repertoire) => {
              const variants = repertoire.variantIds
                .map((id) => areas.openings.variants[id])
                .filter((variant): variant is NonNullable<typeof variant> => Boolean(variant));
              const lineCount = variants.reduce((sum, variant) => sum + variant.lineIds.length, 0);
              return (
                <Card key={repertoire.id} withBorder>
                  <Stack>
                    <Group justify="space-between" align="flex-start">
                      <div>
                        <Title order={4}>{repertoire.name}</Title>
                        <Text size="sm" c="dimmed" mt={4}>
                          {repertoire.description || "Repertorio de aperturas."}
                        </Text>
                      </div>
                      <Badge color="blue" variant="light">
                        {repertoire.color === "both"
                          ? "Ambos"
                          : repertoire.color === "white"
                            ? "Blancas"
                            : "Negras"}
                      </Badge>
                    </Group>
                    <Text size="sm">
                      {variants.length} variantes · {lineCount} líneas
                    </Text>
                    <Text size="xs" c="dimmed">
                      Umbral de desviación: {repertoire.acceptanceThresholdCp} cp
                    </Text>
                    <Button
                      color="blue"
                      variant="light"
                      leftSection={<IconPlayerPlay size={16} />}
                      onClick={() => practiceRepertoire(repertoire)}
                    >
                      Practicar repertorio
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
