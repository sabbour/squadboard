# Cross-Surface Squad Sync — Implementation Plan

**Architecture:** `docs/setup/cross-surface-squad-sync-contract.md`  
**Decision:** `.squad/decisions/inbox/mcmanus-cross-surface-sync-contract.md`  
**Feature:** `docs/features/feat-2026-05-19-define-cross-surface-squad-sync-ownership.md`  

---

## Namespace and Invariant Decisions

- Canonical API namespace: `/api/projects/:projectId/squad-sync/...`.
- Backend route convention: mount `packages/server/src/routes/squad-sync.ts` at `/api/projects/:projectId/squad-sync`; route handlers use local paths such as `/status`, `/repair`, `/project-squad-to-fs`, and `/generate-github-agent`.
- Ceremony invariant: `.squad/ceremonies.md` is required and must contain seeded, non-placeholder defaults. Missing, empty, or placeholder-only ceremonies are drift/health warnings and require the `seed-ceremony-defaults` repair path.

---

## Overview

This plan breaks down the architectural contract into concrete, sequenced work items for each specialist. Work may proceed in parallel where independent; some items have dependencies noted.

**Exit criteria:**
- [ ] All work items implemented and committed
- [ ] Kujan: Integration tests pass (both start paths, drift detection, ceremonies preservation)
- [ ] Redfoot: User-facing docs complete
- [ ] Feature closes (feature artifact updated, decision merged to `decisions.md`)

---

## Hockney — Backend (Lead: Schema + API)

### H1: Schema Migration — Storage Provider Mode

**Scope:** Add `storage_provider_mode` column to `projects` table  
**Effort:** Small (< 4 hours)  
**Dependencies:** None

**Tasks:**
- [ ] Create migration file: `packages/server/src/db/migrations/000X_projects_storage_provider_mode.sql`
  ```sql
  ALTER TABLE projects ADD COLUMN storage_provider_mode 
    VARCHAR(50) NOT NULL DEFAULT 'fs' 
    CHECK (storage_provider_mode IN ('fs', 'postgresql'));
  
  CREATE INDEX idx_projects_storage_provider_mode ON projects(storage_provider_mode);
  ```
- [ ] Add rollback migration
- [ ] Update TypeScript types: `packages/server/src/db/schema.ts`
- [ ] Add test: `packages/server/src/__tests__/migrations-storage-provider.test.ts` (verify column exists, default is 'fs', constraint works)

**Output:** Projects table can now track authoritative storage mode.

---

### H2: Bootstrap Metadata in squad_storage

**Scope:** Mark when filesystem was imported to PostgreSQL  
**Effort:** Small (< 3 hours)  
**Dependencies:** H1 (indirectly; for consistency)

**Tasks:**
- [ ] Add special-key rows to `squad_storage` on first bootstrap import:
  ```
  path = '__bootstrap_metadata'
  content = {
    "source": "fs",
    "timestamp": "2026-05-19T12:00:00Z",
    "idempotent_marker": "fs_bootstrap_v1"
  }
  ```
- [ ] Update `packages/server/src/services/sdk-state.ts` to write this metadata on import
- [ ] Add logic: if `__bootstrap_metadata` exists, skip re-import (idempotency)
- [ ] Add test: `packages/server/src/__tests__/bootstrap-idempotency.test.ts` (verify import is one-time only)

**Output:** Bootstrap is idempotent; repeated calls are safe no-ops.

---

### H3: API Endpoint — GET /api/projects/:projectId/squad-sync/status

**Scope:** Drift detection report  
**Effort:** Medium (6–8 hours)  
**Dependencies:** H1, H2  

