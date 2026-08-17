# Model Game Generator — Fase 2.1

Esta fase permite generar una partida individual y trazable entre dos jugadores controlados por motor. La ejecución por lotes construida sobre esta base se documenta en `docs/model-game-generator-phase-2-2.es.md`.

## Abrir el generador

Hay dos puntos de entrada:

1. Desde **Inicio**, abrir **Model Game Generator**. Sobre la configuración de jugadores aparece una tarjeta visible con la posición inicial, su FEN y la acción **Editar tablero / FEN**.
2. Desde una partida o análisis PGN, seleccionar el nodo deseado y pulsar el icono de matraz. El generador conserva la FEN original y únicamente el historial de jugadas que conduce hasta ese nodo; no copia continuaciones posteriores ni variantes laterales.

El historial es importante para reglas como triple repetición, porque una FEN aislada no lo contiene.

## Configurar una partida

Blancas y negras se configuran por separado. Cada lado puede utilizar:

- un motor UCI normal con un preset limitado, fuerte, de referencia o personalizado;
- uno de los bots humanos Maia disponibles.

Según el tipo de jugador se pueden configurar tiempo, incremento, profundidad o nodos. El generador exige que ambos lados estén controlados por un motor.

Los presets ilimitados distinguen el tipo de búsqueda. Para motores alfa-beta se mantienen las profundidades 16, 18 y 24. Para Lc0/Leela se utilizan respectivamente 500, 2000 y 8000 nodos. La profundidad de una búsqueda MCTS no es equivalente a la de Stockfish: una meta como profundidad 18 puede dejar a Lc0 calculando durante demasiado tiempo sin que exista un fallo del motor.

Cada lado también tiene una **semilla de lanzamiento**. La semilla se registra siempre en la configuración. Solo modifica la ejecución cuando los argumentos de ese motor contienen el placeholder `{{randomSeed}}`; en ese caso se sustituye antes de arrancar el proceso. Una semilla no vuelve determinista a un motor que no ofrece control de aleatoriedad o cuyo resultado varía por concurrencia, hardware u otros factores internos.

## Compatibilidad de opciones UCI

Antes de configurar un proceso, Chess Lab recopila las opciones que el motor anuncia durante el saludo UCI. Durante una partida solo envía las opciones compatibles. El manifiesto distingue:

- `appliedOptions`: opciones realmente enviadas;
- `skippedUnsupportedOptions`: nombres de opciones solicitadas que el motor no anunció.

Esto permite compartir presets entre Stockfish, Lc0 y otros motores sin asumir que todos implementan `Threads`, `Hash`, `Skill Level`, `UCI_Elo`, `MultiPV` o `UCI_Chess960`.

La variante o paquete instalado también debe ser compatible con el hardware. Por ejemplo, una compilación CUDA de Lc0 necesita el entorno NVIDIA correspondiente; en Windows, `windows-onnx-dml` puede ser una alternativa adecuada para hardware compatible con DirectML. Chess Lab registra la ruta, versión declarada y argumentos del motor, pero actualmente no decide automáticamente qué backend conviene instalar.

Durante la búsqueda, la interfaz indica qué jugador está pendiente y desactiva inicios duplicados. **Abortar** termina los procesos de la partida mediante un canal independiente del bloqueo de lectura UCI, por lo que no necesita esperar a que el motor produzca `bestmove`. Cerrar la aplicación también termina los motores activos del generador.

## Repetir y exportar

Al finalizar aparecen estas acciones:

- **Repetir configuración**: restaura la posición e historial originales y arranca otra partida con una copia de la misma configuración, incluidos jugadores, límites, opciones y semillas.
- **Editar configuración**: restaura el origen y vuelve al formulario sin iniciar una partida.
- **Exportar PGN + manifiesto**: solicita un nombre `.pgn` y guarda junto a él un archivo `.manifest.json` con el mismo nombre base.

El PGN contiene la partida completa y cabeceras de trazabilidad. El manifiesto `schemaVersion: 1` contiene la posición e historial iniciales, configuración solicitada, datos efectivos de lanzamiento, opciones aplicadas u omitidas, hardware, jugadas, relojes y resultado.

## Límites de esta fase

- Solo se ejecuta una partida a la vez.
- Desde la Fase 2.3, las partidas terminadas y abortadas se registran automáticamente como experimentos locales y pueden reabrirse para análisis.
- La repetición rápida se conserva mientras la pestaña actual siga abierta; el registro durable se consulta desde **Experimentos de partidas modelo**.
- La generación individual no muestra cola ni progreso agregado; esas funciones se utilizan al activar el modo por lotes de la Fase 2.2.
- Todavía no se calculan hashes criptográficos del binario ni de las redes del motor.
- Repetir la configuración no garantiza partidas idénticas si el motor o el entorno no son deterministas.

## Prueba manual mínima

1. Abrir el generador desde Inicio y confirmar que la tarjeta de posición inicial permite abrir el editor de tablero/FEN.
2. Seleccionar Stockfish y Lc0. Volver a seleccionar **Motor fuerte** si la configuración guardada figura como **Personalizada**; Lc0 debe mostrar 2000 nodos por jugada.
3. Generar una partida corta y confirmar que ambos motores mueven.
4. Durante otra búsqueda, pulsar **Abortar**, comprobar que responde sin esperar `bestmove` y generar inmediatamente una nueva partida.
5. Cerrar la aplicación durante una búsqueda y confirmar que no requiere `Ctrl+C`.
6. Repetir una partida terminada y confirmar que se conservan jugadores, límites, opciones y semillas.
7. Exportar los artefactos y comprobar que existen el `.pgn` y el `.manifest.json` emparejados.
8. Abrir un PGN en análisis, seleccionar un nodo intermedio y generar desde esa posición.
9. Confirmar en el manifiesto que `initialFen` e `initialMoves` representan ese punto de partida.
10. Revisar que las opciones incompatibles aparecen en `skippedUnsupportedOptions` sin impedir el juego.
