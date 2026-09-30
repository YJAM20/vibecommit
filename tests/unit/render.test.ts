import { describe, expect, test } from "vitest";
import type { StagedChangesResult } from "../../src/domain/staged-change.js";
import {
  escapeControlCharacters,
  renderNoStagedChanges,
  renderStagedSummary,
} from "../../src/ui/render.js";

describe("escapeControlCharacters", () => {
  test("passes printable ASCII and legitimate Unicode unchanged", () => {
    expect(escapeControlCharacters("src/index.ts")).toBe("src/index.ts");
    expect(escapeControlCharacters("docs/föö/bär-日本語.md")).toBe("docs/föö/bär-日本語.md");
    expect(escapeControlCharacters("path with spaces.txt")).toBe("path with spaces.txt");
  });

  test("escapes control characters (newlines, tabs, nulls, ANSI escapes)", () => {
    expect(escapeControlCharacters("file\nname.txt")).toBe("file\\nname.txt");
    expect(escapeControlCharacters("file\r\nname.txt")).toBe("file\\r\\nname.txt");
    expect(escapeControlCharacters("tab\tseparated.txt")).toBe("tab\\tseparated.txt");
    expect(escapeControlCharacters("bad\x00file.txt")).toBe("bad\\0file.txt");
    expect(escapeControlCharacters("escape\x1b[31mcolor.txt")).toBe("escape\\x1b[31mcolor.txt");
  });
});

describe("renderStagedSummary", () => {
  test("renders summary layout with counts, per-file lines, renames, binary markers", () => {
    const mockResult: StagedChangesResult = {
      repoRoot: "/test/repo",
      diffText: "mock diff",
      summary: {
        totalFiles: 3,
        additions: 25,
        deletions: 10,
        statusCounts: {
          added: 1,
          modified: 1,
          deleted: 0,
          renamed: 1,
          copied: 0,
        },
      },
      files: [
        {
          status: "added",
          path: "src/new.ts",
          isBinary: false,
          additions: 20,
          deletions: 0,
          hasTextDiff: true,
        },
        {
          status: "modified",
          path: "assets/image.png",
          isBinary: true,
          additions: null,
          deletions: null,
          hasTextDiff: false,
        },
        {
          status: "renamed",
          path: "src/target.ts",
          previousPath: "src/origin.ts",
          isBinary: false,
          additions: 5,
          deletions: 10,
          hasTextDiff: true,
        },
      ],
    };

    const output = renderStagedSummary(mockResult);

    expect(output).toContain("Staged files: 3 (1 added, 1 modified, 1 renamed)");
    expect(output).toContain("[added]    src/new.ts (+20, -0)");
    expect(output).toContain("[modified] assets/image.png (binary)");
    expect(output).toContain("[renamed]  src/origin.ts -> src/target.ts (+5, -10)");
    expect(output).toContain("Total changes: +25, -10");
    // Ensure raw diff text is not present in output
    expect(output).not.toContain("mock diff");
  });

  test("renderNoStagedChanges gives clear guidance", () => {
    const output = renderNoStagedChanges();
    expect(output).toContain("No staged changes detected");
    expect(output).toContain("git add <files>");
  });
});
