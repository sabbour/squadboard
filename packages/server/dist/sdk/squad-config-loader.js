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
const TS_COMPILER_OPTIONS = {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    strict: false,
    noImplicitAny: false,
    isolatedModules: true,
    resolveJsonModule: true,
};
export function loadSquadConfigFromSource(source, opts = {}) {
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
    const warnings = [];
    const useRoleCalls = [];
    // Build the SDK shim. Most builder functions are identity passthroughs so
    // a Proxy that returns `(x) => x` for any property is correct for them.
    // `useRole` deserves a smarter shim because it materialises an agent from
    // a role id + overrides.
    const sdkShim = {};
    // Smart useRole: capture both args and return a synthesised agent
    // definition the mapper can recognise.
    sdkShim.useRole = (id, overrides) => {
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
    sdkShim.BuilderValidationError = class BuilderValidationError extends Error {
    };
    // Default identity-passthrough Proxy. Any unknown property name returns a
    // function that returns its first argument verbatim.
    const sdkProxy = new Proxy(sdkShim, {
        get(target, prop) {
            if (prop in target)
                return target[prop];
            if (prop === Symbol.toPrimitive || prop === 'then')
                return undefined;
            return (x) => x;
        },
    });
    // Fake module — exposes the SDK shim as both default and named exports.
    const sdkModule = new Proxy({ default: sdkProxy, __esModule: true }, {
        get(target, prop) {
            if (prop in target)
                return target[prop];
            return Reflect.get(sdkProxy, prop);
        },
    });
    function fakeRequire(specifier) {
        if (specifier === '@bradygaster/squad-sdk' ||
            specifier.startsWith('@bradygaster/squad-sdk/')) {
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
    const moduleObj = { exports: {} };
    const exportsObj = moduleObj.exports;
    const sandbox = {
        require: fakeRequire,
        module: moduleObj,
        exports: exportsObj,
        console: {
            log: () => { },
            warn: () => { },
            error: () => { },
            info: () => { },
            debug: () => { },
        },
        // Minimal globals samples might touch.
        setTimeout: () => 0,
        clearTimeout: () => { },
        setInterval: () => 0,
        clearInterval: () => { },
        queueMicrotask: () => { },
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
    }
    catch (err) {
        throw new Error(`Failed to evaluate ${filename}: ${err.message}`);
    }
    const finalExports = moduleObj.exports;
    const config = (finalExports.default ?? null);
    // Drop `default` from named exports for clarity.
    const namedExports = {};
    for (const [k, v] of Object.entries(finalExports)) {
        if (k === 'default' || k === '__esModule')
            continue;
        namedExports[k] = v;
    }
    return {
        config,
        namedExports,
        useRoleCalls,
        warnings,
    };
}
//# sourceMappingURL=squad-config-loader.js.map