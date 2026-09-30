import type { RedactionReport } from "./types.js";

interface RedactionRule {
  readonly category: string;
  readonly execute: (input: string) => { output: string; count: number };
}

// 1. Multiline PEM / OpenSSH private key blocks
const PRIVATE_KEY_REGEX =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;

// 2. Database connection strings containing user:password credentials
const DB_CONNECTION_REGEX =
  /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|rediss):\/\/[^\s:]+:[^\s@]+@[^\s'"`]+\b/g;

// 3. OpenAI-style API keys (sk-...)
const OPENAI_KEY_REGEX = /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g;

// 4. GitHub personal access tokens & oauth tokens
const GITHUB_TOKEN_REGEX =
  /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|(?:gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,})\b/g;

// 5. AWS Access Key IDs (AKIA..., ABIA..., etc.)
const AWS_ACCESS_KEY_REGEX = /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16,20}\b/g;

// 6. Bearer authorization header values
const BEARER_TOKEN_REGEX = /\b(Bearer)\s+([A-Za-z0-9\-._~+/]+=*)\b/gi;

const QUOTED_ASSIGNMENT_REGEX =
  /((?:["']?)(?:\b(?:API_?KEY|OPENAI_?API_?KEY|DATABASE_?URL|PASSWORD|SECRET|TOKEN|AUTH_?TOKEN|ACCESS_?TOKEN|PRIVATE_?KEY|CLIENT_?SECRET|SECRET_?KEY|APP_?SECRET)\b)(?:["']?)\s*[:=]\s*)(['"])(?!\s*\[REDACTED:)(.+?)\2/gi;

const UNQUOTED_ASSIGNMENT_REGEX =
  /((?:["']?)(?:\b(?:API_?KEY|OPENAI_?API_?KEY|DATABASE_?URL|PASSWORD|SECRET|TOKEN|AUTH_?TOKEN|ACCESS_?TOKEN|PRIVATE_?KEY|CLIENT_?SECRET|SECRET_?KEY|APP_?SECRET)\b)(?:["']?)\s*[:=]\s*)(?!\s*\[REDACTED:)([^'"\r\n\s;,]+)/gi;

const NON_SECRET_UNQUOTED = new Set(["true", "false", "null", "undefined"]);

function executeRegexRule(
  input: string,
  regex: RegExp,
  replacer: (match: string, ...args: string[]) => string,
): { output: string; count: number } {
  let count = 0;
  const output = input.replace(regex, (...args) => {
    count += 1;
    return replacer(...(args as [string, ...string[]]));
  });
  return { output, count };
}

function executeSensitiveAssignment(input: string): { output: string; count: number } {
  let count = 0;

  // First pass: quoted assignments (e.g. API_KEY="secret", 'token': 'secret')
  let current = input.replace(QUOTED_ASSIGNMENT_REGEX, (_match, prefix: string, quote: string) => {
    count += 1;
    return `${prefix}${quote}[REDACTED:sensitive_assignment]${quote}`;
  });

  // Second pass: unquoted assignments (e.g. API_KEY=secret)
  current = current.replace(UNQUOTED_ASSIGNMENT_REGEX, (match, prefix: string, value: string) => {
    const trimmed = value.trim().toLowerCase();
    // Skip booleans, null, undefined, or environment variable references
    if (
      NON_SECRET_UNQUOTED.has(trimmed) ||
      trimmed.startsWith("process.env.") ||
      trimmed.startsWith("env.")
    ) {
      return match;
    }
    count += 1;
    return `${prefix}[REDACTED:sensitive_assignment]`;
  });

  return { output: current, count };
}

const REDACTION_RULES: readonly RedactionRule[] = [
  // 1. Multiline PEM / Private key blocks (run first to avoid partial line matching)
  {
    category: "private_key",
    execute: (input) => executeRegexRule(input, PRIVATE_KEY_REGEX, () => "[REDACTED:private_key]"),
  },
  // 2. Database connection strings with credentials
  {
    category: "database_connection_string",
    execute: (input) =>
      executeRegexRule(input, DB_CONNECTION_REGEX, () => "[REDACTED:database_connection_string]"),
  },
  // 3. OpenAI-style API keys
  {
    category: "openai_api_key",
    execute: (input) =>
      executeRegexRule(input, OPENAI_KEY_REGEX, () => "[REDACTED:openai_api_key]"),
  },
  // 4. GitHub tokens
  {
    category: "github_token",
    execute: (input) =>
      executeRegexRule(input, GITHUB_TOKEN_REGEX, () => "[REDACTED:github_token]"),
  },
  // 5. AWS access key IDs
  {
    category: "aws_access_key_id",
    execute: (input) =>
      executeRegexRule(input, AWS_ACCESS_KEY_REGEX, () => "[REDACTED:aws_access_key_id]"),
  },
  // 6. Bearer authorization header values
  {
    category: "bearer_token",
    execute: (input) =>
      executeRegexRule(
        input,
        BEARER_TOKEN_REGEX,
        (_match, bearerPrefix: string) => `${bearerPrefix} [REDACTED:bearer_token]`,
      ),
  },
  // 7. Sensitive key-value assignments
  {
    category: "sensitive_assignment",
    execute: executeSensitiveAssignment,
  },
];

export function redactSecrets(text: string): {
  sanitizedText: string;
  report: RedactionReport;
} {
  if (text.length === 0) {
    return {
      sanitizedText: "",
      report: {
        totalRedactions: 0,
        redactionsByCategory: {},
      },
    };
  }

  let current = text;
  let totalRedactions = 0;
  const redactionsByCategory: Record<string, number> = {};

  for (const rule of REDACTION_RULES) {
    const { output, count } = rule.execute(current);
    if (count > 0) {
      current = output;
      totalRedactions += count;
      redactionsByCategory[rule.category] = (redactionsByCategory[rule.category] ?? 0) + count;
    }
  }

  return {
    sanitizedText: current,
    report: {
      totalRedactions,
      redactionsByCategory,
    },
  };
}
