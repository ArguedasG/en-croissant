# Fase 4 beta — Liga automática de bots

## Alcance implementado

La primera versión de 4.5 crea una liga automática bot contra bot usando el ciclo UCI y la
infraestructura de partidas existente. El formato es un round robin reducido: cada pareja juega el
número configurado de partidas y puede alternar colores.

Cada participante conserva:

- `profileId`, nombre, ELO objetivo, versión de perfil y versión del catálogo;
- configuración Maia completa, repertorio, timing, opciones UCI y semilla;
- configuración de reloj y semilla efectiva por partida.

Cada liga se guarda separada de los experimentos del generador y del historial humano en
`bot-leagues-v1`. El paquete incluye `league.manifest.json`, `results.json`, `standings.json`, un
manifiesto por partida, PGN, logs y los intentos no principales cuando hubo reintentos.

La liga se abre desde un botón dentro del Model Game Generator, no desde una sección independiente
de la pantalla principal. Permite seleccionar bots, fijar semillas, alternar colores, definir
partidas por pareja, reloj, reintentos, concurrencia y presupuestos de CPU/Hash. También permite
pausar, cancelar, consultar posiciones, abrir PGN en análisis, cargar ligas guardadas y exportar el
paquete. En ambos flujos beta los bots juegan a velocidad estándar, sin pausas de pensamiento humano.

## Interpretación de resultados

La tabla muestra resultados totales, resultados por color y una estimación de fuerza relativa. Esta
estimación usa el porcentaje de puntuación y los ELO objetivo de los oponentes; es una métrica
interna para ordenar versiones y detectar incoherencias. No es un ELO oficial y no se presenta como
equivalente a Lichess, FIDE u otra plataforma.

No es necesario analizar todas las partidas con Stockfish para aprobar esta fase. Stockfish puede
usarse después para estudios de calidad de juego o errores, pero la validación de 4.5 debe comprobar
primero que el experimento sea reproducible y que sus resultados y artefactos sean correctos.

## Validación manual mínima

1. Abrir `Liga de bots` desde una pestaña nueva y seleccionar un Maia 3 instalado.
2. Ejecutar 4–6 bots, 2 partidas por pareja, colores alternados y una semilla conocida.
3. Confirmar que el total coincide con `n × (n − 1) / 2 × partidasPorPareja`.
4. Comprobar en los manifiestos que las parejas alternan color y que las semillas cambian de forma determinista.
5. Revisar la tabla, incluyendo W/D/L, B/N y estimación relativa.
6. Abrir al menos un PGN, exportar el paquete y comprobar que contiene configuración, resultados,
   manifiestos y artefactos.
7. Cancelar una liga adicional y confirmar que queda marcada como cancelada sin bloquear el cierre de la aplicación.

La Fase 4 se considera cerrada como beta con las pruebas automatizadas del fixture y de la tabla.
La visualización en vivo, los torneos donde participa el usuario, la expansión del catálogo y los
filtros avanzados quedan fuera de esta beta y se trasladan a la Fase 10.
