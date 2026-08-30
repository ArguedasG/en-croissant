# Revisión del proyecto y preparación de la Fase 7

Fecha: 2026-08-28. Alcance: revisión del árbol de trabajo actual, incluida la implementación local
todavía sin commit. No se implementó ninguna funcionalidad de la Fase 7 ni se modificó código de
producto durante esta revisión.

Nota posterior: el usuario autorizó implementar 7.0 y aclaró el alcance de los informes. El resultado
de ese trabajo, sus mediciones y pendientes están en `database-queries-phase-7-0.es.md`. Las cifras y
hallazgos que siguen describen la revisión anterior a esa implementación.

## Dictamen

**Existe una base suficiente para comenzar 7.0 como siguiente trabajo técnico, pero no para afirmar
que todo lo anterior está cerrado o que 7.1 ya puede construirse sobre consultas fiables y escalables.**
Conviene cerrar la comprobación manual de 6.8 y resolver los pendientes de corrección de consultas al
principio de 7.0. Los pendientes de empaquetado y contenido deben seguir explícitos hasta la alpha.

La autorización de esta conversación abarca la revisión y el ajuste documental de 7.1, no el inicio
de implementación de 7.0, 7.1 o Player Analysis.

## Opinión sobre el proyecto y el roadmap

El proyecto tiene una dirección coherente: motores y experimentos reproducibles, entrenamiento
especializado y, después, análisis de bases que pueda alimentar la preparación. La separación entre
Maia, motores de referencia y resultados humanos evita conclusiones engañosas. También son acertados
la privacidad local, la conservación del PGN fuente y la separación entre Táctica, Aperturas y Finales.

La conexión más valiosa para el siguiente incremento es **posición → informe → partida o variante
de referencia → repertorio/entrenamiento**. Ya existen piezas para completarla sin crear otro sistema
de partidas modelo ni otro tablero.

El riesgo principal es acumular amplitud antes de consolidar el producto: conviven pantallas de
entrenamiento anteriores y V2, el roadmap mezcla requisitos de producto con historia de decisiones,
y algunos documentos antiguos aún llaman pendientes a funciones ya implementadas. Por ejemplo, la
decisión 56 y el documento original de 6.1 conservan referencias a una biblioteca modelo pendiente,
mientras que 6.8 y el código actual ya la incluyen. La tabla resumida de bots también conserva seis
perfiles aunque el catálogo actual contiene quince. Estos son desfases documentales, no pruebas de
que esas funciones falten.

Recomiendo mantener el orden 7.0 → 7.1 → alpha y no incorporar Player Analysis, expansión de bots ni
colaboración online al alcance de los informes. Cada entrega necesita criterios observables de
corrección, rendimiento y uso, además de compilar.

## Estado de lo anterior

| Área | Evidencia y conclusión |
| --- | --- |
| Fases 0–3 | Integración UCI, perfiles, manifiestos, lotes, registro y análisis existen. Sus regresiones relevantes pasan. La validación con motores reales consta en los documentos previos; no se repitió aquí. Calibración profunda y hashes de binarios siguen diferidos. |
| Fase 4 | Catálogo de quince perfiles, repertorios y liga reducida presentes. Cerrada como beta, sin equivalencia con fuerza o estilos calibrados ni torneos jugables. |
| Fase 5 | Diferida expresamente hasta después de 7.0–7.1; no es un prerrequisito numérico pendiente antes de 7.0. README, identidad y metadatos de distribución todavía pertenecen a En Croissant. |
| Fase 6, entrenamiento | Las tres áreas, importación, progreso y gestores están implementados. Persisten validación manual consolidada, revisión de migraciones y preparación de objetivos incluidos de Finales. |
| 6.6 | Cancelación por solicitud, LRU y observabilidad implementadas; sus pruebas pasan. No está cerrada la prioridad/cancelación del trabajo de cobertura ni la comprobación nativa y empaquetada con la base grande. |
| 6.7 | Shell centrado en tablero y regresiones de pestañas presentes. Pendientes las últimas pruebas nativas, teclado, escalado, ventana estrecha y uso con una persona nueva. |
| 6.8 | Incorporación a repertorios, biblioteca modelo, Guardar como/Exportar, avance táctico y ES/EN implementados y cubiertos automáticamente. Sigue pendiente la matriz manual de `training-phase-6-8.es.md`. |
| Fase 7 | No hay implementación específica de Opening Reports. El explorador y Games son infraestructura previa reutilizable. |

En Finales hay un pendiente material, no solo de documentación: `addEndgameSet` inicializa objetivos
como `unknown`, y `installBundledEndgameSets` utiliza ese camino. El cálculo/edición del contenido
incluido se oculta fuera de desarrollo. Una instalación limpia no hereda objetivos preparados en el
almacenamiento local del desarrollador; hace falta una fuente versionada de objetivos para la
distribución. Véanse `src/utils/trainingAreas.ts:1584`, `:1619` y
`src/components/training/EndgameTrainingV2Page.tsx:567`. No bloquea diseñar 7.0, pero sí declarar
terminado el contenido de Finales para terceros.

