import { describe, expect, test } from "vitest";
import type { StagedFileChange } from "../../src/domain/staged-change.js";
import { buildSanitizedDiff } from "../../src/security/sanitized-diff.js";
import type { SanitizedDiff } from "../../src/security/types.js";

describe("SanitizedDiff and Ordering Invariants Unit Tests", () => {
  const FAKE_KEY = "sk-fakeKeyPastCutoff1234567890abcdef";

  test("proves secret redaction runs BEFORE diff budget and truncation", () => {
    // Construct a staged diff where the secret is placed far past the default per-file cap (4000)
    const fillerLines = Array.from(
      { length: 300 },
      (_, i) => `+const line_${i} = "filler content";`,
    ).join("\n");
    const rawDiff = [
      "diff --git a/src/large.ts b/src/large.ts",
      "index 1111111..2222222 100644",
      "--- a/src/large.ts",
      "+++ b/src/large.ts",
      "@@ -0,0 +1,305 @@",
      fillerLines,
      `+const secretKey = "${FAKE_KEY}";`,
      '+console.log("end of file");',
    ].join("\n");

    const files: StagedFileChange[] = [
      {
        status: "added",
        path: "src/large.ts",
        isBinary: false,
        additions: 302,
        deletions: 0,
        hasTextDiff: true,
      },
    ];

    const sanitized = buildSanitizedDiff(files, rawDiff);

    // 1. The fake secret must NEVER appear anywhere in the sanitized diff content
    expect(sanitized.content).not.toContain(FAKE_KEY);

    // 2. The redaction report proves the secret was detected and redacted BEFORE truncation
    expect(sanitized.report.totalRedactions).toBe(1);
    expect(sanitized.report.redactionsByCategory["openai_api_key"]).toBe(1);

    // 3. Truncation did occur because the file exceeded perFileCap
    expect(sanitized.truncated).toBe(true);
    expect(sanitized.content).toContain("[... truncated:");
  });

  test("withholds .env content completely prior to text redaction", () => {
    const rawDiff = [
      "diff --git a/.env b/.env",
      "index 0000000..1111111 100644",
      "--- a/.env",
      "+++ b/.env",
      "@@ -0,0 +1,3 @@",
      "+DATABASE_URL=postgres://user:password@localhost/db",
      "+API_KEY=my_secret_key_in_env_file",
    ].join("\n");

    const files: StagedFileChange[] = [
      {
        status: "added",
        path: ".env",
        isBinary: false,
        additions: 2,
        deletions: 0,
        hasTextDiff: true,
      },
    ];

    const sanitized = buildSanitizedDiff(files, rawDiff);

    // Content of .env is completely withheld
    expect(sanitized.content).not.toContain("my_secret_key_in_env_file");
    expect(sanitized.content).not.toContain("DATABASE_URL");
    expect(sanitized.content).toContain("[content withheld by path policy: .env]");
    expect(sanitized.report.filesWithheldByPolicyCount).toBe(1);
    expect(sanitized.report.debug?.filesWithheldByPolicy).toContain(".env");
  });

  test("summarizes dependency lockfile without exposing raw diff lines", () => {
    const rawDiff = [
      "diff --git a/package-lock.json b/package-lock.json",
      "index 1111111..2222222 100644",
      "--- a/package-lock.json",
      "+++ b/package-lock.json",
      "@@ -10,3 +10,3 @@",
      '-  "version": "1.0.0"',
      '+  "version": "1.1.0"',
    ].join("\n");

    const files: StagedFileChange[] = [
      {
        status: "modified",
        path: "package-lock.json",
        isBinary: false,
        additions: 1,
        deletions: 1,
        hasTextDiff: true,
      },
    ];

    const sanitized = buildSanitizedDiff(files, rawDiff);

    expect(sanitized.content).toContain("[Diff withheld by policy: package-lock.json (+1, -1)]");
    expect(sanitized.content).not.toContain('"version": "1.1.0"');
    expect(sanitized.report.filesSummarizedByPolicyCount).toBe(1);
    expect(sanitized.report.debug?.filesSummarizedByPolicy).toContain("package-lock.json");
  });

  test("SanitizationReport exposes counts only on its public interface and no public path arrays", () => {
    const rawDiff = "diff --git a/.env b/.env\n+KEY=val";
    const files: StagedFileChange[] = [
      {
        status: "added",
        path: ".env",
        isBinary: false,
        additions: 1,
        deletions: 0,
        hasTextDiff: true,
      },
    ];

    const sanitized = buildSanitizedDiff(files, rawDiff);
    expect(sanitized.report.filesWithheldByPolicyCount).toBe(1);
    expect(sanitized.report.filesSummarizedByPolicyCount).toBe(0);
    expect(sanitized.report.binaryFilesWithheldCount).toBe(0);

    // Verify public properties do not expose path arrays directly
    const publicKeys = Object.keys(sanitized.report);
    expect(publicKeys).not.toContain("filesWithheldByPolicy");
    expect(publicKeys).not.toContain("filesSummarizedByPolicy");
    expect(publicKeys).not.toContain("binaryFilesWithheld");
  });

  test("SanitizedDiff encapsulates content and does not expose raw unredacted diff", () => {
    const rawDiff = 'diff --git a/src/a.ts b/src/a.ts\n+const x = "sk-fakeKey1234567890abcdef";';
    const files: StagedFileChange[] = [
      {
        status: "modified",
        path: "src/a.ts",
        isBinary: false,
        additions: 1,
        deletions: 0,
        hasTextDiff: true,
      },
    ];

    const sanitized = buildSanitizedDiff(files, rawDiff);

    // Raw diff must not be accessible via any property on the object
    expect((sanitized as unknown as Record<string, unknown>)["rawDiff"]).toBeUndefined();
    expect((sanitized as unknown as Record<string, unknown>)["diffText"]).toBeUndefined();
    expect((sanitized as unknown as Record<string, unknown>)["originalDiff"]).toBeUndefined();

    // The only diff text exposed is the redacted content
    expect(sanitized.content).toContain("[REDACTED:openai_api_key]");
    expect(sanitized.content).not.toContain("sk-fakeKey1234567890abcdef");
  });

  test("enforces compile-time branded type requirement", () => {
    // Demonstration of compile-time boundary:
    // A function accepting SanitizedDiff cannot be given a raw string diff without casting
    function acceptSanitizedOnly(diff: SanitizedDiff): string {
      return diff.content;
    }

    const files: StagedFileChange[] = [
      {
        status: "added",
        path: "src/index.ts",
        isBinary: false,
        additions: 1,
        deletions: 0,
        hasTextDiff: true,
      },
    ];

    const validSanitized = buildSanitizedDiff(
      files,
      "diff --git a/src/index.ts b/src/index.ts\n+1",
    );
    expect(acceptSanitizedOnly(validSanitized)).toContain("diff --git");
  });
});
