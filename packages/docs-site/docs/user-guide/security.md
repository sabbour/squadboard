---
title: Security
description: Security defaults for local-first operation, GitHub credentials, MCP, worktrees, and LLM boundaries.
---

# Security

## Local-first default

Squadboard is designed to run locally by default. The database, `.squad/` files, generated reports, and decision inbox entries stay on the machine unless you configure external services.

## GitHub credentials

Use GitHub Apps when possible for fine-grained permissions. Personal access tokens are supported but should be scoped narrowly.

Private keys and tokens are sensitive. Do not commit them to source control.

## MCP trust boundary

Stdio MCP runs as a subprocess of the local client. HTTP MCP should use HTTPS and token auth outside localhost development. Only expose MCP tools that a project actually needs.

## Worktrees and branches

Cleanup only removes safe worktrees and safe `squad/*` branches. Path operations should fail closed when a path is unsafe or ambiguous.

## LLM boundaries

The LLM does not own hard safety decisions. Deterministic code owns dependency gates, circuit breakers, availability, audit writing, path safety, and schema validation.

## Responsible AI stance

Squadboard is pre-alpha software. Keep human review on code changes, GitHub writes, imports, and any workflow that affects shared repositories. Use it for bounded assistance and auditable orchestration, not unchecked production automation.
