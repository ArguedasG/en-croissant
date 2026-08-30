import { useTranslation as useTrainingTranslation } from "react-i18next";
import i18n from "i18next";
import {
  Badge,
  Button,
  Card,
  Container,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconBook2, IconChess, IconPuzzle } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { trainingAreasAtom } from "@/state/trainingAreas";

const getCards = (trainingT: typeof i18n.t = i18n.t) => [
  {
    key: "tactics",
    title: trainingT("Training.Copy.Tactics.d106ed17", "Tactics"),
    description: trainingT(
      "Training.Copy.Practiceyourtacticssetsand.5abdfdd9",
      "Practice your tactics sets and improve your decisions on the board.",
    ),
    icon: IconPuzzle,
    color: "orange",
    to: "/training/tactics" as const,
  },
  {
    key: "openings",
    title: trainingT("Training.Copy.Openings.fb68d331", "Openings"),
    description: trainingT(
      "Training.Copy.Createimportandpracticeyour.23a91199",
      "Create, import, and practice your opening repertoires.",
    ),
    icon: IconBook2,
    color: "blue",
    to: "/training/openings" as const,
  },
  {
    key: "endgames",
    title: trainingT("Training.Copy.Endgames.6f6de6ac", "Endgames"),
    description: trainingT(
      "Training.Copy.Practiceendgamepositionsagainstan.a8b01ee6",
      "Practice endgame positions against an engine or bot.",
    ),
    icon: IconChess,
    color: "teal",
    to: "/training/endgames" as const,
  },
];

export default function TrainingHubPage() {
  const { t: trainingT } = useTrainingTranslation();

  const areas = useAtomValue(trainingAreasAtom);

  return (
    <Container size="xl" py="md">
      <Stack gap="xl">
        <div>
          <Title order={2}>{trainingT("Training.Copy.Training.e3a01d07", "Training")}</Title>
          <Text c="dimmed" maw={760} mt={4}>
            {" "}
            {trainingT(
              "Training.Copy.Choosewhattopracticeand.b3a34505",
              "Choose what to practice and start a session.",
            )}{" "}
          </Text>
        </div>

        <SimpleGrid cols={{ base: 1, md: 3 }}>
          {getCards(trainingT).map(({ key, title, description, icon: Icon, color, to }) => {
            const count =
              key === "tactics"
                ? Object.keys(areas.tactics.sets).length
                : key === "openings"
                  ? Object.keys(areas.openings.repertoires).length
                  : Object.keys(areas.endgames.sets).length;

            return (
              <Card key={key} withBorder shadow="sm" padding="lg">
                <Stack h="100%" justify="space-between">
                  <Group justify="space-between" align="flex-start">
                    <Icon size={42} stroke={1.5} color={`var(--mantine-color-${color}-6)`} />
                    <Badge color={color} variant="light">
                      {count} {count === 1 ? "set" : "sets"}
                    </Badge>
                  </Group>
                  <div>
                    <Title order={3}>{title}</Title>
                    <Text size="sm" c="dimmed" mt="xs">
                      {description}
                    </Text>
                  </div>
                  <Button component={Link} to={to} color={color} variant="light" fullWidth>
                    {" "}
                    {trainingT("Training.Copy.Open.a01a5fce", "Open")} {title}
                  </Button>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      </Stack>
    </Container>
  );
}
