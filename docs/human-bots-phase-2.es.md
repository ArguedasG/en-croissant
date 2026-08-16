# Bots humanos — Fase 2

Esta fase convierte los perfiles de la Fase 1 en configuraciones compuestas y añade repertorios de aperturas propios. Los perfiles siguen siendo Luna, Nico, Vera, Marcos, Irene y Leo, pero ya no son una lista plana de valores.

## Componentes independientes

Cada perfil referencia tres componentes distintos:

1. **Nivel**: ELO solicitado a Maia mediante `Elo` y `SelfElo`.
2. **Muestreo**: política formada por `Temperature` y `TopP`. Sigue describiendo amplitud de elección, no un estilo táctico o posicional demostrado.
3. **Repertorio**: conjunto de líneas UCI con pesos y un límite de profundidad.

Esta separación permite cambiar o medir una dimensión sin tener que redefinir las otras dos.

## Repertorios incluidos

| Perfil | Repertorio | Preferencias principales | Profundidad máxima |
| --- | --- | --- | ---: |
| Luna | Variedad temprana | Italiana, Dos Caballos, Escocesa y alternativas | 12 plies |
| Nico | Juegos abiertos | Italiana, Dos Caballos, Escocesa y Siciliana | 14 plies |
| Vera | Mezcla clásica | Española, Gambito de Dama, Eslava e Inglesa | 14 plies |
| Marcos | Peón de dama | Gambito de Dama, Eslava, Nimzoindia e India de Dama | 16 plies |
| Irene | Clásico sólido | Gambito de Dama, Nimzoindia, Caro-Kann y Francesa | 16 plies |
| Leo | Líneas principales flexibles | Española, Siciliana, Nimzoindia, India de Rey e Inglesa | 16 plies |

Los pesos no obligan a repetir siempre una línea. En cada posición se consideran únicamente las líneas cuyo prefijo coincide con la partida y cuya siguiente jugada es legal; después se elige una continuación según sus pesos.

Si el rival se desvía, se alcanza el límite del repertorio o no existe una continuación válida, Maia toma la decisión normalmente. Los repertorios se desactivan para posiciones iniciales personalizadas.

El repertorio del perfil tiene prioridad sobre un libro Polyglot compartido. Si el perfil ya no ofrece una continuación, se intenta el libro Polyglot y finalmente Maia.

## Trazabilidad

Los registros del motor muestran las jugadas procedentes del repertorio con mensajes como:

```text
profile repertoire luna-variety: e7e5
```

Las partidas exportadas a PGN incluyen `WhiteElo` o `BlackElo` y, para cada bot, cabeceras que identifican:

- perfil;
- nivel;
- categoría y política de muestreo;
- repertorio;
- `Temperature` y `TopP`.

`HumanBotConfigVersion` vale `2`. Estos datos preparan la medición posterior sin afirmar todavía que el ELO mostrado esté calibrado.

## Prueba manual recomendada

1. Abre **Jugar** y selecciona **Bot humano**.
2. Juega varias partidas con Luna, Marcos y Leo, alternando colores.
3. Mientras la partida coincida con el repertorio, abre los registros del motor y comprueba que aparezca `profile repertoire <id>: <jugada>`. Si el panel ya estaba abierto, pulsa **Refresh**, porque actualmente no se actualiza en vivo.
4. Juega deliberadamente una desviación temprana. A partir de ese punto deberían volver a aparecer los comandos y respuestas UCI habituales de Maia para sus turnos.
5. Exporta una partida a PGN y comprueba las cabeceras `WhiteBot...` o `BlackBot...`.
6. Inicia una partida desde una posición personalizada y confirma que no aparezcan jugadas del repertorio del perfil.

## Validación automatizada

- Todas las líneas del catálogo se reproducen desde la posición inicial y cada jugada se verifica como legal.
- Las pruebas Rust comprueban coincidencia de prefijos, legalidad, pesos y límite de profundidad.
- Las pruebas TypeScript comprueban composición de perfiles, serialización del repertorio y metadatos PGN.

## Límites conocidos

- Los pesos son una primera configuración editorial; todavía no provienen de frecuencias medidas en partidas humanas por rango ELO.
- El ELO continúa siendo un objetivo solicitado a Maia, no una fuerza calibrada en este producto.
- “Explorador”, “equilibrado” y “selectivo” describen únicamente la amplitud del muestreo.
- El catálogo es pequeño a propósito. Antes de ampliarlo conviene medir repetición, tasa de salida del repertorio y resultados por perfil/color.

La siguiente fase debería usar las cabeceras PGN y los registros para ejecutar partidas de medición, obtener métricas por componente y ajustar pesos o niveles con evidencia.
