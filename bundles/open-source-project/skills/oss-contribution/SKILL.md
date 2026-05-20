# OSS Contribution

**Category:** process

Community contribution workflow: fork → branch → PR → review → merge with changelog entry.

## OSS Contribution Workflow

Every contribution follows this discipline:

1. **Link to an issue**: every PR must reference a GitHub issue (`Fixes #123`).
2. **Fork and branch**: work on a personal fork; branch name format `<type>/<short-slug>` (e.g. `fix/null-pointer`, `feat/dark-mode`).
3. **Small PRs**: one logical change per PR. If a change is large, split it.
4. **Tests first**: add or update tests before opening the PR.
5. **Changelog entry**: add a one-line entry to `CHANGELOG.md` in the appropriate section.
6. **Squash before merge**: maintainer squashes to keep history clean.
7. **DCO / CLA**: sign off commits if the project requires it (`git commit --signoff`).
