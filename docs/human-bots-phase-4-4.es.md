# Bots humanos — Fase 4.4: catálogo inicial y expansión

Estado: implementación técnica completada el 2026-08-19. Validación manual de las nuevas identidades pendiente.

## Decisiones aplicadas

El catálogo pasa de seis a quince perfiles. La expansión no consiste únicamente en llenar una escala de ELO: cada bot recibe una combinación editorial de nivel, muestreo, tiempo, estilo y repertorio.

Los repertorios ahora distinguen líneas de blancas y negras. Así, un bot puede tener dos opciones de `e4`, dos de `d4` o una estructura equivalente para negras, sin mezclar cuatro primeras jugadas de blancas sin intención. También existen tres modos:

- `weighted`: selecciona entre líneas ponderadas y después vuelve a la selección normal de Maia;
- `forcedLine`: sigue una única línea inicial durante un límite explícito y después improvisa con Maia;
- `none`: no tiene repertorio propio y deja que Maia determine normalmente sus aperturas.

## Catálogo 4.4.0

| Bot | ELO objetivo | Estilo editorial | Blancas | Negras | Modo |
| --- | ---: | --- | --- | --- | --- |
| Luna | 900 | agresiva y complicadora, poco teórica | Italiana, Escocesa | Francesa, Escandinava | ponderado |
| Sofía | 1050 | agresiva, complejidad media | Escandinava inicial | Escandinava inicial | línea fija |
| Nico | 1200 | agresivo y táctico | Italiana, Dos caballos | Siciliana (Ataque inglés) | ponderado |
| Daniela | 1300 | equilibrada y compleja | Escocesa | Francesa | ponderado |
| Marcos | 1450 | equilibrado y natural | Maia | Maia | sin repertorio |
| Vera | 1500 | equilibrada y clásica | Gambito de dama, Londres | Eslava | ponderado |
| Carlos | 1650 | selectivo y teórico | Londres, Inglesa | Eslava, India de dama | ponderado |
| Gabriel | 1700 | defensivo y simplificador | Gambito de dama, Londres | Eslava, India de dama | ponderado |
| Nelson | 1800 | agresivo y complicador | Gambito de dama | Nimzoindia, India de dama, India de rey, Grünfeld | ponderado |
| Irene | 1900 | sólida, paciente y teórica | Gambito de dama, Inglesa | Caro-Kann | ponderado |
| Mariann | 2000 | sólida y clásica | Española, Gambito de dama | Francesa, Caro-Kann | ponderado |
| Valeria | 2100 | agresiva y compleja | Italiana | Pirc, Moderna | ponderado |
| Leo | 2200 | preciso y orientado a líneas principales | Española, Inglesa | Siciliana, Nimzoindia, India de rey | ponderado |
| Tomás | 2300 | complejo y muy teórico | Ataque Indio de Rey | India de rey | ponderado |
| Atlas | 2400 | preciso, agudo y muy teórico | Española, Escocesa | Siciliana, Nimzoindia, Grünfeld | ponderado |

Las descripciones de estilo y los ELO siguen siendo hipótesis editoriales o objetivos solicitados a Maia. La implementación no los presenta como una medición externa ni como una fuerza calibrada definitivamente.

## Repertorios especiales

Sofía usa la Escandinava como una línea única con un límite de seis plies, equivalente a tres movimientos completos. Si el rival se desvía antes o se alcanza ese límite, el motor continúa mediante la selección normal de Maia.

Marcos usa el repertorio `marcos-maia-natural`, que contiene cero líneas. Esto permite comparar un perfil con estilo editorial contra los perfiles que tienen una preparación de apertura explícita.

La combinación Francesa/Caro-Kann queda concentrada en Mariann. Daniela se especializa en la Francesa e Irene en la Caro-Kann. Nico conserva una variante concreta de la Siciliana, mientras que varios perfiles de mayor fuerza mantienen repertorios más amplios de forma intencional.

## Validación pendiente

La siguiente prueba práctica no requiere cientos de partidas. Para cada bot nuevo será suficiente:

1. abrirlo en la interfaz y comprobar nombre, ELO, estilo y repertorio;
2. jugar o generar algunas partidas con blancas y negras;
3. verificar que sus primeras jugadas respeten el repertorio y que después pueda desviarse;
4. comprobar que Marcos no produzca jugadas `profileRepertoire` y que Sofía deje de producirlas después de su línea inicial;
5. enfrentar cada bot contra uno o dos anclajes cercanos en series pequeñas de 10 partidas.

La distinción estadística completa de los nuevos perfiles y la prueba específica de estilo mediante posiciones con varios planes equivalentes quedan para una iteración posterior.
