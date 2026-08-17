# Model Game Generator — Fase 2.3

Esta fase convierte las ejecuciones del generador en experimentos locales durables. Tanto una partida individual como un lote crean automáticamente un registro versionado; ya no es necesario exportar cada partida manualmente para conservarla.

## Dónde encontrar los experimentos

En la configuración de **Model Game Generator** aparece la tarjeta **Experimentos de partidas modelo**. Desde **Ver experimentos** se puede:

- consultar ejecuciones anteriores después de reiniciar la aplicación;
- abrir un experimento y ver sus partidas por separado;
- abrir cualquier PGN disponible en una pestaña normal de análisis;
- exportar la carpeta completa del experimento;
- eliminar un experimento con confirmación.

Mientras un lote sigue visible, el icono de análisis de cada resultado terminado abre directamente esa partida. Analizar una partida crea una copia de trabajo en una pestaña normal; las anotaciones no sobrescriben silenciosamente el artefacto original.

## Almacenamiento local

Los datos se guardan bajo `model-game-experiments-v1/<id>` dentro del directorio privado de datos de la aplicación:

```text
<experimento>/
├── experiment.manifest.json
├── results.json
├── metrics.json
├── games/
│   ├── game-0001.pgn
│   └── game-0001.manifest.json
├── logs/
│   ├── game-0001-white.json
│   └── game-0001-black.json
└── attempts/
    └── game-0001-attempt-1/
        ├── manifest.json
        ├── white.log.json
        └── black.log.json
```

El manifiesto de experimento utiliza `schemaVersion: 1` y conserva la configuración completa del lote o de la ejecución individual. Cada partida final conserva además el manifiesto reproducible de la Fase 1.3.

Los intentos que terminan por abandono antes de un reintento conservan sus manifiestos y logs en `attempts/`. Un error ocurrido antes de que exista un proceso UCI queda registrado en `results.json`, aunque no puede producir PGN ni logs de motor.

## Resultados y métricas

`results.json` registra índice, jugadores, semillas, intentos, resultado, plies y errores. `metrics.json` deriva únicamente métricas descriptivas que no requieren evaluación adicional:

- tamaño de muestra terminado;
- victorias de blancas y negras;
- tablas;
- partidas fallidas;
- promedio de plies.

ACPL, errores, blunders, entropía y posiciones críticas requieren un motor evaluador y pertenecen a **Experiment Analysis — Fase 3**.

## Cancelación, cierre y recuperación

- Las partidas de un lote que ya terminaron permanecen guardadas aunque el resto se cancele.
- Una partida individual abortada se guarda con resultado `*` antes de terminar los motores.
- Para no volver a bloquear la cancelación esperando un `bestmove`, los logs de una partida abortada se capturan solo si el motor los deja disponibles de inmediato; el PGN y el manifiesto sí se conservan.
- Al cerrar la pestaña del generador se finaliza primero cualquier experimento individual activo y después se aborta su partida.
- Si la aplicación se cerró inesperadamente, al iniciar de nuevo los experimentos que seguían marcados como activos pasan a estado cancelado; no se presentan como completados.
- Un experimento activo no se puede exportar ni eliminar.

La Fase 2.3 no reanuda partidas ni lotes después de reiniciar la aplicación.

## Exportación y eliminación

**Exportar** solicita una carpeta y copia el experimento completo dentro de `chess-lab-experiment-<id>`. Para evitar una sobrescritura silenciosa, la exportación se rechaza si esa carpeta ya existe.

La exportación puede contener rutas locales de motores y modelos, datos de hardware y logs UCI. Conviene revisarla antes de compartirla públicamente.

**Eliminar** borra permanentemente la carpeta local completa del experimento después de una confirmación. Las copias exportadas previamente no se modifican.

## Límites actuales

- El registro se organiza en carpetas y manifiestos JSON; todavía no necesita una base de datos indexada.
- No hay búsqueda ni filtros por jugador, apertura, fecha o resultado.
- Las anotaciones hechas en análisis deben guardarse como un PGN normal si se desean conservar.
- Todavía no se calculan hashes criptográficos de binarios o redes; se conservan sus rutas, versiones, argumentos y opciones efectivas.
- Las métricas ajedrecísticas avanzadas y la comparación entre experimentos pertenecen a la Fase 3.

## Prueba manual mínima

1. Generar una partida individual, terminarla y volver a **Editar configuración**.
2. Abrir **Ver experimentos**, entrar en la ejecución y abrir su partida para análisis.
3. Reiniciar la aplicación y confirmar que el experimento sigue disponible.
4. Ejecutar un lote de cuatro partidas y abrir una partida desde el icono de análisis del panel de resultados.
5. Cancelar otro lote después de que termine al menos una partida y confirmar que esa partida continúa disponible en el experimento cancelado.
6. Exportar un experimento y comprobar que contiene manifiesto, resultados, métricas, PGN y logs.
7. Eliminar un experimento y confirmar que desaparece del historial sin afectar su copia exportada.
