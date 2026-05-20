# Session Log: Ceremony Audit Route Bug Fix

**Timestamp:** 2026-05-20T14:09:31Z  
**Session Type:** Bug fix and code review  
**Component:** Server ceremony API routes  

## Summary

Fixed a route precedence bug in ceremony audit endpoints. The generic `/:id` route was intercepting `/audit` requests, causing 400 errors on UUID parsing failures instead of routing to the audit handler.

## Problem

- Route: `/api/projects/:projectId/ceremonies/audit` was failing
- Root cause: Generic route `/:id` processed before specific `/audit` route
- Impact: Ceremony audit feature broken

## Solution

Reordered route handlers in server to ensure specific routes register before generic routes:
- `/audit` now routes correctly
- Generic `/:id` remains for other ceremony lookups

## Outcome

- **Commit:** f4a6fb303 — `fix(server): route ceremony audit before ids`
- **Tests:** ✅ PASS — `src/__tests__/ceremonies-list-route.test.ts` (2 tests)
- **Review:** ✅ Approved by Kujan
- **Status:** Merged and complete

---
