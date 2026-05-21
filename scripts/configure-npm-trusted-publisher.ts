#!/usr/bin/env npx ts-node
/**
 * configure-npm-trusted-publisher.ts
 *
 * Configures npmjs.com trusted publisher (GitHub Actions OIDC) for all
 * public Squadboard packages. Run this ONCE after first publishing the
 * packages and creating the GitHub repo sabbour/squadboard.
 *
 * What it does:
 *   Navigates to each package's access settings on npmjs.com and adds
 *   GitHub Actions as a trusted publisher using OIDC. This allows CI to
 *   publish with provenance without storing a long-lived NPM_TOKEN.
 *
 * When to run:
 *   After `pnpm run npm:publish` has succeeded at least once (package pages
 *   must exist on npmjs.com) and before enabling OIDC publishing in CI.
 *
 * Required env vars:
 *   NPM_USER  — your npmjs.com username
 *   NPM_PASS  — your npmjs.com password
 *   NPM_EMAIL — your npmjs.com email address (optional, used on login form)
 *   NPM_OTP   — one-time password if 2FA is enabled on your account
 *
 * Usage:
 *   NPM_USER=your-username NPM_PASS=your-password \
 *   NPM_EMAIL=your@email.com \
 *   npx ts-node scripts/configure-npm-trusted-publisher.ts
 *
 *   With OTP:
 *   NPM_OTP=123456 NPM_USER=... NPM_PASS=... \
 *   npx ts-node scripts/configure-npm-trusted-publisher.ts
 *
 * How to verify it worked:
 *   Visit https://www.npmjs.com/package/@sabbour/squadboard/access
 *   and confirm "sabbour/squadboard" appears under Trusted Publishers.
 *
 * Prerequisites:
 *   - npm packages already published at least once (package pages must exist)
 *   - GitHub repo sabbour/squadboard exists
 *   - Playwright installed in packages/e2e (already present in this monorepo)
 */
