import type { Suggestion } from "../domain/suggestion-schema.js";
import type { SanitizedDiff } from "../security/types.js";

export type SuggestionSource = "ai" | "fallback";

export type SafeFallbackReason =
  "missing_api_key" | "timeout" | "auth_error" | "rate_limit" | "invalid_response" | "unavailable";

export interface SuggestionGenerationResult {
  readonly suggestions: readonly Suggestion[];
  readonly source: SuggestionSource;
  readonly fallbackReason?: SafeFallbackReason;
  readonly safeFallbackMessage?: string;
}

export type ProviderErrorKind =
  | "missing_config"
  | "timeout"
  | "network_error"
  | "auth_error"
  | "rate_limit"
  | "refusal"
  | "empty_output"
  | "invalid_output"
  | "unknown";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;

  constructor(kind: ProviderErrorKind, message: string, retryable: boolean, cause?: unknown) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.retryable = retryable;
    if (cause) {
      this.cause = cause;
    }
  }
}

export interface SuggestionProvider {
  generateSuggestions(diff: SanitizedDiff, retryFeedback?: string): Promise<readonly Suggestion[]>;
}
