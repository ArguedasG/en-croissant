# Fase 6 — Primer corte especializado de entrenamiento

Estado: Etapas 1 a 5 y tres etapas de correcciones implementadas al 2026-08-23; la fase completa sigue en progreso y pendiente de validación manual consolidada.

El pulido 6.8 implementado el 2026-08-27 se documenta en [training-phase-6-8.es.md](training-phase-6-8.es.md): incorporación de líneas y PGN a repertorios, biblioteca de partidas modelo, guardado explícito, avance táctico y catálogos ES/EN. Sus pruebas manuales nativas y empaquetadas siguen pendientes.

## Modelo del producto

Entrenamiento se divide en tres experiencias independientes:

- Táctica amplía el entrenador actual de puzzles Lichess con sets PGN y distintos modos.
- Aperturas amplía los repertorios existentes con una jerarquía `Repertorio → Variante → Línea`.
- Finales crea un entrenador nuevo a partir de posiciones didácticas y objetivos teóricos.

El hub `/training` sirve para elegir el área. Más adelante reunirá resúmenes de sesiones, progreso y
recomendaciones, pero no impondrá una sesión ni una configuración común. La ruta técnica de la
biblioteca genérica anterior permanece oculta y no representa la UX principal.

## Navegación

- Desde el ajuste 6.7 del 2026-08-27, el hub y las tres áreas comparten la barra de pestañas del
  tablero. Elegir un área transforma la pestaña del hub, sin añadir otra por cada navegación; al
  volver a una pestaña de entrenamiento se recupera su ruta.
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
- nivel ELO recomendado opcional y tolerancia en centipeones;
- punto de reanudación, avance automático opcional e historial de ciclos.

Los archivos de miles de posiciones no se copian a `localStorage`: se conserva su ruta y se lee solo
la muestra o el ejercicio activo. Si el archivo se mueve, la aplicación debe pedir que se vuelva a
vincular en una iteración posterior.

La sesión guiada reproduce las respuestas del rival y permite alternativas preparadas por el PGN.
Los registros que solo contienen FEN se validan bajo demanda con un motor local, sin analizar el set
entero durante la importación. Woodpecker muestra tiempo, fallos y ejercicios restantes; esos valores
no imponen límites anticipados. El ciclo termina automáticamente al resolver una vez todos los
problemas y cada ciclo nuevo vuelve a recorrer el set completo.

El estado de las tres áreas migra de forma compatible dentro de `training-areas-v1` a su esquema 8.
Los datos existentes de repertorios y puzzles no se eliminan ni se transforman destructivamente.

### Etapa 4 — rediseño del entrenamiento táctico

El dashboard muestra primero los sets disponibles y deja la importación PGN como acción secundaria.
Cada tarjeta resume cantidad de problemas, completados, porcentaje, siguiente problema, tipo de
entrenamiento, ELO recomendado, fallos e historial de ciclos. La configuración permite editar los
metadatos y el ELO sin volver a importar.

Antes de eliminar un set propio se puede recorrer problema por problema con tablero, FEN, soluciones
interpretadas, PGN fuente e intentos anteriores. El borrado elimina únicamente el set, sus ejercicios
embebidos, intentos, progreso y ciclos; nunca modifica ni elimina el PGN original.

La práctica reanuda el primer problema todavía no resuelto en el ciclo. La navegación
anterior/siguiente y el salto numérico son exploratorios: no sustituyen ese punto guardado. Un botón
permite regresar explícitamente a la reanudación. El avance automático al acertar se controla por
set. Una jugada incorrecta registra fallo y duración, muestra «Jugada incorrecta. Inténtalo de
nuevo», reconstruye la posición y mantiene el aviso hasta que se encuentra la respuesta correcta.

Los ciclos Woodpecker son persistentes y se cierran automáticamente al completar todo el set. El
resumen conserva duración, fallos y problemas completados y se compara con ciclos anteriores. La
salida anticipada se mantiene únicamente dentro del menú avanzado, protegida por una advertencia. Al
cerrar un ciclo aparece la acción para comenzar el siguiente, que siempre contiene el set completo.
Los sets importados antes de esta etapa conservan sus intentos y deducen el primer problema todavía
no completado como punto de reanudación.

La revisión ofrece dos vistas. «Detalle y tablero» conserva la inspección individual con FEN,
soluciones y PGN textual. «Lista PGN» virtualiza todos los registros, marca los completados al menos
una vez en el ciclo actual y abre directamente cualquiera en el tablero. Esta apertura directa sigue
siendo exploratoria y no desplaza la reanudación real.

