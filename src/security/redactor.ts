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

const BENIGN_IDENTIFIERS = new Set([
  "primary_key",
  "primarykey",
  "sort_key",
  "sortkey",
  "foreign_key",
  "foreignkey",
  "partition_key",
  "partitionkey",
  "tokenizer",
  "tokenizers",
  "max_tokens",
  "maxtokens",
  "total_tokens",
  "totaltokens",
  "num_tokens",
  "numtokens",
  "key_enter",
  "keyenter",
  "token_type",
  "tokentype",
]);

const SENSITIVE_WORD_PATTERNS: readonly RegExp[] = [
  /password/i,
  /passwd/i,
  /pwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /auth[_-]?key/i,
  /auth[_-]?token/i,
  /private[_-]?key/i,
  /client[_-]?secret/i,
  /access[_-]?key/i,
  /access[_-]?token/i,
  /database[_-]?url/i,
  /db[_-]?url/i,
];

function isSensitiveIdentifier(rawName: string): boolean {
  const cleanName = rawName.replace(/^["']|["']$/g, "").trim();
  const lower = cleanName.toLowerCase();

  if (BENIGN_IDENTIFIERS.has(lower)) {
    return false;
  }

  if (
    lower.endsWith("tokens") &&
    (lower.includes("max") ||
      lower.includes("total") ||
      lower.includes("num") ||
      lower.includes("count"))
  ) {
    return false;
  }

  return SENSITIVE_WORD_PATTERNS.some((pattern) => pattern.test(cleanName));
}

const TS_TYPE_NAMES = new Set([
  "string",
  "number",
  "boolean",
  "any",
  "unknown",
  "never",
  "void",
  "null",
  "undefined",
  "symbol",
  "bigint",
  "object",
  "date",
  "function",
]);

function isTypeAnnotation(op: string, value: string): boolean {
  if (op !== ":") {
    return false;
  }
  const clean = value.replace(/;$/, "").trim().toLowerCase();
  if (TS_TYPE_NAMES.has(clean)) {
    return true;
  }
  if (
    clean.includes("|") ||
    clean.endsWith("[]") ||
    clean.startsWith("record<") ||
    clean.startsWith("map<") ||
    clean.startsWith("promise<")
  ) {
    return true;
  }
  return false;
}

function isPlaceholderOrBenignValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }

  const lower = trimmed.toLowerCase();
  if (NON_SECRET_UNQUOTED.has(lower)) {
    return true;
  }
  if (lower.startsWith("process.env.") || lower.startsWith("env.")) {
    return true;
  }

  // Angle bracket placeholders: <your-key>, etc.
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return true;
  }

  // Env var placeholders: ${VAR}, etc.
  if (trimmed.startsWith("${") && trimmed.endsWith("}")) {
    return true;
  }

  // Placeholder keywords
  if (
    lower.includes("your_") ||
    lower.includes("your-") ||
    lower.includes("yourapi") ||
    lower.includes("changeme") ||
    lower.includes("todo") ||
    lower.includes("example") ||
    lower.includes("placeholder") ||
    lower === "xxx" ||
    lower === "xxxx" ||
    lower === "..."
  ) {
    return true;
  }

  return false;
}

const QUOTED_ASSIGNMENT_REGEX =
  /(^|[^\w$])(["']?[A-Za-z0-9_$-]+["']?\s*\??\s*([:=])\s*)(['"])(?!\s*\[REDACTED:)(.*?)\4/gm;

const UNQUOTED_ASSIGNMENT_REGEX =
  /(^|[^\w$])(["']?[A-Za-z0-9_$-]+["']?\s*\??\s*([:=])\s*)(?!\s*\[REDACTED:)([^'"\r\n\s;,]+)/gm;

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

function extractIdentifier(prefix: string): { identifier: string; op: string } {
  const match = /(["']?[A-Za-z0-9_$-]+["']?)\s*\??\s*([:=])/.exec(prefix);
  if (match && match[1] && match[2]) {
    return { identifier: match[1], op: match[2] };
  }
  return { identifier: "", op: "" };
}

function executeSensitiveAssignment(input: string): { output: string; count: number } {
  let count = 0;

  // First pass: quoted assignments (e.g. DB_PASSWORD = "secret", accessToken: 'secret')
  let current = input.replace(
    QUOTED_ASSIGNMENT_REGEX,
    (match, lead: string, prefix: string, op: string, quote: string, value: string) => {
      const { identifier } = extractIdentifier(prefix);
      if (!identifier || !isSensitiveIdentifier(identifier)) {
        return match;
      }
      if (isPlaceholderOrBenignValue(value)) {
        return match;
      }
      if (isTypeAnnotation(op, value)) {
        return match;
      }
      count += 1;
      return `${lead}${prefix}${quote}[REDACTED:sensitive_assignment]${quote}`;
    },
  );

  // Second pass: unquoted assignments (e.g. DB_PASSWORD=secret, API_KEY=abc)
  current = current.replace(
    UNQUOTED_ASSIGNMENT_REGEX,
    (match, lead: string, prefix: string, op: string, value: string) => {
      const { identifier } = extractIdentifier(prefix);
      if (!identifier || !isSensitiveIdentifier(identifier)) {
        return match;
      }
      if (isPlaceholderOrBenignValue(value)) {
        return match;
      }
      if (isTypeAnnotation(op, value)) {
        return match;
      }
      count += 1;
      return `${lead}${prefix}[REDACTED:sensitive_assignment]`;
    },
  );

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
