# Ops / Incident Runbook

A Squad App for operational runbook and incident response management.

## Purpose

Incident response pipeline: alerts / triaging / mitigating / resolved / postmortem kanban. Team: on-call and escalation leads. Ceremonies: incident open, postmortem.

## Team

- **OnCall** — On-Call Lead: first responder, owns incident triage, mitigation, and resolution.
- **Escalation** — Escalation Lead: owns SEV1/SEV2 escalations, external communication, and postmortem facilitation.

## Kanban Columns

`alerts` → `triaging` → `mitigating` → `resolved` → `postmortem`

## Ceremonies

- **Incident Open** — triggered on entry to `triaging` column
- **Postmortem** — triggered on entry to `postmortem` column

## Skills

- **Incident Timeline Builder** — structured incident timeline format
