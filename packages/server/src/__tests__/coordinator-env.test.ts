import { describe, it, expect, afterEach } from "vitest";
import {
  isCoordinatorDispatchEnabled,
  getCoordinatorModel,
  getCoordinatorModelFallbacks,
  resolveCoordinatorModelChain,
  getCoordinatorEnvSummary,
  DEFAULT_COORDINATOR_MODEL,
  DEFAULT_COORDINATOR_MODEL_FALLBACKS,
  CoordinatorEnvSummary,
} from "../config/coordinator-env";

/**
 * Helper: clear env vars after each test to avoid cross-test pollution.
 */
function createEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...overrides };
}

describe("coordinator-env", () => {
  describe("isCoordinatorDispatchEnabled", () => {
    it("should default to true when unset", () => {
      expect(isCoordinatorDispatchEnabled(createEnv({}))).toBe(true);
    });

    it("should return true when env is undefined", () => {
      expect(isCoordinatorDispatchEnabled()).toBe(true);
    });

    it("should return false for '0'", () => {
      expect(
        isCoordinatorDispatchEnabled(createEnv({ COORDINATOR_DISPATCH_ENABLED: "0" }))
      ).toBe(false);
    });

    it("should return false for 'false'", () => {
      expect(
        isCoordinatorDispatchEnabled(createEnv({ COORDINATOR_DISPATCH_ENABLED: "false" }))
      ).toBe(false);
    });

    it("should return false for 'False' (case-insensitive)", () => {
      expect(
        isCoordinatorDispatchEnabled(createEnv({ COORDINATOR_DISPATCH_ENABLED: "False" }))
      ).toBe(false);
    });

    it("should return false for 'FALSE' (uppercase)", () => {
      expect(
        isCoordinatorDispatchEnabled(createEnv({ COORDINATOR_DISPATCH_ENABLED: "FALSE" }))
      ).toBe(false);
    });

    it("should return false for 'off'", () => {
      expect(
        isCoordinatorDispatchEnabled(createEnv({ COORDINATOR_DISPATCH_ENABLED: "off" }))
      ).toBe(false);
    });

    it("should return false for 'no'", () => {
      expect(
        isCoordinatorDispatchEnabled(createEnv({ COORDINATOR_DISPATCH_ENABLED: "no" }))
      ).toBe(false);
    });

    it("should return true for '1'", () => {
      expect(
        isCoordinatorDispatchEnabled(createEnv({ COORDINATOR_DISPATCH_ENABLED: "1" }))
      ).toBe(true);
    });

    it("should return true for 'true'", () => {
      expect(
        isCoordinatorDispatchEnabled(createEnv({ COORDINATOR_DISPATCH_ENABLED: "true" }))
      ).toBe(true);
    });

    it("should return true for 'yes'", () => {
      expect(
        isCoordinatorDispatchEnabled(createEnv({ COORDINATOR_DISPATCH_ENABLED: "yes" }))
      ).toBe(true);
    });

    it("should return true for random string 'potato'", () => {
      expect(
        isCoordinatorDispatchEnabled(createEnv({ COORDINATOR_DISPATCH_ENABLED: "potato" }))
      ).toBe(true);
    });

    it("should return true for empty string", () => {
      expect(
        isCoordinatorDispatchEnabled(createEnv({ COORDINATOR_DISPATCH_ENABLED: "" }))
      ).toBe(true);
    });

    it("should return false for whitespace ' 0 ' (trim before check)", () => {
      expect(
        isCoordinatorDispatchEnabled(createEnv({ COORDINATOR_DISPATCH_ENABLED: " 0 " }))
      ).toBe(false);
    });

    it("should return true for whitespace ' true ' (trim before check)", () => {
      expect(
        isCoordinatorDispatchEnabled(createEnv({ COORDINATOR_DISPATCH_ENABLED: " true " }))
      ).toBe(true);
    });
  });

  describe("getCoordinatorModel", () => {
    it("should return default when unset", () => {
      expect(getCoordinatorModel(createEnv({}))).toBe(DEFAULT_COORDINATOR_MODEL);
    });

    it("should return default when env is undefined", () => {
      expect(getCoordinatorModel()).toBe(DEFAULT_COORDINATOR_MODEL);
    });

    it("should return default for empty string", () => {
      expect(getCoordinatorModel(createEnv({ COORDINATOR_MODEL: "" }))).toBe(
        DEFAULT_COORDINATOR_MODEL
      );
    });

    it("should return default for whitespace-only string", () => {
      expect(getCoordinatorModel(createEnv({ COORDINATOR_MODEL: "   " }))).toBe(
        DEFAULT_COORDINATOR_MODEL
      );
    });

    it("should return the configured model", () => {
      expect(getCoordinatorModel(createEnv({ COORDINATOR_MODEL: "gpt-5.5" }))).toBe("gpt-5.5");
    });

    it("should trim whitespace from configured model", () => {
      expect(getCoordinatorModel(createEnv({ COORDINATOR_MODEL: "  gpt-5.5  " }))).toBe(
        "gpt-5.5"
      );
    });
  });

  describe("getCoordinatorModelFallbacks", () => {
    it("should return default fallbacks when unset", () => {
      const result = getCoordinatorModelFallbacks(createEnv({}));
      expect(result).toEqual(DEFAULT_COORDINATOR_MODEL_FALLBACKS);
    });

    it("should return default fallbacks when env is undefined", () => {
      const result = getCoordinatorModelFallbacks();
      expect(result).toEqual(DEFAULT_COORDINATOR_MODEL_FALLBACKS);
    });

    it("should parse comma-separated fallbacks", () => {
      const result = getCoordinatorModelFallbacks(
        createEnv({ COORDINATOR_MODEL_FALLBACKS: "a,b,c" })
      );
      expect(result).toEqual(["a", "b", "c"]);
    });

    it("should trim each fallback", () => {
      const result = getCoordinatorModelFallbacks(
        createEnv({ COORDINATOR_MODEL_FALLBACKS: "a, b , c" })
      );
      expect(result).toEqual(["a", "b", "c"]);
    });

    it("should filter out empty entries", () => {
      const result = getCoordinatorModelFallbacks(
        createEnv({ COORDINATOR_MODEL_FALLBACKS: "a,,b" })
      );
      expect(result).toEqual(["a", "b"]);
    });

    it("should return a new array, not reference to default", () => {
      const result = getCoordinatorModelFallbacks(createEnv({}));
      result.push("extra");
      // Verify the default is not mutated
      expect(getCoordinatorModelFallbacks(createEnv({}))).not.toContain("extra");
    });
  });

  describe("resolveCoordinatorModelChain", () => {
    it("should start with primary model", () => {
      const result = resolveCoordinatorModelChain(createEnv({}));
      expect(result[0]).toBe(DEFAULT_COORDINATOR_MODEL);
    });

    it("should include all fallbacks", () => {
      const result = resolveCoordinatorModelChain(createEnv({}));
      expect(result).toEqual([...DEFAULT_COORDINATOR_MODEL_FALLBACKS]);
    });

    it("should deduplicate primary if already in fallbacks", () => {
      // Default: Haiku is both primary and first fallback
      const result = resolveCoordinatorModelChain(createEnv({}));
      const haiku = DEFAULT_COORDINATOR_MODEL;
      const count = result.filter(m => m === haiku).length;
      expect(count).toBe(1);
    });

    it("should custom primary with custom fallbacks", () => {
      const result = resolveCoordinatorModelChain(
        createEnv({
          COORDINATOR_MODEL: "gpt-5.5",
          COORDINATOR_MODEL_FALLBACKS: "claude-haiku-4.5,gpt-5.4-mini",
        })
      );
      expect(result).toEqual(["gpt-5.5", "claude-haiku-4.5", "gpt-5.4-mini"]);
    });

    it("should dedupe when primary appears in fallbacks", () => {
      const result = resolveCoordinatorModelChain(
        createEnv({
          COORDINATOR_MODEL: "gpt-5.5",
          COORDINATOR_MODEL_FALLBACKS: "claude-haiku-4.5,gpt-5.5,gpt-5.4-mini",
        })
      );
      expect(result).toEqual(["gpt-5.5", "claude-haiku-4.5", "gpt-5.4-mini"]);
    });

    it("should preserve order when deduplicating", () => {
      const result = resolveCoordinatorModelChain(
        createEnv({
          COORDINATOR_MODEL: "x",
          COORDINATOR_MODEL_FALLBACKS: "y,x,z",
        })
      );
      expect(result).toEqual(["x", "y", "z"]);
    });
  });

  describe("getCoordinatorEnvSummary", () => {
    it("should return default summary", () => {
      const summary = getCoordinatorEnvSummary(createEnv({}));
      expect(summary).toMatchObject({
        dispatchEnabled: true,
        primaryModel: DEFAULT_COORDINATOR_MODEL,
        fallbacks: DEFAULT_COORDINATOR_MODEL_FALLBACKS,
        modelChain: [...DEFAULT_COORDINATOR_MODEL_FALLBACKS],
      });
    });

    it("should reflect dispatch disabled state", () => {
      const summary = getCoordinatorEnvSummary(
        createEnv({ COORDINATOR_DISPATCH_ENABLED: "0" })
      );
      expect(summary.dispatchEnabled).toBe(false);
    });

    it("should reflect custom primary model", () => {
      const summary = getCoordinatorEnvSummary(
        createEnv({ COORDINATOR_MODEL: "gpt-5.5" })
      );
      expect(summary.primaryModel).toBe("gpt-5.5");
    });

    it("should reflect custom fallbacks", () => {
      const summary = getCoordinatorEnvSummary(
        createEnv({ COORDINATOR_MODEL_FALLBACKS: "a,b,c" })
      );
      expect(summary.fallbacks).toEqual(["a", "b", "c"]);
    });

    it("should return valid CoordinatorEnvSummary shape", () => {
      const summary = getCoordinatorEnvSummary(createEnv({}));
      expect(typeof summary.dispatchEnabled).toBe("boolean");
      expect(typeof summary.primaryModel).toBe("string");
      expect(Array.isArray(summary.fallbacks)).toBe(true);
      expect(Array.isArray(summary.modelChain)).toBe(true);
    });

    it("should update all fields consistently with env changes", () => {
      const summary = getCoordinatorEnvSummary(
        createEnv({
          COORDINATOR_DISPATCH_ENABLED: "false",
          COORDINATOR_MODEL: "claude-opus-4.7",
          COORDINATOR_MODEL_FALLBACKS: "gpt-5.4,gpt-4.1",
        })
      );
      expect(summary.dispatchEnabled).toBe(false);
      expect(summary.primaryModel).toBe("claude-opus-4.7");
      expect(summary.fallbacks).toEqual(["gpt-5.4", "gpt-4.1"]);
      expect(summary.modelChain[0]).toBe("claude-opus-4.7");
    });
  });
});