**Tasks:**
- [ ] Create endpoint in `packages/server/src/routes/squad-sync.ts` (new file), mounted at `/api/projects/:projectId/squad-sync`
  ```typescript
  router.get('/status', async (req, res) => {
    const project = await projects.get(req.params.projectId);
    const drifts = [];
    
    // Check 1: GitHub agent file exists?
    const hasAgentFile = await githubApi.fileExists('.github/agents/squad.agent.md');
    if (!hasAgentFile) drifts.push({ surface: 'github_agent_file', status: 'missing', ... });
    
    // Check 2: Filesystem .squad/ freshness (if fs mode)
    if (project.storage_provider_mode === 'fs') {
      const stale = await detectStaleSquadFiles(...);
      if (stale) drifts.push({ surface: 'filesystem_squad', status: 'diverged', ... });
    }
    
    // Check 3: Ceremony defaults present?
    const ceremonies = await readCeremonies(project);
    if (isEmpty(ceremonies)) drifts.push({ surface: 'ceremonies', status: 'empty', ... });
    
    res.json({
      project_id: project.id,
      storage_mode: project.storage_provider_mode,
      bootstrap_status: await getBootstrapStatus(project),
      drift_status: drifts.length > 0 ? 'warning' : 'clean',
      drifts,
      last_sync_timestamp: project.last_sync_timestamp
    });
  });
  ```
- [ ] Add test: `packages/server/src/__tests__/squad-sync-status.test.ts`
  - Test: `fs` mode project reports drift if ceremonies missing
  - Test: `postgresql` mode project reports no drift if synced
  - Test: Report includes guidance/advice for each drift type

**Output:** Users can query sync health via `/api/projects/:projectId/squad-sync/status`.

---

### H4: API Endpoint — POST /api/projects/:projectId/squad-sync/project-squad-to-fs

**Scope:** Write DB state to filesystem  
**Effort:** Medium (8–10 hours)  
**Dependencies:** H1, H2, H3  

**Tasks:**
- [ ] Create endpoint in `packages/server/src/routes/squad-sync.ts`
  ```typescript
  router.post('/project-squad-to-fs', async (req, res) => {
    const project = await projects.get(req.params.projectId);
    if (project.storage_provider_mode !== 'postgresql') {
      return res.status(400).json({ error: 'Not in postgresql mode' });
    }
    
    // Read all squad_storage rows
    const rows = await db.squadStorage.select().where({ scope: project.squad_scope });
    
    // Write to filesystem
    const results = await writeSquadFiles(project.squad_path, rows);
    
    res.json({
      status: results.failed.length ? 'partial_failure' : 'success',
      written: results.written,
      failed: results.failed,
      diff: results.diff,
      timestamp: new Date().toISOString()
    });
  });
  ```
- [ ] Implement `writeSquadFiles()` helper (write each row to filesystem, skip if content unchanged)
- [ ] Add test: `packages/server/src/__tests__/sync-project-squad-to-fs.test.ts`
  - Test: Writes all valid paths
  - Test: Skips unchanged files
  - Test: Returns meaningful error if write fails (permissions, missing parent dir)
  - Test: Partial failure case (some files written, some failed)

**Output:** Users can sync DB state to filesystem via API.

---

### H5: API Endpoint — POST /api/projects/:projectId/squad-sync/generate-github-agent

**Scope:** Render and push `.github/agents/squad.agent.md`  
**Effort:** Medium (8–10 hours)  
**Dependencies:** H1, H3  

**Tasks:**
- [ ] Create endpoint in `packages/server/src/routes/squad-sync.ts`
  ```typescript
  router.post('/generate-github-agent', async (req, res) => {
    const project = await projects.get(req.params.projectId);
    
    // Read authoritative state
    const team = await getTeam(project);
    const routing = await getRouting(project);
    const ceremonies = await getCeremonies(project);
    
    // Render agent file from template
    const agentMarkdown = await renderSquadAgentTemplate({
      team, routing, ceremonies, version: SDK_VERSION
    });
    
    // Push to GitHub (or return error if not authorized)
    try {
      const result = await githubApi.createOrUpdateFile({
        path: '.github/agents/squad.agent.md',
        content: agentMarkdown,
        message: 'feat: sync squad agent file from board'
      });
      res.json({ status: 'success', path: result.path, sha: result.sha });
    } catch (err) {
      res.status(401).json({ status: 'auth_required', error: err.message });
    }
  });
  ```
