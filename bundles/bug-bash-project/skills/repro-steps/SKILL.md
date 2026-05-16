# Repro Step Authoring

**Category:** quality

Structured reproduction steps: environment, preconditions, exact actions, observed vs expected behavior.

## Repro Step Authoring

Every bug report must include:

```
**Environment:** <OS, runtime version, package version>
**Preconditions:** <state the system must be in before starting>
**Steps to reproduce:**
1. ...
2. ...
3. ...
**Observed:** <what actually happens>
**Expected:** <what should happen>
**Severity:** P0 (crash/data-loss) | P1 (major, no workaround) | P2 (minor, has workaround) | P3 (cosmetic)
```

Rules:
- Steps must be atomic and ordered. Each step = one action.
- "Observed" must be specific — include error messages verbatim.
- If you can't reproduce it, say so and note what you tried.
- Attach screenshots, logs, or stack traces as needed.
