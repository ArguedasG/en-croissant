# Experiment Analysis — Fase 3.1

## Alcance

La primera entrega de Experiment Analysis analiza la posición seleccionada en el panel de
análisis usando los motores locales que el usuario haya configurado. Se pueden activar Maia 3 y
Stockfish al mismo tiempo, pero sus resultados se presentan por separado:

- Maia muestra las probabilidades W/D/L que entrega su salida UCI. Son una predicción del modelo
  sobre el resultado humano esperado, no una probabilidad empírica ni una evaluación objetiva.
- Stockfish conserva su evaluación objetiva en centipeones o mate, junto con profundidad, nodos y
  variantes principales.

El análisis sigue usando el flujo UCI y el almacenamiento de configuración existente. No se
introducen simulaciones adicionales, partidas ficticias ni un segundo administrador de motores.

## Control de ELO de Maia

Al abrir los ajustes de una instalación Maia 3 en el panel de análisis aparece un control de ELO
entre 600 y 2600. El valor se envía como la opción UCI `Elo` y se conserva con la configuración
del motor cuando los ajustes están sincronizados.

El valor sigue siendo un objetivo solicitado al modelo. No debe interpretarse como una fuerza
calibrada de Chess Lab.

## Validación manual pendiente

1. Registrar una instalación Maia 3 y una instalación Stockfish.
2. Abrir una posición no terminal desde una partida o FEN.
3. Activar ambos motores y confirmar que Maia muestra W/D/L y Stockfish muestra Eval.
4. Cambiar el ELO de Maia y confirmar que se envía `setoption name Elo value ...` en los logs.
5. Comprobar que desactivar un motor detiene su búsqueda sin afectar al otro.
6. Confirmar que el panel no llama a simulaciones ni crea artefactos de experimentos.

## Fuera de alcance

El análisis de partidas completas, ACPL por jugador, posiciones críticas, comparación estadística,
intervalos de confianza y simulaciones emparejadas quedan para entregas posteriores de la Fase 3.
