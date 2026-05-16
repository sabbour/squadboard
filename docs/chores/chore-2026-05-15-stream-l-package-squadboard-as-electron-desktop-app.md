# Chore: Stream L — package squadboard as Electron desktop app

| Field | Value |
|-------|-------|
| **Chore ID** | `chore-2026-05-15-stream-l-package-squadboard-as-electron-desktop-app` |
| **Created** | 2026-05-15 |
| **Effort** | large |
| **Component** | tooling |
| **Assigned to** | Hockney |
| **Status** | Backlog |

## Goal

Wave 10 lower-priority append from Ahmed (2026-05-15): "Package as an electron app. Look at https://github.com/jmanuelcorral/squadcenter for installation instructions, we should probably have something similar."

Stream L is a 14-item plan covering: architecture decision (server-as-child-process recommended), packages/electron scaffold, renderer integration (HashRouter), embedded-postgres bundling under app.asar (highest-risk item — spike L4 EARLY), MCP child-process compatibility, first-run UX reusing Stream K PageLoading idiom, electron-builder packaging (Win NSIS / mac DMG x64+arm64 / Linux AppImage+.deb), electron-updater auto-update against GitHub Releases, code signing strategy (deferred until certs procured), staged distribution (GitHub Releases → npm → Chocolatey → winget → apt), tray icon + window state + squadboard:// deep links, CLI ↔ App handoff (squadboard app install/launch/status), Playwright e2e against built binary in CI matrix, docs + screenshots mirroring squadcenter INSTALLATION.md style.

Acceptance criteria 69-80 captured in plan.md. Headless server build target MUST be preserved (squadboard serve continues to work for cloud/CI/shared deployments — Electron app is a desktop wrapper around the same server).

Stream parked behind Wave 10 close-out + Streams F/G/H/I/J/K per Ahmed's "lower priority, append" directive. No autopilot dispatch.

## Implementation Notes

Reference architecture: jmanuelcorral/squadcenter (Electron 35 + React 19 + Vite 6 + vite-plugin-electron + electron-builder + electron-updater; multi-channel distribution via npm/Chocolatey/winget/apt/GH Releases).

Hardest piece: bundling embedded-postgres binaries under app.asar — they're real native binaries that must survive packing. Solution: electron-builder asarUnpack + extraResources, then runtime path resolution via process.resourcesPath when process.versions.electron is truthy. Spike this FIRST before committing to a release date.

Owners per plan: Hockney (main process + Postgres bundling + supervisor), Keyser (renderer + first-run + tray reuse of Stream K PageLoading), McManus (architecture review + auto-updater + signing strategy), Redfoot (install docs + README + screenshots), Kujan (packaged-binary e2e in CI matrix), Kobayashi (CLI ↔ App handoff shape).

Plan + acceptance: /home/asabbour/.copilot/session-state/4fa34ed1-d2fd-4363-8668-f63188a1cfe3/plan.md (Stream L section, ACs 69-80). Mirrored to .squad/squadboard/plans/wave-10.md. Directive captured: .squad/decisions/inbox/copilot-directive-2026-05-15-1338-electron.md.

## Checklist

- [ ] Work done in worktree branch `squad/chore-2026-05-15-stream-l-package-squadboard-as-electron-desktop-app`
- [ ] No new user-facing docs required
- [ ] Merged to `main` — worktree removed
