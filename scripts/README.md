# Release Scripts

Scripts in this directory support publishing and configuring the public Squadboard npm packages.

---

## `configure-npm-trusted-publisher.ts`

Automates the npmjs.com UI (via Playwright) to configure GitHub Actions as a
**trusted publisher** (OIDC) for all four public Squadboard packages.

Run **once** after the packages are first published and the GitHub repo
`sabbour/squadboard` exists. After this, the CI `release.yml` workflow can
publish with provenance without storing a long-lived `NPM_TOKEN`.

### Usage

```bash
NPM_USER=your-username \
NPM_PASS=your-password \
NPM_EMAIL=your@email.com \
npx ts-node scripts/configure-npm-trusted-publisher.ts
```

With 2FA OTP:

```bash
NPM_OTP=123456 NPM_USER=... NPM_PASS=... \
npx ts-node scripts/configure-npm-trusted-publisher.ts
```

Or via the workspace script:

```bash
NPM_USER=... NPM_PASS=... pnpm run npm:configure-trusted-publisher
```

### What it configures

For each package it visits the access page and adds a trusted publisher entry:

| Field            | Value              |
|------------------|--------------------|
| Repository owner | `sabbour`          |
| Repository name  | `squadboard`       |
| Workflow file    | `release.yml`      |
| Environment      | *(blank)*          |

Packages configured:
- `@sabbour/squadboard`
- `@sabbour/squadboard-sdk`
- `@sabbour/squadboard-cli`
- `@sabbour/squadboard-electron`

### Verify it worked

Visit each package's access page and confirm "sabbour/squadboard" appears
under **Trusted Publishers**:

```
https://www.npmjs.com/package/@sabbour/squadboard/access
https://www.npmjs.com/package/@sabbour/squadboard-sdk/access
https://www.npmjs.com/package/@sabbour/squadboard-cli/access
https://www.npmjs.com/package/@sabbour/squadboard-electron/access
```

Screenshots are saved alongside the script for each step if you need to debug.

---

## `start-dev.mjs`

Starts the full local development stack (server + client).

```bash
pnpm run start
```

---

## First-time release checklist

Follow these steps **in order** when publishing for the first time:

1. **Bump versions**
   ```bash
   pnpm changeset version
   ```

2. **Build all public packages**
   ```bash
   pnpm run npm:build
   ```

3. **Authenticate locally**
   ```bash
   npm login
   ```

4. **Publish to npm**
   ```bash
   pnpm run npm:publish
   ```
   *(or `npm:publish:dry-run` first to verify)*

5. **Configure OIDC trusted publisher**
   ```bash
   NPM_USER=... NPM_PASS=... pnpm run npm:configure-trusted-publisher
   ```

6. **Add `NPM_TOKEN` secret to GitHub repo settings**
   GitHub → Settings → Secrets → Actions → `NPM_TOKEN`
   *(Used only as a fallback until OIDC is confirmed working)*

7. **Future releases** — push changesets to `main` → CI creates a Version PR
   → merge → `release.yml` publishes automatically with OIDC provenance.
