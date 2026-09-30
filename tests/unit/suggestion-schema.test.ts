import { describe, expect, test } from "vitest";
import { COMMIT_TYPES } from "../../src/domain/commit-types.js";
import {
  CommitTypeSchema,
  formatCommitMessage,
  formatValidationIssues,
  ReasonSchema,
  ScopeSchema,
  SubjectSchema,
  SuggestionSchema,
  SuggestionsResponseSchema,
} from "../../src/domain/suggestion-schema.js";

describe("CommitTypeSchema and COMMIT_TYPES", () => {
  test("accepts every allowed commit type", () => {
    for (const type of COMMIT_TYPES) {
      expect(CommitTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  test("rejects invalid commit types", () => {
    const invalidTypes = ["perf", "build", "ci", "style", "FEAT", "Fix", "", "unknown"];
    for (const type of invalidTypes) {
      const result = CommitTypeSchema.safeParse(type);
      expect(result.success).toBe(false);
    }
  });
});

describe("ScopeSchema", () => {
  test("accepts valid scopes", () => {
    const valid = ["cli", "v1.0", "git-read", "sub/module", "a_b", "123", "a".repeat(24)];
    for (const scope of valid) {
      expect(ScopeSchema.safeParse(scope).success).toBe(true);
    }
  });

  test("rejects invalid scopes", () => {
    const invalid = [
      "", // empty string
      "foo bar", // space
      "(foo)", // parentheses
      "-foo", // starts with dash
      ".foo", // starts with dot
      "/foo", // starts with slash
      "FOO", // uppercase
      "a".repeat(25), // > 24 chars
      "has\nnewline",
    ];
    for (const scope of invalid) {
      expect(ScopeSchema.safeParse(scope).success).toBe(false);
    }
  });
});

describe("SubjectSchema", () => {
  test("accepts valid subjects", () => {
    expect(SubjectSchema.safeParse("add cli support").success).toBe(true);
    expect(SubjectSchema.safeParse("a".repeat(72)).success).toBe(true);
    expect(SubjectSchema.safeParse("café and naïve Unicode").success).toBe(true);
  });

  test("rejects invalid subjects", () => {
    expect(SubjectSchema.safeParse("").success).toBe(false);
    expect(SubjectSchema.safeParse("   ").success).toBe(false);
    expect(SubjectSchema.safeParse("a".repeat(73)).success).toBe(false);
    expect(SubjectSchema.safeParse("ends with a period.").success).toBe(false);
    expect(SubjectSchema.safeParse("multiline\nsubject").success).toBe(false);
    expect(SubjectSchema.safeParse("carriage\rreturn").success).toBe(false);
    expect(SubjectSchema.safeParse("control\x07char").success).toBe(false);
  });
});

describe("ReasonSchema", () => {
  test("accepts valid reasons", () => {
    expect(ReasonSchema.safeParse("based on file names and change types").success).toBe(true);
    expect(ReasonSchema.safeParse("r".repeat(200)).success).toBe(true);
  });

  test("rejects invalid reasons", () => {
    expect(ReasonSchema.safeParse("").success).toBe(false);
    expect(ReasonSchema.safeParse("   ").success).toBe(false);
    expect(ReasonSchema.safeParse("r".repeat(201)).success).toBe(false);
    expect(ReasonSchema.safeParse("multi\nline").success).toBe(false);
    expect(ReasonSchema.safeParse("control\x00char").success).toBe(false);
  });
});

describe("SuggestionSchema", () => {
  test("accepts valid suggestion with scope", () => {
    const raw = {
      type: "feat",
      scope: "cli",
      subject: "add option support",
      reason: "adds new command line options",
    };
    const parsed = SuggestionSchema.parse(raw);
    expect(parsed).toEqual(raw);
  });

  test("accepts valid suggestion with null scope", () => {
    const raw = {
      type: "docs",
      scope: null,
      subject: "update readme",
      reason: "only readme.md changed",
    };
    const parsed = SuggestionSchema.parse(raw);
    expect(parsed.scope).toBeNull();
  });

  test("normalizes absent scope to null", () => {
    const raw = {
      type: "fix",
      subject: "resolve null check crash",
      reason: "single source file fix",
    };
    const parsed = SuggestionSchema.parse(raw);
    expect(parsed.scope).toBeNull();
  });

  test("rejects extra keys (strict object)", () => {
    const raw = {
      type: "feat",
      scope: null,
      subject: "valid subject",
      reason: "valid reason",
      extraKey: "forbidden",
    };
    const result = SuggestionSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });
});

describe("SuggestionsResponseSchema", () => {
  const item = {
    type: "chore" as const,
    scope: null,
    subject: "update lockfile",
    reason: "lockfile modified",
  };

  test("accepts exactly 3 items", () => {
    const result = SuggestionsResponseSchema.safeParse({
      suggestions: [item, item, item],
    });
    expect(result.success).toBe(true);
  });

  test("rejects arrays of length 0, 1, 2, 4", () => {
    for (const count of [0, 1, 2, 4]) {
      const items = Array.from({ length: count }, () => item);
      const result = SuggestionsResponseSchema.safeParse({ suggestions: items });
      expect(result.success).toBe(false);
    }
  });
});

describe("formatCommitMessage", () => {
  test("formats with scope", () => {
    const msg = formatCommitMessage({
      type: "feat",
      scope: "git",
      subject: "add parser helper",
      reason: "new function added",
    });
    expect(msg).toBe("feat(git): add parser helper");
  });

  test("formats without scope", () => {
    const msg = formatCommitMessage({
      type: "docs",
      scope: null,
      subject: "update readme",
      reason: "docs changed",
    });
    expect(msg).toBe("docs: update readme");
  });
});

describe("formatValidationIssues", () => {
  test("formats issues cleanly", () => {
    const result = SuggestionSchema.safeParse({
      type: "invalid-type",
      subject: "",
      reason: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatValidationIssues(result.error.issues);
      expect(formatted.length).toBeGreaterThan(0);
      expect(formatted.some((line) => line.includes("type"))).toBe(true);
    }
  });
});
