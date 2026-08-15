# Bots humanos: Fase 1

La Fase 1 convierte la integración técnica de Maia 3 en una experiencia basada en perfiles. Los
bots aparecen como un tercer tipo de oponente en la pantalla **Jugar ajedrez**:

```text
Humano | Motor | Bot humano
```

## Perfiles iniciales

| Perfil | ELO objetivo | Estilo de muestreo | Temperatura | TopP |
| --- | ---: | --- | ---: | ---: |
| Luna | 900 | Explorador | 1.25 | 0.98 |
| Nico | 1200 | Explorador | 1.12 | 0.96 |
| Vera | 1500 | Equilibrado | 1.00 | 0.94 |
| Marcos | 1700 | Equilibrado | 0.92 | 0.92 |
| Irene | 1900 | Selectivo | 0.82 | 0.88 |
| Leo | 2200 | Selectivo | 0.72 | 0.84 |

El estilo describe la amplitud de muestreo de jugadas humanas, no una personalidad estratégica
como «táctico» o «posicional». Esa distinción necesitará medición sobre partidas y mecanismos
adicionales antes de poder presentarse honestamente al usuario.

## Configuración aplicada

Al iniciar una partida, el perfil se convierte en opciones UCI para el Maia seleccionado:

- `Elo` y `SelfElo`: ELO objetivo del perfil;
- `OppoElo`: ELO del otro perfil en partidas bot contra bot; contra una persona se usa por ahora el
  ELO del propio perfil;
- `Temperature` y `TopP`: variedad de muestreo del perfil;
- `MultiPV`: siempre 1 durante la partida.

El modo también garantiza los argumentos `--use-uci-history` y `--seed {{randomSeed}}` si no
estaban presentes en el motor registrado. Los demás argumentos y ajustes del motor se conservan.

## Prueba manual

1. Inicia Chess Lab y abre **Jugar ajedrez**.
2. Deja un lado como **Humano** y selecciona **Bot humano** en el otro.
3. Confirma que aparezca tu instalación local de Maia 3.
4. Selecciona `Luna`, juega algunas jugadas y revisa los registros.
5. Repite con `Leo`.
6. Comprueba que los registros contengan los valores de `SelfElo`, `OppoElo`, `Temperature`,
   `TopP` y `MultiPV` correspondientes al perfil elegido.
7. Retrocede una jugada y confirma que el bot continúe jugando normalmente.

## Limitaciones deliberadas

- Los valores ELO condicionan el comportamiento de Maia, pero todavía no están calibrados contra
  una población de jugadores de Chess Lab.
- Los estilos actuales controlan diversidad y concentración de jugadas; no garantizan estilos
  tácticos, agresivos, sólidos o posicionales.
- Los perfiles todavía no tienen repertorios de aperturas propios.
- Maia continúa siendo una instalación externa seleccionada por el usuario.

La siguiente fase debe medir los perfiles, separar nivel de estilo y añadir repertorios ponderados
por perfil antes de ampliar el catálogo.
