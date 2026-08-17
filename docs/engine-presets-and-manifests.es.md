# Presets de motor y manifiestos reproducibles

Este documento describe las fases 1.2 y 1.3 de Chess Lab. Ambas construyen la base que utilizará el futuro Model Game Generator.

## Categorías de jugador y motor

Chess Lab separa explícitamente cinco categorías:

| Categoría | Propósito | Configuración aplicada |
| --- | --- | --- |
| Bot humano Maia | Simular decisiones humanas mediante un perfil Maia | ELO objetivo, muestreo, repertorio y tiempo propios del perfil |
| Motor limitado | Pedir al motor una fuerza reducida, sin afirmar que esté calibrada por Chess Lab | `UCI_LimitStrength=true`, `UCI_Elo`, 1 hilo y 64 MB Hash. En modo ilimitado: profundidad 16 para motores alfa-beta o 500 nodos para Lc0/Leela |
| Motor fuerte | Juego a fuerza completa con un presupuesto moderado y repetible | Sin límite de fuerza, Skill Level 20, 1 hilo y 64 MB Hash. En modo ilimitado: profundidad 18 para motores alfa-beta o 2000 nodos para Lc0/Leela |
| Motor de referencia | Referencia superhumana con mayor presupuesto de cálculo | Sin límite de fuerza, Skill Level 20, 1 hilo y 256 MB Hash. En modo ilimitado: profundidad 24 para motores alfa-beta u 8000 nodos para Lc0/Leela |
| Personalizada | Control manual del usuario | Conserva las opciones UCI y el límite de búsqueda seleccionados |

En todos los presets se solicita `MultiPV=1` durante la partida. Las opciones que el preset no reconoce —por ejemplo `EvalFile`— se conservan. Al arrancar, el backend solo envía las opciones que el motor anunció durante el saludo UCI; las demás se omiten y quedan registradas.

Los valores `UCI_Elo` son solicitudes al motor compatible, no mediciones de fuerza hechas por Chess Lab. Del mismo modo, **motor fuerte** no significa “Gran Maestro humano” y **motor de referencia** no significa “humano de 3000 ELO”.

Los presets se aplican al seleccionarlos. Chess Lab reconoce por nombre a Lc0/Leela y utiliza nodos porque su profundidad MCTS no es comparable con la profundidad de un motor alfa-beta: pedir profundidad 18 a Lc0 puede tardar mucho aunque el proceso siga calculando correctamente. Con reloj, el control de tiempo sustituye la profundidad o los nodos como límite de búsqueda. Editar manualmente profundidad, nodos, Threads o Hash cambia la categoría a **Personalizada**, conservando el estado resultante.

## Manifiesto de partida

Durante una partida con al menos un motor aparece la acción **Exportar manifiesto**. El archivo JSON usa actualmente `schemaVersion: 1` e incluye:

- versión de Chess Lab, identificador y fechas de inicio/exportación;
- sistema operativo, arquitectura y cantidad de CPU lógicas;
- FEN inicial, historial inicial UCI y posición final;
- configuración completa de blancas y negras;
- categoría del jugador, ELO solicitado, versión, ruta, argumentos y opciones UCI;
- argumentos de lanzamiento ya resueltos y semilla generada cuando se usó un placeholder;
- opciones UCI realmente aplicadas y nombres de las opciones solicitadas que el motor no anunció;
- límites de cálculo, controles de tiempo y libro de aperturas;
- jugadas, relojes, origen y tiempo de reflexión;
- estado, resultado y causa de finalización cuando la partida terminó.

Las duraciones que Rust representa como enteros de 64 bits se exportan como cadenas decimales para no perder precisión en JSON/JavaScript.

## Límites actuales

- La compatibilidad de opciones como `UCI_Elo` o `Skill Level` depende del motor instalado.
- El manifiesto identifica el ejecutable o modelo por ruta, versión declarada y argumentos, pero todavía no calcula hashes criptográficos.
- Una partida abortada se elimina del administrador actual; por ello el manifiesto debe exportarse antes de abortarla. La persistencia de ejecuciones abortadas pertenece al registro de experimentos de la Fase 2.
- El manifiesto permite repetir condiciones controladas, pero la reproducibilidad exacta también depende del motor, el hardware y su determinismo interno.

## Prueba manual mínima

1. Recompilar y abrir **Jugar**.
2. Elegir un motor y recorrer las categorías limitada, fuerte, referencia y personalizada.
3. Confirmar que cambian profundidad o nodos, Threads, Hash y opciones de fuerza según la tabla.
4. Iniciar una partida corta, finalizarla y pulsar **Exportar manifiesto**.
5. Abrir el JSON y comprobar jugadores, opciones, ruta, argumentos, posición inicial, jugadas, resultado y causa.
