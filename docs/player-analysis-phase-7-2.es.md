# Fase 7.2 — Player Analysis local y accionable

Fecha: 2026-08-29. Estado: núcleo implementado y validación automática aprobada; validación manual
nativa y empaquetada pendiente. Las fuentes principales son cuentas Lichess descargadas e
importaciones PGN que
ya forman parte de una base local. No se envían partidas, evaluaciones ni perfiles a servicios
externos.

## Flujo implementado

1. Abrir el perfil personal de una cuenta descargada o seleccionar un jugador dentro de una base.
2. Entrar en **Análisis** y elegir periodo, color, control de tiempo y rango ELO del rival.
3. Generar o recalcular el perfil descriptivo. El resultado guarda versión, fecha, fuentes, filtros,
   muestra y referencias de evidencia sin duplicar los PGN en `localStorage`.
4. Consultar resultados por color, control de tiempo, fuerza relativa, apertura/ECO, rival y año;
   abrir una partida de evidencia por su base e ID exactos en una pestaña separada, conservando el
   perfil para regresar o consultar otra evidencia.
5. Elegir un motor local distinto de Maia, cantidad de partidas recientes y tiempo acotado por
   posición. El análisis conserva ACPL, errores, fases, conversión, defensa y posiciones críticas.
6. Abrir una posición crítica en su ply o añadirla a un set táctico propio. Si no existe un set
   embebido seleccionable, se puede crear **Mis errores tácticos** desde la primera posición.

## Contrato y reproducibilidad

- `player-analysis-v1` conserva perfiles locales con `schemaVersion: 2`, fuente, jugador, filtros,
  fecha de cálculo, agregados y referencias. Se puede desactivar todo el perfil, recalcularlo o
  borrarlo. La versión 2 invalida los perfiles anteriores para recalcular correctamente nombres de
  apertura desde las jugadas cuando falta la cabecera ECO.
- El motor se registra con nombre, ruta, argumentos, opciones UCI y límite. Maia se excluye de las
  métricas objetivas.
- El análisis de motor usa las partidas más recientes dentro de la muestra filtrada. El usuario
  puede elegir la cantidad en pasos de cinco o analizar explícitamente toda la muestra. El valor
  predeterminado es 10 partidas y 250 ms por posición; no se inicia automáticamente al importar.
- Los resultados por partida se reutilizan cuando coinciden partida, motor y límite. Una ejecución
  cancelada conserva lo ya terminado y puede continuar después. El proceso activo recibe la misma
  cancelación cooperativa que el análisis de partidas existente.
- ACPL y clasificación usan únicamente las jugadas del jugador. Los umbrales reproducen el pipeline
  existente: 40 cp para inexactitud, 100 cp para error y 200 cp para error grave.
- Apertura/medio juego/final se clasifican mediante ply, damas y cantidad de piezas no peón. Es una
  heurística declarada, no una segmentación teórica perfecta.
- Una partida ofrece oportunidad de conversión si el jugador alcanza al menos +150 cp al inicio de
  uno de sus turnos; cuenta como convertida si gana. Una partida inferior usa -150 cp y se considera
  salvada si termina en victoria o tablas. Estas métricas dependen del motor y presupuesto elegidos.
- Los errores recurrentes agrupan al menos dos posiciones por fase, severidad y ECO. Todavía no se
  les asigna automáticamente un motivo táctico o estratégico.
- Si una partida no contiene cabecera ECO, el backend recorre su línea principal y conserva el
  nombre de apertura más profundo reconocido por el catálogo local. El nombre derivado se usa en
  estadísticas, hallazgos y agrupaciones de errores del motor.

## Integración con Táctica

`training-areas-v1` migra al esquema 9. Cada ejercicio creado desde Player Analysis conserva:

- base e ID de la partida;
- ply exacto anterior al error;
- pérdida en centipeones y clasificación;
- FEN y variante principal propuesta por el motor;
- etiquetas `player-analysis`, fase y severidad.

**Añadir al set** solo modifica sets propios embebidos. Los sets enlazados a un PGN y el contenido
incluido permanecen inmutables. Se deduplica la misma base, partida y ply dentro de un set. Esta
procedencia prepara una ampliación que construya y mantenga automáticamente un set de errores
tácticos, pero esa automatización no forma parte del núcleo actual.

## Alcance y límites actuales

- La estadística descriptiva pagina todas las partidas del jugador, pero el comando histórico
  `getGames` hidrata su movetexto. Es suficiente para cuentas personales normales; una ampliación
  deberá separar metadatos de PGN para perfiles con cientos de miles de partidas.
- Aperturas se agrupan inicialmente por ECO almacenado. La agrupación por posición crítica,
  desviaciones de repertorio y enlace directo a un Opening Report específico pasan a mejoras.
- No se calcula todavía administración del tiempo: la base normalizada no expone de forma uniforme
  los comentarios `[%clk]`. Debe declararse la cobertura antes de mostrar esa métrica.
- No se asignan motivos como horquilla, clavada, sobrecarga o debilidad estratégica sin un
  clasificador verificable. Las posiciones críticas sí quedan disponibles para revisión y sets.
- No hay aún análisis incremental automático al descargar nuevas partidas, exportación HTML/JSON,
  comparación entre periodos entrenados ni tablebases dentro de Player Analysis.
- La prueba manual debe cubrir cuenta Lichess, PGN genérico con alias, cancelación y continuación,
  reapertura de evidencia, borrado, ausencia de motor, set táctico existente/nuevo y build
  empaquetada.

## Fase posterior de mejora

Los pendientes de 7.1 y 7.2 se concentran en 7.3 en vez de dispersarse entre ambas fases. Incluyen
interpretación estratégica de informes, planes y finales típicos, fuente Lichess remota para
Opening Reports, biblioteca persistente, novedades/desviaciones, filtros de evento/ritmo,
metadatos paginados de Player Analysis, relojes, motivos tácticos/estratégicos, tablebases,
sincronización incremental, set táctico automático y medición longitudinal del entrenamiento.

## Validación ejecutada

- 178 pruebas frontend aprobadas en 28 archivos, incluidas métricas, filtros, evidencia, migración y
  deduplicación del ejercicio táctico;
- 53 pruebas del módulo de base de datos Rust aprobadas y cuatro omitidas por estar marcadas como
  ignoradas;
- `tsgo --noEmit --incremental false`, lint focalizado y auditoría de traducciones aprobados;
- 1.648 claves coincidentes en inglés y español, sin claves o placeholders ausentes;
- build web aprobada. La prueba manual en Tauri con una cuenta real, un motor local y una build
  empaquetada sigue siendo requisito del corte de presentación.
