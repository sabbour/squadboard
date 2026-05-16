# Semver Discipline

**Category:** release

Strict semantic versioning: patch for fixes, minor for backwards-compatible additions, major for breaking changes.

## Semver Discipline

Follow semantic versioning (semver.org) rigorously:

- **PATCH** (x.y.Z): backwards-compatible bug fix only. No new public API.
- **MINOR** (x.Y.0): backwards-compatible new functionality. Existing API is unchanged.
- **MAJOR** (X.0.0): any breaking change to the public API. Adding required parameters, removing exports, changing types.

**Rules:**
1. A breaking change in any public export forces a MAJOR bump — no exceptions.
2. Deprecation is MINOR (add `@deprecated` JSDoc/docstring, keep the symbol).
3. Never increment PATCH if ANY public behaviour changed.
4. `0.x.y` versions: MINOR can contain breaking changes. Graduate to `1.0.0` before promising stability.
