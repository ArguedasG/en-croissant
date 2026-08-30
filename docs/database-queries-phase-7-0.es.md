# Fase 7.0 — Consultas compartidas por posición

Fecha: 2026-08-28. Alcance: primera parte de la Fase 7, autorizada después de la revisión de
preparación. No incluye todavía Opening Reports ni Player Analysis.

Actualización posterior: el informe local se implementó en 7.1; véase
`opening-reports-phase-7-1.es.md`. Las mediciones de este documento corresponden al cierre de 7.0.
Para reutilizar el índice sin buscar cada ID, el registro temporal de 24 bytes ahora incluye su
ordinal: ID (4), ply (4), ordinal (4) y SAN (12). Sigue siendo temporal de sesión; no requiere
migración de bases ni del índice `.ecsi`.

## Resultado

El explorador local y la cobertura de repertorios utilizan una consulta compartida que separa:

1. Resumen de continuaciones y resultados, sin PGN.
2. Todas las coincidencias, guardadas en un archivo temporal acotado.
3. Páginas de metadatos y decodificación de una partida únicamente al abrirla.

**Games** conserva su lugar en la interfaz. Deja de ser una muestra de hasta 500 PGN: pagina las
coincidencias completas, muestra nombres, ELO, fecha, resultado, evento y continuación, y abre la
partida en el primer nodo coincidente. Se conserva su base e identificador como procedencia.
El orden base es estable dentro del índice; los índices nuevos se construyen por ID ascendente.
Actualización de 7.1: Games permite ordenar todas las coincidencias por fecha, ELO medio, ELO de
blancas, ELO de negras o ese orden base, y filtrar por un rango ELO común a ambos jugadores.

## Contrato de consulta

| Operación | Respuesta |
| --- | --- |
| `query_position(file, query, tab_id, background)` | Token, huella, FEN normalizada, total, continuaciones, resultados desconocidos, errores de decodificación encontrados, duración y acierto de caché. |
| `get_position_games(token, offset, limit, sort, direction, tab_id)` | Metadatos de 1–100 partidas en el orden global solicitado; la interfaz solicita 20. No contiene PGN. |
| `get_position_game(token, offset)` | Una partida normalizada y su ply coincidente. |
| `cancel_position_search(tab_id)` | Cancela al propietario, también si espera un permiso. |

La identidad exacta incluye tablero, turno, derechos de enroque y captura al paso legal. No incluye
los contadores FEN. Se conserva la primera aparición en la línea principal de cada partida: una
repetición no cuenta esa partida varias veces. Las variantes PGN no forman parte del universo.
`*` como continuación significa que la partida acaba en la posición consultada.
Los duplicados que tengan IDs distintos se cuentan como partidas distintas; no se deduplican aquí.

El backend admite jugador por color o por cualquier color, rangos ELO por color, fechas y resultado.
Sin filtro se incluyen los datos desconocidos. Con filtro ELO se excluye ELO ausente/0; con filtro
de fecha se excluyen fechas ausentes o con `?`. El selector ELO de Options aplica el mismo intervalo
a ambos jugadores; un límite vacío queda abierto. Los filtros de evento/control de tiempo no se han
añadido. Los filtros incompatibles se rechazan; no se ignoran silenciosamente.

Victorias, tablas, derrotas y desconocidos se cuentan por separado. La frecuencia de continuación y
las barras del explorador usan todas las partidas como denominador y muestran los desconocidos.
En 7.1, una puntuación de resultados deberá usar solo resultados conocidos y declarar ese denominador.
`skippedGames` informa errores encontrados al decodificar candidatos, no certifica la integridad de
todas las partidas ni valida sus continuaciones posteriores al punto encontrado.

## Vigencia, recursos y cancelación

- Huella local versionada: metadatos y cabecera SQLite de base/WAL, más revisión del índice.
  Es una revisión de archivos, **no un hash criptográfico del dataset**. Se comprueba antes y después
  de leer una página y antes de publicar el resumen. Una modificación invalida el token.
- Caché LRU: hasta 32 consultas y 512 MiB conjuntos; máximo 256 MiB de coincidencias por consulta.
  Cada coincidencia ocupa 24 bytes. Un orden global terminado ocupa además 4 bytes por coincidencia;
  se conserva solo uno por snapshot y cuenta contra los 512 MiB. Superar el límite produce un error
  recuperable, no un total truncado.