- [ ] Verify agent template exists: `packages/server/src/templates/squad.agent.md.hbs` or similar
- [ ] Add test: `packages/server/src/__tests__/squad-sync-generate-github-agent.test.ts`
  - Test: Renders agent file with correct SDK version
  - Test: Includes team roster, routing rules, ceremony triggers
  - Test: Handles missing GitHub auth gracefully

**Output:** Squadboard can generate and push `.github/agents/squad.agent.md` to GitHub.

---

### H6: API Endpoint — POST /api/projects/:projectId/squad-sync/repair

**Scope:** User-initiated repair actions  
**Effort:** Medium (6–8 hours)  
**Dependencies:** H4, H5, H3  

**Tasks:**
- [ ] Create endpoint in `packages/server/src/routes/squad-sync.ts`
  ```typescript
  router.post('/repair', async (req, res) => {
    const { action, force } = req.body; // 'regenerate_github_agent' | 'sync_squad_to_fs' | 'reimport_fs_to_db'
    const project = await projects.get(req.params.projectId);
    
    let result;
    switch (action) {
      case 'regenerate_github_agent':
        result = await callEndpoint(`/projects/${project.id}/squad-sync/generate-github-agent`);
        break;
      case 'sync_squad_to_fs':
        if (project.storage_provider_mode !== 'postgresql') {
          throw new Error('Only valid in postgresql mode');
        }
        result = await callEndpoint(`/projects/${project.id}/squad-sync/project-squad-to-fs`);
        break;
      case 'reimport_fs_to_db':
        if (project.storage_provider_mode !== 'postgresql' || !force) {
          throw new Error('Requires postgresql mode + force: true');
        }
        result = await bootstrapImportFilesystemToDb(project);
        break;
    }
    
    // Return new sync status
    const status = await callEndpoint(`/projects/${project.id}/squad-sync/status`);
    res.json({ action, result, updated_status: status });
  });
  ```
- [ ] Add test: `packages/server/src/__tests__/squad-sync-repair.test.ts`
  - Test: Each repair action calls the right endpoint
  - Test: Force flag required for reimport
  - Test: Returns updated status after repair

**Output:** Users can trigger repairs from UI or CLI.

---

### H7: Update setup-lifecycle — Default Ceremonies

**Scope:** Seed ceremonies defaults on project create  
**Effort:** Small (4–6 hours)  
**Dependencies:** None  

**Tasks:**
- [ ] Update `packages/server/src/services/setup-lifecycle.ts` to include ceremonies seeding
  ```typescript
  // Write default ceremonies
  const defaultCeremonies = [
    {
      name: 'Simple Review',
      slug: 'review-on-demand',
      trigger: { type: 'manual' },
      workflow: { /* simple-review workflow */ }
    },
    // ... bug-fix, rfc, spike, pair-programming
  ];
  
  await provider.writeContent(squadPath, 'ceremonies.md', renderCeremoniesYaml(defaultCeremonies));
  ```
- [ ] Verify ceremonies template exists or create: `packages/server/src/templates/ceremonies-defaults.yaml`
- [ ] Add test: `packages/server/src/__tests__/setup-lifecycle-ceremonies.test.ts`
  - Test: Project created with non-empty ceremonies.md
  - Test: All 5 templates are included

**Output:** New projects are never created with empty ceremonies; defaults are ready to use.

---

### H8: Update project-squad.ts — Respect Storage Mode

**Scope:** Read team context according to storage mode  
**Effort:** Small (3–4 hours)  
**Dependencies:** H1  

**Tasks:**
- [ ] Update `packages/server/src/services/project-squad.ts` to check `storage_provider_mode`
  ```typescript
  async function getProjectContext(project) {
    if (project.storage_provider_mode === 'fs') {
      // Read from filesystem
      return await fsProvider.read(project.squad_path);
    } else {
      // Read from DB
      return await dbProvider.read(project.squad_scope);
    }
  }
  ```
