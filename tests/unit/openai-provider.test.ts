import { describe, expect, test, vi } from "vitest";
import type { OpenAI } from "openai";
import type { OpenAiConfig } from "../../src/ai/config.js";
import { COMMIT_TYPES } from "../../src/domain/commit-types.js";
import {
  COMMIT_SUGGESTIONS_JSON_SCHEMA,
  OpenAiSuggestionProvider,
} from "../../src/ai/openai-provider.js";
import { ProviderError } from "../../src/ai/types.js";
import { buildSanitizedDiff } from "../../src/security/sanitized-diff.js";
import type { StagedFileChange } from "../../src/domain/staged-change.js";

function createMockDiff(rawDiffText = "diff --git a/file.ts b/file.ts\n+console.log(1);\n") {
  const files: StagedFileChange[] = [
    {
      path: "file.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      isBinary: false,
      hasTextDiff: true,
    },
  ];
  return buildSanitizedDiff(files, rawDiffText);
}

describe("OpenAiSuggestionProvider", () => {
  const fakeConfig: OpenAiConfig = {
    apiKey: "sk-test-secretkey1234567890abcdef",
    model: "gpt-4o-mini",
    timeoutMs: 5000,
  };

  test("sends structured output request with configured model and delimited sanitized diff", async () => {
    let capturedParams: unknown = null;
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation((params: unknown) => {
            capturedParams = params;
            return Promise.resolve({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      suggestions: [
                        {
                          type: "feat",
                          scope: "cli",
                          subject: "add openai provider",
                          reason: "implements AI suggestions",
                        },
                        {
                          type: "chore",
                          scope: null,
                          subject: "update dependencies",
                          reason: "adds openai sdk",
                        },
                        {
                          type: "test",
                          scope: "ai",
                          subject: "add provider tests",
                          reason: "verifies mocked calls",
                        },
                      ],
                    }),
                  },
                },
              ],
            });
          }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAiSuggestionProvider(fakeConfig, mockClient);
    const diff = createMockDiff();
    const suggestions = await provider.generateSuggestions(diff);

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]!.type).toBe("feat");
    expect(suggestions[0]!.scope).toBe("cli");

    const params = capturedParams as {
      model: string;
      response_format: { type: string; json_schema: { name: string; strict: boolean } };
      messages: Array<{ role: string; content: string }>;
    };
    expect(params.model).toBe("gpt-4o-mini");
    expect(params.response_format.type).toBe("json_schema");
    expect(params.response_format.json_schema.strict).toBe(true);
    expect(params.messages[1]!.content).toContain("=== BEGIN SANITIZED STAGED DIFF");
  });

  test("appends corrective prompt when retryFeedback is provided", async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const mockClient = {
      chat: {
        completions: {
          create: vi
            .fn()
            .mockImplementation(
              (params: { messages: Array<{ role: string; content: string }> }) => {
                capturedMessages = params.messages;
                return Promise.resolve({
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          suggestions: [
                            { type: "fix", scope: null, subject: "fix bug", reason: "fixes bug" },
                            { type: "test", scope: null, subject: "add test", reason: "adds test" },
                            {
                              type: "docs",
                              scope: null,
                              subject: "doc change",
                              reason: "docs change",
                            },
                          ],
                        }),
                      },
                    },
                  ],
                });
              },
            ),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAiSuggestionProvider(fakeConfig, mockClient);
    await provider.generateSuggestions(createMockDiff(), "Suggestions must have unique subjects");

    expect(capturedMessages).toHaveLength(3);
    expect(capturedMessages[2]!.role).toBe("user");
    expect(capturedMessages[2]!.content).toContain("Suggestions must have unique subjects");
  });

  test("maps timeout errors to ProviderError(timeout, retryable=true)", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue({ name: "AbortError" }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAiSuggestionProvider(fakeConfig, mockClient);
    await expect(provider.generateSuggestions(createMockDiff())).rejects.toSatisfy((err) => {
      return err instanceof ProviderError && err.kind === "timeout" && err.retryable === true;
    });
  });

  test("maps HTTP 401 to ProviderError(auth_error, retryable=false)", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue({ status: 401, message: "Invalid API key" }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAiSuggestionProvider(fakeConfig, mockClient);
    await expect(provider.generateSuggestions(createMockDiff())).rejects.toSatisfy((err) => {
      return err instanceof ProviderError && err.kind === "auth_error" && err.retryable === false;
    });
  });

  test("maps HTTP 429 to ProviderError(rate_limit, retryable=true)", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue({ status: 429, message: "Rate limit" }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAiSuggestionProvider(fakeConfig, mockClient);
    await expect(provider.generateSuggestions(createMockDiff())).rejects.toSatisfy((err) => {
      return err instanceof ProviderError && err.kind === "rate_limit" && err.retryable === true;
    });
  });

  test("maps connection error to ProviderError(network_error, retryable=true)", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue({ name: "APIConnectionError", code: "ECONNREFUSED" }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAiSuggestionProvider(fakeConfig, mockClient);
    await expect(provider.generateSuggestions(createMockDiff())).rejects.toSatisfy((err) => {
      return err instanceof ProviderError && err.kind === "network_error" && err.retryable === true;
    });
  });

  test("maps refusal response to ProviderError(refusal, retryable=true)", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  refusal: "I cannot fulfill this request.",
                  content: null,
                },
              },
            ],
          }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAiSuggestionProvider(fakeConfig, mockClient);
    await expect(provider.generateSuggestions(createMockDiff())).rejects.toSatisfy((err) => {
      return err instanceof ProviderError && err.kind === "refusal" && err.retryable === true;
    });
  });

  test("maps empty choices or empty content to ProviderError(empty_output, retryable=true)", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [],
          }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAiSuggestionProvider(fakeConfig, mockClient);
    await expect(provider.generateSuggestions(createMockDiff())).rejects.toSatisfy((err) => {
      return err instanceof ProviderError && err.kind === "empty_output" && err.retryable === true;
    });
  });

  test("maps malformed JSON to ProviderError(invalid_output, retryable=true)", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: "not json at all",
                },
              },
            ],
          }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAiSuggestionProvider(fakeConfig, mockClient);
    await expect(provider.generateSuggestions(createMockDiff())).rejects.toSatisfy((err) => {
      return (
        err instanceof ProviderError && err.kind === "invalid_output" && err.retryable === true
      );
    });
  });

  test("maps schema validation failures to ProviderError(invalid_output, retryable=true)", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  // Only 2 suggestions instead of 3
                  content: JSON.stringify({
                    suggestions: [
                      { type: "feat", scope: null, subject: "s1", reason: "r1" },
                      { type: "chore", scope: null, subject: "s2", reason: "r2" },
                    ],
                  }),
                },
              },
            ],
          }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAiSuggestionProvider(fakeConfig, mockClient);
    await expect(provider.generateSuggestions(createMockDiff())).rejects.toSatisfy((err) => {
      return (
        err instanceof ProviderError && err.kind === "invalid_output" && err.retryable === true
      );
    });
  });

  test("never includes API key or raw secret in thrown error messages", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error(`Failed with key ${fakeConfig.apiKey}`)),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAiSuggestionProvider(fakeConfig, mockClient);
    try {
      await provider.generateSuggestions(createMockDiff());
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(fakeConfig.apiKey);
    }
  });

  test("schema enum equals COMMIT_TYPES and includes 'security'", () => {
    expect(
      COMMIT_SUGGESTIONS_JSON_SCHEMA.schema.properties.suggestions.items.properties.type.enum,
    ).toEqual(COMMIT_TYPES);
    expect(
      COMMIT_SUGGESTIONS_JSON_SCHEMA.schema.properties.suggestions.items.properties.type.enum,
    ).toContain("security");
  });

  test("validates provider response containing 'security' type suggestion", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    suggestions: [
                      {
                        type: "security",
                        scope: "auth",
                        subject: "patch token verification bypass",
                        reason: "mitigates auth bypass vulnerability",
                      },
                      {
                        type: "fix",
                        scope: "deps",
                        subject: "update vulnerable dependency",
                        reason: "fixes reported security advisory",
                      },
                      {
                        type: "test",
                        scope: "security",
                        subject: "add exploit regression test",
                        reason: "verifies vulnerability fix",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAiSuggestionProvider(fakeConfig, mockClient);
    const suggestions = await provider.generateSuggestions(createMockDiff());

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]!.type).toBe("security");
    expect(suggestions[0]!.subject).toBe("patch token verification bypass");
  });
});
