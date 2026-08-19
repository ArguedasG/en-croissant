# Experiment Analysis — Fase 3.3

## Alcance

La primera entrega empírica compara la predicción W/D/L de Maia en la posición inicial de un
experimento guardado con los resultados observados en sus partidas completadas. Reutiliza el
Model Game Generator: primero se genera un lote pequeño, preferiblemente Maia contra Maia para
estudiar comportamiento humanoide, con colores alternados y semillas distintas; después se
ejecuta el benchmark desde el historial del experimento. Maia contra Stockfish limitado se puede
conservar como control de resistencia frente a juego objetivo, pero no como equivalente de
resultados humanos.

Esta entrega no afirma que Maia esté calibrada contra jugadores humanos ni convierte el ELO de
Maia en un ELO de Chess Lab. Es una comprobación inicial de si la predicción del modelo se parece
al resultado observado bajo un protocolo concreto.

## Qué calcula

- predicción W/D/L de Maia para la posición inicial, desde la perspectiva de blancas;
- W/D/L observado en las partidas completadas del experimento;
- intervalos de confianza de Wilson del 95% para cada resultado observado;
- error absoluto medio entre la predicción y las frecuencias observadas, en puntos porcentuales;
- Brier score multiclase, donde un valor menor es mejor;
- configuración del motor, ELO, límite y opciones UCI persistidas en el resultado.

El resultado se guarda junto al experimento como `empirical-wdl-v1.json`. La predicción se
obtiene de una búsqueda UCI de Maia sobre la posición inicial; no se ejecutan partidas nuevas al
pulsar el benchmark.

## Protocolo básico recomendado

1. En **Model Game Generator**, configura Maia contra Maia al ELO que quieras estudiar.
2. Usa al menos 4 partidas para la primera prueba, activa **Alternar colores** y utiliza semillas
   diferentes.
3. Mantén constante la posición inicial, el límite del rival y el resto de la configuración.
4. Cuando el lote termine, abre el experimento desde el historial.
5. En **Empirical W/D/L benchmark**, selecciona Maia, elige su ELO y ejecuta el benchmark.
6. Compara el W/D/L predicho, el observado, los intervalos y los dos indicadores de error.

Con cuatro partidas los intervalos serán muy amplios; sirven para comprobar el flujo, no para
extraer conclusiones. La muestra debe crecer antes de juzgar la utilidad del W/D/L.

## Límites

El benchmark mide resultados de partidas generadas por los motores configurados, no resultados de
una población humana. Maia contra Stockfish puede mostrar una señal útil de consistencia, pero el
rival, el límite, la posición y el protocolo afectan directamente el resultado. La calibración
humana requerirá posteriormente partidas humanas o un dataset externo con posiciones y resultados
observados, además de análisis por posición, ELO, color y fase. Las referencias de Lichess usadas
en la validación actual son una comparación útil, pero mezclan contextos y no sustituyen una
validación estadística amplia.

## Validación manual realizada

- [x] Confirmar que el panel solo ofrece motores Maia y conserva el ELO seleccionado.
- [x] Ejecutar lotes con colores alternados y comprobar que el benchmark usa solo partidas
  completadas.
- [x] Verificar que W/D/L predicho y observado se muestran desde la perspectiva de blancas.
- [x] Confirmar que una ejecución posterior recupera `empirical-wdl-v1.json` sin repetirla.
- [x] Repetir con otros ELO y observar que la predicción puede cambiar; no exigir que el cambio sea monotónico
  en una sola posición.

La validación cubre el alcance exploratorio de la fase. La calibración estadística con muestras
mayores y más posiciones queda como trabajo posterior.
