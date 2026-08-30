import { useTranslation as useTrainingTranslation } from "react-i18next";
import i18n from "i18next";
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

function filename(path: string, trainingT: typeof i18n.t = i18n.t): string {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || trainingT("Training.Copy.Tacticsset.e9b5f38c", "Tactics set")
  );
}

export default function TacticsTrainingPage() {
  const { t: trainingT } = useTrainingTranslation();

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
      tab: {
        name: trainingT("Training.Copy.Tacticstraining.8816b222", "Tactics training"),
        type: "puzzles",
      },
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
          trainingT(
            "Training.Copy.NopositionswithexplicitFEN.ec65daa7",
            "No positions with explicit FEN headers were found. This importer requires a FEN for each position.",
          ),
        );
      }

      const name = setName.trim() || filename(selected, trainingT);
      setAreas((previous) => ({
        ...previous,
        tactics: addTacticsSet(previous.tactics, name, description.trim(), usable),
      }));
      setSetName("");
      setDescription("");
      const skipped = records.length - usable.length;
      setFeedback({
        text: trainingT(
          "Training.Copy.Setv0importedwithv1.33ec5dd8",
          "Set “{{v0}}” imported with {{v1}} exercises{{v2}}.",
          {
            v0: name,
            v1: usable.length,
            v2: skipped > 0 ? `; ${skipped} registros sin FEN fueron omitidos` : "",
          },
        ),
      });
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? error.message
            : trainingT("Training.Copy.Couldnotimporttheset.90285448", "Could not import the set."),
        color: "red",
      });
    }
  }

  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
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
                {trainingT("Training.Copy.Tacticstraining.8816b222", "Tactics training")}
              </Title>
              <Text c="dimmed" mt={4}>
                {" "}
                {trainingT(
                  "Training.Copy.UsetheLichessworkflowand.0ab91ef9",
                  "Use the Lichess workflow and organize your own tactical position sets.",
                )}{" "}
              </Text>
            </div>
          </Group>
          <Button leftSection={<IconPlayerPlay size={16} />} onClick={openLichessTrainer}>
            {" "}
            {trainingT("Training.Copy.OpenLichesstrainer.66c59db5", "Open Lichess trainer")}{" "}
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
                <Text fw={600}>
                  {trainingT("Training.Copy.Importyourownset.de7fbd60", "Import your own set")}
                </Text>
                <Text size="sm" c="dimmed">
                  {" "}
                  {trainingT(
                    "Training.Copy.EachFENrecordrepresentsa.22d0105d",
                    "Each FEN record represents a position. Its solution can be included in the moves or calculated on demand when you answer.",
                  )}{" "}
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <TextInput
                label={trainingT("Training.Copy.Setname.a54101c6", "Set name")}
                placeholder={trainingT(
                  "Training.Copy.egCalculationtactics.73de31ea",
                  "e.g. Calculation tactics",
                )}
                value={setName}
                onChange={(event) => setSetName(event.currentTarget.value)}
              />
              <TextInput
                label={trainingT("Training.Copy.Description.ee00b96f", "Description")}
                placeholder="Origen, nivel o tema"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
            </SimpleGrid>
            <Button leftSection={<IconUpload size={16} />} color="orange" onClick={importSet}>
              {" "}
              {trainingT(
                "Training.Copy.SelectPGNorpositionfile.dd6d1748",
                "Select PGN or position file",
              )}{" "}
            </Button>
          </Stack>
        </Card>

        {sets.length === 0 ? (
          <Card withBorder>
            <Stack align="center" py="xl">
              <IconPuzzle size={42} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">
                {trainingT("Training.Copy.Nopersonalsetsyet.621db003", "No personal sets yet.")}
              </Text>
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
                        {set.description ||
                          trainingT(
                            "Training.Copy.Tacticalpositionset.3fbbdb39",
                            "Tactical position set.",
                          )}
                      </Text>
                      <Text size="sm" mt="md">
                        {" "}
                        {trainingT("Training.Copy.Correct.6fb6bcb3", "Correct:")} {progress.correct}{" "}
                        {trainingT("Training.Copy.Incorrect.ffa38b68", "· Incorrect:")}{" "}
                        {progress.incorrect}
                      </Text>
                      <Text size="xs" c="dimmed" mt={4}>
                        {" "}
                        {trainingT(
                          "Training.Copy.Equivalencethreshold.c63fdf99",
                          "Equivalence threshold:",
                        )}{" "}
                        {set.config.acceptanceThresholdCp} cp
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
                      {" "}
                      {trainingT("Training.Copy.Practiceset.da2522ca", "Practice set")}{" "}
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
