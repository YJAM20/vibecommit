import { describe, expect, test } from "vitest";
import { validateCommitMessage } from "../../src/domain/validate-message.js";

describe("validateCommitMessage", () => {
  const validCases: Array<{
    input: string;
    expected: { type: string; scope: string | null; subject: string };
  }> = [
    {
      input: "feat: add user login support",
      expected: { type: "feat", scope: null, subject: "add user login support" },
    },
    {
      input: "fix(auth): handle expired token gracefully",
      expected: { type: "fix", scope: "auth", subject: "handle expired token gracefully" },
    },
    {
      input: "docs: update getting started guide",
      expected: { type: "docs", scope: null, subject: "update getting started guide" },
    },
    {
      input: "refactor(core/engine): simplify state transition loop",
      expected: {
        type: "refactor",
        scope: "core/engine",
        subject: "simplify state transition loop",
      },
    },
    {
      input: "test(cli): add integration test suite",
      expected: { type: "test", scope: "cli", subject: "add integration test suite" },
    },
    {
      input: "chore(deps): bump typescript from 5.4 to 5.5",
      expected: { type: "chore", scope: "deps", subject: "bump typescript from 5.4 to 5.5" },
    },
    {
      input: "security(jwt): validate algorithm parameter",
      expected: { type: "security", scope: "jwt", subject: "validate algorithm parameter" },
    },
    {
      input: "   feat: trimmed leading and trailing whitespace   ",
      expected: { type: "feat", scope: null, subject: "trimmed leading and trailing whitespace" },
    },
    {
      input: "feat: café naïve resumé Unicode support",
      expected: { type: "feat", scope: null, subject: "café naïve resumé Unicode support" },
    },
    {
      input: `fix(api): ${"a".repeat(72)}`,
      expected: { type: "fix", scope: "api", subject: "a".repeat(72) },
    },
  ];

  test.each(validCases)("accepts valid message: %s", ({ input, expected }) => {
    const result = validateCommitMessage(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(expected);
    }
  });

  const invalidCases: Array<{ input: unknown; reason: string }> = [
    { input: "", reason: "empty string" },
    { input: "   ", reason: "whitespace only" },
    { input: null, reason: "null input" },
    { input: undefined, reason: "undefined input" },
    { input: 123, reason: "number input" },
    { input: "Feat: uppercase type", reason: "uppercase type" },
    { input: "FEAT: all-caps type", reason: "all-caps type" },
    { input: "unknown: unknown type", reason: "unknown type" },
    { input: "perf: unsupported type in MVP", reason: "perf type not in allowed list" },
    { input: "build: unsupported type in MVP", reason: "build type not in allowed list" },
    { input: "feat(): empty scope parentheses", reason: "empty scope" },
    { input: "feat( ): whitespace scope", reason: "whitespace scope" },
    { input: "feat(SCOPE): uppercase scope", reason: "uppercase scope" },
    { input: "feat(has space): invalid scope chars", reason: "space in scope" },
    { input: "feat((nested)): extra parentheses", reason: "extra parentheses" },
    { input: "feat!: breaking change marker", reason: "breaking change exclamation" },
    { input: "feat(api)!: breaking change with scope", reason: "breaking change exclamation" },
    { input: "feat missing colon and space", reason: "missing colon" },
    { input: "feat:no space after colon", reason: "missing space after colon" },
    { input: "feat:   ", reason: "empty subject" },
    { input: "feat: ends with period.", reason: "subject ending with period" },
    { input: "feat: multiline\nsubject", reason: "multiline subject" },
    { input: "feat: carriage\rreturn", reason: "carriage return" },
    { input: "feat: control\x07char", reason: "control character in subject" },
    { input: `feat: ${"a".repeat(73)}`, reason: "subject > 72 chars" },
    {
      input: `feat(${"a".repeat(24)}): ${"b".repeat(70)}`,
      reason: "total header > 100 characters",
    },
  ];

  test.each(invalidCases)("rejects invalid message: $reason ($input)", ({ input }) => {
    const result = validateCommitMessage(input as string);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  test("never throws on arbitrary invalid input", () => {
    const weirdInputs: unknown[] = [
      {},
      [],
      Symbol("test"),
      true,
      () => "feat: foo",
      "\x00\x01\x02",
      "feat:" + "\x00".repeat(50),
    ];
    for (const inp of weirdInputs) {
      expect(() => validateCommitMessage(inp as string)).not.toThrow();
    }
  });
});
