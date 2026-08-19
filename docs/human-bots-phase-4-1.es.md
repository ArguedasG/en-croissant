# Bots humanos — Fase 4.1: perfiles paramétricos y versionado

**Estado: Implementada para su alcance técnico y editorial inicial el 18 de agosto de 2026.** La clasificación está aprobada como hipótesis editorial; todavía no es una medición empírica.

## Objetivo

La Fase 4.1 prepara una base práctica para crear bots que se diferencien por decisiones observables, sin afirmar que una personalidad o un ELO ya estén calibrados. La fuerza objetivo, el muestreo, el estilo de decisión, el estilo de apertura, el repertorio y el tiempo de reflexión permanecen separados.

## Contrato paramétrico actual

Cada perfil conserva su ELO objetivo, configuración de muestreo, repertorio y tiempo. Además, ahora puede declarar:

- estilo de decisión: agresión y tendencia a complicar o simplificar;
- estilo de apertura: agudeza de la apertura y grado de apoyo en teoría;
- evidencia del estilo: `unclassified`, `editorial` o `measured`.

Los niveles usados para cada eje son `low`, `medium` y `high`. Los seis perfiles existentes ya tienen una clasificación editorial explícita y se marcan como `editorial`. Esto significa que la descripción fue aprobada como hipótesis de diseño; no significa que el comportamiento haya sido medido contra partidas humanas.

## Versionado y trazabilidad

- catálogo de perfiles: `4.1.1`;
- perfil: versión `2`;
- esquema de repertorio: versión `1`;
- modelo declarado: `maia3`;
- versión concreta del motor: la versión reportada por la instalación UCI, o `unknown` si no está disponible;
- configuración de trazabilidad PGN: versión `5`.

Las cabeceras PGN registran el perfil, catálogo, repertorio, modelo, versión del motor, evidencia y los cuatro ejes editoriales. El manifiesto conserva la configuración reproducible del jugador, incluyendo el motor y el repertorio. Las mediciones anteriores siguen siendo legibles: los campos nuevos son opcionales y se exportan con una celda vacía cuando un registro histórico no los contiene.

## Límites de esta entrega

Esta fase establece una primera descripción editorial, pero no convierte el ELO objetivo ni los ejes de estilo en mediciones calibradas. Tampoco modifica todavía los pesos actuales de apertura. La Fase 4.3 comprobará si las diferencias observadas corresponden con estas hipótesis.

## Clasificación editorial inicial

Se aprobó usar estos ejes como lenguaje común:

1. agresión: defensivo — equilibrado — agresivo;
2. complejidad: simplificador — equilibrado — complicador;
3. apertura: sólida — equilibrada — aguda;
4. teoría: poco teórica — equilibrada — teórica.

La asignación inicial es:

| Perfil | Decisión | Apertura | Interpretación breve |
| --- | --- | --- | --- |
| Luna | agresiva y complicadora | intermedia, poco teórica | exploratoria y variada |
| Nico | agresivo y complicador | aguda, poco teórica | dinámico y táctico |
| Vera | equilibrada | intermedia y equilibrada | punto de referencia general |
| Marcos | defensivo y simplificador | sólida, moderadamente teórica | selectivo y posicional |
| Irene | defensiva y simplificadora | sólida y teórica | clásica y paciente |
| Leo | equilibrado | intermedia y teórica | preciso y orientado a líneas principales |

Solo tras la calibración podremos marcar los perfiles como `measured` y describir diferencias con evidencia.

## Siguiente paso técnico

Con esta base se continuó con la Fase 4.3: lotes Maia–Maia, colores alternados, semillas registradas, controles de tiempo constantes y comparación por perfil, color, apertura y fase de partida. La validación inicial quedó documentada en `docs/human-bots-phase-4-3.es.md` y permite pasar a la Fase 4.4. No es necesario publicar los tests locales ni los documentos de planificación privados para ejecutar o reproducir esa validación.
