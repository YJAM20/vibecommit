import { generateHeuristicSuggestions } from "../domain/heuristics.js";
import type { StagedFileChange } from "../domain/staged-change.js";
import { formatCommitMessage, type Suggestion } from "../domain/suggestion-schema.js";
import { validateCommitMessage } from "../domain/validate-message.js";
import type { SanitizedDiff } from "../security/types.js";
import { loadOpenAiConfig, type OpenAiConfig } from "./config.js";
import { OpenAiSuggestionProvider } from "./openai-provider.js";
import {
  ProviderError,
  type SafeFallbackReason,
  type SuggestionGenerationResult,
  type SuggestionProvider,
} from "./types.js";

export interface OrchestratorDependencies {
  readonly provider?: SuggestionProvider;
  readonly configLoader?: (env?: Record<string, string | undefined>) => OpenAiConfig;
  readonly env?: Record<string, string | undefined>;
}

export interface GenerationOptions {
  readonly noAi: boolean;
}

export function validateSuggestions(
  suggestions: readonly Suggestion[],
): { readonly valid: true } | { readonly valid: false; readonly reason: string } {
  if (suggestions.length !== 3) {
    return { valid: false, reason: "Must contain exactly three suggestions" };
  }

  const formattedSet = new Set<string>();
  for (const s of suggestions) {
    const formatted = formatCommitMessage(s);
    if (formattedSet.has(formatted)) {
      return { valid: false, reason: `Duplicate formatted commit message: '${formatted}'` };
    }
    formattedSet.add(formatted);

    const validation = validateCommitMessage(formatted);
    if (!validation.ok) {
      return {
        valid: false,
        reason: `Invalid commit message '${formatted}': ${validation.errors.join(", ")}`,
      };
    }
  }

  return { valid: true };
}

function resolveFallbackMessage(reason: SafeFallbackReason): string {
  switch (reason) {
    case "missing_api_key":
      return "OPENAI_API_KEY is not configured. Using local fallback suggestions.";
    case "timeout":
      return "AI request timed out. Using local fallback suggestions.";
    case "invalid_response":
      return "AI response could not be validated. Using local fallback suggestions.";
    case "auth_error":
      return "AI authentication failed. Using local fallback suggestions.";
    case "rate_limit":
      return "AI rate limit exceeded. Using local fallback suggestions.";
    case "unavailable":
    default:
      return "AI suggestions are unavailable. Using local fallback suggestions.";
  }
}

function categorizeError(error: unknown): {
  reason: SafeFallbackReason;
  retryable: boolean;
  message: string;
} {
  if (error instanceof ProviderError) {
    switch (error.kind) {
      case "missing_config":
        return {
          reason: "missing_api_key",
          retryable: false,
          message: error.message,
        };
      case "timeout":
        return {
          reason: "timeout",
          retryable: error.retryable,
          message: error.message,
        };
      case "auth_error":
        return {
          reason: "auth_error",
          retryable: false,
          message: error.message,
        };
      case "rate_limit":
        return {
          reason: "rate_limit",
          retryable: error.retryable,
          message: error.message,
        };
      case "invalid_output":
      case "empty_output":
      case "refusal":
        return {
          reason: "invalid_response",
          retryable: error.retryable,
          message: error.message,
        };
      case "network_error":
      case "unknown":
      default:
        return {
          reason: "unavailable",
          retryable: error.retryable,
          message: error.message,
        };
    }
  }

  return {
    reason: "unavailable",
    retryable: true,
    message: error instanceof Error ? error.message : "Unknown error",
  };
}

export class SuggestionOrchestrator {
  private readonly provider?: SuggestionProvider;
  private readonly configLoader: (env?: Record<string, string | undefined>) => OpenAiConfig;
  private readonly env: Record<string, string | undefined>;

  constructor(deps: OrchestratorDependencies = {}) {
    this.provider = deps.provider;
    this.configLoader = deps.configLoader ?? loadOpenAiConfig;
    this.env = deps.env ?? process.env;
  }

  async getSuggestions(
    diff: SanitizedDiff,
    files: readonly StagedFileChange[],
    options: GenerationOptions,
  ): Promise<SuggestionGenerationResult> {
    // 1. Explicit no-AI mode: Never touch OPENAI_API_KEY, never instantiate provider
    if (options.noAi) {
      const fallback = generateHeuristicSuggestions(files);
      return {
        suggestions: fallback,
        source: "fallback",
      };
    }

    // 2. Normal AI mode: obtain configuration lazily
    let provider = this.provider;
    if (!provider) {
      let config: OpenAiConfig;
      try {
        config = this.configLoader(this.env);
      } catch (err: unknown) {
        const { reason } = categorizeError(err);
        const fallback = generateHeuristicSuggestions(files);
        return {
          suggestions: fallback,
          source: "fallback",
          fallbackReason: reason,
          safeFallbackMessage: resolveFallbackMessage(reason),
        };
      }

      provider = new OpenAiSuggestionProvider(config);
    }

    // 3. Attempt 1
    let lastFailureReason: SafeFallbackReason;
    let retryFeedback: string | undefined;

    try {
      const suggestions = await provider.generateSuggestions(diff);
      const validation = validateSuggestions(suggestions);
      if (validation.valid) {
        return {
          suggestions,
          source: "ai",
        };
      }
      lastFailureReason = "invalid_response";
      retryFeedback = validation.reason;
    } catch (err: unknown) {
      const categorized = categorizeError(err);
      lastFailureReason = categorized.reason;
      if (!categorized.retryable) {
        const fallback = generateHeuristicSuggestions(files);
        return {
          suggestions: fallback,
          source: "fallback",
          fallbackReason: lastFailureReason,
          safeFallbackMessage: resolveFallbackMessage(lastFailureReason),
        };
      }
      retryFeedback = categorized.message;
    }

    // 4. Exactly one retry on retryable failure
    try {
      const retriedSuggestions = await provider.generateSuggestions(diff, retryFeedback);
      const validation = validateSuggestions(retriedSuggestions);
      if (validation.valid) {
        return {
          suggestions: retriedSuggestions,
          source: "ai",
        };
      }
      lastFailureReason = "invalid_response";
    } catch (err: unknown) {
      const categorized = categorizeError(err);
      lastFailureReason = categorized.reason;
    }

    // 5. Fallback to deterministic local heuristics after retry exhausted
    const fallback = generateHeuristicSuggestions(files);
    return {
      suggestions: fallback,
      source: "fallback",
      fallbackReason: lastFailureReason,
      safeFallbackMessage: resolveFallbackMessage(lastFailureReason),
    };
  }
}