- Los archivos temporales se eliminan al cerrar sus descriptores. No se persisten informes ni tokens
  entre sesiones; no hay migración de datos personales. Descartar/cancelar una consulta no guarda
  resultados incompletos en caché.
- Escaneo por lotes de 65.536 entradas; nunca se crea un vector con todas las partidas o sus PGN.
  Dos permisos de consulta, como máximo uno para trabajo de cobertura. Las consultas idénticas
  comparten un bloqueo y pueden reutilizar el resultado terminado.
- El trabajo visible interrumpe cobertura; esta reintenta cuando no hay solicitudes visibles.
  Desmontar su componente cancela el recorrido y los reintentos. Un error no se convierte en
  «cero partidas» ni en «repertorio completamente cubierto».
- La interfaz descarta respuestas abortadas y páginas de tokens anteriores. Un token expulsado de
  la caché provoca una nueva consulta; también existe el botón **Actualizar**.

Los límites anteriores son de lotes y archivos de resultados, no un límite duro del RSS del proceso.
El mmap permite al sistema operativo gestionar las páginas del índice; un recorrido puede hacer
residente gran parte del archivo. La caché JavaScript de metadatos de páginas no equivale a la LRU nativa.

## Índice y compatibilidad

Se siguen leyendo los `.ecsi` v4 existentes, ahora con validación estructural antes de acceder a su
contenido. La validación conserva las comprobaciones de rkyv y consulta la cancelación dentro del
archivo, no solo al principio/final. La primera apertura puede ser costosa; el mmap validado se reutiliza.

Las reconstrucciones escriben v5: bloques rkyv independientes de hasta 4.096 partidas, vaciados además
al alcanzar aproximadamente 8 MiB de datos. Una partida con más de 16 MiB de jugadas se rechaza. La
construcción lee SQLite de forma incremental, comprueba cancelación y vigencia, y publica un temporal
terminado por reemplazo; nunca trunca un mmap activo. Un cuerpo corrupto se reconstruye desde SQLite.

La v5 guarda la revisión de la fuente. Para v4 se conserva la comprobación por fechas, incluyendo WAL.
No se reconstruyó ni modificó la Gigabase del usuario durante las mediciones. Sus índices v4 no se
migran por abrir la aplicación: se conservan mientras sigan vigentes. Volver a una versión antigua de
la aplicación puede exigir reconstruir un v5, porque esa versión no lo reconocerá.

En Windows, un índice que todavía esté mapeado por otro lector puede impedir su reemplazo o borrado.
Se libera la caché correspondiente antes de reconstruir. Si otro lector sigue activo, el error debe
resolverse al finalizar/cancelar ese trabajo y reintentar; no se fuerza una escritura sobre el archivo.
La comprobación nativa de edición simultánea queda en la matriz manual.

## Mediciones

Equipo: Windows, Intel Core i5-1135G7, 4 núcleos/8 hilos, 16.901.771.264 bytes de RAM física.
Compilación Rust **debug**, base de 10.355.465 partidas, SQLite de 3.003.420.672 bytes e índice v4 de
1.784.674.124 bytes. FEN:

```text
r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3
```

La línea base del escaneo anterior, repetida antes de los cambios, fue 24,837 s para 933.494
coincidencias. La primera versión con lotes de 4.096 tardó 29,959 s, más 23,622 s de validación inicial;
las páginas tuvieron P50 16,802 ms y P95 28,283 ms. Estas cifras motivaron ampliar el lote de escaneo
y añadir cancelación dentro de la validación heredada; no demuestran una aceleración del primer FEN.

Resultados finales sin otras compilaciones simultáneas:

| Medida | Resultado |
| --- | ---: |
| Validación inicial de v4 | 25,351 s |
| Escaneo completo | 26,005 s |
| Coincidencias | 933.494 |
| Archivo temporal de coincidencias | 22.403.856 bytes (~21,37 MiB) |
| Página de 20 partidas, P50 / P95 | 15,799 / 22,323 ms |
| Consulta a caché con comprobación de revisión, P50 / P95 | 0,601 / 0,871 ms |
| Validación cancelada a los 100 ms, duración total | 101,338 ms |
| Escaneo cancelado desde un hilo a los ~100 ms, duración total | 108,818 ms |

