import { OpenAI } from "openai";
import { SuggestionsResponseSchema, type Suggestion } from "../domain/suggestion-schema.js";
import type { SanitizedDiff } from "../security/types.js";
import type { OpenAiConfig } from "./config.js";
import { buildCorrectivePrompt, buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import { ProviderError, type SuggestionProvider } from "./types.js";

const COMMIT_SUGGESTIONS_JSON_SCHEMA = {
  name: "commit_suggestions",
  strict: true,
  schema: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["feat", "fix", "docs", "refactor", "test", "chore"],
            },
            scope: {
              type: ["string", "null"],
            },
            subject: {
              type: "string",
            },
            reason: {
              type: "string",
            },
          },
          required: ["type", "scope", "subject", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["suggestions"],
    additionalProperties: false,
  },
} as const;

export class OpenAiSuggestionProvider implements SuggestionProvider {
  private readonly client: OpenAI;
  private readonly config: OpenAiConfig;

  constructor(config: OpenAiConfig, client?: OpenAI) {
    this.config = config;
    this.client =
      client ??
      new OpenAI({
        apiKey: config.apiKey,
        timeout: config.timeoutMs,
      });
  }

  async generateSuggestions(
    diff: SanitizedDiff,
    retryFeedback?: string,
  ): Promise<readonly Suggestion[]> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: buildSystemPrompt(),
      },
      {
        role: "user",
        content: buildUserPrompt(diff),
      },
    ];

    if (retryFeedback !== undefined && retryFeedback.trim().length > 0) {
      messages.push({
        role: "user",
        content: buildCorrectivePrompt(retryFeedback),
      });
    }

    let response: OpenAI.Chat.ChatCompletion;
    try {
      response = await this.client.chat.completions.create(
        {
          model: this.config.model,
          messages,
          response_format: {
            type: "json_schema",
            json_schema: COMMIT_SUGGESTIONS_JSON_SCHEMA,
          },
          temperature: 0.2,
        },
        {
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null) {
        const err = error as { name?: string; status?: number; code?: string; message?: string };
        if (err.name === "AbortError" || err.name === "APIConnectionTimeoutError") {
          throw new ProviderError("timeout", "OpenAI request timed out", true, error);
        }
        if (err.status === 401) {
          throw new ProviderError("auth_error", "OpenAI authentication failed", false, error);
        }
        if (err.status === 429) {
          throw new ProviderError("rate_limit", "OpenAI rate limit exceeded", true, error);
        }
        if (
          err.name === "APIConnectionError" ||
          err.code === "ECONNREFUSED" ||
          err.code === "ENOTFOUND"
        ) {
          throw new ProviderError("network_error", "Failed to connect to OpenAI", true, error);
        }
      }
      throw new ProviderError("unknown", "OpenAI API request failed", true, error);
    }

    const choice = response.choices?.[0];
    if (!choice) {
      throw new ProviderError("empty_output", "OpenAI returned an empty response", true);
    }

    if (choice.message?.refusal) {
      throw new ProviderError("refusal", "OpenAI model refused to generate suggestions", true);
    }

    const rawContent = choice.message?.content;
    if (!rawContent || rawContent.trim().length === 0) {
      throw new ProviderError("empty_output", "OpenAI returned empty message content", true);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawContent);
    } catch (error: unknown) {
      throw new ProviderError("invalid_output", "OpenAI response was not valid JSON", true, error);
    }

    const parseResult = SuggestionsResponseSchema.safeParse(parsedJson);
    if (!parseResult.success) {
      const issueMessages = parseResult.error.issues.map((i) => i.message).join(", ");
      throw new ProviderError(
        "invalid_output",
        `OpenAI response failed schema validation: ${issueMessages}`,
        true,
        parseResult.error,
      );
    }

    return parseResult.data.suggestions;
  }
}