## Corte operativo de Aperturas

El dashboard organiza el contenido como `Repertorio → Variante → Línea`. Su acción principal es crear
un repertorio propio desde cero, abrir inmediatamente el constructor del tablero y añadir tantos
capítulos vacíos como sean necesarios. Importar PGN es una alternativa. Antes de importar muestra
una vista previa de capítulos, líneas, comentarios, subvariantes, errores y posibles partidas modelo.
El usuario decide si se entrenan únicamente las líneas principales o todas las subvariantes.

El PGN original permanece como fuente inmutable. La aplicación genera una copia local editable que
conserva todas las ramas, comentarios y anotaciones; la política de importación solo decide cuáles
líneas empiezan marcadas para entrenar. Cada capítulo se abre por su número de partida. Las partidas
modelo detectadas se pueden analizar y editar en la copia, pero quedan fuera de la repetición
espaciada.

Durante el entrenamiento, el rival reproduce automáticamente sus respuestas y los movimientos
correctos del estudiante continúan sin interrupción. La escala de dificultad aparece una sola vez al
terminar la línea; esa calificación programa conjuntamente las posiciones recorridas.

La práctica valida primero el repertorio. Cuando Stockfish está disponible, una jugada externa que
queda dentro del umbral de 30 centipeones se presenta como buena desviación y pausa la sesión antes
de regresar a la continuación preparada. Las variantes se pueden renombrar, reordenar y reclasificar;
cada línea importada se puede incluir o excluir de la copia de entrenamiento sin modificar la fuente.
La acción “Practicar repertorio” encadena los capítulos de teoría habilitados y mantiene las
estadísticas mientras avanza. Permanece pendiente una biblioteca dedicada de partidas modelo.

### Etapa 2 — estabilidad y feedback de la práctica

La clasificación de una jugada fuera del repertorio ya no reutiliza como promesa puntual el canal de
análisis continuo. Ahora abre una consulta UCI privada que:

- retorna en cuanto el motor emite `bestmove`;
- conserva hasta ocho líneas `MultiPV` de la profundidad más reciente;
- tiene un límite total de ocho segundos, incluido el arranque y el protocolo inicial;
- termina su proceso al completar, desconectarse o agotar el plazo.

Mientras se comprueba una desviación, el lateral informa el estado y el tablero se bloquea solo de
forma temporal. Una respuesta correcta continúa la línea y se confirma en el lateral. Una jugada
incorrecta no se aplica, no muestra la solución y deja el tablero listo para reintentar. Una jugada
equivalente fuera del repertorio se presenta como desviación buena y pausa la línea hasta regresar a
la continuación preparada. Si el motor no está disponible o falla, la interfaz lo explica y permite
seguir intentando la línea estricta sin quedar bloqueada.

Los PGN comerciales usados para comprobar formatos son material local del propietario. No se
distribuyen ni se copian dentro de la aplicación.

### Etapa 3 — progreso y gestor jerárquico

Cada intento de una jugada del estudiante registra acierto o fallo, tiempo acumulado y último uso.
Al completar la línea se conserva además el número de sesiones, cierres perfectos, errores y duración.
El progreso y la dificultad se calculan para la línea y se agregan, ponderados por intentos, a su
variante y repertorio. Esta telemetría no sustituye la programación FSRS de la línea completa.

La pregunta de dificultad al final de cada línea se puede desactivar desde el dashboard. Cuando está
desactivada, la calificación se deduce automáticamente a partir de los errores y el tiempo medio por
movimiento y la práctica continúa sin una pausa adicional.

El gestor mantiene la jerarquía `Repertorio → Variante → Línea` como estructura organizativa. Permite:

- crear variantes como carpetas, incluso sobre repertorios importados;
- arrastrar variantes para reordenarlas y líneas para reordenarlas o moverlas entre variantes del
  mismo repertorio;
- construir líneas y subvariantes directamente con el tablero, renombrarlas, incluirlas o excluirlas
  del entrenamiento y eliminarlas del gestor;
- ver progreso y dificultad en los tres niveles.

Cada línea conserva por separado su identidad y secuencia. Al reorganizar una línea, la copia editable
se reconstruye fusionando la rama desde su capítulo actual; los comentarios y anotaciones de esa rama
se mantienen. Ninguna de estas acciones escribe en el PGN importado original.

### Etapa avanzada — copia editable, tablero y exportación

