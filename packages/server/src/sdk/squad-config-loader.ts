/**
 * sdk/squad-config-loader.ts
 *
 * Evaluates a Squad-IRL `squad.config.ts` source string and returns the
 * `SquadSDKConfig`-shaped default export as plain JSON.
 *
 * Design:
 *   1. Transpile the TS source to CommonJS via the TypeScript compiler API.
 *   2. Run the compiled JS in a brand-new V8 context with `vm.runInNewContext`,
 *      which gives us a hard timeout (default 3000ms) and prevents access to
 *      Node globals (no `require` from disk, no `process`, no `fs`).
 *   3. Provide a fake `require()` that only resolves `@bradygaster/squad-sdk`
 *      and returns identity-passthrough builders. The real SDK is never
 *      loaded — we just capture what `defineSquad/defineAgent/...` were
 *      called with.
 *
 * This pattern is safe because:
 *   - The sample's code can only see what we put into the context.
 *   - All SDK builder functions in the SDK are themselves identity-passthrough
 *     (`defineAgent(c) => c`), so our shim produces exactly what the sample's
 *     authors intended.
 *   - The `vm` timeout kills runaway scripts mid-execution.
 *
 * Limitations:
 *   - Samples that perform real I/O (filesystem, network) will fail because
 *     the shim `require` only knows about the SDK. That is the desired
 *     behavior — gallery preview must be data-only.
 */

import ts from 'typescript';
import vm from 'node:vm';

export interface LoadOptions {
  /** Hard timeout in ms before evaluation is killed. Default 3000. */
  timeoutMs?: number;
  /** Optional source filename for error reporting. */
  filename?: string;
}

export interface LoadedSquadConfig {
  /** The default-exported config object (shape: SquadSDKConfig). */
  config: Record<string, unknown> | null;
  /** Anything else exported (rare, but possible). */
  namedExports: Record<string, unknown>;
  /** Captured calls into `useRole(id, overrides)` in argument order. */
  useRoleCalls: Array<{ id: unknown; overrides?: Record<string, unknown> }>;
  /** Errors emitted by the shim when something unexpected happened. */
  warnings: string[];
}

const TS_COMPILER_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  strict: false,
  noImplicitAny: false,
  isolatedModules: true,
  resolveJsonModule: true,
};

export function loadSquadConfigFromSource(
  source: string,
  opts: LoadOptions = {},
): LoadedSquadConfig {
  if (!source || !source.trim()) {
    throw new Error('Empty squad.config.ts source');
  }

  const filename = opts.filename ?? 'squad.config.ts';
  const timeoutMs = Math.max(500, Math.min(10_000, opts.timeoutMs ?? 3000));

  const transpiled = ts.transpileModule(source, {
    compilerOptions: TS_COMPILER_OPTIONS,
    fileName: filename,
    reportDiagnostics: false,
  });

  const code = transpiled.outputText;
  const warnings: string[] = [];
  const useRoleCalls: LoadedSquadConfig['useRoleCalls'] = [];

  // Build the SDK shim. Most builder functions are identity passthroughs so
  // a Proxy that returns `(x) => x` for any property is correct for them.
  // `useRole` deserves a smarter shim because it materialises an agent from
  // a role id + overrides.
  const sdkShim: Record<string, unknown> = {};

  // Smart useRole: capture both args and return a synthesised agent
  // definition the mapper can recognise.
  sdkShim.useRole = (id: unknown, overrides?: Record<string, unknown>) => {
    useRoleCalls.push({ id, overrides });
    if (overrides && typeof overrides === 'object') {
      return { __useRole: id, ...overrides };
    }
    return { __useRole: id };
  };

  // listRoles must return an array; samples sometimes destructure from it.
  sdkShim.listRoles = () => [];

  // BuilderValidationError shim — samples sometimes import it for type only,
  // but if instantiated should still behave like an Error.
  sdkShim.BuilderValidationError = class BuilderValidationError extends Error {};

  // Default identity-passthrough Proxy. Any unknown property name returns a
  // function that returns its first argument verbatim.
  const sdkProxy = new Proxy(sdkShim, {
    get(target, prop) {
      if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
      if (prop === Symbol.toPrimitive || prop === 'then') return undefined;
      return (x: unknown) => x;
    },
  });

  // Fake module — exposes the SDK shim as both default and named exports.
  const sdkModule: Record<string, unknown> = new Proxy(
    { default: sdkProxy, __esModule: true },
    {
      get(target, prop) {
        if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
        return Reflect.get(sdkProxy, prop);
      },
    },
  );

  function fakeRequire(specifier: string): unknown {
    if (
      specifier === '@bradygaster/squad-sdk' ||
      specifier.startsWith('@bradygaster/squad-sdk/')
    ) {
      return sdkModule;
    }
    // node: builtins are blocked.
    if (specifier.startsWith('node:') || specifier === 'fs' || specifier === 'path') {
      warnings.push(`Blocked require('${specifier}') from sample`);
      return new Proxy({}, { get: () => () => undefined });
    }
    // Relative imports inside the sample (e.g. './prompts.ts') aren't supported
    // in Phase 2 v1 — log a warning and return an empty module.
    warnings.push(`Unsupported require('${specifier}') from sample`);
    return new Proxy({}, { get: () => () => undefined });
  }

  const moduleObj = { exports: {} as Record<string, unknown> };
  const exportsObj = moduleObj.exports;

  const sandbox: Record<string, unknown> = {
    require: fakeRequire,
    module: moduleObj,
    exports: exportsObj,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
      debug: () => {},
    },
    // Minimal globals samples might touch.
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    queueMicrotask: () => {},
    process: { env: {} },
    Buffer,
    URL,
    URLSearchParams,
  };

  try {
    vm.runInNewContext(code, sandbox, {
      filename,
      timeout: timeoutMs,
      displayErrors: true,
    });
  } catch (err) {
    throw new Error(
      `Failed to evaluate ${filename}: ${(err as Error).message}`,
    );
  }

  const finalExports = moduleObj.exports as Record<string, unknown>;
  const config = (finalExports.default ?? null) as Record<string, unknown> | null;

  // Drop `default` from named exports for clarity.
  const namedExports: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(finalExports)) {
    if (k === 'default' || k === '__esModule') continue;
    namedExports[k] = v;
  }

  return {
    config,
    namedExports,
    useRoleCalls,
    warnings,
  };
}
