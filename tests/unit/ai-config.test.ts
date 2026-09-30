import { describe, expect, test } from "vitest";
import {
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_TIMEOUT_MS,
  loadOpenAiConfig,
} from "../../src/ai/config.js";
import { ProviderError } from "../../src/ai/types.js";

describe("OpenAI Configuration (loadOpenAiConfig)", () => {
  const FAKE_KEY = "sk-test-fakekey1234567890abcdef";

  test("loads valid configuration with defaults", () => {
    const config = loadOpenAiConfig({
      OPENAI_API_KEY: FAKE_KEY,
    });

    expect(config.apiKey).toBe(FAKE_KEY);
    expect(config.model).toBe(DEFAULT_OPENAI_MODEL);
    expect(config.timeoutMs).toBe(DEFAULT_OPENAI_TIMEOUT_MS);
  });

  test("loads custom model and timeout", () => {
    const config = loadOpenAiConfig({
      OPENAI_API_KEY: FAKE_KEY,
      VIBECOMMIT_OPENAI_MODEL: "gpt-4o",
      VIBECOMMIT_OPENAI_TIMEOUT_MS: "30000",
    });

    expect(config.model).toBe("gpt-4o");
    expect(config.timeoutMs).toBe(30000);
  });

  test("throws ProviderError when OPENAI_API_KEY is missing or empty", () => {
    expect(() => loadOpenAiConfig({})).toThrow(ProviderError);
    expect(() => loadOpenAiConfig({ OPENAI_API_KEY: "" })).toThrow(ProviderError);
    expect(() => loadOpenAiConfig({ OPENAI_API_KEY: "   " })).toThrow(
      "OPENAI_API_KEY is not configured",
    );
  });

  test("throws ProviderError on invalid timeout values (non-numeric, zero, negative, decimal, out of range)", () => {
    const invalidTimeouts = ["abc", "0", "-500", "15.5", "999999999", ""];

    for (const invalid of invalidTimeouts) {
      expect(() =>
        loadOpenAiConfig({
          OPENAI_API_KEY: FAKE_KEY,
          VIBECOMMIT_OPENAI_TIMEOUT_MS: invalid,
        }),
      ).toThrow(ProviderError);
    }
  });

  test("never includes API key in error messages", () => {
    try {
      loadOpenAiConfig({
        OPENAI_API_KEY: FAKE_KEY,
        VIBECOMMIT_OPENAI_TIMEOUT_MS: "invalid",
      });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(FAKE_KEY);
    }
  });
});