La copia local del repertorio es ahora el documento editable canónico. «Editar y analizar» y
«Construir en tablero» abren esa copia, nunca el archivo importado. Al guardar manualmente o mediante
autoguardado, el árbol del capítulo se reconcilia con el gestor: se detectan líneas nuevas, ramas
eliminadas, comentarios, subvariantes y cambios de nombre del capítulo. Las líneas que no cambiaron
conservan su identidad y sus estadísticas.

El arrastre entre variantes sí modifica de forma sana la copia editable. Antes de escribir se leen
sus capítulos actuales; cada rama se localiza por su secuencia de jugadas y se fusiona en el destino,
manteniendo comentarios, glifos y anotaciones. El movimiento se rechaza si las posiciones iniciales
de los capítulos son incompatibles. Reordenar variantes actualiza también el orden físico de los
registros PGN.

La práctica dejó de depender de un archivo filtrado. Forma una cola explícita por línea marcada como
entrenable, incluso cuando varias líneas comparten capítulo. Por eso la copia puede conservar ramas
ilustrativas y partidas modelo sin que entren accidentalmente en la sesión. «Exportar copia» guarda
el PGN editable completo en la ubicación elegida. Crear un repertorio o un capítulo abre un árbol
vacío que se construye visualmente; ya no se exige introducir jugadas UCI desde el gestor.

La sincronización ocurre al guardar el capítulo. No intenta interpretar gestos todavía no guardados
ni combinar simultáneamente dos pestañas antiguas del mismo archivo. Importar otro PGN dentro de una
variante concreta queda como ampliación futura sobre este modelo, no como requisito de esta etapa.

### Corrección de cierre — Etapa 1

El gestor de repertorios calcula la altura expandida a partir de variantes y líneas, con un mínimo
mayor y scroll interno. Cada línea entrenable tiene una acción de práctica individual y puede
repetirse sin depender de que venza su programación. La práctica completa por variante o repertorio
se conserva.

Las preferencias «Evaluar jugadas buenas fuera del repertorio» y «Preguntar dificultad» nacen
desactivadas. Con la primera desactivada no se inicia Stockfish: la línea se comprueba estrictamente
y se evita el timeout del evaluador. Al activarla se conserva la clasificación equivalente con el
límite acotado existente. El esquema 8 migra los perfiles anteriores a estos valores iniciales.

El lateral de práctica tiene scroll vertical, distingue el progreso programado del capítulo de los
resultados de la sesión y explica sus contadores. «Mostrar jugada» registra un fallo, reproduce
brevemente la respuesta, restaura la posición y obliga al estudiante a ejecutar después la misma
jugada.

El aviso repetido `timed out waiting for connection` tenía dos fuentes combinadas. Una búsqueda mmap
larga reservaba una conexión SQLite antes de necesitarla, incluso mientras consultas duplicadas
esperaban el bloqueo de colisión; ahora la conexión se adquiere únicamente para la consulta final.
Además, el panel oculto de construcción seguía calculando cobertura durante la práctica; ahora solo
se monta al abrir esa pestaña. Esto reduce también el trabajo de fondo que podía retrasar sonidos.

La edición avanzada sincronizada entre análisis y gestor, junto con exportación de la copia editada,
queda diferida a una etapa propia posterior. El PGN fuente seguirá siendo inmutable. Tras las etapas
de corrección se realizará una validación manual consolidada y una pasada de regresiones de las tres
áreas.

### Corrección de cierre — Etapa 2

El rediseño táctico descrito arriba se ajustó al comportamiento definitivo de Woodpecker: cada ciclo
es el set completo, termina solo al resolverlo y ofrece «Iniciar ciclo N» en el resumen. Las colas
reducidas guardadas por la implementación provisional se expanden al set completo al reanudarse.

La navegación visual queda separada del cursor de progreso. Resolver ejercicios adelantados se
registra en el ciclo y permite saltarlos cuando corresponda, pero simplemente recorrerlos no cambia
el primer problema pendiente. La lista de revisión usa virtualización para mantener fluidez con PGN
grandes.

### Corrección de cierre — Etapa 3

La experiencia de Finales ofrece «Volver a la lista de finales» durante la partida y en su pantalla de
resultado, además del acceso ya disponible durante la preparación. Si se usa durante una partida
activa, el backend se aborta limpiamente y la salida no se registra como intento ni como fallo del
ejercicio.

Cuando no se alcanza el objetivo, el cierre evita comparar o juzgar el resultado: informa simplemente
que no se pudo conseguir el objetivo y ofrece intentarlo de nuevo. Las acciones de análisis y regreso
a la biblioteca se conservan.

## Etapa 5 — experiencia especializada de Finales