## Comprobaciones ejecutadas en esta revisión

| Comprobación | Resultado |
| --- | --- |
| `npm.cmd test` | 21 archivos, 144 pruebas aprobadas. |
| `npm.cmd run lint` | TypeScript correcto; lint global con 44 avisos y cero errores. No confundir con el lint focalizado de 6.8. |
| `npm.cmd run i18n:check` | 1.470 claves en ES y EN; sin claves faltantes, diferencias de interpolación ni texto de entrenamiento detectado fuera de traducciones. No valida calidad lingüística ni todos los textos dinámicos. |
| `npm.cmd run build-vite` | Correcta; avisos de tamaño del bundle y tiempo de plugins. JavaScript principal de aproximadamente 5,17 MB, 1,56 MB comprimido. |
| `cargo test --offline --manifest-path src-tauri/Cargo.toml` | 72 aprobadas, 8 fallidas y 6 omitidas. |

Los ocho fallos Rust reproducen antecedentes documentados: siete pruebas de evaluación heurística
en `chess.rs` y `get_move_after_exact_match_test`. Este último espera `e5` desde una FEN que omite
el turno de negras: el fixture debe corregirse o aclararse; el fallo no demuestra por sí solo que
una FEN completa falle. Las pruebas de cancelación/LRU, PGN, protocolo UCI simulado, manifiestos,
lotes y métricas pasan. Las omitidas incluyen auxiliares de motores simulados, motores externos y
benchmarks que requieren rutas configuradas.

No se ejecutaron pruebas de interfaz nativa, instalador, motores reales ni un nuevo benchmark sobre
Gigabase. El tiempo de 28,641 s y la latencia de cancelación registrados en 6.6 son mediciones
históricas en debug, no resultados de esta revisión ni objetivos de aceptación para release.

## Hallazgos para el inicio de 7.0

### 1. Corregir el universo de las estadísticas

`src-tauri/src/db/search.rs:662` suma `Other` y `None` a tablas. Así, una partida con resultado `*`
o sin resultado mejora artificialmente la tasa de tablas y altera las puntuaciones. El informe debe
separar victorias, tablas, derrotas y desconocidos; indicar qué denominador utiliza cada porcentaje.
También debe definir tratamiento de fechas/ELO ausentes, duplicados y partidas que terminan justo
en la posición consultada.

### 2. Definir una identidad ajedrecística de posición compartida

`src-tauri/src/db/search.rs:301` compara tablero y turno, sin derechos de enroque ni captura al paso.
Puede agrupar estados con movimientos legales diferentes. Para informes por posición propongo
tablero + turno + derechos de enroque + captura al paso legal, sin contadores FEN. Debe conservarse
el orden de jugadas como dato separado para estudiar transposiciones y elegir el nodo de la partida.
Esta propuesta para consultas no cambia la política de fusión de PGN de 6.8.

### 3. Completar prioridad y cancelación de cobertura

Desmontar el panel evita iniciar nuevos efectos desde él, pero no detiene una promesa ya lanzada.
`RepertoireInfo.tsx:135` llama a `computeTreeCoverage` sin señal de cancelación; el recorrido de
`src/utils/repertoire.ts:20` puede continuar consultando después de salir. Usa el identificador
global `coverage-calc`; la consulta visible del constructor usa `build-tab`. No hay prioridad
explícita en el semáforo de búsqueda. Es un pendiente funcional de 6.6 que debe integrarse en el
coordinador de consultas de 7.0, con propietarios y cancelación reales.

### 4. Hacer escalable y recuperable la construcción del índice

El índice `.ecsi` actual contiene entradas por partida y jugadas comprimidas; no es un índice
invertido por posición. Cada consulta recorre las entradas y reproduce movimientos candidatos.

`generate_search_index`, en `src-tauri/src/db/mod.rs:726`, carga todas las partidas en un `Vec`,
construye otro contenedor y serializa el índice completo. La regeneración automática no recibe la
señal de cancelación de la búsqueda. Por tanto, el camino de consulta con índice caliente y el de
primera construcción tienen perfiles de memoria/cancelación diferentes.

Además, `src-tauri/src/db/search_index.rs:224` verifica la cabecera y accede al cuerpo mediante
`rkyv::access_unchecked`; `is_valid` solo comprueba la cabecera. Un cuerpo corrupto no tiene una
validación estructural segura antes de su uso. La vigencia depende de fechas de modificación, no de
una identidad estable del dataset. Se necesitan construcción por bloques, publicación segura,
validación del cuerpo, recuperación y huella/versionado antes de prometer robustez ante corrupción.

