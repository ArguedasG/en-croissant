# Bots humanos — Fase 4.3: validación experimental inicial

Estado: validación inicial de producto completada el 2026-08-19. La calibración estadística profunda continúa diferida.

## Objetivo

Comprobar que los ELO objetivo producen un orden de fuerza razonable entre los seis perfiles actuales y que las diferencias editoriales son observables en partidas normales. Esta validación no intenta convertir todavía los ELO de Maia en una escala externa ni demostrar estadísticamente cada rasgo de personalidad.

## Pruebas revisadas

Se utilizaron series de 10 partidas con colores alternados, semillas registradas y configuraciones conservadas en los manifiestos locales. El usuario revisó manualmente partidas representativas y reportó lo siguiente:

| Serie | Resultado reportado | Lectura |
| --- | --- | --- |
| Nico 1200 — Luna 900 | Nico 8–2 | Coherente con una diferencia de 300 ELO. Ambos son dinámicos; Nico se percibe más agresivo. |
| Vera 1500 — Nico 1200 | Vera 7–3 en puntos | Coherente para una muestra de 10. El manifiesto local desglosa 6 victorias, 2 derrotas y 2 tablas para Vera. |
| Marcos 1700 — Vera 1500 | Marcos 7–3 | Coherente con una diferencia de 200 ELO; apareció un error puntual de pieza de Marcos. |
| Irene 1900 — Marcos 1700 | Irene 9–1 | Algo favorable a Irene, pero plausible en una muestra pequeña; su derrota fue un error instructivo de final de peones. |
| Leo 2200 — Irene 1900 | Leo 8–2 | Coherente; hubo una tabla reñida, un ahogado y un mate en uno permitido por Leo. |

Los cuatro primeros lotes disponibles en el workspace tienen 10/10 partidas registradas, colores alternados y cero fallos. La quinta serie se conserva aquí como resultado reportado por el usuario; sus artefactos no están actualmente en la carpeta privada local.

## Interpretación

Una diferencia de ELO expresa una expectativa probabilística, no un marcador obligatorio. Como referencia, una diferencia de 300 ELO implica aproximadamente 85% de puntuación esperada para el perfil superior, y 200 ELO aproximadamente 76%. Los resultados observados no contradicen esos objetivos: una muestra de 10 partidas tiene demasiado ruido para ajustar pesos a partir de una sola serie.

La revisión manual aporta evidencia suficiente para el producto actual:

- los perfiles se ordenan de forma razonable por fuerza;
- las partidas muestran diferencias perceptibles de carácter, aunque no todos los rasgos sean medibles automáticamente todavía;
- los errores puntuales de perfiles fuertes son compatibles con la naturaleza estocástica de Maia y no constituyen por sí solos un fallo del catálogo;
- no es necesario ejecutar Stockfish sobre todas las partidas para aprobar esta validación.

## Stockfish

Stockfish sería útil como herramienta diagnóstica, no como requisito de aprobación. Puede emplearse después sobre partidas concretas para investigar errores sorprendentes, obtener ACPL o identificar pérdidas tácticas. No hace falta analizar las 50 partidas —mucho menos cientos— para decidir si el orden interno de los bots permite continuar.

La prueba propuesta de posiciones con varios planes de valor similar es buena para una futura validación específica de estilo. Debe mantenerse separada de la calibración de fuerza: conviene construir un conjunto pequeño de posiciones con dos o más planes equivalentes, registrar la elección del bot y repetir semillas. No bloquea la expansión del catálogo.

## Criterio de salida

La Fase 4.3 queda validada para iniciar la expansión inicial cuando se cumplen estos criterios prácticos:

1. existen varias series reproducibles entre perfiles cercanos y separados;
2. los colores están alternados y las partidas se completan sin fallos sistémicos;
3. el orden de resultados es compatible con los ELO objetivo, sin exigir un marcador exacto;
4. una revisión manual breve encuentra diferencias útiles de comportamiento;
5. no aparecen errores repetidos que indiquen un problema técnico o de configuración.

Estos criterios se cumplen con las pruebas actuales. La estimación con intervalos de confianza, el control por apertura/color y la medición automatizada de estilo son mejoras posteriores, no bloqueantes.

## Siguiente fase: 4.4

La siguiente fase puede comenzar con tres tipos de repertorio, sujetos a validación editorial del usuario antes de asignarlos a bots concretos:

- un especialista en una apertura concreta, por ejemplo Londres;
- un bot que siga una línea fija durante los primeros tres movimientos y después abandone deliberadamente el repertorio para dejar actuar a Maia;
- un bot sin repertorio propio, que use únicamente la selección de Maia y el estilo editorial definido.

La implementación técnica puede reutilizar el esquema de repertorios versionado actual. No se necesita todavía un libro externo para comenzar; uno podría ampliar la cobertura más adelante si aporta líneas con licencia y calidad comprobables.