Los tres archivos incluidos se presentan como una sola biblioteca pedagógica, sin exponer sus nombres
“Parte 1”, “Parte 2” y “Parte 3”. Las 180 posiciones se clasifican por material en finales de peones,
torres, piezas menores, damas, material mixto y otros. Cada tema muestra cantidad y progreso; al
abrirlo se elige una posición concreta.

El botón “Jugar” configura el lado del estudiante y el motor seleccionado, abre la posición y comienza
la partida automáticamente. Al terminar se sustituye el cierre genérico por un resultado propio de
Finales. Si se alcanza al menos el resultado teórico esperado, la posición queda completada de forma
permanente y se puede analizar, repetir o continuar con el siguiente final. Si no se alcanza el
objetivo, se ofrecen reintento, análisis y regreso a la biblioteca. “New Game” no aparece en este
flujo.

El contenido incluido queda bloqueado en la interfaz: sus objetivos no se calculan ni editan desde la
biblioteca y su progreso es independiente por posición. Los objetivos definitivos deben prepararse
antes de distribuir el contenido. Las builds de desarrollo muestran exclusivamente para esa
preparación el cálculo por tema y la edición manual; las builds de producción los ocultan. Los sets
importados por el usuario permanecen separados y sí
permiten consultar tablebase, corregir objetivos manualmente y eliminar el set completo.

La importación PGN se conserva al final de la pantalla como herramienta avanzada. La tablebase remota
continúa como opción predeterminada para evitar descargas locales grandes; Maia al ELO máximo es el
rival inicial y Stockfish se puede seleccionar.

## Formatos revisados

El inventario exacto de los nueve PGN reales, las diferencias entre sus árboles y las reglas de
importación están documentados en `docs/training-import-formats-phase-6.es.md`.

## Validación

- 99 pruebas frontend pasan, incluidas migraciones de esquemas, creación desde cero, progreso y
  reorganización de líneas, sets PGN grandes, políticas de
  variantes tácticas y de Aperturas, y omisión de registros de estudio vacíos.
- Dos regresiones Rust específicas comprueban que la consulta UCI retorna con `bestmove` aunque el
  proceso permanezca abierto y que un motor sin respuesta libera al llamador por timeout.
- La consulta puntual se comprobó además con el Stockfish local real a profundidad 12 y `MultiPV`.
- El typecheck de TypeScript pasa.
- Las tres correcciones de cierre y la edición avanzada pasan 28 pruebas unitarias focalizadas, el typecheck, lint sin
  advertencias y formato en los archivos afectados; la corrección de Aperturas conserva además
  `cargo check` correcto.
- El build web de producción pasa.
- La suite Rust completa conserva ocho fallos no relacionados con esta etapa en pruebas históricas de
  evaluación ingenua y búsqueda de base de datos; las regresiones UCI nuevas pasan de forma aislada y
  dentro de la suite.

## Pendientes inmediatos

1. Validar manualmente la tercera corrección de Finales: regreso durante preparación, partida y
   cierre; aborto sin intento artificial; objetivo conseguido/no conseguido, repetición, siguiente
   ejercicio, análisis y persistencia.
2. Validar manualmente la segunda corrección de Táctica: lista PGN, marcas del ciclo, acceso directo,
   navegación sin mover la reanudación, aviso persistente, cierre automático y ciclo siguiente con
   el set completo.
3. Validar la primera etapa de correcciones de Aperturas en desarrollo y build empaquetada: práctica
   individual, «Mostrar jugada», scroll, ambos ajustes desactivados, sonidos y ausencia del timeout
   de conexión bajo un repertorio grande.
4. Validar la Etapa 2 original en una aplicación empaquetada con la evaluación externa activada:
   acierto, fallo, desviación buena, timeout, fallo de arranque y recuperación del tablero.
5. Validar manualmente en la aplicación de escritorio la importación y práctica con los tres PGN
   tácticos reales.
6. Preparar y verificar los objetivos fijos de las 180 posiciones incluidas antes de distribuirlas.
7. Validar manualmente los tres formatos reales de Aperturas y su regeneración filtrada.
8. Añadir estadísticas de sesión y recomendaciones al hub cuando las tres áreas produzcan datos
   estables.
9. Ejecutar, al terminar las etapas de corrección, la validación manual consolidada y regresiones de
   Táctica, Aperturas y Finales.
10. Validar la edición avanzada: crear y extender ramas en tablero, sincronización al guardar,
    arrastre entre variantes compatibles, rechazo entre FEN incompatibles, reordenamiento físico,
    selección de líneas entrenables y exportación sin cambios en el PGN fuente.
