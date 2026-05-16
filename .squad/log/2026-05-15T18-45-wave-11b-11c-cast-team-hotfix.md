# Wave 11B+11C Close-Out Session — Cast-Team Modal Hotfix

**Date:** 2026-05-15T18:45:00-07:00  
**Root Cause Hunt:** 1 session  
**Bugs Fixed:** 2 (Crash #1, Crash #2)  
**Tests Locked:** 4 sub-tests, 9.9s pass time

---

## Session Flow

1. **Bug Report:** Cast-Team modal crash on agents page. Error: "Unexpected token '<'". No modal rendered.

2. **Root Cause Hunt:**
   - Hockney (M1) traced crash to missing server routes: `/hire-team/propose` and `/hire-team/confirm` returning HTML instead of JSON
   - Keyser (M2) added Content-Type guard in apiFetch to detect and report HTML-200 crashes with friendly error
   - Keyser (M3) fixed secondary bug: clicking any role label toggled Lead only (Fluent Field htmlFor footgun)

3. **Regression Lock:**
   - Kujan (M4) wrote 4-test suite covering all three fixes
   - 4 passed in 9.9s
   - createProjectViaApi() helper added to fixtures.ts for WSL/Chromium headless workaround

4. **Scribe Merge:**
   - 4 directives merged into decisions.md
   - Inbox emptied
   - Learnings documented for Hockney (Express catch-all behavior) + Keyser (Fluent Field htmlFor)

---

## Outcome

Cast-Team modal crash fully fixed and locked. Fleet ready to close Wave 11.
