import { describe, expect, test } from "vitest";
import {
  applyDiffBudget,
  DEFAULT_PER_FILE_CAP,
  DEFAULT_TOTAL_BUDGET,
} from "../../src/domain/diff-budget.js";
import type { StagedFileChange } from "../../src/domain/staged-change.js";

function createFile(partial: Partial<StagedFileChange> & { path: string }): StagedFileChange {
  return {
    status: "modified",
    isBinary: false,
    additions: 10,
    deletions: 5,
    hasTextDiff: true,
    ...partial,
  };
}

describe("applyDiffBudget", () => {
  test("empty input returns zeroed stats and empty text", () => {
    const result = applyDiffBudget("", []);
    expect(result.text).toBe("");
    expect(result.stats).toEqual({
      originalChars: 0,
      budgetedChars: 0,
      filesTruncated: 0,
      filesCollapsed: 0,
      filesOmitted: 0,
      unmatchedSections: 0,
      wasReduced: false,
    });
  });

  test("small diff passes through unchanged with correct stats", () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1234..5678 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,4 @@",
      " console.log(1);",
      "+console.log(2);",
    ].join("\n");

    const files = [createFile({ path: "src/app.ts", additions: 1, deletions: 0 })];
    const result = applyDiffBudget(diff, files);

    expect(result.text).toBe(diff);
    expect(result.stats.originalChars).toBe(diff.length);
    expect(result.stats.budgetedChars).toBe(diff.length);
    expect(result.stats.wasReduced).toBe(false);
    expect(result.stats.filesTruncated).toBe(0);
    expect(result.stats.filesCollapsed).toBe(0);
    expect(result.stats.filesOmitted).toBe(0);
  });

  test("per-file truncation preserves headers and adds truncation marker", () => {
    const headers = [
      "diff --git a/src/big.ts b/src/big.ts",
      "index 1111..2222 100644",
      "--- a/src/big.ts",
      "+++ b/src/big.ts",
      "@@ -1,5 +1,100 @@",
    ].join("\n");

    // Add many lines
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) {
      lines.push(`+const line${i} = "data_${i}";`);
    }
    const diff = `${headers}\n${lines.join("\n")}`;
    const files = [createFile({ path: "src/big.ts" })];

    // Use a small per-file cap to trigger truncation
    const result = applyDiffBudget(diff, files, { perFileCap: headers.length + 100 });

    expect(result.stats.wasReduced).toBe(true);
    expect(result.stats.filesTruncated).toBe(1);
    expect(result.text).toContain("diff --git a/src/big.ts b/src/big.ts");
    expect(result.text).toContain("[... truncated:");
    expect(result.text).toContain("lines omitted ...]");
  });

  test("collapses lockfile content keeping headers and summary marker", () => {
    const diff = [
      "diff --git a/package-lock.json b/package-lock.json",
      "index 3333..4444 100644",
      "--- a/package-lock.json",
      "+++ b/package-lock.json",
      "@@ -1,10 +1,50 @@",
      "+line1",
      "+line2",
      "+line3",
    ].join("\n");

    const files = [
      createFile({
        path: "package-lock.json",
        additions: 120,
        deletions: 80,
      }),
    ];

    const result = applyDiffBudget(diff, files);
    expect(result.stats.filesCollapsed).toBe(1);
    expect(result.stats.wasReduced).toBe(true);
    expect(result.text).toContain("diff --git a/package-lock.json b/package-lock.json");
    expect(result.text).toContain("[content omitted: lockfile, +120 -80]");
    expect(result.text).not.toContain("+line1");
  });

  test("collapses generated content", () => {
    const diff = [
      "diff --git a/dist/bundle.js b/dist/bundle.js",
      "index aaaa..bbbb 100644",
      "--- a/dist/bundle.js",
      "+++ b/dist/bundle.js",
      "@@ -1,1 +1,2 @@",
      "+generated code",
    ].join("\n");

    const files = [createFile({ path: "dist/bundle.js" })];
    const result = applyDiffBudget(diff, files);

    expect(result.stats.filesCollapsed).toBe(1);
    expect(result.text).toContain("[content omitted: generated, +10 -5]");
    expect(result.text).not.toContain("+generated code");
  });

  test("preserves binary file marker line", () => {
    const diff = [
      "diff --git a/logo.png b/logo.png",
      "new file mode 100644",
      "index 0000000..1234567",
      "Binary files /dev/null and b/logo.png differ",
    ].join("\n");

    const files = [createFile({ path: "logo.png", isBinary: true, hasTextDiff: false })];
    const result = applyDiffBudget(diff, files);

    expect(result.text).toContain("Binary files /dev/null and b/logo.png differ");
    expect(result.stats.filesCollapsed).toBe(0);
    expect(result.stats.filesTruncated).toBe(0);
  });

  test("total budget overflow omits subsequent file bodies keeping headers and marker", () => {
    const file1Diff = [
      "diff --git a/file1.ts b/file1.ts",
      "index 1111..2222 100644",
      "--- a/file1.ts",
      "+++ b/file1.ts",
      "@@ -1,1 +1,2 @@",
      "+body1",
    ].join("\n");

    const file2Diff = [
      "diff --git a/file2.ts b/file2.ts",
      "index 3333..4444 100644",
      "--- a/file2.ts",
      "+++ b/file2.ts",
      "@@ -1,1 +1,2 @@",
      "+body2",
    ].join("\n");

    const diff = `${file1Diff}\n${file2Diff}`;
    const files = [createFile({ path: "file1.ts" }), createFile({ path: "file2.ts" })];

    // Cap total budget so file2 body cannot fit
    const result = applyDiffBudget(diff, files, {
      totalBudget: file1Diff.length + 40,
      perFileCap: 1000,
    });

    expect(result.stats.wasReduced).toBe(true);
    expect(result.stats.filesOmitted).toBe(1);
    // file2 header must still be present!
    expect(result.text).toContain("diff --git a/file2.ts b/file2.ts");
    expect(result.text).toContain("[content omitted: diff size budget reached]");
    expect(result.text).not.toContain("+body2");
  });

  test("handles spaces in file path in headers", () => {
    const diff = [
      "diff --git a/path with spaces.txt b/path with spaces.txt",
      "index 1111..2222 100644",
      "--- a/path with spaces.txt",
      "+++ b/path with spaces.txt",
      "@@ -1,1 +1,2 @@",
      "+line",
    ].join("\n");

    const files = [createFile({ path: "path with spaces.txt" })];
    const result = applyDiffBudget(diff, files);

    expect(result.stats.unmatchedSections).toBe(0);
    expect(result.text).toContain("path with spaces.txt");
  });

  test("handles Git C-style quoted Unicode headers", () => {
    const diff = [
      'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
      "index 1111..2222 100644",
      '--- "a/caf\\303\\251.txt"',
      '+++ "b/caf\\303\\251.txt"',
      "@@ -1,1 +1,2 @@",
      "+line",
    ].join("\n");

    const files = [createFile({ path: "café.txt" })];
    const result = applyDiffBudget(diff, files);

    expect(result.stats.unmatchedSections).toBe(0);
  });

  test("falls back to positional match when section headers cannot be matched but counts equal", () => {
    const diff = [
      "diff --git a/unknown1 b/unknown1",
      "@@ -1,1 +1,2 @@",
      "+line1",
      "diff --git a/unknown2 b/unknown2",
      "@@ -1,1 +1,2 @@",
      "+line2",
    ].join("\n");

    const files = [createFile({ path: "package-lock.json" }), createFile({ path: "src/app.ts" })];

    const result = applyDiffBudget(diff, files);
    // First section positionally matches package-lock.json (lockfile) so it collapses
    expect(result.stats.filesCollapsed).toBe(1);
    expect(result.stats.unmatchedSections).toBe(0);
  });

  test("counts unmatched sections when counts differ and headers cannot match", () => {
    const diff = ["diff --git a/unmatched1 b/unmatched1", "@@ -1,1 +1,2 @@", "+line1"].join("\n");

    const files = [createFile({ path: "a.ts" }), createFile({ path: "b.ts" })];
    const result = applyDiffBudget(diff, files);

    expect(result.stats.unmatchedSections).toBe(1);
  });

  test("never throws on arbitrary non-diff input", () => {
    const garbage = "this is not a diff at all\nrandom text\n12345\x00\x01\x02";
    expect(() => applyDiffBudget(garbage, [])).not.toThrow();
    const result = applyDiffBudget(garbage, []);
    expect(result.stats.wasReduced).toBe(false);
  });

  test("is deterministic", () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1234..5678 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,4 @@",
      "+test",
    ].join("\n");
    const files = [createFile({ path: "src/app.ts" })];

    const r1 = applyDiffBudget(diff, files);
    const r2 = applyDiffBudget(diff, files);
    expect(r1).toEqual(r2);
  });

  test("exports default constants", () => {
    expect(DEFAULT_TOTAL_BUDGET).toBe(24000);
    expect(DEFAULT_PER_FILE_CAP).toBe(4000);
  });
});
