---
title: Copilot CLI + Squad coexistence
description: Server-owned equivalents that let Squadboard coexist with the Copilot CLI + Squad driver workflow.
---

# Copilot CLI + Squad coexistence

Squadboard is not trying to replace Copilot CLI or upstream [Squad](https://github.com/bradygaster/squad). The goal is coexistence: the CLI can remain the interactive place where ambiguous work is discussed, while Squadboard becomes the durable place where cards, routing decisions, runs, ceremonies, and audit records live.

## Deterministic routing

The server handles concrete cases before asking an LLM:

- named-agent requests
- blocked parent issues
- human-only operations such as credentials, signing, billing, and organization-level secrets
- all-agents-busy ambiguity
- backlog no-match gates
- thin issue ambiguity
- circuit-breaker lockouts

## LLM role

The LLM is reserved for ambiguity: semantic role fit, charter interpretation, summarization, and converting fuzzy instructions into structured proposals.

## Spawn fidelity

Server-spawned agents receive charter, team root, requester, workspace path/mode, history and decision-reading instructions, assigned skills, MCP context, drop-box guidance, and validation expectations.

See [Copilot CLI + Squad coexistence](../user-guide/copilot-squad-coexistence.md) for the operating model.
