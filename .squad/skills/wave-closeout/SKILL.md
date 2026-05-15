# SKILL: Wave Closeout / E1 Gate

**Owner:** Kujan (QA/Tester)  
**Applies to:** Any wave that has reached E1 (test sweep & commit gate)  
**Last updated:** 2026-05-15

---

## Purpose

Standardised checklist and procedure for closing out a Squadboard development wave. Run this at the end of every wave before declaring it shipped.

---

## Steps

### Step 1 — Build verification
```bash
pnpm -r build
```
All packages (cli, server, client) must exit 0. `e2e` has no build step. Vite chunk-size warnings are non-blocking.

### Step 2 — Unit tests
```bash
# Check if any package has a test script:
grep -r '"test"' packages/*/package.json
```
If no test runner exists, note it as a gap and continue. Do NOT add a runner mid-wave.

### Step 3 — E2E suite
```bash
pnpm --filter @sabbour/squadboard-e2e test
```
- All non-fixme tests must pass.
- If a test fails, determine: regression (block commit) vs pre-existing env issue (warn, continue).
- Common regression root causes: imported-but-unmounted routers; missing column seeding in fresh projects.

### Step 4 — AC smoke-walk (source code)
For each AC in the wave plan, locate the implementation in source and verify the key line exists. Document each AC as ✅ or ❌.

### Step 5 — Stray file sanity check
```bash
git status --porcelain | grep "??" | grep -v "node_modules\|dist/\|playwright-report\|test-results"
```
Legitimate untracked files: `.squad/squadboard/` tree, `dogfood.md`, any intentional runtime artifacts. Runtime logs and playwright artifacts must be in `.gitignore`.

### Step 6 — CHANGELOG.md
If `CHANGELOG.md` exists at root, add or update the wave section with New / Fixed / Changed / Removed groups. If it doesn't exist, skip (Redfoot owns doc creation).

### Step 7 — Commit
```bash
git add -A
git commit -m "Wave N: <one-line summary>

<stream list and key changes>

Co-authored-by: Squad <squad@noreply.local>
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Step 8 — Post-wave documentation
1. Append `## Learnings` section to `.squad/agents/kujan/history.md`
2. Write decision-drop file `.squad/decisions/inbox/kujan-wave-N-verification.md`
3. Update SQL: `UPDATE todos SET status = 'done' WHERE id = 'eN-test-sweep'`

---

## Common Failure Patterns

### Imported-but-unmounted router
**Symptom:** `SyntaxError: Unexpected token '<'` when tests parse API response as JSON.  
**Cause:** Router is `import`ed in `index.ts` but missing `app.use()` mount. Server SPA fallback returns `index.html` for the route.  
**Fix:** Add `app.use('/api/...', routerName)` after the existing router block.  
**Prevention:** After each wave, grep for unmatched imports:
```bash
grep -n "import.*Router" packages/server/src/index.ts
grep -n "app\.use(" packages/server/src/index.ts
```

### Column not found in fresh project
**Symptom:** `Column 'X' does not exist for this project` during e2e test.  
**Cause:** `POST /api/squad/create` does NOT seed `column_meta` rows. Fresh projects are empty.  
**Fix:** In test setup, call `GET /api/projects/:id/columns` first — it runs `seedDefaults()` and inserts all 5 default columns.  
**Pattern:**
```ts
const colRes = await fetch(`${API}/api/projects/${projectId}/columns`);
await colRes.json(); // seeds defaults
```

### tsx watch not reloading on WSL2 Windows-mounted paths
**Symptom:** Code changes not reflected in running server.  
**Cause:** inotify doesn't fire for Windows NTFS cross-FS writes in WSL2.  
**Workaround:** `pnpm build && node dist/index.js` on a fresh port for verification. Ask Ahmed to restart dev server manually after commits.

### UI browser tests timing out in headless Chromium
**Symptom:** Tests fail with `element not found` / timeout; elements exist in source.  
**Cause:** Likely WSL2 headless GPU / missing fonts / Vite HMR not triggered.  
**Action:** Mark as pre-existing env issue. Do NOT block wave gate on these.

---

## Gate Decision Matrix

| Criterion | Block? |
|-----------|--------|
| Build fails | ✅ Block |
| E2E regression (new failure) | ✅ Block |
| E2E pre-existing env failure | ⚠️ Warn, continue |
| AC ❌ with source verification | ✅ Block |
| CHANGELOG missing | ⚠️ Warn, continue |
| Stray log files not gitignored | ⚠️ Fix and continue |