import { chromium, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PACKAGES = [
  '@sabbour/squadboard',
  '@sabbour/squadboard-sdk',
  '@sabbour/squadboard-cli',
  '@sabbour/squadboard-electron',
];

const GITHUB_OWNER = 'sabbour';
const GITHUB_REPO = 'squadboard';
const WORKFLOW_FILE = 'release.yml';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function login(page: Page, npmUser: string, npmPass: string, npmOtp?: string) {
  console.log('→ Navigating to npmjs.com login...');
  await page.goto('https://www.npmjs.com/login', { waitUntil: 'networkidle' });

  await page.getByLabel(/username or email address/i).fill(npmUser);
  await page.getByLabel(/password/i).fill(npmPass);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Handle OTP prompt (2FA)
  const otpVisible = await page
    .getByText(/one-time password/i)
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  if (otpVisible) {
    console.log('→ OTP prompt detected.');
    if (!npmOtp) {
      throw new Error('OTP required — set NPM_OTP environment variable');
    }
    await page.getByLabel(/one-time password/i).fill(npmOtp);
    await page.getByRole('button', { name: /verify|submit|sign in/i }).click();
  }

  await page.waitForURL(/npmjs\.com\/?$|npmjs\.com\/~/, { timeout: 15000 });
  console.log('✓ Logged in successfully.');
}

async function screenshotPath(pkg: string, suffix: string): Promise<string> {
  const safe = pkg.replace(/[@/]/g, '-').replace(/^-/, '');
  return path.join(__dirname, `npm-trusted-pub-${safe}-${suffix}.png`);
}

async function configurePackage(page: Page, pkg: string, npmUser: string) {
  const encodedPkg = pkg.replace('/', '%2F');
  const accessUrl = `https://www.npmjs.com/package/${encodedPkg}/access`;

  console.log(`\n[${pkg}] Navigating to ${accessUrl}`);
  await page.goto(accessUrl, { waitUntil: 'networkidle', timeout: 20000 });

  // Capture initial state for debugging
  await page.screenshot({ path: await screenshotPath(pkg, '1-access-page') });
  console.log(`[${pkg}] Screenshot saved: access page`);

  // --- Try to find "Trusted Publishers" or "Automated Publishing" section ---
  // npmjs.com as of 2024-2025 shows a "Trusted Publishers" section on the
  // package access page with an "Add GitHub Actions" or similar button.

  const addPublisherButton = page
    .getByRole('button', { name: /add.*github|github.*actions|trusted publisher|add publisher/i })
    .or(page.getByText(/add.*github actions/i))
    .first();

  const buttonVisible = await addPublisherButton
    .isVisible({ timeout: 8000 })
    .catch(() => false);

  if (!buttonVisible) {
    // Fallback: look for a link/button with broader text
    console.log(`[${pkg}] Primary button not found — trying fallback selectors...`);
    await page.screenshot({ path: await screenshotPath(pkg, '2-fallback') });

    // Some versions of the page use a link inside a "publishing access" section
    const fallback = page
      .getByRole('link', { name: /add.*publisher|trusted publish|github actions/i })
      .or(page.getByRole('button', { name: /add/i }))
      .first();

    const fallbackVisible = await fallback.isVisible({ timeout: 5000 }).catch(() => false);
    if (!fallbackVisible) {
      console.warn(
        `[${pkg}] ⚠️  Could not find "Add trusted publisher" button. ` +
        `The npmjs.com UI may have changed. Check the screenshot at: ` +
        await screenshotPath(pkg, '2-fallback')
      );
      return;
    }
    await fallback.click();
  } else {
    await addPublisherButton.click();
  }

  console.log(`[${pkg}] Clicked "Add trusted publisher" button.`);
  await page.waitForTimeout(2000); // let modal/form animate in

  await page.screenshot({ path: await screenshotPath(pkg, '3-form-open') });

  // --- Fill in the GitHub Actions trusted publisher form ---
  // Fields vary slightly by npmjs UI version; try each by label text.

  const ownerField = page
    .getByLabel(/repository owner|owner/i)
    .or(page.getByPlaceholder(/owner/i))
    .first();

  const repoField = page
    .getByLabel(/repository name|repository$/i)
    .or(page.getByPlaceholder(/repository/i))
    .first();

  const workflowField = page
    .getByLabel(/workflow.*file|workflow name|workflow/i)
    .or(page.getByPlaceholder(/workflow/i))
    .first();

  // Some forms have an "environment" field (optional — leave blank)
  const envField = page
    .getByLabel(/environment/i)
    .first();

  try {
    await ownerField.waitFor({ state: 'visible', timeout: 8000 });
    await ownerField.fill(GITHUB_OWNER);
    console.log(`[${pkg}] Filled owner: ${GITHUB_OWNER}`);
  } catch {
    console.warn(`[${pkg}] ⚠️  Could not find owner field.`);
  }

  try {
    await repoField.waitFor({ state: 'visible', timeout: 5000 });
    await repoField.fill(GITHUB_REPO);
    console.log(`[${pkg}] Filled repo: ${GITHUB_REPO}`);
  } catch {
    console.warn(`[${pkg}] ⚠️  Could not find repository field.`);
  }

  try {
    await workflowField.waitFor({ state: 'visible', timeout: 5000 });
    await workflowField.fill(WORKFLOW_FILE);
    console.log(`[${pkg}] Filled workflow: ${WORKFLOW_FILE}`);
  } catch {
    console.warn(`[${pkg}] ⚠️  Could not find workflow field.`);
  }

  // Environment is optional — only fill if clearly present
  const envVisible = await envField.isVisible({ timeout: 2000 }).catch(() => false);
  if (envVisible) {
    // Leave blank intentionally — no environment constraint needed
    console.log(`[${pkg}] Environment field found but left blank (not required).`);
  }

  await page.screenshot({ path: await screenshotPath(pkg, '4-form-filled') });

  // --- Submit the form ---
  const saveButton = page
    .getByRole('button', { name: /add|save|confirm|submit/i })
    .last(); // "last" catches the submit button vs cancel

  const saveVisible = await saveButton.isVisible({ timeout: 5000 }).catch(() => false);
  if (!saveVisible) {
    console.warn(`[${pkg}] ⚠️  Save button not found — skipping submit.`);
    return;
  }

  await saveButton.click();
  console.log(`[${pkg}] Clicked save.`);

  // Wait for confirmation feedback (success banner or page reload)
  await page
    .waitForResponse((resp) => resp.status() < 400, { timeout: 10000 })
    .catch(() => {});
  await page.waitForTimeout(2000);

  await page.screenshot({ path: await screenshotPath(pkg, '5-done') });
  console.log(`✓ [${pkg}] Trusted publisher configured. Screenshot saved.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const npmUser = process.env.NPM_USER;
  const npmPass = process.env.NPM_PASS;
  const npmOtp = process.env.NPM_OTP;

  if (!npmUser || !npmPass) {
    console.error('Error: NPM_USER and NPM_PASS environment variables are required.');
    console.error(
      'Usage: NPM_USER=user NPM_PASS=pass [NPM_OTP=123456] ' +
      'npx ts-node scripts/configure-npm-trusted-publisher.ts'
    );
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: false, // visible so you can intervene if the UI changes
    slowMo: 100,     // slight slow-down for stability
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  try {
    await login(page, npmUser, npmPass, npmOtp);

    for (const pkg of PACKAGES) {
      await configurePackage(page, pkg, npmUser);
    }

    console.log('\n✓ All packages processed.');
    console.log('Verify at: https://www.npmjs.com/package/@sabbour/squadboard/access');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
