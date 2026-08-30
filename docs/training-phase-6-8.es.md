# Fase 6.8 — Repertorios, PGN e idiomas

Implementación del 2026-08-27. Los flujos nativos y la build empaquetada siguen pendientes de prueba manual; las pruebas automatizadas no los sustituyen.

## Accesos y comportamiento

- En Aperturas, **Importar al repertorio** permite elegir un PGN y una variante de teoría existente. El icono de importación de una variante la preselecciona.
- El campo de registros acepta números de partida desde 1: `1, 3-5`. Vacío importa todos. Los intervalos contiguos se leen juntos.
- En el menú **⋯** del tablero, **Añadir al repertorio** captura la línea hasta la jugada seleccionada o esa rama con sus continuaciones. Conserva el recorrido desde la FEN inicial, no las ramas hermanas ajenas a la selección.
- En ese mismo diálogo, **Partidas modelo** guarda el árbol completo de la partida en la biblioteca del repertorio. También admite importación desde archivo.
- Las partidas modelo tienen una sección propia para abrirlas y analizarlas. No entran en la cola de memorización ni en los agregados de progreso del repertorio. La clasificación explícita se conserva al exportar y volver a importar.
- Las nuevas importaciones de repertorios seleccionan **Todas las subvariantes** por defecto. No se cambia la política ni el progreso de repertorios anteriores.
- En Táctica, el avance automático oculta la acción de finalización «Siguiente problema». La navegación manual Anterior/Siguiente continúa disponible. Cambiar de ejercicio, desactivar el avance o salir cancela el temporizador pendiente.

## Reglas de incorporación

La incorporación se prepara primero en memoria. El usuario confirma una vista previa con líneas nuevas, coincidencias y partidas modelo nuevas.

Una selección que incluya registros sin jugadas se rechaza completa, sin guardar parcialmente; se pueden seleccionar solo los registros útiles. No se descartan registros silenciosamente.

| Caso                              | Regla                                                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FEN inicial                       | Debe coincidir exactamente para fusionar teoría, incluidos turno, enroques, al paso y contadores. No se inserta automáticamente una posición incompatible en una variante vacía.                                  |
| Jugadas duplicadas                | Se fusionan por movimiento UCI dentro de la misma rama; no se vuelve a crear la línea.                                                                                                                            |
| Transposición                     | Los órdenes de jugadas diferentes siguen siendo ramas distintas, aunque lleguen a la misma posición.                                                                                                              |
| Comentarios, símbolos y marcas    | Se conserva lo existente y se agregan las anotaciones entrantes que no estaban presentes.                                                                                                                         |
| Color                             | Se conserva el color de entrenamiento del repertorio. «Ambos» mantiene la orientación de cada registro.                                                                                                           |
| Nombre de teoría                  | Se conserva el nombre de la variante de destino.                                                                                                                                                                  |
| Nombre de partida modelo          | Se usa el nombre indicado o el del registro; las colisiones añaden `(2)`, `(3)`, etc.                                                                                                                             |
| Partida modelo duplicada          | Igual FEN inicial y conjunto de líneas UCI: se reutiliza el registro y se fusionan sus anotaciones. Sus cabeceras anteriores se conservan; no se consideran diferentes solo por cambiar los nombres de jugadores. |
| Progreso                          | Se conservan los identificadores y estadísticas de líneas existentes, incluidas las desactivadas. Las líneas nuevas de teoría quedan seleccionadas para entrenar.                                                 |
| Cambios pendientes o concurrentes | No se importa si hay pestañas del repertorio con cambios sin guardar, o si cambia el estado/archivo desde la vista previa. Hay que guardar o descartar los cambios y preparar otra vista previa.                  |

Las incorporaciones modifican solamente el PGN editable. El PGN importado originalmente no se escribe. Se registran origen, índices de registros, fecha, modalidad y cantidades en `training-areas-v1`; las cabeceras del registro editable incluyen identidad de repertorio/variante, tipo y última incorporación. La captura desde tablero también registra su archivo o partida de origen.

Antes de sustituir el editable se crea `archivo.pgn.before-import-<id>.pgn` junto a él. La nueva versión se escribe primero en un temporal del mismo directorio y se vuelve a comprobar que el destino no haya cambiado. Si falla la escritura o sustitución, se conserva el respaldo y se intenta retirar únicamente ese temporal. Los respaldos no se eliminan automáticamente.

