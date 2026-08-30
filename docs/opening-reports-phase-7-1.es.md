# Fase 7.1 — Informes locales de apertura

Fecha: 2026-08-28. Núcleo inicial implementado después de la autorización del usuario.
No incluye Player Analysis, interpretación estratégica ni fuentes remotas.

## Uso y alcance

1. En un tablero, elegir una base local de referencia y una posición exacta.
2. Esperar el resumen del explorador y abrir **Informe**.
3. Elegir profundidad y máximo de partidas de teoría; pulsar **Generar informe**.
4. Consultar estadísticas, continuaciones, años, franjas ELO, jugadores frecuentes y más fuertes,
   tabla de teoría, órdenes de llegada y transposiciones.
5. Pulsar un jugador para abrir todas sus coincidencias en otra pestaña **Games**; pulsar una jugada
   abre su línea y una referencia abre la partida completa en el nodo correspondiente.

El informe aparece en un modal con tablas desplazables. No se duplicó la lista de Games debajo
de las estadísticas. La apertura de una referencia conserva base, ID y ply; las variantes sintéticas
son pestañas independientes y no modifican la fuente. Los filtros del explorador (jugador por color
o cualquier color, rango ELO, fecha y resultado) definen también el universo del informe. El rango
ELO exige que ambos jugadores estén dentro del intervalo; un extremo vacío se mantiene abierto.

La exportación permite guardar HTML autónomo, un PGN con el árbol de teoría mostrado y un PGN
con hasta 20 partidas de referencia distintas. Se pide confirmación antes de reemplazar un archivo.
Cancelar o fallar al guardar no se anuncia como éxito. No se creó una biblioteca persistente de
informes: el resultado permanece en la caché de sesión; para conservarlo se exporta.

Corrección del 2026-08-29: al abrir una partida desde el Games filtrado de un jugador y cerrar luego
esa pestaña, la cancelación de la consulta desmontada podía quedar en la caché de interfaz y mostrarse
temporalmente como fallo de base. Las cancelaciones y sustituciones de ciclo de vida ahora conservan
la página previa, se reintentan una vez al restaurar la pestaña y no se presentan como errores reales.
La regresión automatizada pasa; queda pendiente repetir manualmente el recorrido en Tauri y en la
build empaquetada dentro del corte de validación acordado.

## Referencias funcionales y decisión de escala