La duración de escaneo cancelado incluye la espera antes de solicitar la cancelación; no es una
medición aislada de latencia desde la señal. P50/P95 de páginas y caché corresponden a 20 lecturas
dentro del mismo proceso. No son
percentiles de búsquedas frías, no incluyen IPC/renderizado, ni representan una build distribuible.

Una muestra determinista de 10.000 partidas contiene 794.750 posiciones, contando la inicial.
Una representación simple de firma de 64 bits + ID + ply, 16 bytes por posición, extrapola
**13.168.009.294 bytes (~12,26 GiB)**, antes de índices auxiliares y sin estimar compresión.
Esto es una estimación, no un archivo construido. Una muestra adicional de reproducción y hashing
estima trabajo CPU; no mide ordenación, escritura, compresión ni verificación de colisiones.
En esa segunda muestra, 1.000 partidas y 80.367 firmas tardaron 0,523 s; una extrapolación lineal
monohilo a toda la base da 5.415 s (~90 min) de trabajo CPU en debug. No es una predicción del tiempo
de construcción paralelo ni del rendimiento release; la distribución de la muestra también limita
la estimación. No se construyó el índice global.

**Decisión:** no construir por defecto ese índice global en 7.0. El coste de almacenamiento es
relevante frente al índice por partidas actual. Los reportes deben reutilizar las coincidencias y
recorrer sus continuaciones por lotes; no disparar un escaneo completo por cada celda de teoría.
En 7.1 habrá que medir esa agregación y, si no resulta suficiente, comparar un índice persistente
acotado a aperturas o una estrategia incremental. No se promete navegación instantánea de un FEN
nuevo sobre diez millones de partidas.

## Verificación automatizada y límites de entrega

- Frontend: 151 pruebas aprobadas en 23 archivos, incluidas páginas después de la partida 500,
  carga diferida de PGN, nodo inicial, token renovado y respuestas tardías.
- Rust: 83 aprobadas, 7 fallidas y 8 omitidas en la suite completa. Las siete fallidas son las
  evaluaciones heurísticas previas de `chess.rs`; no se cambiaron ni se relajaron sus expectativas.
  Las 46 pruebas de base de datos activas pasan, además de benchmarks invocados explícitamente.
- Se corrigió el fixture de búsqueda exacta que omitía el turno. Hay cobertura de enroque/captura
  al paso, filtros/desconocidos, índice corrupto, reconstrucción, v4/v5, múltiples bloques,
  cancelación, prioridad y expulsión/invalidez de tokens, usando bases SQLite temporales.
- TypeScript y build web pasan. ES/EN: 1.479 claves, sin faltantes ni diferencias de interpolación.
  El lint global conserva 44 avisos previos y cero errores; no se considera una suite totalmente limpia.
  El bundle principal sigue superando 5 MB; no se optimizó como parte de esta fase.
- No se ejecutaron interfaz Tauri real, instalador ni motores reales. Tampoco una batería de
  percentiles en release para varios FEN/selectividades ni una medición del pico de memoria.
  Una muestra externa del proceso durante el benchmark mostró 1.797.951.488 bytes residentes;
  no es un pico. La lectura de RSS mediante sysinfo devolvió 0 y no se considera válida.

Comandos reproducibles desde el repositorio:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run i18n:check
npm.cmd run build-vite
cargo test --offline --manifest-path src-tauri/Cargo.toml
$env:CHESS_LAB_BENCH_DB = 'RUTA_LOCAL_A_LA_BASE.db3'
cargo test --offline --manifest-path src-tauri/Cargo.toml benchmark_position_snapshot -- --ignored --nocapture
```

## Siguiente etapa y comprobación manual

7.1: informes locales con estadísticas, tabla de teoría y transposiciones; acceso a su evidencia
mediante Games. HTML del informe y PGN de partidas/variantes son deseables, no bloqueantes.
Temas estratégicos, planes, finales típicos y fuentes Lichess quedan explícitamente diferidos.

Antes de la alpha, comprobar en Tauri y build empaquetada: navegación rápida/cierre durante escaneo
e indexación, prioridad frente a cobertura, actualización de una base consultada desde dos pestañas,
recuperación de errores, primera apertura de v4, regeneración de v5, apertura en nodo correcto,
tablas en ventana estrecha y limpieza de temporales. También siguen pendientes los objetivos
incluidos de Finales y la matriz de entrenamiento de 6.8, según el corte acordado con el usuario.