- [ ] Add test: `packages/server/src/__tests__/project-squad-mode-aware.test.ts`
  - Test: `fs` mode reads from filesystem
  - Test: `postgresql` mode reads from DB

**Output:** Squadboard respects storage mode when reading team context.

---

## Kobayashi — SDK/Services (Authority Clarity + Tests)

### K1: Clean Up Stale "pglite Mode" Inbox Entries

**Scope:** Archive superseded decision notes  
**Effort:** Trivial (< 1 hour)  
**Dependencies:** None  

**Tasks:**
- [ ] Search `.squad/decisions/inbox/` for "pglite mode" or "pglite" references
- [ ] Archive to `.squad/decisions-archive.md` with note: "Superseded by cross-surface-sync contract; pglite is an implementation detail, not a mode choice"
- [ ] Add comment in `.squad/decisions.md` clarifying current provider semantics

**Output:** No conflicting documentation.

---

### K2: SDK Documentation — Authority Semantics

**Scope:** Clarify that SDK is authority-agnostic  
**Effort:** Small (2–3 hours)  
**Dependencies:** None  

**Tasks:**
- [ ] Update `packages/squad-sdk/README.md` (or create `packages/squad-sdk/docs/storage-provider-semantics.md`)
  ```markdown
  # Storage Provider Semantics
  
  The SDK provides **storage backends**, not authority decisions.
  
  - `FilesystemStorageProvider`: Reads/writes to `.squad/` directory
  - `PostgreSQLStorageProvider`: Reads/writes to `squad_storage` table
  
  **Authority is decided by the application layer**, not the SDK:
  - CLI defaults to `FilesystemStorageProvider` (filesystem is truth)
  - Squadboard application layer decides mode via `projects.storage_provider_mode`
  
  The SDK does NOT:
  - Decide which source of truth is "correct"
  - Perform continuous two-way syncing
  - Generate client artifacts
  
  The SDK DO:
  - Provide identical read/write interfaces for both backends
  - Support one-time bootstrap import (idempotent)
  - Preserve content without interpretation
  ```
- [ ] Add test: `packages/squad-sdk/tests/provider-semantics.test.ts` (verify both providers are interchangeable from SDK perspective)

**Output:** Clear documentation that SDK is a library, not an oracle.

---

### K3: Bootstrap Idempotency Integration Test

**Scope:** Verify `fs` → PostgreSQL bootstrap is truly one-time  
**Effort:** Small (4–5 hours)  
**Dependencies:** H2  

**Tasks:**
- [ ] Create test: `packages/server/src/__tests__/bootstrap-idempotency-integration.test.ts`
  ```typescript
  it('bootstrap import fs -> postgresql is idempotent', async () => {
    // Set up filesystem .squad/ with some files
    // Set up empty squad_storage table
    
    // First import
    await bootstrapImportFilesystemToDb(project);
    const firstRows = await db.squadStorage.select().where({ scope: project.squad_scope });
    
    // Second import (should be no-op)
    await bootstrapImportFilesystemToDb(project);
    const secondRows = await db.squadStorage.select().where({ scope: project.squad_scope });
    
    expect(firstRows).toEqual(secondRows);
  });
  ```
- [ ] Add test: Two processes reading from different sources (one FS, one DB) observe expected one-way behavior

**Output:** Confidence that bootstrap import is safe to call repeatedly.

---

### K4: Update SDK Version in squad.agent.md Template

**Scope:** Ensure generated agent files include SDK version  
**Effort:** Trivial (< 1 hour)  
**Dependencies:** None  

**Tasks:**
- [ ] Verify `packages/server/src/templates/squad.agent.md.hbs` or similar template includes SDK version stamp:
  ```
  <!-- Squad SDK version: 0.9.4 -->
  ```
- [ ] This version is used in H5 to render consistent agent files

**Output:** Generated agent files are versioned.

---

## Keyser — Frontend (Team Sync Settings Panel)

