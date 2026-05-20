# Squad Doc Review

Public-safe Squadboard App for reviewing documentation changes in the Squad repository.

## Triggers

The app declares two review triggers:

| Trigger | Default | Purpose |
|---|---|---|
| Scheduled | Weekly, Mondays at 09:00 UTC (`0 9 * * 1`) | Review changed or stale docs since the last cursor, plus explicitly queued docs. |
| Manual | Run now from the ceremony surface | Review selected docs, changed docs, or the configured source immediately. |

Manual ceremony firing is a reusable platform capability for every ceremony, not a Squad Doc Review-specific button. Selected-doc context is passed through the manual run trigger source using the contract declared in `project.settings.docReview.manual` and the manual trigger config.

## Intake and dedupe contract

`squadboard.doc-review-intake.v1` is configured for `https://github.com/bradygaster/squad` and defaults to:

- Paths: `docs/**`, `README.md`, `CONTRIBUTING.md`
- Review profiles: technical accuracy, reader success, staleness
- Stale threshold: 30 days by default, configurable
- Cursor/dedupe key: repo + doc path + blob/commit SHA + review profile
- Include explicitly queued docs even when unchanged
- Triage labels/stages: docs, technical review, reader review, maintainer review, needs owner

## Final action

The default final action is **not** to edit docs or open a PR. It creates or updates Squadboard review issues grouped by doc path. Each issue should contain findings, severity, owner recommendation, source SHA/review profile, and a suggested patch/PR checklist.

An optional future action can draft a PR after human approval.

## App-specific config

The app owns the repo/docs globs, weekly cadence, stale threshold, review rubric/profile, triage labels/stages, and final-action policy. The platform owns scheduled execution, Run now with context, changed-doc enumeration, source-specific dedupe/cursor storage, and creating/updating traceable review issues.
