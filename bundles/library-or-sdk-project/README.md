# Library / SDK Project

A Squad App for open-source library and SDK development.

## Purpose

Kanban for npm / PyPI library development: triage through release. Ceremonies cover API RFC, version bump, and release notes. Team includes a lead, implementer, docs writer, and tester.

## Team

- **Lead** — Library Lead: owns public API design, versioning policy, and release cadence.
- **Implementer** — Core Implementer: writes library internals, unit tests, and benchmarks.
- **Docs** — Documentation Writer: owns API reference, guides, migration notes, and examples.
- **Tester** — QA / Compatibility Tester: validates across supported runtime versions.

## Kanban Columns

`triage` → `api-design` → `impl` → `docs` → `release`

## Ceremonies

- **API RFC** — triggered on entry to `api-design` column
- **Implementation Review** — triggered on entry to `docs` column
- **Version Bump & Release Notes** — triggered on entry to `release` column

## Skills

- **Semver Discipline** — strict semantic versioning policy
- **Changelog Authoring** — Keep a Changelog format
