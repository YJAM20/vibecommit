import { describe, expect, test } from "vitest";
import { generateHeuristicSuggestions } from "../../src/domain/heuristics.js";
import type { StagedFileChange } from "../../src/domain/staged-change.js";
import {
  containsControlCharacters,
  formatCommitMessage,
  ReasonSchema,
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

  const scenarios: Record<string, StagedFileChange[]> = {
    "docs-only-modified": [createFile({ path: "README.md", status: "modified" })],
    "docs-only-added": [
      createFile({ path: "README.md", status: "added", additions: 10, deletions: 0 }),
    ],
    "tests-only": [createFile({ path: "tests/unit/cli.test.ts", status: "modified" })],
    "tests-only-added": [
      createFile({ path: "tests/foo.test.ts", status: "added", additions: 15, deletions: 0 }),
    ],
    "lockfile-only": [createFile({ path: "package-lock.json", status: "modified" })],
    "config-and-lockfile-only": [
      createFile({ path: "package.json", status: "modified" }),
      createFile({ path: "package-lock.json", status: "modified" }),
    ],
    "config-only": [createFile({ path: "tsconfig.json", status: "modified" })],
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
    "rename-pure": [
      createFile({
        path: "src/domain/new-name.ts",
        previousPath: "src/domain/old-name.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
        hasTextDiff: false,
      }),
    ],
    "rename-with-changes": [
      createFile({
        path: "src/domain/new-name.ts",
        previousPath: "src/domain/old-name.ts",
        status: "renamed",
        additions: 25,
        deletions: 10,
        hasTextDiff: true,
      }),
    ],
    "mixed-source-tests-docs": [
      createFile({ path: "src/domain/feature.ts", status: "added", additions: 30, deletions: 0 }),
      createFile({
        path: "tests/unit/feature.test.ts",
        status: "added",
        additions: 20,
        deletions: 0,
      }),
      createFile({ path: "docs/feature.md", status: "modified" }),
    ],
    "mixed-without-source": [
      createFile({ path: "tests/cli.test.ts", status: "modified" }),
      createFile({ path: "docs/guide.md", status: "modified" }),
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
    "generated-only": [
      createFile({
        path: "dist/bundle.js",
        status: "modified",
        additions: 10,
        deletions: 5,
      }),
    ],
  };

  const FORBIDDEN_PURPOSE_WORDS = [
    "obsolete",
    "unused",
    "fix",
    "improve",
    "optimize",
    "clean up bugs",
    "handle",
    "support",
  ];

  describe("Invariants across all scenarios", () => {
    for (const [name, files] of Object.entries(scenarios)) {
      test(`verifies invariants for scenario: ${name}`, () => {
        const suggestions1 = generateHeuristicSuggestions(files);
        const suggestions2 = generateHeuristicSuggestions(files);

        // 1. Exactly 3 suggestions
        expect(suggestions1).toHaveLength(3);

        // 2. Deterministic
        expect(suggestions1).toEqual(suggestions2);

        // 3. Same type across all 3 suggestions
        const primaryType = suggestions1[0].type;
        expect(suggestions1[1].type).toBe(primaryType);
        expect(suggestions1[2].type).toBe(primaryType);

        // 4. Never 'fix'
        expect(primaryType).not.toBe("fix");

        const hasAdded = files.some((f) => f.status === "added");
        const hasDeleted = files.some((f) => f.status === "deleted");
        const hasRenamed = files.some((f) => f.status === "renamed");
        const hasAddedSourceWithLines = files.some(
          (f) => f.status === "added" && (f.additions ?? 0) > 0 && f.path.endsWith(".ts"),
        );
        const isPureRename =
          files.length > 0 &&
          files.every(
            (f) =>
              f.status === "renamed" &&
              (!f.hasTextDiff || ((f.additions ?? 0) === 0 && (f.deletions ?? 0) === 0)),
          );

        // 5. 'feat' only if added source with additions exists
        if (primaryType === "feat") {
          expect(hasAddedSourceWithLines).toBe(true);
        }

        // 6. 'refactor' only for pure renames
        if (primaryType === "refactor") {
          expect(isPureRename).toBe(true);
        }

        const formattedMessages = new Set<string>();

        for (const s of suggestions1) {
          // Schema validation
          const parsed = SuggestionSchema.safeParse(s);
          expect(parsed.success).toBe(true);

          // Validator
          const formatted = formatCommitMessage(s);
          const validation = validateCommitMessage(formatted);
          expect(validation.ok).toBe(true);

          // Header bounds
          expect(s.subject.length).toBeLessThanOrEqual(72);
          expect(s.subject.endsWith(".")).toBe(false);
          expect(containsControlCharacters(s.subject)).toBe(false);

          // Verb status consistency
          const lowerSubj = s.subject.toLowerCase();
          if (lowerSubj.startsWith("add ") || lowerSubj.includes(" add ")) {
            expect(hasAdded).toBe(true);
          }
          if (
            lowerSubj.startsWith("remove ") ||
            lowerSubj.startsWith("delete ") ||
            lowerSubj.startsWith("prune ")
          ) {
            expect(hasDeleted).toBe(true);
          }
          if (lowerSubj.startsWith("rename ") || lowerSubj.includes(" rename ")) {
            expect(hasRenamed).toBe(true);
          }

          // Reason safety: no purpose claims, within bounds
          expect(ReasonSchema.safeParse(s.reason).success).toBe(true);
          const lowerReason = s.reason.toLowerCase();
          for (const forbidden of FORBIDDEN_PURPOSE_WORDS) {
            expect(lowerReason).not.toContain(forbidden);
          }

          formattedMessages.add(formatted);
        }

        // 7. All three formatted messages are distinct
        expect(formattedMessages.size).toBe(3);

        // 8. Explicit forbidden combinations
        expect(formattedMessages.has("fix: add files")).toBe(false);
        expect(formattedMessages.has("refactor: add files")).toBe(false);
        expect(formattedMessages.has("feat: delete files")).toBe(false);
      });
    }
  });

  describe("Specific bucket requirements", () => {
    test("docs-only remains docs across all three; modified README never produces add", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["docs-only-modified"]!);
      for (const s of suggestions) {
        expect(s.type).toBe("docs");
      }
      expect(suggestions[0].subject).toBe("update README");
      expect(suggestions[0].subject).not.toContain("add");

      const formatted = suggestions.map(formatCommitMessage);
      expect(formatted).not.toContain("chore: add README");
    });

    test("docs-only added README produces add", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["docs-only-added"]!);
      for (const s of suggestions) {
        expect(s.type).toBe("docs");
      }
      expect(suggestions[0].subject).toBe("add README");
    });

    test("test-only remains test across all three", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["tests-only"]!);
      for (const s of suggestions) {
        expect(s.type).toBe("test");
      }
    });

    test("lockfile-only and config-only remain chore with conventional scopes", () => {
      const lockfileSuggestions = generateHeuristicSuggestions(scenarios["lockfile-only"]!);
      for (const s of lockfileSuggestions) {
        expect(s.type).toBe("chore");
      }
      expect(lockfileSuggestions[1].scope).toBe("deps");

      const configSuggestions = generateHeuristicSuggestions(scenarios["config-only"]!);
      for (const s of configSuggestions) {
        expect(s.type).toBe("chore");
      }
      expect(configSuggestions[1].scope).toBe("tooling");
    });

    test("pure rename is refactor; rename with content changes is chore", () => {
      const pureSuggestions = generateHeuristicSuggestions(scenarios["rename-pure"]!);
      for (const s of pureSuggestions) {
        expect(s.type).toBe("refactor");
        expect(s.subject.toLowerCase()).toMatch(/rename|reorganize|update/);
      }

      const changedSuggestions = generateHeuristicSuggestions(scenarios["rename-with-changes"]!);
      for (const s of changedSuggestions) {
        expect(s.type).toBe("chore");
        expect(s.type).not.toBe("refactor");
      }
    });

    test("delete-only is chore without feat/fix/refactor or purpose words", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["deleted-only"]!);
      for (const s of suggestions) {
        expect(s.type).toBe("chore");
        expect(s.type).not.toBe("feat");
        expect(s.type).not.toBe("fix");
        expect(s.type).not.toBe("refactor");
        expect(s.subject).not.toContain("obsolete");
        expect(s.subject).not.toContain("unused");
      }
    });

    test("binary-only is chore with assets scope", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["binary-file-only"]!);
      for (const s of suggestions) {
        expect(s.type).toBe("chore");
      }
      expect(suggestions[1].scope).toBe("assets");
    });

    test("generated-only is chore", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["generated-only"]!);
      for (const s of suggestions) {
        expect(s.type).toBe("chore");
      }
    });

    test("source with added file is feat across all three; modified source is chore", () => {
      const addedSuggestions = generateHeuristicSuggestions(scenarios["new-source-file"]!);
      for (const s of addedSuggestions) {
        expect(s.type).toBe("feat");
      }

      const modSuggestions = generateHeuristicSuggestions(scenarios["modified-only-source"]!);
      for (const s of modSuggestions) {
        expect(s.type).toBe("chore");
        expect(s.type).not.toBe("refactor");
        expect(s.type).not.toBe("fix");
      }
    });

    test("mixed sets use chore project-level phrasing", () => {
      const suggestions = generateHeuristicSuggestions(scenarios["mixed-without-source"]!);
      for (const s of suggestions) {
        expect(s.type).toBe("chore");
      }
    });
  });
});
