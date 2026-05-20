# Semantic Versioning

**Category:** engineering

SemVer discipline: MAJOR.MINOR.PATCH with pre-release and build metadata conventions.

## Semantic Versioning

Follow SemVer 2.0.0 (https://semver.org/) for all releases:

- **MAJOR**: incompatible API changes.
- **MINOR**: new backwards-compatible functionality.
- **PATCH**: backwards-compatible bug fixes.
- **Pre-release**: append `-alpha.1`, `-beta.2`, `-rc.1` as needed.
- **Build metadata**: append `+build.20241231` for informational suffixes.

Rules:
1. Never reuse a version number once published.
2. `0.y.z` is for initial development — anything may change.
3. Deprecate before removing — give consumers at least one MINOR release of notice.
4. Tag releases in git: `git tag -a v1.2.3 -m 'Release v1.2.3'`.
