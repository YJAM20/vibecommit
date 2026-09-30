import { describe, expect, test, vi } from "vitest";
import { SuggestionOrchestrator, validateSuggestions } from "../../src/ai/generate.js";
import { ProviderError, type SuggestionProvider } from "../../src/ai/types.js";
import type { Suggestion } from "../../src/domain/suggestion-schema.js";
import type { StagedFileChange } from "../../src/domain/staged-change.js";
import { buildSanitizedDiff } from "../../src/security/sanitized-diff.js";

function createMockDiff() {
  const files: StagedFileChange[] = [
    {
      path: "src/index.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      isBinary: false,
      hasTextDiff: true,
    },
  ];
  return {
    diff: buildSanitizedDiff(files, "diff --git a/src/index.ts b/src/index.ts\n+console.log();\n"),
    files,
  };
}

const VALID_SUGGESTIONS: readonly Suggestion[] = [
  {
    type: "feat",
    scope: "ai",
    subject: "add suggestion orchestrator",
    reason: "adds orchestrator",
  },
  { type: "fix", scope: null, subject: "fix retry handling", reason: "fixes retry loop" },
  { type: "docs", scope: "readme", subject: "update ai usage docs", reason: "documents env vars" },
];

describe("validateSuggestions", () => {
  test("returns valid: true for three unique valid suggestions", () => {
    const result = validateSuggestions(VALID_SUGGESTIONS);
    expect(result.valid).toBe(true);
  });

  test("returns valid: false when count is not 3", () => {
    const result = validateSuggestions(VALID_SUGGESTIONS.slice(0, 2));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("Must contain exactly three suggestions");
    }
  });

  test("returns valid: false when duplicate formatted commit messages exist", () => {
    const duplicates: readonly Suggestion[] = [
      { type: "feat", scope: "ai", subject: "add suggestion orchestrator", reason: "r1" },
      { type: "feat", scope: "ai", subject: "add suggestion orchestrator", reason: "r2" },
      { type: "docs", scope: null, subject: "update readme", reason: "r3" },
    ];
    const result = validateSuggestions(duplicates);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("Duplicate formatted commit message");
    }
  });

  test("returns valid: false when a suggestion has an invalid or overlong subject", () => {
    const invalid: readonly Suggestion[] = [
      {
        type: "feat",
        scope: "ai",
        subject:
          "this subject is way too long and exceeds the seventy-two character conventional commit limit by quite a lot",
        reason: "too long",
      },
      VALID_SUGGESTIONS[1]!,
      VALID_SUGGESTIONS[2]!,
    ];
    const result = validateSuggestions(invalid);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("exceeds maximum length");
    }
  });

  test("returns valid: false when a suggestion has a multiline subject", () => {
    const invalid: readonly Suggestion[] = [
      {
        type: "feat",
        scope: "ai",
        subject: "line one\nline two",
        reason: "multiline",
      },
      VALID_SUGGESTIONS[1]!,
      VALID_SUGGESTIONS[2]!,
    ];
    const result = validateSuggestions(invalid);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("single line");
    }
  });
});

