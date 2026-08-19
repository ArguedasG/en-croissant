# Bots humanos — Fase 3

**Estado: Cerrada para su alcance de observabilidad el 18 de agosto de 2026.**

Esta fase añade observabilidad para calibrar los perfiles y un modelo inicial de tiempo de reflexión humano. El objetivo todavía no es declarar calibrados el ELO, el repertorio ni los tiempos, sino producir datos comparables para poder ajustarlos con evidencia.

## Profundidad teórica configurada y observada

Cada perfil conserva el límite máximo de repertorio definido en la Fase 2. Luna tiene un máximo de 12 plies y Leo de 16, pero ese límite no garantiza que una partida alcance esa profundidad: la elección del jugador puede abandonar antes todas las líneas compatibles.

Al finalizar una partida contra un bot humano se registran, entre otros datos:

- perfil, nivel, muestreo y repertorio;
- número total de jugadas del bot;
- jugadas elegidas por el repertorio del perfil;
- jugadas elegidas por Maia o por un libro Polyglot;
- última ply y último turno del bot cubiertos por su repertorio;
- primera ply y primer turno del bot resueltos por Maia;
- tiempo de reflexión medio y máximo observado.

La pantalla de configuración muestra un resumen por perfil con partidas registradas, media de jugadas teóricas y tiempo medio de reflexión. Las mediciones se guardan localmente, se limitan a las 1000 partidas más recientes y se pueden exportar como JSON o CSV.

La media de jugadas teóricas cuenta únicamente los turnos del bot procedentes de `profileRepertoire`. Es una medida observada y depende tanto del repertorio como de las respuestas del rival. Por eso, para comparar Luna y Leo conviene alternar colores, usar el mismo control de tiempo y repetir aperturas o posiciones iniciales comparables.

Como primera muestra útil se recomiendan al menos 30 partidas por perfil; 50 o más reducirán bastante el efecto de una desviación casual. Que Luna tenga una media menor que Leo sería coherente con el diseño, pero los resultados servirán para decidir si hay que modificar límites, líneas o pesos.

## Tiempo de reflexión humano

La opción **Tiempo de reflexión humano** aparece al seleccionar un bot humano y está activada por defecto. Se puede desactivar para pruebas rápidas.

Cada perfil tiene una distribución inicial diferente:

| Perfil | Mínimo | Media objetivo | Máximo | Tiempo de repertorio |
| --- | ---: | ---: | ---: | ---: |
| Luna | 0,45 s | 1,20 s | 3,50 s | 45 % |
| Nico | 0,50 s | 1,45 s | 4,20 s | 43 % |
| Vera | 0,60 s | 1,75 s | 5,20 s | 40 % |
| Marcos | 0,65 s | 2,00 s | 6,00 s | 38 % |
| Irene | 0,70 s | 2,25 s | 6,80 s | 35 % |
| Leo | 0,75 s | 2,50 s | 7,50 s | 32 % |

No son pausas fijas. El tiempo objetivo varía aleatoriamente y se ajusta según la fase de la partida, la cantidad de jugadas legales y si el rey está en jaque. Las jugadas conocidas del repertorio suelen ser más rápidas; una decisión de Maia puede incluir ocasionalmente una pausa mayor.

Con reloj, el modelo limita la pausa según el tiempo restante y el incremento. Cuando quedan 150 ms o menos no añade espera, y nunca espera deliberadamente hasta consumir ese pequeño margen. El cálculo real de Maia cuenta como parte de la reflexión: si el motor ya tardó más que el objetivo, la jugada se envía inmediatamente.

## Trazabilidad

Cada jugada enviada al frontend identifica su origen como:

- `human`;
- `engine` (Maia);
- `profileRepertoire`;
- `polyglot`;
- `initial`.

También incluye el tiempo total observado desde que comenzó la decisión hasta que se aplicó la jugada del motor. Las partidas terminadas añaden al PGN cabeceras resumen como:

```text
[HumanBotConfigVersion "3"]
[BlackBotTiming "casual-fast"]
[BlackBotMoves "18"]
[BlackBotRepertoireMoves "3"]
[BlackBotRepertoireLastPly "6"]
[BlackBotFirstMaiaPly "8"]
[BlackBotAverageThinkMs "1194"]
[BlackBotMaxThinkMs "2410"]
```

Los valores exactos variarán en cada partida. Un guion en `BlackBotRepertoireLastPly` o `BlackBotFirstMaiaPly` significa que no hubo ninguna jugada de ese origen.

Este ejemplo conserva la versión de trazabilidad de la Fase 3. La Fase 4.1 la incrementa a `5` y
añade versiones de perfil, catálogo, repertorio, modelo y ejes editoriales; el contrato actualizado está documentado
en `human-bots-phase-4-1.es.md`.

## Prueba manual recomendada

1. Reinicia la aplicación después de compilar esta versión.
2. En **Jugar**, selecciona **Bot humano** y confirma que **Tiempo de reflexión humano** esté activado.
3. Juega una partida completa contra Luna. Sus jugadas deberían tener pausas cortas y variables, no una demora idéntica en cada turno.
4. Repite con Leo y comprueba que, en conjunto, suele ser más deliberado. Una sola jugada o partida no basta para comparar distribuciones.
5. Desactiva la opción e inicia otra partida: Maia ya no debería recibir pausas artificiales, aunque se seguirá registrando su tiempo real de cálculo.
6. Termina una partida y vuelve a la configuración. En **Mediciones de calibración** debería aumentar el contador y aparecer el resumen del perfil.
7. Exporta JSON y CSV, y confirma que contienen una fila o registro para la partida.
8. Exporta el PGN terminado y comprueba las cabeceras `BotTiming`, `BotRepertoireMoves`, `BotAverageThinkMs` y relacionadas.
9. Prueba un control muy corto para confirmar que el bot reduce sus pausas cuando queda poco tiempo.

## Validación automatizada

- Las pruebas Rust comprueban la serialización exacta de la configuración, que las jugadas de repertorio tengan un objetivo temporal menor que las de Maia y que se conserve un margen cuando queda poco reloj.
- Las pruebas TypeScript comprueban las métricas observadas, cabeceras PGN, exportación CSV y agregación por perfil.
- El lint verifica el contrato TypeScript generado entre Rust y el frontend.

## Límites conocidos

- Los tiempos son una primera heurística editorial, no distribuciones aprendidas de partidas humanas.
- La media mostrada no controla por apertura, color, rival ni duración de la partida; el CSV permite hacer comparaciones más cuidadosas.
- Las partidas abandonadas antes de que el backend emita un resultado final no se registran.
- El ELO mostrado continúa siendo un objetivo de Maia, no una fuerza calibrada contra una población de jugadores.
- Esta fase produce la evidencia necesaria; los ajustes estadísticos de repertorios, tiempos y ELO
  corresponden a la Fase 4. La fase queda cerrada sin afirmar todavía que esos componentes estén
  calibrados.