### K1: Create Team Sync Settings Panel Component

**Scope:** Display sync status, repair buttons  
**Effort:** Medium (10–12 hours)  
**Dependencies:** H1–H6  

**Tasks:**
- [ ] Create component: `packages/client/src/components/ProjectSettings/TeamSyncPanel.tsx`
  - Display current storage mode (badge)
  - Display bootstrap status + timestamp
  - List drift items with descriptions
  - "Repair" button per drift type (calls `POST /api/projects/:projectId/squad-sync/repair`)
  - Loading state during repair
  - Success/error toast on repair completion
- [ ] Use `useQuery` hook to fetch `GET /api/projects/:projectId/squad-sync/status`
- [ ] Add to Project Settings layout under **Team** section
- [ ] Add test: `packages/client/src/__tests__/TeamSyncPanel.test.tsx`
  - Test: Displays storage mode
  - Test: Repair button calls API
  - Test: Drift items are listed

**Output:** Users can see and repair sync issues from UI.

---

### K2: Project Create Flow — Storage Mode Choice

**Scope:** Let users pick storage mode on project create  
**Effort:** Small (4–6 hours)  
**Dependencies:** H1, K1  

**Tasks:**
- [ ] Update `ProjectCreateWizard.tsx` or similar
  - Step 1: Project name, description
  - Step 2 (new): **Storage mode**
    - Option A: "Local (filesystem)" — `.squad/` is truth, kept in Git
    - Option B: "Squadboard (database)" — use PostgreSQL, sync across surfaces
    - Default: "Squadboard" if user is in Squadboard UI
  - Step 3: Review + create
- [ ] Store selected mode in `projects.storage_provider_mode`
- [ ] Add test: Project created with selected mode

**Output:** Users can choose storage mode at creation time.

---

### K3: Project Import Wizard — Storage Mode Upgrade

**Scope:** Let users import existing `.squad/` and optionally upgrade to DB mode  
**Effort:** Small (4–6 hours)  
**Dependencies:** H1–H6  

**Tasks:**
- [ ] Update `ProjectImportWizard.tsx` or create new flow for linking existing `.squad/` projects
  - Step 1: Link to existing repo
  - Step 2 (new): Detect existing `.squad/`
    - If found: Offer "Stay in filesystem mode (read-only)" vs. "Import to database (full sync)"
    - If not found: Proceed with new project creation
  - Step 3: If importing, call `POST /api/projects/:projectId/squad-sync/repair` with `reimport_fs_to_db`
- [ ] Add test: Existing project with `.squad/` can be imported and upgraded

**Output:** CLI-first users can link and upgrade their projects.

---

## Kujan — QA (Integration & Regression Tests)

### KQA1: Squadboard-First Path Integration Test

**Scope:** End-to-end: Create in Squadboard → sync to CLI  
**Effort:** Medium (8–10 hours)  
**Dependencies:** H1–H6, Keyser K1–K3  

**Tasks:**
- [ ] Create test file: `packages/server/src/__tests__/integration-squadboard-first-path.test.ts`
  ```typescript
  it('e2e: create project in squadboard, verify cli can read agent', async () => {
    // 1. Create project via API with storage_mode='postgresql'
    const project = await api.post('/api/projects', {
      name: 'test-project',
      storage_mode: 'postgresql'
    });
    
    // 2. Verify ceremonies are not empty
    const ceremonies = await api.get(`/api/projects/${project.id}/ceremonies`);
    expect(ceremonies).not.toBeEmpty();
    
    // 3. Generate GitHub agent file
    await api.post(`/api/projects/${project.id}/squad-sync/generate-github-agent`);
    
    // 4. Verify file exists
    const agentFile = await github.getFile('.github/agents/squad.agent.md');
    expect(agentFile).toBeDefined();
    expect(agentFile.content).toContain('squad.agent.md');
    
    // 5. Verify CLI can parse the agent file
    const parsed = parseSquadAgent(agentFile.content);
    expect(parsed.team).toBeDefined();
    expect(parsed.ceremonies).not.toBeEmpty();
  });
  ```
