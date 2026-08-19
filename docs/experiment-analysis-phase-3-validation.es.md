# Validación de Experiment Analysis — Fase 3

**Estado: Cerrada para su alcance básico el 18 de agosto de 2026.**

Las entregas 3.1, 3.2 y 3.3 están implementadas y validadas con experimentos reales. La
calibración estadística profunda queda deliberadamente fuera de este cierre y pasa a la Fase 4.

## Propósito

Esta validación comprueba tres cosas distintas:

1. que Maia produzca una predicción W/D/L razonable desde una posición;
2. que las partidas simuladas puedan compararse con una referencia humana externa;
3. que el análisis objetivo de Stockfish y las métricas de partidas funcionen como controles
   independientes.

Los resultados no deben interpretarse como una conversión directa entre el ELO de Maia, el ELO de
Stockfish y el ELO humano de Lichess.

## Experimentos realizados

| Caso | Partidas | Resultado observado desde blancas | Referencia Lichess |
| --- | ---: | ---: | ---: |
| FEN 1: Maia 1900 contra Stockfish 1900 | 20 | 45% - 0% - 55% | 47% - 7% - 46% |
| FEN 2: Maia 1600 contra Maia 1600 | 20 | 55% - 5% - 40% | 53% - aproximadamente 4% - 43% |
| FEN 3: Maia 2200 contra Maia 2200 | 20 | 40% - 30% - 30% | 46% - aproximadamente 10% - 44% |

En los tres casos se alternaron los colores y se utilizaron semillas diferentes. Las referencias
de Lichess proceden de aproximadamente 5.300, 11.000 y 37.000 partidas, respectivamente. Son una
referencia útil, aunque mezclan contextos de juego y pueden tener sesgos de selección y preparación
de apertura.

También se ejecutaron dos controles cortos contra Stockfish, según los resultados reportados:

- en la posición de Maia 2200, Stockfish 2200 obtuvo 5,5 puntos de 6;
- en la posición de Maia 1600, Stockfish 1600 ganó 4-2.

Estos dos controles sirven para confirmar que Stockfish es un rival objetivo más fuerte en este
protocolo, pero no son muestras suficientemente grandes para estimar una probabilidad precisa. En
el momento de redactar este documento, sus carpetas no aparecen entre las exportaciones completas
de `tests`.

## Predicción W/D/L de Maia

El panel W/D/L no genera partidas nuevas. Consulta la predicción de Maia desde la posición inicial
del experimento y la compara con los resultados ya guardados.

| Caso | ELO del análisis Maia | Predicción Maia | Resultado observado | MAE |
| --- | ---: | ---: | ---: | ---: |
| FEN 1 | 2500 | 43,9% - 10,0% - 46,1% | 45% - 0% - 55% | 10,0 pp |
| FEN 2 | 1600 | 51,7% - 2,6% - 45,7% | 55% - 5% - 40% | 5,7 pp |
| FEN 3 | 2200 | 47,1% - 7,2% - 45,7% | 40% - 30% - 30% | 22,8 pp |

La observación más positiva es que las predicciones de Maia se parecen bastante a las referencias
humanas de Lichess en las tres posiciones. En particular, la predicción de la tercera posición es
casi idéntica a su referencia humana, aunque las 20 partidas Maia–Maia produjeron muchas más
tablas.

Esto significa que la predicción W/D/L parece tener utilidad como señal de la tendencia de una
posición. No significa todavía que esté calibrada con precisión contra humanos: hacen falta más
posiciones, más partidas y muestras mayores.

## Cómo interpretar las diferencias

### Maia contra Maia

Es el protocolo principal para estudiar comportamiento humanoide. Ambos jugadores usan la misma
familia de modelo y el mismo ELO, por lo que evita que Stockfish domine la muestra desde una
posición temprana.

El resultado de Maia 1600 coincide muy bien con Lichess. En Maia 2200 aparecieron seis tablas de
veinte partidas, frente a aproximadamente dos tablas esperadas por la predicción W/D/L. Esto puede
deberse a la variación de una muestra pequeña o a que el self-play de Maia tenga una propensión a
tablas diferente de la población humana. No debe considerarse una refutación definitiva con solo
20 partidas.

### Maia contra Stockfish

El primer lote mostró que Stockfish 1900 no es un rival equivalente a Maia 1900. Stockfish ganó
19 de 20 partidas y el análisis objetivo registró aproximadamente ACPL 28,1 para Stockfish frente
a 44,9 para Maia.

Los controles de seis partidas confirman la misma tendencia en los otros niveles, pero deben
interpretarse como controles de fuerza, no como resultados humanos. El ELO solicitado a Stockfish
no está calibrado automáticamente con el ELO solicitado a Maia.

### Lichess

Las estadísticas de Lichess son la referencia externa más útil disponible, pero no son una verdad
objetiva de la posición. La posición puede alcanzarse después de una preparación concreta, los
jugadores pueden conocer planes específicos y los filtros mezclan distintos ritmos de juego.

## Criterio de cierre de la fase 3

La fase 3 queda validada para su alcance básico porque:

- el análisis dual Maia–Stockfish funciona;
- el análisis de partidas calcula ACPL, imprecisiones, errores y blunders correctamente;
- el benchmark empírico calcula predicción, resultados observados, intervalos de Wilson, MAE y
  Brier score;
- se validaron lotes reales con colores alternados y semillas distintas;
- Maia–Maia quedó establecido como protocolo principal para comportamiento humanoide;
- Stockfish quedó establecido como control objetivo de fuerza;
- las limitaciones de muestra y calibración están documentadas.

La calibración estadística profunda —por ejemplo, 50–100 o más partidas por condición y muchas
posiciones— queda como trabajo posterior. No es necesaria para cerrar esta primera versión de la
fase 3.
