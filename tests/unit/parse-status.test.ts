import { describe, expect, test } from "vitest";
import { parseStatusOutput } from "../../src/git/parse-status.js";
import { VibeCommitError } from "../../src/utils/errors.js";

describe("parseStatusOutput", () => {
  test("parses empty output as empty array", () => {
    expect(parseStatusOutput("")).toEqual([]);
  });

  test("parses added file", () => {
    const output = "A\0src/index.ts\0";
    expect(parseStatusOutput(output)).toEqual([{ status: "added", path: "src/index.ts" }]);
  });

  test("parses modified file", () => {
    const output = "M\0package.json\0";
    expect(parseStatusOutput(output)).toEqual([{ status: "modified", path: "package.json" }]);
  });

  test("parses deleted file", () => {
    const output = "D\0old-file.txt\0";
    expect(parseStatusOutput(output)).toEqual([{ status: "deleted", path: "old-file.txt" }]);
  });

  test("parses renamed file with similarity score and both paths", () => {
    const output = "R100\0old-name.ts\0new-name.ts\0";
    expect(parseStatusOutput(output)).toEqual([
      {
        status: "renamed",
        previousPath: "old-name.ts",
        path: "new-name.ts",
      },
    ]);
  });

  test("maps type change (T) to modified", () => {
    const output = "T\0symlink-or-file\0";
    expect(parseStatusOutput(output)).toEqual([
      {
        status: "modified",
        path: "symlink-or-file",
      },
    ]);
  });

  test("parses file path containing spaces", () => {
    const output = "A\0path with multiple spaces.md\0";
    expect(parseStatusOutput(output)).toEqual([
      {
        status: "added",
        path: "path with multiple spaces.md",
      },
    ]);
  });

  test("parses Unicode file path correctly", () => {
    const output = "M\0docs/föö/bär-日本語.md\0";
    expect(parseStatusOutput(output)).toEqual([
      {
        status: "modified",
        path: "docs/föö/bär-日本語.md",
      },
    ]);
  });

  test("parses file path with newline or leading dash", () => {
    const output = "A\0weird\nname.txt\0A\0-leading-dash.txt\0";
    expect(parseStatusOutput(output)).toEqual([
      {
        status: "added",
        path: "weird\nname.txt",
      },
      {
        status: "added",
        path: "-leading-dash.txt",
      },
    ]);
  });

  test("throws VibeCommitError on unknown status code", () => {
    const output = "X\0invalid.txt\0";
    expect(() => parseStatusOutput(output)).toThrow(VibeCommitError);
    expect(() => parseStatusOutput(output)).toThrow(/Unknown git status code: X/);
  });

  test("throws VibeCommitError on truncated/malformed input missing trailing NUL", () => {
    const output = "A\0missing-trailing-nul";
    expect(() => parseStatusOutput(output)).toThrow(VibeCommitError);
    expect(() => parseStatusOutput(output)).toThrow(/missing trailing NUL/);
  });

  test("throws VibeCommitError on truncated rename record", () => {
    const output = "R100\0old-only.txt\0";
    expect(() => parseStatusOutput(output)).toThrow(VibeCommitError);
    expect(() => parseStatusOutput(output)).toThrow(/incomplete rename record/);
  });
});