- [ ] Add test: Squadboard creates ceremonies defaults; CLI can read them via agent file

**Output:** Squadboard-first path is verified end-to-end.

---

### KQA2: CLI-First Path Integration Test

**Scope:** End-to-end: Create in CLI → import to Squadboard  
**Effort:** Medium (8–10 hours)  
**Dependencies:** H1–H6  

**Tasks:**
- [ ] Create test file: `packages/server/src/__tests__/integration-cli-first-path.test.ts`
  ```typescript
  it('e2e: create project in cli, import to squadboard', async () => {
    // 1. Simulate CLI project: create .squad/ files
    const squadPath = '/tmp/test-squad';
    await createSquadStructureOnDisk(squadPath, cliTeamContent);
    
    // 2. Create Squadboard project linked to this path
    const project = await api.post('/api/projects', {
      name: 'cli-project',
      squad_path: squadPath,
      storage_mode: 'fs' // Start in FS mode
    });
    
    // 3. Offer upgrade to DB mode
    await api.post(`/api/projects/${project.id}/squad-sync/repair`, {
      action: 'reimport_fs_to_db',
      force: true
    });
    
    // 4. Verify project is now in postgresql mode
    const updated = await api.get(`/api/projects/${project.id}`);
    expect(updated.storage_mode).toBe('postgresql');
    
    // 5. Verify ceremonies were preserved
    const ceremonies = await api.get(`/api/projects/${project.id}/ceremonies`);
    expect(ceremonies).toMatch(cliTeamContent.ceremonies);
  });
  ```
- [ ] Add test: Existing `.squad/` ceremonies are preserved after import

**Output:** CLI-first path with import is verified end-to-end.

---

### KQA3: Drift Detection Test

**Scope:** `GET /api/projects/:projectId/squad-sync/status` correctly identifies drifts
**Effort:** Small (4–5 hours)  
**Dependencies:** H3  

**Tasks:**
- [ ] Create test file: `packages/server/src/__tests__/drift-detection.test.ts`
  ```typescript
  it('drift detection: missing github agent file', async () => {
    // Create project, don't generate agent file
    const status = await api.get(`/api/projects/${project.id}/squad-sync/status`);
    expect(status.drifts).toContainEqual({
      surface: 'github_agent_file',
      status: 'missing',
      advice: 'Call POST /api/projects/:projectId/squad-sync/generate-github-agent'
    });
  });
  
  it('drift detection: empty ceremonies', async () => {
    // Create project, clear ceremonies.md
    const status = await api.get(`/api/projects/${project.id}/squad-sync/status`);
    expect(status.drifts).toContainEqual({
      surface: 'ceremonies',
      status: 'empty'
    });
  });
  ```
- [ ] Add test: No drifts reported on freshly synced project

**Output:** Drift detection is reliable and testable.

---

### KQA4: Ceremonies Preservation Test

**Scope:** Verify ceremonies are never lost across operations  
**Effort:** Small (3–4 hours)  
**Dependencies:** H7  

**Tasks:**
- [ ] Create test: `packages/server/src/__tests__/ceremonies-preservation.test.ts`
  - Create project with default ceremonies
  - Verify ceremonies exist
  - Perform sync operations (reimport, project-squad-to-fs)
  - Verify ceremonies still exist and unchanged
- [ ] Add test: Project created in either mode has ceremonies defaults

**Output:** Ceremonies are never empty; defaults are always present.

---

## Redfoot — Docs (User-Facing Guides)

### R1: Quick-Start Guide — Cross-Surface Sync Overview

**Scope:** `.squad/setup/` documentation for users  
**Effort:** Medium (4–6 hours)  
**Dependencies:** Architecture contract approved  

