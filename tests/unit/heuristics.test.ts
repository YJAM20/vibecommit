import { describe, expect, test } from "vitest";
import { generateHeuristicSuggestions } from "../../src/domain/heuristics.js";
import type { StagedFileChange } from "../../src/domain/staged-change.js";
import {
  containsControlCharacters,
  formatCommitMessage,
  SuggestionSchema,
} from "../../src/domain/suggestion-schema.js";
import { validateCommitMessage } from "../../src/domain/validate-message.js";
import { VibeCommitError } from "../../src/utils/errors.js";

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

describe("generateHeuristicSuggestions", () => {
  test("throws VibeCommitError on empty file list", () => {
    expect(() => generateHeuristicSuggestions([])).toThrow(VibeCommitError);
  });

  const scenarios: Record<string, StagedFileChange[]> & {
    "docs-only": StagedFileChange[];
    "tests-only": StagedFileChange[];
    "config-and-lockfile-only": StagedFileChange[];
    "new-source-file": StagedFileChange[];
    "modified-only-source": StagedFileChange[];
    "deleted-only": StagedFileChange[];
    "rename-only": StagedFileChange[];
    "mixed-source-tests-docs": StagedFileChange[];
    "single-file": StagedFileChange[];
    "many-files-in-one-directory": StagedFileChange[];
    "root-level-files-null-scope": StagedFileChange[];
    "unicode-and-spaces": StagedFileChange[];
    "very-long-filename": StagedFileChange[];
    "filenames-with-control-chars": StagedFileChange[];
    "binary-file-only": StagedFileChange[];
  } = {
    "docs-only": [createFile({ path: "README.md", status: "modified" })],
    "tests-only": [createFile({ path: "tests/unit/cli.test.ts", status: "modified" })],
    "config-and-lockfile-only": [
      createFile({ path: "package.json", status: "modified" }),
      createFile({ path: "package-lock.json", status: "modified" }),
    ],
    "new-source-file": [
      createFile({
        path: "src/domain/new-feature.ts",
        status: "added",
        additions: 50,
        deletions: 0,
      }),
    ],
    "modified-only-source": [
      createFile({ path: "src/git/git-client.ts", status: "modified" }),
      createFile({ path: "src/git/parse-status.ts", status: "modified" }),
    ],
    "deleted-only": [
      createFile({
        path: "src/legacy/old-util.ts",
        status: "deleted",
        additions: 0,
        deletions: 100,
      }),
    ],
    "rename-only": [
      createFile({
        path: "src/domain/new-name.ts",
        previousPath: "src/domain/old-name.ts",
        status: "renamed",
      }),
    ],
    "mixed-source-tests-docs": [
      createFile({ path: "src/domain/feature.ts", status: "added" }),
      createFile({ path: "tests/unit/feature.test.ts", status: "added" }),
      createFile({ path: "docs/feature.md", status: "modified" }),
    ],
    "single-file": [createFile({ path: "src/core/engine.ts", status: "modified" })],
    "many-files-in-one-directory": [
      createFile({ path: "src/ui/components/button.ts", status: "modified" }),
      createFile({ path: "src/ui/components/modal.ts", status: "modified" }),
      createFile({ path: "src/ui/components/table.ts", status: "modified" }),
    ],
    "root-level-files-null-scope": [
      createFile({ path: "index.ts", status: "modified" }),
      createFile({ path: "setup.ts", status: "modified" }),
    ],
    "unicode-and-spaces": [
      createFile({ path: "src/café/naïve space file.ts", status: "modified" }),
    ],
    "very-long-filename": [
      createFile({
        path: `src/domain/${"very-long-component-name-that-exceeds-normal-limits-in-length-and-is-huge".repeat(2)}.ts`,
        status: "modified",
      }),
    ],
    "filenames-with-control-chars": [
      createFile({
        path: "src/domain/bad\nname\rwith\x07controls.ts",
        status: "modified",
      }),
    ],
    "binary-file-only": [
      createFile({
        path: "assets/logo.png",
        status: "added",
        isBinary: true,
        additions: null,
        deletions: null,
        hasTextDiff: false,
      }),
    ],
  };

  describe("Invariants for all scenarios", () => {
    for (const [name, files] of Object.entries(scenarios)) {
      test(`verifies invariants for scenario: ${name}`, () => {
        const suggestions1 = generateHeuristicSuggestions(files);
        const suggestions2 = generateHeuristicSuggestions(files);

        // 1. Exactly 3 suggestions
        expect(suggestions1).toHaveLength(3);

        // 2. Deterministic
        expect(suggestions1).toEqual(suggestions2);

        const formattedMessages = new Set<string>();

        for (const s of suggestions1) {
          // 3. Passes SuggestionSchema
          const parsed = SuggestionSchema.safeParse(s);
          expect(parsed.success).toBe(true);

          // 4. Passes validateCommitMessage
          const formatted = formatCommitMessage(s);
          const validation = validateCommitMessage(formatted);
          expect(validation.ok).toBe(true);

          // 5. Subject length <= 72, no trailing dot, no control chars
          expect(s.subject.length).toBeLessThanOrEqual(72);
          expect(s.subject.endsWith(".")).toBe(false);
          expect(containsControlCharacters(s.subject)).toBe(false);

          formattedMessages.add(formatted);
        }

        // 6. All three formatted messages are distinct
        expect(formattedMessages.size).toBe(3);
      });
    }
  });

  describe("Specific scenario rules", () => {
    test("docs-only generates docs primary suggestion", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["docs-only"]);
      expect(suggestions[0].type).toBe("docs");
    });

    test("tests-only generates test primary suggestion", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["tests-only"]);
      expect(suggestions[0].type).toBe("test");
    });

    test("config and lockfile generates chore primary suggestion", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["config-and-lockfile-only"]);
      expect(suggestions[0].type).toBe("chore");
    });

    test("new source file generates feat primary suggestion", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["new-source-file"]);
      expect(suggestions[0].type).toBe("feat");
    });

    test("modified-only source generates refactor primary suggestion with fix/feat alternates", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["modified-only-source"]);
      expect(suggestions[0].type).toBe("refactor");
      const types = suggestions.map((s) => s.type);
      expect(types).toContain("fix");
      expect(types).toContain("feat");
    });

    test("derives deepest scope from directory prefix", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["modified-only-source"]);
      // files are in src/git/ -> scope should be "git"
      expect(suggestions[0].scope).toBe("git");
    });

    test("common prefix of just src gives null scope", () => {
      const files = [
        createFile({ path: "src/a.ts", status: "modified" }),
        createFile({ path: "src/b.ts", status: "modified" }),
      ];
      const suggestions = generateHeuristicSuggestions(files);
      expect(suggestions[0].scope).toBeNull();
    });

    test("deleted-only source generates refactor primary", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["deleted-only"]);
      expect(suggestions[0].type).toBe("refactor");
    });

    test("rename-only generates refactor primary with rename verb", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["rename-only"]);
      expect(suggestions[0].type).toBe("refactor");
      expect(suggestions[0].subject).toContain("rename");
    });
  });
});
