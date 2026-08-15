# Configuración de Maia 3 para desarrollo

Esta guía corresponde a la integración de la Fase 0. Maia 3 y Python se instalan fuera del
repositorio de Chess Lab. Por ahora la aplicación inicia Maia mediante su interfaz UCI oficial;
el motor todavía no se distribuye junto con Chess Lab.

## 1. Instalar los requisitos en Windows

Instala estas herramientas si todavía no las tienes:

- Git para Windows.
- Python 3.11 de 64 bits. Maia 3 requiere Python 3.10 o posterior; usaremos 3.11 como versión base
  de desarrollo. Durante la instalación, activa el lanzador de Python (`py`).

Abre una ventana nueva de PowerShell y comprueba ambas herramientas:

```powershell
git --version
py -3.11 --version
```

## 2. Instalar Maia 3 en un entorno aislado

Ejecuta estos comandos en PowerShell:

```powershell
$maiaRoot = Join-Path $env:LOCALAPPDATA "ChessLab\maia3"
New-Item -ItemType Directory -Force -Path (Split-Path $maiaRoot)
git clone https://github.com/CSSLab/maia3.git $maiaRoot
Set-Location $maiaRoot
py -3.11 -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install .
& .\.venv\Scripts\maia3-cache.exe
```

El último comando descarga el modelo Maia3-5M en la caché estándar de Hugging Face. La primera
descarga puede tardar; las siguientes ejecuciones reutilizarán el modelo local.

Comprueba el ejecutable UCI y la carga del modelo:

```powershell
$maiaEngine = Join-Path $maiaRoot ".venv\Scripts\maia3-5m.exe"
"uci`nisready`nquit`n" | & $maiaEngine --device cpu --no-use-amp
```

La salida debe contener `uciok` y `readyok`.

## 3. Registrar Maia en Chess Lab

1. Inicia Chess Lab con `pnpm dev` desde la raíz del repositorio.
2. Abre **Motores**, pulsa **Añadir motor** y selecciona la pestaña **Local**.
3. Selecciona este ejecutable:
   `%LOCALAPPDATA%\ChessLab\maia3\.venv\Scripts\maia3-5m.exe`.
4. Usa `Maia3 5M (desarrollo)` como nombre.
5. En **Argumentos del ejecutable**, introduce exactamente un argumento por línea:

```text
--use-uci-history
--seed
{{randomSeed}}
--temperature
1.0
--multipv
1
--device
cpu
--no-use-amp
```

6. Guarda el motor.
7. Abre sus ajustes avanzados. Para la primera prueba, deja `Elo`, `SelfElo` y `OppoElo` en 1500
   y confirma que `Temperature` sea 1.0.

`{{randomSeed}}` es un marcador propio de Chess Lab. La aplicación lo sustituye por un entero
aleatorio cada vez que inicia el proceso. Los argumentos se pasan directamente al ejecutable,
sin usar un intérprete de comandos.

## 4. Jugar la primera partida

1. Abre **Jugar ajedrez**.
2. Mantén un jugador como **Humano** y cambia el otro a **Motor**.
3. Selecciona `Maia3 5M (desarrollo)`.
4. Empieza con una partida 3+2 o sin límite de tiempo.
5. Juega varias jugadas, retrocede una vez y termina la partida por abandono.
6. Abre **Registros del motor**.

Los registros deberían mostrar:

- una línea `launch:` con un `randomSeed` numérico;
- `setoption name MultiPV value 1`;
- `position fen ... moves ...` después de que se hayan jugado movimientos;
- una respuesta `bestmove` legal.

Inicia dos partidas con las mismas primeras jugadas y comprueba que Maia no repita siempre la
misma continuación. La variación es probabilística, por lo que una jugada puede repetirse; aun
así, los valores `randomSeed` de ambos inicios deben ser distintos.

## 5. Solución de problemas

- Si no se reconoce `py -3.11`, reinstala Python 3.11 con el lanzador de Python activado y abre
  una terminal nueva.
- Si falla `maia3-cache.exe`, comprueba que el equipo pueda acceder a Hugging Face y repite el
  mismo comando.
- Si Chess Lab indica que el motor agotó el tiempo esperando `readyok`, ejecuta la comprobación
  de la sección 2 y revisa su salida de error.
- Si todas las partidas son deterministas, verifica que los argumentos contengan
  `--temperature` / `1.0` y `--seed` / `{{randomSeed}}` en líneas separadas.
- No selecciones un archivo de modelo `.pt` como ejecutable; selecciona `maia3-5m.exe`.
