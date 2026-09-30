import { ProviderError } from "./types.js";

export interface OpenAiConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
}

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_OPENAI_TIMEOUT_MS = 15000;
export const MAX_OPENAI_TIMEOUT_MS = 120000;

export function loadOpenAiConfig(
  env: Record<string, string | undefined> = process.env,
): OpenAiConfig {
  const rawKey = env["OPENAI_API_KEY"];
  if (!rawKey || rawKey.trim().length === 0) {
    throw new ProviderError(
      "missing_config",
      "OPENAI_API_KEY is not configured in the environment",
      false,
    );
  }

  const apiKey = rawKey.trim();

  let model = DEFAULT_OPENAI_MODEL;
  const rawModel = env["VIBECOMMIT_OPENAI_MODEL"];
  if (rawModel !== undefined && rawModel.trim().length > 0) {
    model = rawModel.trim();
  }

  let timeoutMs = DEFAULT_OPENAI_TIMEOUT_MS;
  const rawTimeout = env["VIBECOMMIT_OPENAI_TIMEOUT_MS"];
  if (rawTimeout !== undefined) {
    const trimmedTimeout = rawTimeout.trim();
    if (!/^\d+$/.test(trimmedTimeout)) {
      throw new ProviderError(
        "missing_config",
        "VIBECOMMIT_OPENAI_TIMEOUT_MS must be a positive integer",
        false,
      );
    }

    const parsed = Number(trimmedTimeout);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_OPENAI_TIMEOUT_MS) {
      throw new ProviderError(
        "missing_config",
        `VIBECOMMIT_OPENAI_TIMEOUT_MS must be between 1 and ${MAX_OPENAI_TIMEOUT_MS} milliseconds`,
        false,
      );
    }

    timeoutMs = parsed;
  }

  return {
    apiKey,
    model,
    timeoutMs,
  };
}