No propongo elegir ya un formato nuevo: comparar alternativas con medidas de latencia, memoria,
espacio y tiempo de indexación. Medir P50/P95 en varias posiciones y selectividades, con caché fría
y caliente, e incluir cancelación durante reconstrucción.

### 5. Reutilizar Games con paginación real y navegación al nodo

`search.rs:574` conserva como máximo 500 partidas seleccionadas por ELO y después hidrata sus PGN.
`GamesTable.tsx:22` divide esa muestra en páginas de veinte en el navegador; `totalRecords` es el
tamaño de la muestra, no el total de coincidencias.

La apertura ya conserva base e identificador, pero no pasa la posición coincidente al crear la
pestaña (`GamesTable.tsx:48`). `createTab` ya acepta `position`; hay infraestructura reutilizable.
Faltan cursor/paginación backend, metadatos sin PGN hasta abrir, orden estable con desempate, evento,
continuación, filtros adicionales y distinción clara entre total y muestra.

Stats y Games ya comparten `openingData` en `DatabasePanel`; no hace falta una consulta nueva por
cambiar entre esas dos pestañas. El problema es que la respuesta actual entrega agregado y PGN de
la muestra juntos. El informe no debe calcular métricas de todo el universo usando esas 500 partidas.

## Reproducibilidad del repositorio

Hay numerosos cambios locales y archivos nuevos previos a esta revisión; no se hicieron commits ni
se alteraron exclusiones. `PROJECT_ROADMAP.md` está excluido localmente en `.git/info/exclude`.
La regla `tests/` de `.gitignore` también deja fuera `src/utils/tests/training.test.ts` y
`src/utils/tests/trainingAreas.test.ts`, que sí participan en las 144 pruebas locales. Antes de
declarar una base reproducible en CI conviene separar exports/fixtures privados de pruebas de
código publicables y verificar qué debe versionarse. La exclusión puede ser intencional: no se
modificó ni se incorporó contenido privado.

El workflow de pruebas actual ejecuta lint y frontend, pero no Rust. Conviene resolver/clasificar
los fallos históricos e incorporar una comprobación backend adecuada antes de aceptar cambios de
consultas. No se investigó aquí toda la deuda del lint ni se ejecutó el flujo completo `lint:ci`.

## Enfoque recomendado de 7.1

**Cambio confirmado:** Games es la lista de partidas; no se exige otra debajo de las estadísticas.
El reporte debe ofrecer una síntesis ajedrecística de la posición con acceso a su evidencia.

ChessBase documenta evolución histórica, jugadores, resultados, continuaciones, líneas principales
y críticas y planes. Scid vs. PC documenta órdenes de jugadas, temas, una tabla de teoría y enlaces
que abren partidas o filtran el conjunto. Las dos referencias respaldan un informe más rico que una
tabla de frecuencia/WDL. Fuentes: [ChessBase, Opening report](https://help.chessbase.com/cbase/17/eng/openings_report.htm)
y [Scid vs. PC, Reports](https://scidvspc.sourceforge.net/doc/Reports.htm).

Propuesta de primera entrega, aún por concretar con el usuario:

- Cabecera con posición, base, versión/huella, filtros, fecha de generación y tamaño de muestra.
- Resumen W/D/L, puntuación, rating, evolución temporal y jugadores frecuentes/fuertes.
- Continuaciones y tabla de teoría con ramas principales, transposiciones y partidas de respaldo.
- Partidas representativas seleccionadas por criterios visibles; no llamar «mejores» a las de mayor
  ELO sin explicar el criterio. Reutilizar la incorporación a partidas modelo de 6.8.
- Enlaces a Games con filtros y apertura en el nodo exacto, sin copiar masivamente partidas.
- Guardado/exportación del informe y referencias PGN si se incluyen en el alcance inicial.

Una rama con mejor puntuación histórica no equivale a la mejor jugada según un motor. «Novedad»
debe significar nueva en la base/periodo consultado, no novedad universal. Los temas, planes y finales
típicos pueden ser una entrega adicional con heurísticas explícitas y partidas de evidencia; no
conviene prometer explicaciones estratégicas automáticas sin definir cómo se obtienen.

## Preguntas que cambian el alcance

1. ¿La primera versión debe incluir ya temas estratégicos, planes y finales típicos, además del
   informe estadístico y la tabla de teoría? Recomiendo empezar por estos últimos y las transposiciones.
2. ¿El primer informe debe trabajar solo con bases locales o también con Lichess? Recomiendo bases
   locales primero para poder consultar partidas y conservar procedencia de forma reproducible.
3. ¿Guardar/exportar el informe es un requisito inicial? Propongo HTML para el informe y PGN para
   partidas/variantes; PDF puede añadirse después si se necesita.

Estas preguntas no impiden corregir las consultas de 7.0; sí afectan el alcance final de 7.1.
