# Maia 3 development setup

This setup is intended for the Phase 0 development integration. Maia 3 and Python are installed
outside the Chess Lab repository. The application launches Maia through its official UCI entry
point and does not bundle it yet.

## 1. Prerequisites on Windows

Install the following if they are not already available:

- Git for Windows.
- 64-bit Python 3.11. Maia 3 supports Python 3.10 or newer; 3.11 is the development baseline for
  this integration. Enable the Python launcher during installation.

Open a new PowerShell window and verify both tools:

```powershell
git --version
py -3.11 --version
```

## 2. Install Maia 3 in an isolated environment

Run these commands in PowerShell:

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

The last command downloads the Maia3-5M checkpoint into the standard Hugging Face cache. The
first download can take a while, but later launches work from the local cache.

Verify the UCI executable and model load:

```powershell
$maiaEngine = Join-Path $maiaRoot ".venv\Scripts\maia3-5m.exe"
"uci`nisready`nquit`n" | & $maiaEngine --device cpu --no-use-amp
```

The output must contain both `uciok` and `readyok`.

## 3. Register Maia in Chess Lab

1. Start Chess Lab with `pnpm dev` from the repository root.
2. Open **Engines**, choose **Add Engine**, and select the **Local** tab.
3. Select this executable:
   `%LOCALAPPDATA%\ChessLab\maia3\.venv\Scripts\maia3-5m.exe`.
4. Use `Maia3 5M (development)` as the name.
5. In **Executable arguments**, enter exactly one argument per line:

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

6. Save the engine.
7. Open the engine's advanced settings. For the first test, leave `Elo`, `SelfElo`, and
   `OppoElo` at 1500 and confirm that `Temperature` is 1.0.

`{{randomSeed}}` is a Chess Lab argument placeholder. It is replaced with a random unsigned
integer each time the process starts. Arguments are passed directly to the executable without a
shell.

## 4. Run the first game

1. Open **Play Chess**.
2. Keep one player as **Human** and change the other to **Engine**.
3. Select `Maia3 5M (development)`.
4. Start with a 3+2 or unlimited game.
5. Play several moves, use takeback once, and finish by resignation.
6. Open **Engine Logs**.

The logs should show:

- a `launch:` line with a numeric seed instead of `{{randomSeed}}`;
- `setoption name MultiPV value 1`;
- `position fen ... moves ...` after moves have been played;
- a legal `bestmove` response.

Start two games with the same first moves and confirm that Maia does not always repeat the same
continuation. Variation is probabilistic, so a repeated move is possible; the launch seeds should
still be different.

## 5. Troubleshooting

- If `py -3.11` is not found, reinstall Python 3.11 with the Python launcher enabled and open a
  new terminal.
- If `maia3-cache.exe` fails, confirm that the machine can access Hugging Face and rerun the same
  command.
- If Chess Lab reports `Engine timed out waiting for readyok`, run the verification command from
  section 2 and inspect its error output.
- If every game is deterministic, verify that the executable arguments include both
  `--temperature` / `1.0` and `--seed` / `{{randomSeed}}` on separate lines.
- Do not select a `.pt` checkpoint as the engine executable. Select `maia3-5m.exe`.
