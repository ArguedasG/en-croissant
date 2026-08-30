import { useTranslation as useTrainingTranslation } from "react-i18next";
import i18n from "i18next";
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

function filename(path: string, trainingT: typeof i18n.t = i18n.t): string {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || trainingT("Training.Copy.Repertoire.5125381b", "Repertoire")
  );
}

export default function OpeningTrainingPage() {
  const { t: trainingT } = useTrainingTranslation();

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
      if (records.length === 0)
        throw new Error(
          trainingT(
            "Training.Copy.ThePGNcontainsnoimportable.6bc5efa3",
            "The PGN contains no importable lines.",
          ),
        );

      const repertoireName = name.trim() || filename(selected, trainingT);
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
        text: trainingT(
          "Training.Copy.Repertoirev0importedwithv1.3dab39e0",
          "Repertoire “{{v0}}” imported with {{v1}} lines.",
          { v0: repertoireName, v1: records.length },
        ),
      });
      await navigate({ to: "/" });
      await openFile(created.value, setTabs, setActiveTab);
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? error.message
            : trainingT(
                "Training.Copy.Couldnotimporttherepertoire.8d7bcf4d",
                "Could not import the repertoire.",
              ),
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
          <Button
            component={Link}
            to="/training"
            variant="subtle"
            p="xs"
            aria-label={trainingT("Training.Copy.Back.ab26ae7b", "Back")}
          >
            <IconArrowLeft size={20} />
          </Button>
          <div>
            <Title order={2}>
              {trainingT("Training.Copy.Openingtraining.268bdba9", "Opening training")}
            </Title>
            <Text c="dimmed" mt={4}>
              {" "}
              {trainingT(
                "Training.Copy.Importrepertoiresandpracticecomplete.e293f0a8",
                "Import repertoires and practice complete lines using spaced repetition.",
              )}{" "}
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
                <Text fw={600}>
                  {trainingT("Training.Copy.ImportPGNrepertoire.bc0efff0", "Import PGN repertoire")}
                </Text>
                <Text size="sm" c="dimmed">
                  {" "}
                  {trainingT(
                    "Training.Copy.Thefileiskeptas.361a9af2",
                    "The file is kept as a project repertoire, organized into variations and lines for practice.",
                  )}{" "}
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 3 }}>
              <TextInput
                label={trainingT("Training.Copy.Name.562bb157", "Name")}
                placeholder={trainingT(
                  "Training.Copy.egFrenchDefenseas.dc938947",
                  "e.g. French Defense as White",
                )}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <TextInput
                label={trainingT("Training.Copy.Description.ee00b96f", "Description")}
                placeholder={trainingT("Training.Copy.Repertoiregoal.8b47ac77", "Repertoire goal")}
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
              <Select
                label={trainingT("Training.Copy.Color.6b73191a", "Color")}
                data={[
                  { value: "white", label: trainingT("Training.Copy.White.9666a8c0", "White") },
                  { value: "black", label: trainingT("Training.Copy.Black.ead8fe1f", "Black") },
                  {
                    value: "both",
                    label: trainingT("Training.Copy.Bothcolors.c5bf9151", "Both colors"),
                  },
                ]}
                value={color}
                onChange={(value) => value && setColor(value as typeof color)}
              />
            </SimpleGrid>
            <Button color="blue" leftSection={<IconUpload size={16} />} onClick={importRepertoire}>
              {" "}
              {trainingT(
                "Training.Copy.SelectrepertoirePGN.e0199e01",
                "Select repertoire PGN",
              )}{" "}
            </Button>
          </Stack>
        </Card>

        {repertoires.length === 0 ? (
          <Card withBorder>
            <Stack align="center" py="xl">
              <IconBook2 size={42} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">
                {trainingT("Training.Copy.Norepertoiresyet.24e289d9", "No repertoires yet.")}
              </Text>
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
                          {repertoire.description ||
                            trainingT(
                              "Training.Copy.Openingrepertoire.0216f702",
                              "Opening repertoire.",
                            )}
                        </Text>
                      </div>
                      <Badge color="blue" variant="light">
                        {repertoire.color === "both"
                          ? trainingT("Training.Copy.Both.727f1e02", "Both")
                          : repertoire.color === "white"
                            ? trainingT("Training.Copy.White.9666a8c0", "White")
                            : trainingT("Training.Copy.Black.ead8fe1f", "Black")}
                      </Badge>
                    </Group>
                    <Text size="sm">
                      {variants.length}{" "}
                      {trainingT("Training.Copy.variations.ca95a410", "variations ·")} {lineCount}{" "}
                      {trainingT("Training.Copy.lines.6dad0dc4", "lines")}{" "}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {" "}
                      {trainingT(
                        "Training.Copy.Deviationthreshold.2d7a8cf1",
                        "Deviation threshold:",
                      )}{" "}
                      {repertoire.acceptanceThresholdCp} cp
                    </Text>
                    <Button
                      color="blue"
                      variant="light"
                      leftSection={<IconPlayerPlay size={16} />}
                      onClick={() => practiceRepertoire(repertoire)}
                    >
                      {" "}
                      {trainingT(
                        "Training.Copy.Practicerepertoire.da71a3f0",
                        "Practice repertoire",
                      )}{" "}
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
