# Historial de partidas contra bots humanos

Esta funcionalidad guarda automáticamente las partidas terminadas entre un jugador humano y uno de los perfiles de bots humanos. Es independiente de las mediciones técnicas de calibración.

## Qué se guarda

Cada entrada contiene:

- PGN completo de la partida, incluidas sus cabeceras y relojes;
- fecha y hora;
- perfil, nombre y ELO mostrado del bot;
- colores del jugador y del bot;
- resultado desde la perspectiva del jugador;
- control de tiempo y cantidad de plies.

El historial se almacena en `human-bot-history.json` dentro del directorio de datos de la aplicación. No utiliza `localStorage`, no se sube a ningún servidor y no modifica los perfiles de los bots.

Solamente cuentan las partidas **jugador humano contra bot humano**. Las partidas entre dos bots pueden seguir produciendo mediciones de calibración, pero no aparecen en este historial ni modifican el marcador personal.

## Marcador

Para cada bot se muestran dos representaciones:

- puntos del jugador frente a puntos del bot, por ejemplo `1½–½`;
- victorias-tablas-derrotas (`W-D-L`) desde la perspectiva del jugador.

Una victoria vale un punto y unas tablas medio punto para cada lado. El marcador se calcula desde las partidas guardadas; no es un ELO ni modifica la fuerza de Maia.

El botón de reinicio situado en la fila de cada bot inicia su marcador desde cero sin borrar sus PGN. También existe un reinicio global. Internamente se registra el momento del reinicio y solo las partidas posteriores cuentan para el nuevo marcador.

## Interfaz

El panel **Partidas contra bots humanos** aparece en la configuración de **Jugar**, debajo de las opciones generales de la partida.

- **Ver partidas** abre el historial, paginado en grupos de 20.
- El icono de análisis abre el PGN seleccionado en una pestaña normal de análisis.
- La papelera de una fila elimina únicamente esa partida y vuelve a calcular el marcador correspondiente.
- La papelera del panel elimina todo el historial y todos los marcadores.
- El icono de reinicio global conserva las partidas, pero pone todos los marcadores en cero.

Las eliminaciones y los reinicios requieren confirmación. Borrar el historial no afecta a los PGN que el usuario haya exportado previamente a otra ubicación.

## Análisis

Al abrir una partida del historial se crea una pestaña de análisis con el PGN almacenado. Los cambios que se hagan durante el análisis no sobrescriben silenciosamente el historial original. Si se desea conservar una versión anotada, se puede guardar como un PGN normal mediante las acciones existentes de En Croissant.

## Prueba manual recomendada

1. En **Jugar**, selecciona un jugador humano y un bot humano.
2. Termina una partida, incluida la posibilidad de rendirse.
3. Pulsa **Nueva partida** o vuelve a la configuración.
4. Comprueba que el contador del historial aumentó y que el marcador corresponde al resultado.
5. Abre **Ver partidas** y pulsa el icono de análisis.
6. Confirma que se abre una pestaña con la partida completa y su resultado.
7. Reinicia el marcador de ese bot y comprueba que queda en `0–0`, mientras la partida continúa en el historial.
8. Juega otra partida y confirma que solo la nueva cuenta en el marcador reiniciado.
9. Elimina una partida individual y después prueba **Borrar historial contra bots**.
10. Reinicia la aplicación y confirma que las partidas que no hayas eliminado siguen disponibles.

## Límites actuales

- El historial se carga desde un único archivo JSON. Es adecuado para la etapa actual y evita el límite de espacio de `localStorage`; si en el futuro se esperan decenas de miles de partidas, convendrá migrarlo a una base de datos indexada.
- No existe todavía búsqueda o filtrado por fecha, color, apertura o resultado.
- Las anotaciones realizadas al analizar una partida no se escriben de vuelta al historial.
- Una partida abortada sin resultado no se guarda.
