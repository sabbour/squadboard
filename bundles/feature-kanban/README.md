# Feature Kanban

A generic product-management workflow for shaping and launching features.

## What is included

- **Board:** Backlog → Discovery → Shaping → Prototyping → Launch Readiness → Done.
- **Agents:** ProductManager, ProductResearcher, PrototypeDesigner, DocsWriter, and QualityReviewer.
- **Skills:** customer research, PRD writing, prototype creation, feature naming, feature disclosure, and feature documentation.
- **Ceremonies:** customer signal triage, feature shaping review, and launch readiness review.
- **Seed issues:** generic product examples for research, PRD, prototype, docs, and validation work.

## Best for

Use this template when a team needs a lightweight PM operating system for customer-backed feature work: gather signals, write a PRD, prototype the riskiest assumption, name the feature, prepare docs/release notes, and make a launch decision.

## Install

```bash
npx squadboard app install ./bundles/feature-kanban --dry-run
npx squadboard app install ./bundles/feature-kanban
```

## File layout

```text
bundles/feature-kanban/
├── squadapp.json
├── squad-bundle.json
├── project.json
├── agents/
├── ceremonies/
├── skills/
└── issues/seed.json
```
