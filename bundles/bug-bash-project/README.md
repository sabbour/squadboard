# Bug Bash Project

A Squad App for time-boxed bug bash events.

## Purpose

Focused on cleaning a bug backlog fast: triage / verified / in-fix / verified-fixed kanban. Team: a triage lead and three fixers. Ceremonies: bug-fix loop and batch-close.

## Team

- **TriageLead** — owns initial bug assessment, severity classification, and routing.
- **Fixer1**, **Fixer2**, **Fixer3** — implement fixes and write regression tests.

## Kanban Columns

`triage` → `verified` → `in-fix` → `verified-fixed`

## Ceremonies

- **Bug Fix Loop** — triggered on entry to `verified` column
- **Batch Close** — manual trigger to summarise and ship verified fixes

## Skills

- **Repro Step Authoring** — structured reproduction step format
