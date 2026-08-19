# Experiment Analysis — Fase 3.2

## Alcance

La segunda entrega analiza las partidas completadas de un experimento guardado mediante un motor
UCI objetivo seleccionado por el usuario. El resultado se persiste junto al experimento como
`analysis-v2.json`, de modo que volver a abrir el historial no repite el cálculo. La versión 2
separa las categorías de imprecisión, error y blunder; los resultados v1 deben volver a ejecutarse.

La implementación es deliberadamente local y acotada: reutiliza los manifiestos y artefactos de la
Fase 2.3, inicia un único motor evaluador y procesa las partidas secuencialmente. Maia no se
ofrece como evaluador objetivo en este panel; sus W/D/L siguen perteneciendo a la entrega 3.1.

## Configuración de Maia para jugar

Al seleccionar una instalación Maia 3 como oponente en una partida normal o en un model game,
la configuración muestra un ELO Maia entre 600 y 2600. El valor se envía como la opción UCI
`Elo`. En ese modo no se muestran los presets de Stockfish ni los controles de profundidad o
nodos: cada jugada usa una decisión acotada del modelo y el ELO es el control relevante.

El ELO es el nivel solicitado por Maia, no una medición calibrada de fuerza dentro de Chess Lab.

## Métricas

Para cada jugada generada se evalúa la posición antes y después de la jugada. La pérdida se expresa
desde la perspectiva del jugador que movió, por lo que funciona igual para blancas y negras.

- ACPL por color, jugador y fase;
- conteo de imprecisiones cuando la pérdida es mayor que 40 cp;
- conteo de errores cuando la pérdida es mayor que 100 cp;
- conteo de blunders cuando la pérdida es mayor que 200 cp;
- victorias, tablas y derrotas por color y jugador;
- cantidad de partidas y plies analizados, plies promedio y partidas omitidas;
- agregados por apertura, medio juego y final mediante una clasificación heurística reproducible.

Las puntuaciones de mate y valores extremos se limitan a ±1000 cp para evitar que una posición
terminal domine artificialmente los agregados. Un blunder no se cuenta además como error.

## Reproducibilidad y persistencia

`analysis-v2.json` conserva:

- versión del esquema y fecha de análisis;
- ruta y argumentos del motor;
- límite UCI y opciones aplicadas, incluido `MultiPV=1`;
- umbrales de imprecisión/error/blunder;
- resumen agregado y métricas de cada partida.

El análisis puede cancelarse desde la interfaz y publica progreso por plies. La cancelación no
borra el resultado anterior; si la ejecución termina correctamente, el nuevo resultado reemplaza
el archivo versionado.

## Límites de esta entrega

La clasificación de fases es una heurística (los primeros 20 plies son apertura y después se usa
material/ausencia de damas). No se presentan ELO calibrado, causalidad, posiciones críticas,
distribuciones de jugadas, entropía ni intervalos de confianza. Esas funciones requieren una
entrega estadística posterior y muestras diseñadas específicamente para ese fin.

## Validación manual pendiente

1. Generar o abrir un experimento completado con al menos una partida y un motor local instalado.
2. Abrir el historial y ejecutar el análisis con un límite de tiempo pequeño.
3. Confirmar progreso, cancelación y que el historial recupera el resultado guardado.
4. Repetir con colores alternados y revisar que ACPL, errores y blunders aparecen por color y jugador.
5. Comparar el resultado con una revisión directa de algunas jugadas en el panel normal de análisis.
6. Confirmar que un motor Maia no aparece como opción de evaluación objetiva.
