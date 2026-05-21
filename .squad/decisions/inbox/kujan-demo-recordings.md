# Decision: Playwright demo recordings for README assets

**Date:** 2026-05-21  
**Author:** Kujan (Tester / QA)  
**Requested by:** Ahmed

## Context

Ahmed wanted a repeatable way to capture polished product footage for the README and marketing docs without turning on full-video recording for every E2E test.

## Decision

Add a dedicated Playwright spec, `packages/e2e/tests/demo-recording.spec.ts`, that records four marketing-friendly user journeys and enables `video: 'on'` only for that spec via `test.use(...)`.

## Why this shape

- The shared Playwright config already records `retain-on-failure`; the demo spec upgrades itself to always-on video without changing the rest of the suite.
- The demo command disables server reuse so the onboarding video starts from a clean first-run state.
- Ceremony and live-run clips use deterministic API mocks where needed so the visuals are stable enough for README capture.
- Key screenshots are captured alongside video so docs still have a fallback if GIF conversion is skipped.

## Files changed

- `packages/e2e/tests/demo-recording.spec.ts`
- `packages/e2e/package.json`
- `packages/e2e/DEMO.md`

## Usage

```bash
cd packages/e2e
pnpm demo:record
```

Artifacts land in `packages/e2e/test-results/demo-recording-*/`.
