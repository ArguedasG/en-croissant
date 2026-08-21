import { Badge, Button, Card, Container, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconBook2, IconChess, IconPuzzle } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { trainingAreasAtom } from "@/state/trainingAreas";

const cards = [
  {
    key: "tactics",
    title: "Táctica",
    description: "Practica tus sets tácticos y mejora tus decisiones en el tablero.",
    icon: IconPuzzle,
    color: "orange",
    to: "/training/tactics" as const,
  },
  {
    key: "openings",
    title: "Aperturas",
    description: "Crea, importa y practica tus repertorios de aperturas.",
    icon: IconBook2,
    color: "blue",
    to: "/training/openings" as const,
  },
  {
    key: "endgames",
    title: "Finales",
    description: "Practica posiciones de finales contra un motor o un bot.",
    icon: IconChess,
    color: "teal",
    to: "/training/endgames" as const,
  },
];

export default function TrainingHubPage() {
  const areas = useAtomValue(trainingAreasAtom);

  return (
    <Container size="xl" py="md">
      <Stack gap="xl">
        <div>
          <Title order={2}>Entrenamiento</Title>
          <Text c="dimmed" maw={760} mt={4}>
            Elige qué quieres practicar y empieza una sesión.
          </Text>
        </div>

        <SimpleGrid cols={{ base: 1, md: 3 }}>
          {cards.map(({ key, title, description, icon: Icon, color, to }) => {
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
                    Abrir {title}
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