**Tasks:**
- [ ] Create: `docs/setup/getting-started-cross-surface.md`
  ```markdown
  # Getting Started: Squad Across Squadboard and Copilot
  
  ## Where to Start?
  
  **Option 1: Squadboard Web UI**
  - Create a project in Squadboard
  - Ceremonies are pre-seeded and ready to use
  - Click "Sync to Copilot" → Generates `.github/agents/squad.agent.md`
  - Open Copilot/CLI → Team is ready
  
  **Option 2: Copilot/CLI**
  - Initialize with `copilot squad init` or `@copilot squad init`
  - `.squad/` is created on disk (Git-tracked)
  - Later: Link to Squadboard (Project Settings)
  - Offer: Upgrade to multi-surface mode (optional)
  
  **Option 3: Both Together**
  - Create Squadboard project
  - Create Copilot repo with same name
  - Link them in Squadboard
  - Both read from shared database
  
  ## Storage Modes Explained
  
  ### Filesystem Mode (`fs`)
  - `.squad/` directory is the source of truth
  - Squadboard reads it (advisory)
  - Best for: Local teams, Git-first workflows, CLI projects
  
  ### Database Mode (`postgresql`)
  - Squadboard database is the source of truth
  - `.squad/` is auto-generated (cached locally)
  - Best for: Multi-surface teams, hosted deployments, faster sync
  
  ## Syncing Between Surfaces
  
  Project Settings → **Team Sync** panel shows:
  - Current mode
  - Health status (any drifts?)
  - Repair buttons
  
  Click "Repair" to sync manually, or it happens automatically on key operations.
  ```
- [ ] Add test: Markdown formatting clean, links work, no broken references

**Output:** Users understand start paths and storage modes.

---

### R2: Update MCP Install Documentation

**Scope:** Link to sync setup in existing MCP guide  
**Effort:** Small (2–3 hours)  
**Dependencies:** R1  

**Tasks:**
- [ ] Update `docs/setup/mcp-install.md`
  - Add section: "Setting up Squad Sync"
  - Link to R1 quick-start guide
  - Explain how MCP capture flows into inbox + board

**Output:** MCP docs are aligned with sync architecture.

---

### R3: Update README — "Start Anywhere" Claim

**Scope:** Claim that users can start in Squadboard or CLI  
**Effort:** Small (2–3 hours)  
**Dependencies:** R1  

**Tasks:**
- [ ] Update `README.md` or `docs/README.md`
  - Add prominent section: "Start in Squadboard or Copilot/CLI — fully synced"
  - Link to R1 quick-start guide
  - One sentence per start path

**Output:** README advertises multi-surface capability.

---

## Timeline and Dependencies

**Phase 1 (Non-blocking foundation):**
- H1: Schema migration (Hockney)
- K1: Archive stale inbox entries (Kobayashi)
- H7: Default ceremonies seeding (Hockney)
- R1: Quick-start guide (Redfoot)

**Phase 2 (API foundation):**
- H2: Bootstrap metadata (Hockney)
- H3: Sync status endpoint (Hockney)
- K2: SDK documentation (Kobayashi)

**Phase 3 (Sync endpoints):**
- H4: Sync project-squad-to-fs (Hockney)
- H5: Generate GitHub agent (Hockney)
- H6: Repair endpoint (Hockney)

**Phase 4 (Frontend + tests):**
- K1: Team Sync panel (Keyser)
- K2: Project create wizard (Keyser)
- K3: Project import wizard (Keyser)
- KQA1–KQA4: Integration tests (Kujan)

**Phase 5 (Docs + go-live):**
- R2: Update MCP docs (Redfoot)
- R3: Update README (Redfoot)
- Full end-to-end test (Kujan sign-off)

---

## Definition of Done

✅ All work items implemented and committed  
✅ Integration tests pass (Kujan sign-off)  
✅ Drift detection reports correctly  
✅ Both start paths (Squadboard-first, CLI-first) verified end-to-end  
✅ Ceremonies never empty  
✅ User-facing docs complete (Redfoot sign-off)  
✅ Feature ticket updated and closed  

---

_Related: Architecture contract, decision record, feature scope._
