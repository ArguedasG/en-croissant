# Fase 6 — Primer corte especializado de entrenamiento

Estado: primer corte especializado actualizado el 2026-08-20; la fase completa sigue en progreso.

## Modelo del producto

Entrenamiento se divide en tres experiencias independientes:

- Táctica amplía el entrenador actual de puzzles Lichess con sets PGN y distintos modos.
- Aperturas amplía los repertorios existentes con una jerarquía `Repertorio → Variante → Línea`.
- Finales crea un entrenador nuevo a partir de posiciones didácticas y objetivos teóricos.

El hub `/training` sirve para elegir el área. Más adelante reunirá resúmenes de sesiones, progreso y
recomendaciones, pero no impondrá una sesión ni una configuración común. La ruta técnica de la
biblioteca genérica anterior permanece oculta y no representa la UX principal.

## Navegación

- El acceso existente de Puzzles abre `/training/tactics`.
- Finales tiene acceso directo desde la pantalla de inicio.
- Entrar en Táctica ya no abre inmediatamente el tablero: primero se elige una base o set y su modo.
- El tablero se crea al comenzar la práctica.

## Corte operativo de Táctica

El dashboard táctico mantiene el acceso al entrenador de bases Lichess y añade sets PGN propios.
Antes de importar muestra el total de registros, una muestra de posiciones y posibles errores. Cada
set conserva independientemente:

- quién realiza la primera jugada;
- si se usa solo la línea principal, alternativas del rival o todas las variantes;
- validación automática, estricta contra la solución PGN o mediante motor;
- modo guiado o Woodpecker;
- límite de tiempo, máximo de fallos y tolerancia en centipeones.

Los archivos de miles de posiciones no se copian a `localStorage`: se conserva su ruta y se lee solo
la muestra o el ejercicio activo. Si el archivo se mueve, la aplicación debe pedir que se vuelva a
vincular en una iteración posterior.

La sesión guiada reproduce las respuestas del rival y permite alternativas preparadas por el PGN.
Los registros que solo contienen FEN se validan bajo demanda con un motor local, sin analizar el set
entero durante la importación. Woodpecker muestra tiempo, fallos y ejercicios restantes; los ciclos
sucesivos conservan tanto los problemas fallados como los no alcanzados por tiempo o límite de
errores.

El estado de las tres áreas migra de forma compatible dentro de `training-areas-v1` a su esquema 4. Los datos
existentes de repertorios y puzzles no se eliminan ni se transforman destructivamente.

## Corte operativo de Aperturas

El dashboard organiza el contenido como `Repertorio → Variante → Línea`. Su acción principal es crear
un repertorio propio desde cero, abrir inmediatamente el constructor del tablero y añadir tantos
capítulos vacíos como sean necesarios. Importar PGN es una alternativa. Antes de importar muestra
una vista previa de capítulos, líneas, comentarios, subvariantes, errores y posibles partidas modelo.
El usuario decide si se entrenan únicamente las líneas principales o todas las subvariantes.

El PGN original permanece como fuente de lectura y análisis, por lo que nunca se pierden comentarios
ni ramas ilustrativas. La aplicación genera un archivo local separado con el árbol entrenable y abre
cada capítulo por su número de partida. Las partidas modelo detectadas se pueden analizar, pero quedan
fuera de la repetición espaciada.

Durante el entrenamiento, el rival reproduce automáticamente sus respuestas y los movimientos
correctos del estudiante continúan sin interrupción. La escala de dificultad aparece una sola vez al
terminar la línea; esa calificación programa conjuntamente las posiciones recorridas.

La práctica valida primero el repertorio. Cuando Stockfish está disponible, una jugada externa que
queda dentro del umbral de 30 centipeones se presenta como buena desviación y pausa la sesión antes
de regresar a la continuación preparada. Las variantes se pueden renombrar, reordenar y reclasificar;
cada línea importada se puede incluir o excluir de la copia de entrenamiento sin modificar la fuente.
La acción “Practicar repertorio” encadena los capítulos de teoría habilitados y mantiene las
estadísticas mientras avanza. Permanece pendiente una biblioteca dedicada de partidas modelo.

Los PGN comerciales usados para comprobar formatos son material local del propietario. No se
distribuyen ni se copian dentro de la aplicación.

## Finales: base existente y siguiente corte

El importador extrae FEN de PGN exportados desde estudios y consulta objetivos remotos. Los tres
archivos revisados se empaquetan como 180 posiciones válidas; se omiten cuatro registros
introductorios o vacíos y la instalación versionada evita duplicarlos.

La tablebase remota es la opción predeterminada para evitar descargas locales muy grandes;
`SyzygyPath` permanece disponible como opción avanzada. Maia al ELO máximo es el rival inicial
predeterminado y Stockfish se puede seleccionar. El estudiante juega el lado al turno en la FEN y
cada posición ofrece un botón separado para abrirla en análisis.

## Formatos revisados

El inventario exacto de los nueve PGN reales, las diferencias entre sus árboles y las reglas de
importación están documentados en `docs/training-import-formats-phase-6.es.md`.

## Validación

- 89 pruebas automáticas pasan, incluidas migraciones de esquemas, creación desde cero, sets PGN grandes, políticas de
  variantes tácticas y de Aperturas, y omisión de registros de estudio vacíos.
- El typecheck de TypeScript pasa.
- El build web de producción pasa.

## Pendientes inmediatos

1. Validar manualmente en la aplicación de escritorio la importación y práctica con los tres PGN
   tácticos reales.
2. Validar manualmente los ciclos Woodpecker sucesivos y sus límites de tiempo/fallos.
3. Validar manualmente los tres formatos reales de Aperturas y su regeneración filtrada.
4. Completar la finalización teórica y el registro de progreso de las partidas de Finales.
5. Añadir estadísticas de sesión y recomendaciones al hub cuando las tres áreas produzcan datos
   estables.
