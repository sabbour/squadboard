import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for @sabbour/squadboard server.
 *
 * The default vitest test discovery scans every `*.test.*` file under the
 * package root, which picks up stale compiled outputs in `dist/__tests__/`
 * after running `pnpm build`. Those files fail at import time because they
 * reference workflow YAML siblings that only exist in `src/` (workflow YAML
 * files are not copied to `dist/`). They are not part of the test surface —
 * vitest should only run the TypeScript sources under `src/`.
 *
 * Excluding `dist/**` makes the test run reproducible regardless of whether
 * the user has run a build, and prevents the build output from being
 * reported as test failures.
 */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
