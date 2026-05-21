# Demo recordings

Use the Playwright demo spec to capture README and marketing footage.

## Run

```bash
cd packages/e2e
pnpm demo:record
```

The command:
1. Kills any stale dev-server processes on ports 5173 and 3000
2. Wipes `.demo-home/` so PGLite starts with an empty database
3. Starts fresh API and Vite servers
4. Seeds a "Squadboard" and a "Contoso" project (the clean-slate state shown in the demos)
5. Records all four scenarios at 1920×1080 (Full HD) with `deviceScaleFactor: 2` for crisp text

## Output

Artifacts are written to `packages/e2e/demo-results/`.
Each test folder contains a `.webm` video plus annotated PNG screenshots captured at key moments.

## Included clips

| Clip | File prefix | What it shows |
|------|------------|---------------|
| A — First run | `first-run-*` | Home page with Squadboard + Contoso, create a third project, add a card |
| B — Connect a repo | `repo-connect-*` | Apps → Install from GitHub flow |
| C — Run a ceremony | `ceremony-*` | Ceremony list, editor, trigger a run, live log |
| D — Live run tracking | `live-run-*` | Running → Completed run transcript |

## Convert video to GIF

High-quality palette GIF using ffmpeg:

```bash
ffmpeg -i video.webm \
  -vf "fps=15,scale=1920:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  demo.gif
```

Even better quality with `gifski` (install via `cargo install gifski` or brew/apt):

```bash
gifski --fps 15 --quality 90 -o demo.gif video.webm
```

