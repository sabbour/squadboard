# Demo recordings

Use the Playwright demo spec to capture README and marketing footage.

## Run

```bash
cd packages/e2e
pnpm demo:record
```

The script forces `SQUADBOARD_E2E_REUSE_SERVER=0` so the first-run onboarding clip starts from a fresh server state.

## Output

Artifacts are written to `packages/e2e/test-results/demo-recording-*/`.
Each test gets its own Playwright video plus fallback screenshots captured in the test output folder.

## Included clips

- First run onboarding
- Connect a repo (Apps → Install from GitHub)
- Ceremony execution
- Live run tracking

## Convert video to GIF

```bash
ffmpeg -i video.webm -vf "fps=10,scale=1280:-1" demo.gif
```

For higher-quality GIF output, use `gifski` after exporting frames or converting from the recorded video.
