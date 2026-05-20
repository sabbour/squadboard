# Orchestration Log — Redfoot (Wave 4)

**Timestamp:** 2026-05-20T14:00:00Z  
**Agent:** Redfoot (Docs / DevRel Dev)  
**Wave:** 4

## Spawn Manifest

- **Task:** Create Squad→Squadboard onboarding guide and update docs index
- **Files Created:** `docs/setup/getting-started-from-squad.md` (128 lines, 3,240 bytes)
- **Files Modified:** `docs/setup/mcp-install.md`, `docs/README.md`
- **Commit:** c4f2c3c05

## Deliverables

### 1. New Getting Started Guide

**File:** `docs/setup/getting-started-from-squad.md`  
**Scope:** Squad CLI users transitioning to Squadboard

**Key Decisions:**
- Local-first default (PGlite with zero config)
- Graceful degradation upfront (filesystem fallback documented)
- Storage provider (`SQUADBOARD_SQUAD_STORAGE_PROVIDER`) as the mental model
- Project ID discoverability via CLI command
- Both modes work simultaneously (board is additive)

**Coverage:**
- What you're getting (board, MCP, ceremonies, run history)
- Storage provider choice (PGlite vs. PostgreSQL)
- MCP wiring without disruption
- Graceful fallback when MCP is NOT wired
- Smoke test for MCP verification

### 2. Updated MCP Install Doc

**File:** `docs/setup/mcp-install.md`  
**Additions:**
- Storage Providers & Graceful Degradation table
- Project ID discovery moved earlier
- Clear `SQUADBOARD_SQUAD_STORAGE_PROVIDER` explanation

### 3. Rewritten Docs Index

**File:** `docs/README.md`  
**Changed from:** Alphabetical table of files  
**Changed to:** User journey organized by role/task

**New Structure:**
1. Getting Started
2. API Reference
3. Ceremonies & Workflows
4. Core Concepts
5. Product Documentation
6. Specification
7. Release & Quality

## Metrics

- **Lines added:** 220+
- **User paths covered:** 4 (Squad-only, local board, team+MCP, migration)
- **Code blocks:** 8+ runnable commands
- **Setup options:** 2 (PGlite, PostgreSQL)
- **Mental models explained:** 3

## Acceptance Criteria

- [x] Getting Started guide <200 lines
- [x] Every command is runnable
- [x] Storage provider table explains all modes
- [x] Graceful degradation documented
- [x] Project ID CLI command included
- [x] docs/README.md organized by user journey
- [x] All docs linked from README