Después de importar se actualizan las pestañas limpias del repertorio y se reconstruye el índice nativo de posiciones de registros PGN. Un fallo en esa reconstrucción informa que la importación sí quedó guardada y pide reabrir la aplicación. No hay una transacción única entre sistema de archivos y almacenamiento del navegador: un cierre abrupto en ese intervalo requiere revisar el editable y su respaldo; no se promete recuperación automática de ese caso.

## Guardar, Guardar como y Exportar

El menú **⋯** muestra el archivo y número de registro, la base de datos o la ausencia de archivo de origen.

| Acción                         | Destino y efecto                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guardar                        | Actualiza el registro actual en su archivo/base; en un PGN múltiple conserva las partidas vecinas. Sin archivo solicita un destino. Mantiene el comportamiento previo de copia de archivos temporales. |
| Guardar como PGN nuevo         | Escribe únicamente la partida actual, con comentarios y variantes, en otro archivo. La pestaña pasa al registro 1 de ese archivo y queda guardada.                                                     |
| Exportar copia PGN             | Escribe únicamente la partida actual en otro archivo, pero no cambia su origen ni marca sus cambios como guardados.                                                                                    |
| Exportar copia desde Aperturas | Exporta todo el PGN editable del repertorio, incluidas las partidas modelo.                                                                                                                            |

Guardar como/Exportar rechazan el mismo archivo de origen; desde un repertorio también protegen su PGN fuente conocido. Para sustituir otro archivo existente se solicita confirmación. Cancelar o fallar antes de escribir no cambia el origen de la pestaña ni elimina sus cambios pendientes.

El guardado nativo descarta los offsets PGN antiguos antes de localizar el registro y después de reescribirlo. Esto evita que, tras cambiar longitudes de registros, se guarde sobre una partida diferente en archivos grandes.

## Inglés y español

`en-US` y `es-ES` son los idiomas de referencia. Se han completado sus catálogos y trasladado a traducciones los textos de las pantallas de entrenamiento y práctica, incluidas las pantallas heredadas conservadas en el repositorio. Las etiquetas reactivas usan la función de traducción del hook para que el compilador de React no retenga el idioma anterior.

El fallback sigue siendo inglés y las traducciones vacías no se muestran. Los nombres y comentarios de contenido del usuario no se traducen automáticamente. No se afirma que los demás idiomas estén completos ni se amplía su alcance.

`npm run i18n:check` comprueba igualdad y valores no vacíos de los dos catálogos, variables de interpolación, claves literales usadas en TS/TSX y texto JSX/etiquetas sin traducir en entrenamiento y práctica. La extracción reconoce `trainingT`. Las claves construidas dinámicamente y la calidad lingüística requieren revisión humana adicional.

## Verificación manual pendiente

Realizar en desarrollo y en una aplicación empaquetada, preferiblemente con copias de los PGN reales:

1. Importar un repertorio nuevo y comprobar que todas sus ramas quedan disponibles; comprobar que uno antiguo conserva su selección y progreso.
2. Añadir un PGN completo y luego `1, 3-5` a una variante. Repetir una importación: no deben duplicarse líneas; sí conservarse comentarios y el respaldo.
3. Intentar una FEN incompatible y una importación con cambios pendientes en una pestaña: el editable debe permanecer igual.
4. Capturar una línea y luego un subárbol desde análisis. Comprobar la selección, las ramas y la reapertura del repertorio.
5. Guardar/importar una partida modelo, abrirla desde su biblioteca y comprobar que nunca entra en la práctica de memorización.
6. Abrir una partida intermedia de un PGN de más de 200 registros. Probar Guardar, Guardar como y Exportar; verificar cabeceras, comentarios, variantes, partidas vecinas, cancelación y negativa a sobrescribir.
7. En Táctica, acertar con avance automático, navegar durante la espera y cambiar al modo manual. Comprobar la reanudación y el cierre del ciclo.
8. Alternar español/inglés sin reiniciar: hub, importaciones, biblioteca modelo, menús PGN, errores y sesiones de entrenamiento.

Verificación automatizada: 144 pruebas frontend, dos regresiones Rust de PGN, typecheck, build web y auditoría de 1.470 claves por idioma correctos. El lint focalizado de los flujos nuevos no tiene avisos; en `RepertoireInfo.tsx` permanecen dos avisos previos de dependencias React. La build conserva avisos de tamaño de bundle y tiempo de plugins. No se ejecutó la suite Rust completa; su estado previo está registrado en `PROJECT_ROADMAP.md`.
