# Release Readiness Checklist

This document outlines the steps to prepare Squadboard for release to npm and GitHub.

## Current Local Readiness Findings

- `pnpm docs:build` succeeds and regenerates `llms.txt`/`llms-full.txt`.
- `pnpm npm:build` succeeds for the SDK, CLI, and server packages.
- `pnpm npm:publish:dry-run` succeeds for the publishable packages with the `prealpha` tag.
- No Git remote is configured in this checkout. `gh repo view sabbour/squadboard` does not currently resolve to a repository, so create/configure the GitHub repository before pushing.
- Git history is not public-push ready yet: `git count-objects -vH` reports a 282.38 MiB pack and the largest blobs are committed `node_modules`/tool binaries, including a Copilot binary. Clean history before making the repository public.

## Pre-Release Validation

### Code Quality
- [ ] Run full test suite: `pnpm test:e2e`
- [ ] All tests passing (no skips or warnings)
- [ ] Linter clean: `pnpm lint` (if available)
- [ ] Type check clean: `pnpm typecheck` (if available)
- [ ] No console errors or warnings in development build

### Documentation
- [ ] README.md is current and links are valid
- [ ] Getting-started guide is clear and tested
- [ ] E2E test guide covers real workflows
- [ ] Squad App creation guide is complete
- [ ] All internal docs are discoverable from README

### Docs Build
- [ ] Docs build succeeds: `pnpm docs:build`
- [ ] No broken links in built docs
- [ ] All guides render correctly
- [ ] llms.txt generated for LLM ingestion

### Features & Known Limits
- [ ] `docs/features.md` is current
- [ ] Known gaps documented in `features/roadmap-gaps.md`
- [ ] Pre-alpha warning visible in README and docs

### GitHub Integration
- [ ] LICENSE file present and correct (MIT)
- [ ] CHANGELOG.md updated with new features
- [ ] Git history is clean and commit messages are clear

## Publishing Steps

### Package Release
1. Update version in `package.json` following semver
2. Update CHANGELOG.md with release notes
3. Commit with message: `Release: v<version>`
4. Create git tag: `git tag v<version>`
5. Push: `git push origin && git push origin --tags`

### npm Publication
```bash
pnpm publish --access public
```

### Post-Release
- [ ] npm package is public and installable
- [ ] GitHub release created with release notes
- [ ] Docs site deployed (if separate hosting)
- [ ] Documentation links to new version

## Validation After Release

- [ ] Test fresh install: `npx @sabbour/squadboard init`
- [ ] Verify MCP integration works
- [ ] Cross-surface sync validation (Squadboard + CLI)
- [ ] E2E test with live Copilot CLI (if applicable)

## Rollback Plan

If critical issues found post-release:
1. Deprecate version: `npm deprecate @sabbour/squadboard@<version> "Critical bug found"`
2. Release hotfix on previous version
3. Publish new release with fix
4. Undeprecate working version

## Release Cadence

- **Alpha:** Release as needed for testing
- **Beta:** Release weekly with known issue summary
- **Stable:** Release monthly with formal changelog
