# Auditoría de motores UCI — Fase 1.1

Esta fase verifica que las partidas de motores no pierdan fuerza por errores de integración. No
calibra ELO ni convierte un motor fuerte en un bot humano.

## Resultado de la anomalía original

La jugada débil observada anteriormente en una partida Stockfish 18 contra Stockfish 18 no pudo
reproducirse. El 15 de agosto de 2026 se repitieron dos pruebas con procesos separados por color,
un hilo y 16 MB de Hash:

- partida sin reloj a profundidad 24;
- partida blitz 3+2.

Ambas se comportaron normalmente. El incidente queda cerrado como **no reproducido**. Si vuelve a
ocurrir, se deben exportar antes de iniciar otra partida el PGN, los logs de ambos colores y las
opciones completas del motor.

## Garantías del flujo de partida

Para cada color Chess Lab:

1. crea un proceso independiente;
2. completa `uci`/`uciok` e `isready`/`readyok`;
3. aplica las opciones guardadas;
4. fuerza `MultiPV=1` durante juego;
5. configura `UCI_Chess960` según la posición;
6. envía `ucinewgame` y espera un nuevo `readyok` después de las opciones;
7. envía la FEN inicial y todo el historial mediante `position fen ... moves ...`;
8. envía un único límite `go` de profundidad, nodos, tiempo fijo o reloj de ambos jugadores;
9. acepta únicamente el `bestmove` que después resulte legal en la posición actual.

Los relojes se expresan en milisegundos. Los valores que excedan el rango del contrato UCI interno
se saturan en lugar de truncarse y producir un tiempo pequeño por desbordamiento.

## Validación automatizada

La regresión con motor simulado comprueba el orden completo del protocolo, incluyendo opciones,
reinicio, historial, `go depth 24` y lectura de `bestmove`.

Existe además una prueba ignorada que permite auditar un motor fuerte externo contra tres posiciones
elementales. En PowerShell:

```powershell
$env:CHESS_LAB_REFERENCE_ENGINE = "C:\ruta\a\stockfish.exe"
cargo test --manifest-path src-tauri/Cargo.toml reference_engine_solves_elementary_tactical_suite -- --ignored --nocapture
Remove-Item Env:CHESS_LAB_REFERENCE_ENGINE
```

La prueba usa un hilo, 16 MB de Hash, `MultiPV=1`, fuerza ilimitada y profundidad 12. Un motor de
referencia no debe fallar consistentemente mates en una ni la captura limpia de una dama.

## Límites restantes

- Stockfish es una instalación externa y su binario o red NNUE no se distribuyen con Chess Lab.
- Los presets confiables pertenecen a la Fase 1.2.
- El manifiesto reproducible de una ejecución pertenece a la Fase 1.3.
- Los logs viven con la partida activa; para investigar una anomalía deben exportarse antes de
  reemplazarla con una partida nueva en la misma pestaña.
