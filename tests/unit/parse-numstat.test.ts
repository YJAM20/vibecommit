import { describe, expect, test } from "vitest";
import { parseNumstatOutput, reconcileStagedChanges } from "../../src/git/parse-numstat.js";
import type { ParsedStatusItem } from "../../src/git/parse-status.js";
import { VibeCommitError } from "../../src/utils/errors.js";

describe("parseNumstatOutput", () => {
  test("parses empty output as empty array", () => {
    expect(parseNumstatOutput("")).toEqual([]);
  });

  test("parses normal counts", () => {
    const output = "15\t5\tsrc/file.ts\0";
    expect(parseNumstatOutput(output)).toEqual([
      {
        path: "src/file.ts",
        isBinary: false,
        additions: 15,
        deletions: 5,
      },
    ]);
  });

  test("parses binary file (-/-)", () => {
    const output = "-\t-\tassets/logo.png\0";
    expect(parseNumstatOutput(output)).toEqual([
      {
        path: "assets/logo.png",
        isBinary: true,
        additions: null,
        deletions: null,
      },
    ]);
  });

  test("parses renamed file with empty path field and two path fields", () => {
    const output = "10\t2\t\0old-dir/old.ts\0new-dir/new.ts\0";
    expect(parseNumstatOutput(output)).toEqual([
      {
        path: "new-dir/new.ts",
        previousPath: "old-dir/old.ts",
        isBinary: false,
        additions: 10,
        deletions: 2,
      },
    ]);
  });

  test("parses filenames with spaces and Unicode characters", () => {
    const output = "1\t0\tpath with spaces.txt\0" + "5\t3\tüñîçødé/файл.ts\0";
    expect(parseNumstatOutput(output)).toEqual([
      {
        path: "path with spaces.txt",
        isBinary: false,
        additions: 1,
        deletions: 0,
      },
      {
        path: "üñîçødé/файл.ts",
        isBinary: false,
        additions: 5,
        deletions: 3,
      },
    ]);
  });

  test("throws VibeCommitError on missing trailing NUL", () => {
    const output = "10\t5\tfile.ts";
    expect(() => parseNumstatOutput(output)).toThrow(VibeCommitError);
  });

  test("throws VibeCommitError on missing tab delimiters", () => {
    const output = "10-5-file.ts\0";
    expect(() => parseNumstatOutput(output)).toThrow(VibeCommitError);
  });

  test("throws VibeCommitError on non-numeric counts", () => {
    const output = "abc\t5\tfile.ts\0";
    expect(() => parseNumstatOutput(output)).toThrow(VibeCommitError);
  });
});

describe("reconcileStagedChanges (merge logic)", () => {
  test("reconciles matching status and numstat items", () => {
    const statusItems: ParsedStatusItem[] = [
      { status: "added", path: "src/a.ts" },
      { status: "modified", path: "src/b.ts" },
    ];
    const numstatItems = [
      { path: "src/a.ts", isBinary: false, additions: 20, deletions: 0 },
      { path: "src/b.ts", isBinary: false, additions: 5, deletions: 3 },
    ];

    const result = reconcileStagedChanges(statusItems, numstatItems);
    expect(result).toEqual([
      {
        status: "added",
        path: "src/a.ts",
        previousPath: undefined,
        isBinary: false,
        additions: 20,
        deletions: 0,
        hasTextDiff: true,
      },
      {
        status: "modified",
        path: "src/b.ts",
        previousPath: undefined,
        isBinary: false,
        additions: 5,
        deletions: 3,
        hasTextDiff: true,
      },
    ]);
  });

  test("handles binary files and pure renames flags", () => {
    const statusItems: ParsedStatusItem[] = [
      { status: "added", path: "image.png" },
      { status: "renamed", path: "new.ts", previousPath: "old.ts" },
    ];
    const numstatItems = [
      { path: "image.png", isBinary: true, additions: null, deletions: null },
      { path: "new.ts", previousPath: "old.ts", isBinary: false, additions: 0, deletions: 0 },
    ];

    const result = reconcileStagedChanges(statusItems, numstatItems);
    expect(result).toEqual([
      {
        status: "added",
        path: "image.png",
        previousPath: undefined,
        isBinary: true,
        additions: null,
        deletions: null,
        hasTextDiff: false,
      },
      {
        status: "renamed",
        path: "new.ts",
        previousPath: "old.ts",
        isBinary: false,
        additions: 0,
        deletions: 0,
        hasTextDiff: false,
      },
    ]);
  });

  test("throws VibeCommitError on count mismatch", () => {
    const statusItems: ParsedStatusItem[] = [{ status: "added", path: "src/a.ts" }];
    const numstatItems = [
      { path: "src/a.ts", isBinary: false, additions: 1, deletions: 0 },
      { path: "src/b.ts", isBinary: false, additions: 1, deletions: 0 },
    ];

    expect(() => reconcileStagedChanges(statusItems, numstatItems)).toThrow(VibeCommitError);
  });

  test("throws VibeCommitError on path mismatch", () => {
    const statusItems: ParsedStatusItem[] = [{ status: "added", path: "src/a.ts" }];
    const numstatItems = [{ path: "src/b.ts", isBinary: false, additions: 1, deletions: 0 }];

    expect(() => reconcileStagedChanges(statusItems, numstatItems)).toThrow(VibeCommitError);
  });
});
