# Model Game Generator — Fase 2.2

Esta fase añade ejecución por lotes sobre el generador individual de la Fase 2.1. El coordinador vive en el backend y mantiene el lote en memoria aunque se cambie de pestaña. Desde la Fase 2.3, las partidas terminadas se registran además como experimentos locales durables.

## Configurar un lote

En **Model Game Generator**, activar **Ejecutar un lote** y configurar:

- **Número de partidas**: entre 1 y 1000.
- **Alternar colores**: intercambia las configuraciones completas de ambos jugadores cada dos partidas, incluidos reloj, motor, opciones y semilla.
- **Incremento de semilla**: se suma a las semillas base después de cada partida programada. Con semillas 1 y 2 e incremento 1, la segunda partida utiliza 2 y 3; si además se alternan colores, esas semillas viajan con sus respectivos jugadores.
- **Concurrencia solicitada**: cantidad máxima deseada de partidas simultáneas.
- **Presupuesto de hilos de CPU**: límite agregado usado por el planificador según la opción UCI `Threads` solicitada por ambos motores.
- **Presupuesto de memoria Hash**: límite agregado usado según la opción UCI `Hash` solicitada por ambos motores.
- **Reintentos por partida**: nuevos intentos cuando un motor no inicia o abandona por un error de ejecución.

El planificador calcula una **concurrencia efectiva** que nunca supera la cantidad solicitada ni los presupuestos agregados. Por ejemplo, si cada partida necesita cuatro hilos y el presupuesto es ocho, solo se ejecutan dos a la vez aunque se hayan solicitado cuatro.

El presupuesto de Hash es una estimación de planificación. No es un límite estricto sobre toda la RAM del proceso, la memoria de la red neuronal ni la VRAM utilizada por Lc0. Tampoco se aplican afinidad de CPU o límites del sistema operativo en esta fase.

## Semillas, variedad y repetición

**Repetir configuración** en la generación individual conserva intencionalmente las mismas semillas. Maia se inicia con `--seed {{randomSeed}}`, de modo que dos ejecuciones desde la misma posición, con la misma configuración y semillas, pueden producir exactamente la misma partida. Ese comportamiento demuestra reproducibilidad, no ausencia de muestreo.

Para obtener variedad controlada en un lote, usar un incremento de semilla distinto de cero. El lote registra en memoria las semillas efectivas de cada jugador y cada partida. Una semilla solo puede controlar fuentes de aleatoriedad que el motor exponga; el hardware, la concurrencia o motores no deterministas todavía pueden producir diferencias.

## Progreso, pausa y cancelación

El panel muestra:

- partidas terminadas, activas y en cola;
- concurrencia efectiva y recursos estimados por partida;
- resultado, colores, semillas, medias jugadas e intentos de cada partida terminada;
- partidas que agotaron sus reintentos.

**Pausar** es cooperativo: las partidas ya activas pueden terminar, pero no se programan nuevas hasta pulsar **Reanudar**. Esto evita matar motores sanos y convertir una pausa en una serie de fallos artificiales.

**Cancelar lote** detiene inmediatamente las partidas activas y descarta la cola. Cambiar de pestaña no interrumpe el lote; al volver, la interfaz recupera el estado desde el backend. Cerrar la pestaña propietaria cancela el lote, y cerrar la aplicación termina todos los motores activos.

## Reintentos

Un intento se repite cuando:

- el proceso o el saludo UCI no logra iniciar;
- la partida termina por `abandonment`, que en un enfrentamiento exclusivamente entre motores representa un error de ejecución o desconexión.

Jaque mate, tablas y derrotas por tiempo son resultados válidos y no se reintentan. Los reintentos conservan posición, colores, opciones y semillas para reproducir las condiciones del intento fallido.

## Límites de esta fase

- La cola activa vive en memoria, pero sus partidas terminadas y el resumen del experimento se guardan localmente desde la Fase 2.3.
- Cerrar la aplicación no permite reanudar el lote después de reiniciarla.
- La carpeta del experimento, PGN, manifiestos, logs, resultados y métricas básicas se guardan automáticamente desde la Fase 2.3.
- No hay límites duros de CPU, RAM o GPU impuestos por el sistema operativo.
- El planificador evita oversubscription según `Threads` y `Hash`, pero otros recursos internos del motor pueden aumentar el consumo real.

## Prueba manual mínima

1. Configurar Maia contra Lc0 desde una posición concreta, activar un lote de cuatro partidas, alternar colores y usar incremento de semilla 1.
2. Solicitar concurrencia 2 con presupuestos suficientes y confirmar que el panel muestra dos partidas activas cuando ambas tardan lo suficiente.
3. Comprobar que las semillas aumentan y que los jugadores alternan colores en los resultados.
4. Pausar con partidas activas, confirmar que pueden terminar pero no se lanzan nuevas, y luego reanudar.
5. Cambiar de pestaña mientras el lote continúa y regresar para comprobar el progreso recuperado.
6. Iniciar otro lote y cancelarlo; confirmar que las activas terminan y la cola queda vacía.
7. Cerrar la pestaña durante un lote y comprobar que sus motores no permanecen ejecutándose.
8. Probar un presupuesto menor que los Threads o el Hash de una sola partida y confirmar que la aplicación rechaza la configuración con una explicación.
