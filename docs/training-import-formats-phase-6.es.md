# Fase 6 — Formatos reales de importación

Estado: revisión realizada el 2026-08-20 sobre ejemplos locales proporcionados por el usuario.

Los archivos de ejemplo con contenido adquirido se usan únicamente como fixtures manuales locales.
No deben copiarse al repositorio, a pruebas distribuibles ni a paquetes de la aplicación.

## Táctica

Se revisaron tres familias distintas:

1. `Ejemplo de Tácticas 1.pgn`: 7200 registros con FEN; predominan soluciones lineales cortas.
2. `Ejemplo de Tácticas 2.pgn`: 3198 registros con FEN, comentarios y numerosas subvariantes. Las
   ramas pueden representar respuestas alternativas del rival, soluciones alternativas o ejemplos
   inferiores del estudiante.
3. `Ejemplo de Tácticas 3.pgn`: 1001 registros con FEN; los primeros incluyen solución y muchos de
   los siguientes contienen solamente la posición.

Decisiones:

- los PGN grandes permanecen como fuente en disco y se leen por registro bajo demanda;
- la importación muestra el número total y una muestra antes de crear el set;
- cada set configura quién hace la primera jugada;
- las variantes pueden tratarse como línea principal, respuestas alternativas del rival o todas las
  ramas;
- el modo automático usa la solución PGN cuando existe y reserva el motor para registros sin solución;
- las posiciones sin solución no se analizan en masa durante la importación;
- el contenido con copyright adquirido por el usuario no se redistribuye.

## Aperturas

Se revisaron tres familias:

1. `Ejemplo repertorio 1.pgn`: 113 partidas con muchos comentarios y subvariantes; cada partida
   representa principalmente una variante del curso. Las ramas ilustrativas deben conservarse para
   análisis aunque se marquen como no entrenables.
2. `Ejemplo repertorio 2.pgn`: dos capítulos de estudio y numerosas subvariantes que sí pueden
   representar líneas entrenables.
3. `Ejemplo repertorio 3.pgn`: 45 partidas, comentarios, subvariantes y un grupo explícito de
   `Model Games` que debe separarse de las líneas de memorización.

Implementación actual y decisiones pendientes:

- el PGN fuente conserva comentarios, NAG, flechas y variantes para análisis;
- una copia separada de entrenamiento incluye la línea principal o todas las ramas según la política
  elegida al importar;
- la jerarquía inicial usa `ChapterName`, `White`, `Black` y `Event`; la reorganización manual queda
  pendiente;
- los capítulos cuyo encabezado identifica `Model Games` se muestran como partidas modelo,
  analizables pero no incluidas en la repetición espaciada;
- los cursos adquiridos permanecen locales y no pueden convertirse en contenido incluido.

## Finales

Los tres PGN contienen 184 registros: 180 posiciones legales de hasta siete piezas y cuatro registros
no entrenables —tres introducciones y una conclusión con tablero vacío—. Se preferirá tablebase remota
y Maia en su ELO máximo como oponente predeterminado; Stockfish será seleccionable. El estudiante
jugará inicialmente el lado al turno de la FEN y podrá abrir cualquier posición en análisis fuera de
la sesión.