El [manual de ChessBase](https://help.chessbase.com/cbase/17/eng/openings_report.htm) orienta el
concepto de informe por posición, historia y líneas. El
[manual de Scid vs. PC](https://scidvspc.sourceforge.net/doc/Reports.htm) describe tablas de teoría,
órdenes de jugadas y una selección de partidas por ELO medio. Se tomó esa separación como referencia,
sin prometer paridad con todas sus funciones.

**Las estadísticas generales usan todas las coincidencias del snapshot. La teoría usa una selección
acotada, explícita y determinista.** No se descodifican cientos de miles de continuaciones para
construir un primer informe, ni se vuelve a recorrer toda la base por cada línea.

Selección: mayor ELO medio cuando se conocen ambos ELO; después año más reciente y menor ID.
Una partida con ELO incompleto queda detrás de las que tienen ambos valores. No es una muestra
aleatoria o representativa del conjunto. Dentro de cada línea, la referencia es la primera según
ese mismo orden, no una partida elegida por evaluación de motor o calidad de sus planes.

## Estadísticas e identidad

- Totales, resultados, ELO medio por color, partidas con ELO conocido y distribución anual se
  agregan sobre todas las coincidencias. El año usa los cuatro primeros dígitos válidos: una fecha
  parcial con año conocido puede contribuir a ese año; fechas sin año se cuentan por separado.
- Puntuación de blancas: `(victorias + tablas / 2) / resultados conocidos`. Los desconocidos no
  se convierten en tablas. La frecuencia de continuación sí incluye todos los resultados.
- Los años describen las coincidencias de la consulta, no la popularidad respecto a todo el ajedrez
  de cada año. La interfaz muestra los últimos 20 años representados; HTML conserva todos.
- Siete franjas usan el ELO medio de ambos jugadores: 1–1599, 1600–1799, 1800–1999, 2000–2199,
  2200–2399, 2400–2599 y 2600+. Exigen ambos ELO; las partidas sin ellos se declaran aparte. Su
  frecuencia usa todas las coincidencias como denominador, por lo que también hace visible esa falta.
- Se agregan todos los jugadores por ID y se muestran los 20 con más coincidencias y los 20 con
  mayor ELO registrado. Cada fila contiene colores, victorias/tablas/derrotas/desconocidos desde
  la perspectiva del jugador, puntuación, porcentaje de victorias y ELO medio/máximo. El desempate
  es determinista. La base no guarda títulos FIDE y el informe no los infiere.
- Abrir un jugador crea otra pestaña en el mismo FEN y base, selecciona Games y aplica el jugador
  con cualquier color. Conserva fechas, resultado y el rango ELO común del reporte; la lista sigue
  paginada y el PGN se carga solo al abrir una partida.
- La identidad exacta conserva tablero, turno, enroques y captura al paso legal; ignora contadores.
  Se utiliza la primera aparición en la línea principal de cada partida. IDs distintos, incluidos
  duplicados, cuentan por separado. No se incluyen variantes PGN en los agregados.
- El FEN visible conserva la numeración elegida por el usuario. Los órdenes de llegada conservan
  también la numeración de su FEN inicial. La revisión de fuente es una huella de archivos, no un
  hash criptográfico del dataset.
- `skippedGames` conserva el alcance de 7.0: errores encontrados durante la búsqueda, no una
  certificación integral de la base. Si una continuación seleccionada no se puede descodificar,
  se excluye solo de teoría y se declara; los totales generales no se recortan silenciosamente.

## Teoría, órdenes y transposiciones

Cada fila de teoría corresponde a una continuación terminada o truncada al horizonte. Las filas
particionan la selección válida: una partida contribuye a una sola fila. Se ordenan por frecuencia
y desempate SAN determinista. Se muestran las primeras 64 y se declara tanto el número total de
líneas distintas como cuántas partidas abarcan las visibles. Un prefijo repetido usa puntos
suspensivos; pulsarlo abre el prefijo real de esa fila.

Los órdenes de llegada agrupan el recorrido anterior al FEN consultado. Las transposiciones
posteriores agrupan rutas distintas que convergen al mismo FEN canónico **a igual profundidad**.
Esto evita etiquetar una repetición a otra profundidad como una transposición de esa tabla.
No se pretende encontrar todas las transposiciones de toda la base: la profundidad y la selección
limitan lo observable. Las cantidades de grupos y rutas ocultos también se indican.

## Arquitectura y límites

`generate_opening_report(token, options, tab_id)` reutiliza el snapshot de 7.0. El registro temporal
mantiene 24 bytes y añade el ordinal del índice: permite leer metadatos de cada coincidencia
directamente del mmap, en lotes de 4.096. Solo se reproduce la selección de teoría; las referencias
leen metadatos SQL bajo demanda. Los PGN completos se solicitan únicamente al abrir o exportar.

| Recurso | Límite |
| --- | --- |
| Partidas de teoría | 5.000 por defecto; configurable de 1 a 10.000 |
| Profundidad posterior | 12 medias jugadas por defecto; de 1 a 16 |
| Recorrido anterior al FEN | Hasta 512 medias jugadas por partida seleccionada |
| Árbol de teoría | Como máximo `1 + partidas × profundidad`: 160.001 nodos |
| Filas visibles y exportadas de teoría | Hasta 64 |
| Órdenes de llegada visibles | Hasta 12 |
| Grupos de transposición / rutas por grupo | Hasta 20 / 4 |
| Agregación de informe | Comprueba un plazo de 180 s; no incluye espera de turno ni carga de índice |
| Informes simultáneos | Uno; comparte los dos permisos de consultas de 7.0 |
| Caché de informes | Una versión de opciones por snapshot; hasta 32 snapshots |
| Jugadores distintos agregables | Hasta 2.000.000; superar el límite falla explícitamente |
| Tablas de jugadores | 20 frecuentes y 20 más fuertes; selección en montículos de tamaño fijo |
| Orden global de Games | Uno por snapshot; 4 bytes por coincidencia, incluido en la caché de 512 MiB |
| Exportación de referencias | 20 partidas distintas; 8 MiB UTF-8 totales, incluidos separadores |

El PGN de referencias limita también el tamaño de entrada y el presupuesto de complejidad del
parser. Un exceso se rechaza, no se exporta una partida truncada. Conserva comentarios y variantes
legibles. El HTML escapa nombres, metadatos y FEN, no ejecuta JavaScript ni carga recursos externos;
incluye un diagrama de la posición y procedencia. El PGN de teoría conserva versión, fecha de
generación, revisión, filtros, FEN, límites y referencias.

El trabajo visible interrumpe cobertura, mantiene progreso y comprueba cancelación durante lotes,
descodificación y agrupación. Cambiar posición/base, salir del panel o cancelar descarta la respuesta
tardía. La publicación y el acierto de caché comprueban vigencia; un token expirado pide actualizar.
Un informe fallido no se publica como completo. La caché de coincidencias sigue limitada a
256 MiB por snapshot y 512 MiB conjuntos; no se creó un índice persistente nuevo.

Son límites de estructuras y respuestas, no un techo duro del RSS. El mmap puede hacer residente
gran parte del índice durante el recorrido. No hay migración de bases ni datos personales.

## Mediciones

Windows, Intel Core i5-1135G7, 4 núcleos/8 hilos y 16.901.771.264 bytes de RAM. Rust **debug**.
Gigabase: 10.355.465 partidas, SQLite de 3.003.420.672 bytes e índice v4 de 1.784.674.124 bytes.
Se abrió el índice existente directamente: no se reconstruyó ni se modificó la base del usuario.

```text
r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3
```

Primera ejecución: 933.494 coincidencias, 5.000 partidas de teoría, profundidad 12, 2.045 líneas
distintas, 2 órdenes de llegada y 1.117 convergencias. Cero exclusiones de teoría. Respuesta JSON:
64.609 bytes. Agregación: **3.846,172 ms**, después de disponer del snapshot. Cancelación comprobada
a partir de los 100 ms: duración total **113,397 ms**, incluidos esos primeros 100 ms.

La ejecución completa del test inicial tardó 80,64 s, incluyendo apertura/validación del índice,
consulta inicial, informe y cancelación. Los 3,85 s del informe no son el tiempo de una consulta
fría completa. El coste inicial documentado en 7.0 sigue existiendo.

Segunda ejecución, sin otras compilaciones/pruebas simultáneas durante la medición:

| Medida | Resultado |
| --- | ---: |
| Agregación, P50 / P95 (5 ejecuciones) | 3.221,929 / 4.281,380 ms |
| Duraciones ordenadas | 2.605,774; 2.867,456; 3.221,929; 4.015,282; 4.281,380 ms |
| Cancelación comprobada desde 100 ms, duración total | 104,497 ms |
| Respuesta JSON de esa ejecución | 64.599 bytes |
| Máximo residente observado en 351 muestras | 1.808.498.688 bytes (~1,68 GiB) |
| Máximo privado observado en esas muestras | 15.794.176 bytes (~15,06 MiB) |

Las cinco agregaciones reconstruyen el informe sobre el mismo snapshot e índice abierto; no usan
la caché del informe terminado. P95 con solo cinco observaciones coincide con el máximo y no es
una garantía estadística. El proceso completo del segundo test tardó 95,76 s, incluyendo creación
de snapshot, cinco informes y cancelación, sin contar compilación.

Las muestras externas de memoria se tomaron nominalmente cada 250 ms durante el proceso de test;
no certifican un pico continuo ni el máximo con 10.000 partidas de teoría. El residente incluye
el mmap del índice, no una copia de todas las partidas en objetos del informe. Tampoco son
percentiles de IPC, renderizado, búsquedas frías ni rendimiento release en distintos equipos.

Ampliación con jugadores, franjas ELO y ordenación global, sobre la misma posición y máquina:

| Medida debug | Resultado |
| --- | ---: |
| Jugadores distintos agregados | 236.282 |
| Agregación ampliada, P50 / P95 (5 ejecuciones) | 4.205,042 / 5.861,901 ms |
| Duraciones ordenadas | 3.695,710; 3.970,009; 4.205,042; 4.273,141; 5.861,901 ms |
| Cancelación desde 100 ms, duración total | 107,734 ms |
| Respuesta JSON ampliada | 73.915 bytes |
| Ordenar 933.494 coincidencias por fecha descendente | 2.281,650 ms |
| Ordenar 933.494 coincidencias por ELO medio descendente | 1.720,365 ms |
| Vector persistido para un orden | 3.733.976 bytes |

El P50 del informe aumentó aproximadamente un 30,5 % frente a la segunda medición del núcleo, a
cambio de agregar exactamente los jugadores y ratings de todas las coincidencias. La selección de
las dos tablas conserva solo 20 candidatos durante el recorrido y no ordena los 236.282 jugadores.
El primer orden solicitado se construye de forma cancelable y los siguientes accesos lo reutilizan;
cambiar de criterio reemplaza el único vector cacheado. Estas mediciones tampoco incluyen IPC,
renderizado ni una compilación release.

## Verificación y límites de la entrega

- Pruebas nativas de informe: estadísticas completas frente a selección, convergencias y órdenes
  anteriores al FEN, filtros, ranking determinista, límites visibles, cancelación, fuentes caducadas,
  posición incompatible, continuaciones corruptas y resultados vacíos, con SQLite temporal.
- Frontend completo: **169 pruebas aprobadas en 26 archivos**. Cobertura del informe: denominadores,
  numeración con negras al turno, PGN legal con prefijos compartidos,
  escape HTML, procedencia, límites/cancelación de exportación, diálogos fallidos, cambio de idioma,
  apertura de referencias en su nodo, acceso a Games por jugador, filtro ELO, ordenamiento global,
  reutilización de Games y respuestas tardías.
- La suite Rust completa conserva los siete fallos previos de heurísticas de `chess.rs`:
  89 aprobadas, 7 fallidas y 9 omitidas; las 52 pruebas activas de bases de datos pasan.
  No se modificaron esas heurísticas ni sus expectativas.
- ES/EN: 1.567 claves por idioma, sin faltantes ni diferencias de interpolación. El lint focalizado
  no tiene avisos; el lint global registra 44 avisos previos y cero errores.
- TypeScript y build web de producción pasan. Bundle principal: 5.246,13 kB antes de gzip;
  sigue existiendo el aviso de tamaño. No se hizo una optimización global del frontend.
- La herramienta de navegador falló dos veces al iniciar, antes de ejecutar el código de inspección
  (`failed to write kernel assets`). **No se verificaron visualmente la interfaz ni el HTML**.
  Los tests de componentes se ejecutaron con Mantine real en jsdom, no en un WebView nativo.
- No se ejecutó la interfaz Tauri, el instalador ni el flujo con motores reales. El cierre manual
  consolidado permanece en el corte de marca/release acordado con el usuario.

Comandos desde el repositorio:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run i18n:check
npm.cmd run build-vite
cargo test --offline --manifest-path src-tauri/Cargo.toml
$env:CHESS_LAB_BENCH_DB = 'RUTA_LOCAL_A_LA_BASE.db3'
cargo test --offline --manifest-path src-tauri/Cargo.toml benchmark_real_opening_report -- --ignored --nocapture
cargo test --offline --manifest-path src-tauri/Cargo.toml benchmark_position_snapshot -- --ignored --nocapture
```

## Pendientes explícitos

Para el corte de marca/release: revisar ventana estrecha y tema claro/oscuro, posición inicial y FEN
con negras al turno, apertura de referencias y variantes, cancelación/cierre/cambio de base,
actualización simultánea de la fuente, exportación real y reapertura HTML/PGN, diálogos de
sobrescritura, falta de permisos y comparación con una base pequeña contada manualmente. Repetir
en Tauri y build empaquetada, y fijar objetivos de rendimiento release por selectividad.

Ampliaciones posteriores: temas estratégicos, planes, finales típicos, fuentes Lichess, biblioteca
persistente de informes, títulos FIDE/perfiles biográficos, partidas modelo, novedades y desviaciones.
Games conserva pendientes los filtros por evento/control de tiempo y una definición de relevancia;
el filtro ELO y los órdenes por fecha/ELO/identificador ya están implementados. No se inicia 7.2
automáticamente desde este hito; su núcleo fue implementado posteriormente y se documenta en
`player-analysis-phase-7-2.es.md`.

Los objetivos incluidos de Finales y la matriz de entrenamiento de 6.8 siguen pendientes del corte
acordado, sin considerarlos resueltos por haber terminado el núcleo del informe.