describe("SuggestionOrchestrator", () => {
  const { diff, files } = createMockDiff();

  test("returns AI suggestions with source 'ai' on primary attempt success", async () => {
    const generateSuggestions = vi.fn().mockResolvedValue(VALID_SUGGESTIONS);
    const mockProvider: SuggestionProvider = {
      generateSuggestions,
    };

    const orchestrator = new SuggestionOrchestrator({ provider: mockProvider });
    const result = await orchestrator.getSuggestions(diff, files, { noAi: false });

    expect(result.source).toBe("ai");
    expect(result.suggestions).toEqual(VALID_SUGGESTIONS);
    expect(generateSuggestions).toHaveBeenCalledTimes(1);
    expect(result.fallbackReason).toBeUndefined();
  });

  test("retries once when primary attempt returns invalid schema/validation, then succeeds", async () => {
    const invalidSuggestions: readonly Suggestion[] = [
      { type: "feat", scope: null, subject: "duplicate", reason: "r1" },
      { type: "feat", scope: null, subject: "duplicate", reason: "r2" },
      { type: "chore", scope: null, subject: "chore msg", reason: "r3" },
    ];

    const generateSuggestions = vi
      .fn()
      .mockResolvedValueOnce(invalidSuggestions)
      .mockResolvedValueOnce(VALID_SUGGESTIONS);

    const mockProvider: SuggestionProvider = {
      generateSuggestions,
    };

    const orchestrator = new SuggestionOrchestrator({ provider: mockProvider });
    const result = await orchestrator.getSuggestions(diff, files, { noAi: false });

    expect(result.source).toBe("ai");
    expect(result.suggestions).toEqual(VALID_SUGGESTIONS);
    expect(generateSuggestions).toHaveBeenCalledTimes(2);
    // Verify second call passed corrective feedback
    expect(generateSuggestions).toHaveBeenNthCalledWith(
      2,
      diff,
      expect.stringContaining("Duplicate formatted commit message"),
    );
  });

  test("falls back to heuristics after retry failure on invalid output", async () => {
    const invalidSuggestions: readonly Suggestion[] = [
      { type: "feat", scope: null, subject: "duplicate", reason: "r1" },
      { type: "feat", scope: null, subject: "duplicate", reason: "r2" },
      { type: "chore", scope: null, subject: "chore msg", reason: "r3" },
    ];

    const generateSuggestions = vi.fn().mockResolvedValue(invalidSuggestions);
    const mockProvider: SuggestionProvider = {
      generateSuggestions,
    };

    const orchestrator = new SuggestionOrchestrator({ provider: mockProvider });
    const result = await orchestrator.getSuggestions(diff, files, { noAi: false });

    expect(result.source).toBe("fallback");
    expect(result.suggestions).toHaveLength(3);
    expect(result.fallbackReason).toBe("invalid_response");
    expect(result.safeFallbackMessage).toContain("AI response could not be validated");
    expect(generateSuggestions).toHaveBeenCalledTimes(2);
  });

  test("retries on timeout and falls back if retry also times out", async () => {
    const generateSuggestions = vi
      .fn()
      .mockRejectedValue(new ProviderError("timeout", "Timed out", true));
    const mockProvider: SuggestionProvider = {
      generateSuggestions,
    };

    const orchestrator = new SuggestionOrchestrator({ provider: mockProvider });
    const result = await orchestrator.getSuggestions(diff, files, { noAi: false });

    expect(result.source).toBe("fallback");
    expect(result.suggestions).toHaveLength(3);
    expect(result.fallbackReason).toBe("timeout");
    expect(result.safeFallbackMessage).toContain("AI request timed out");
    expect(generateSuggestions).toHaveBeenCalledTimes(2);
  });

  test("does NOT retry on non-retryable auth error and immediately falls back", async () => {
    const generateSuggestions = vi
      .fn()
      .mockRejectedValue(new ProviderError("auth_error", "Unauthorized", false));
    const mockProvider: SuggestionProvider = {
      generateSuggestions,
    };

    const orchestrator = new SuggestionOrchestrator({ provider: mockProvider });
    const result = await orchestrator.getSuggestions(diff, files, { noAi: false });

    expect(result.source).toBe("fallback");
    expect(result.suggestions).toHaveLength(3);
    expect(result.fallbackReason).toBe("auth_error");
    expect(result.safeFallbackMessage).toContain("AI authentication failed");
    expect(generateSuggestions).toHaveBeenCalledTimes(1); // No second call!
  });

  test("falls back with safe message when OPENAI_API_KEY is not configured", async () => {
    const orchestrator = new SuggestionOrchestrator({
      env: {}, // Empty env without OPENAI_API_KEY
    });
    const result = await orchestrator.getSuggestions(diff, files, { noAi: false });

    expect(result.source).toBe("fallback");
    expect(result.suggestions).toHaveLength(3);
    expect(result.fallbackReason).toBe("missing_api_key");
    expect(result.safeFallbackMessage).toContain(
      "OPENAI_API_KEY is not configured. Using local fallback suggestions.",
    );
  });

  test("in explicit no-ai mode: never calls provider or config loader", async () => {
    const generateSuggestions = vi.fn();
    const mockProvider: SuggestionProvider = {
      generateSuggestions,
    };
    const mockConfigLoader = vi.fn();

    const orchestrator = new SuggestionOrchestrator({
      provider: mockProvider,
      configLoader: mockConfigLoader,
    });
    const result = await orchestrator.getSuggestions(diff, files, { noAi: true });

    expect(result.source).toBe("fallback");
    expect(result.suggestions).toHaveLength(3);
    expect(generateSuggestions).not.toHaveBeenCalled();
    expect(mockConfigLoader).not.toHaveBeenCalled();
    expect(result.fallbackReason).toBeUndefined();
    expect(result.safeFallbackMessage).toBeUndefined();
  });

  test("calls onBeforeRequest immediately before network call, but never in no-ai or missing key mode", async () => {
    const onBeforeRequest = vi.fn();
    const generateSuggestions = vi.fn().mockResolvedValue(VALID_SUGGESTIONS);
    const mockProvider: SuggestionProvider = { generateSuggestions };

    const orchestrator = new SuggestionOrchestrator({ provider: mockProvider });

    // 1. Called in normal AI mode
    await orchestrator.getSuggestions(diff, files, { noAi: false, onBeforeRequest });
    expect(onBeforeRequest).toHaveBeenCalledTimes(1);

    onBeforeRequest.mockClear();

    // 2. Never called in explicit no-ai mode
    await orchestrator.getSuggestions(diff, files, { noAi: true, onBeforeRequest });
    expect(onBeforeRequest).not.toHaveBeenCalled();

    onBeforeRequest.mockClear();

    // 3. Never called when API key is missing (fails before network call)
    const orchestratorNoKey = new SuggestionOrchestrator({ env: {} });
    await orchestratorNoKey.getSuggestions(diff, files, { noAi: false, onBeforeRequest });
    expect(onBeforeRequest).not.toHaveBeenCalled();
  });
});
