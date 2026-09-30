import type { StagedFileChange } from "./staged-change.js";
import type { CommitType } from "./commit-types.js";
import type { Suggestion } from "./suggestion-schema.js";
import { formatCommitMessage, SuggestionSchema } from "./suggestion-schema.js";
import { validateCommitMessage } from "./validate-message.js";
import { classifyPath } from "./classify-paths.js";
import type { PathCategory } from "./classify-paths.js";
import { VibeCommitError } from "../utils/errors.js";

/**
 * Heuristic Type Selection Rules Table:
 * -------------------------------------------------------------------------
 * Condition                                | Primary | Alt 1     | Alt 2
 * -----------------------------------------|---------|-----------|--------
 * All files are docs                       | docs    | chore     | refactor
 * All files are test                       | test    | refactor  | chore
 * All files are config / lockfile          | chore   | refactor  | fix
 * Source files present, any added          | feat    | refactor  | fix
 * Source files present, only deleted/rename| refactor| chore     | feat
 * Source files present, only modified      | refactor| fix       | feat
 * Mixed without source (tests present)     | test    | chore     | refactor
 * Mixed without source (docs present)      | docs    | chore     | refactor
 * Mixed without source (only other/config) | chore   | refactor  | fix
 */

function sanitizeSubject(raw: string): string {
  // Strip control characters
  let cleaned = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (!(code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f))) {
      cleaned += raw[i];
    }
  }
  cleaned = cleaned.trim();

  // Strip trailing period if any
  cleaned = cleaned.replace(/\.+$/, "").trim();

  if (cleaned.length === 0) {
    return "update files";
  }

  // Ensure first character is lowercase
  cleaned = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);

  // Truncate to maximum 72 characters cleanly at word boundary
  if (cleaned.length > 72) {
    const truncated = cleaned.slice(0, 72);
    const lastSpace = truncated.lastIndexOf(" ");
    if (lastSpace > 20) {
      cleaned = truncated.slice(0, lastSpace).trim();
    } else {
      cleaned = truncated.trim();
    }
    cleaned = cleaned.replace(/[-_:, /]+$/, "").trim();
  }

  return cleaned.length > 0 ? cleaned : "update files";
}

function extractBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const filename = normalized.split("/").pop() ?? "";
  // Strip known compound or simple extensions
  const stripped = filename.replace(/\.(test|spec)\.[^.]+$/i, "").replace(/\.[^.]+$/, "");
  return stripped.length > 0 ? stripped : filename;
}

function deriveScope(changes: readonly StagedFileChange[]): string | null {
  // Use source files if present; otherwise use all files
  const sourceChanges = changes.filter((c) => classifyPath(c.path) === "source");
  const targetChanges = sourceChanges.length > 0 ? sourceChanges : changes;

  // Split paths into directory segments
  const splitDirs: string[][] = [];
  for (const c of targetChanges) {
    const normalized = c.path.replace(/\\/g, "/");
    const segments = normalized.split("/");
    // If file is at the root level, scope cannot be derived
    if (segments.length <= 1) {
      return null;
    }
    // Remove filename, keep directories
    splitDirs.push(segments.slice(0, -1));
  }

  if (splitDirs.length === 0) {
    return null;
  }

  // Find longest common directory prefix
  const first = splitDirs[0]!;
  let commonLength = 0;
  for (let i = 0; i < first.length; i++) {
    const segment = first[i]!;
    if (splitDirs.every((dir) => dir[i] === segment)) {
      commonLength = i + 1;
    } else {
      break;
    }
  }

  if (commonLength === 0) {
    return null;
  }

  const commonSegments = first.slice(0, commonLength);

  // A common prefix of just "src" gives null
  if (commonSegments.length === 1 && commonSegments[0]?.toLowerCase() === "src") {
    return null;
  }

  // Take the deepest common directory name
  const deepest = commonSegments[commonSegments.length - 1]!;
  const sanitized = deepest
    .toLowerCase()
    .replace(/[^a-z0-9._/-]/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 24);

  return sanitized.length > 0 ? sanitized : null;
}

interface TypeSelection {
  primary: CommitType;
  alt1: CommitType;
  alt2: CommitType;
  categoryReason: string;
}

function selectCommitTypes(changes: readonly StagedFileChange[]): TypeSelection {
  const categories = changes.map((c) => classifyPath(c.path));
  const categorySet = new Set<PathCategory>(categories);

  const sourceFiles = changes.filter((_, i) => categories[i] === "source");
  const testFiles = changes.filter((_, i) => categories[i] === "test");
  const docsFiles = changes.filter((_, i) => categories[i] === "docs");

  // All docs
  if (categorySet.size === 1 && categorySet.has("docs")) {
    return {
      primary: "docs",
      alt1: "chore",
      alt2: "refactor",
      categoryReason: "documentation files changed",
    };
  }

  // All tests
  if (categorySet.size === 1 && categorySet.has("test")) {
    return {
      primary: "test",
      alt1: "refactor",
      alt2: "chore",
      categoryReason: "test files changed",
    };
  }

  // All config / lockfile
  const isOnlyConfigOrLockfile = changes.every((c) => {
    const cat = classifyPath(c.path);
    return cat === "config" || cat === "lockfile";
  });
  if (isOnlyConfigOrLockfile) {
    return {
      primary: "chore",
      alt1: "refactor",
      alt2: "fix",
      categoryReason: "configuration or dependency files changed",
    };
  }

  // Source files present
  if (sourceFiles.length > 0) {
    const hasAdded = sourceFiles.some((f) => f.status === "added");
    const allDeletedOrRenamed = sourceFiles.every(
      (f) => f.status === "deleted" || f.status === "renamed",
    );
    const allModified = sourceFiles.every((f) => f.status === "modified");

    if (hasAdded) {
      return {
        primary: "feat",
        alt1: "refactor",
        alt2: "fix",
        categoryReason: "new source files added",
      };
    }
    if (allDeletedOrRenamed) {
      return {
        primary: "refactor",
        alt1: "chore",
        alt2: "feat",
        categoryReason: "source files restructured, renamed, or removed",
      };
    }
    if (allModified) {
      return {
        primary: "refactor",
        alt1: "fix",
        alt2: "feat",
        categoryReason: "existing source files modified",
      };
    }
    return {
      primary: "refactor",
      alt1: "fix",
      alt2: "feat",
      categoryReason: "source code changes detected",
    };
  }

  // No source files, mixed categories
  if (testFiles.length > 0) {
    return {
      primary: "test",
      alt1: "chore",
      alt2: "refactor",
      categoryReason: "test files and related project files changed",
    };
  }
  if (docsFiles.length > 0) {
    return {
      primary: "docs",
      alt1: "chore",
      alt2: "refactor",
      categoryReason: "documentation and related project files changed",
    };
  }

  return {
    primary: "chore",
    alt1: "refactor",
    alt2: "fix",
    categoryReason: "project files updated",
  };
}

function deriveVerb(changes: readonly StagedFileChange[]): string {
  if (changes.every((c) => c.status === "added")) {
    return "add";
  }
  if (changes.every((c) => c.status === "deleted")) {
    return "remove";
  }
  if (changes.every((c) => c.status === "renamed")) {
    return "rename";
  }
  return "update";
}

function buildPhrases(
  changes: readonly StagedFileChange[],
  scope: string | null,
): { specificPhrase: string; broadPhrase: string } {
  if (changes.length === 1) {
    const file = changes[0]!;
    if (file.status === "renamed" && file.previousPath) {
      const oldBase = extractBasename(file.previousPath);
      const newBase = extractBasename(file.path);
      return {
        specificPhrase: `${oldBase} to ${newBase}`,
        broadPhrase: `${newBase}`,
      };
    }
    const base = extractBasename(file.path);
    return {
      specificPhrase: base,
      broadPhrase: "files",
    };
  }

  if (scope !== null) {
    return {
      specificPhrase: `${scope} files`,
      broadPhrase: "project files",
    };
  }

  const categories = new Set(changes.map((c) => classifyPath(c.path)));
  if (categories.has("source") && categories.has("test")) {
    return {
      specificPhrase: "implementation and tests",
      broadPhrase: "codebase",
    };
  }
  if (categories.has("docs")) {
    return {
      specificPhrase: "documentation",
      broadPhrase: "project files",
    };
  }
  if (categories.has("test")) {
    return {
      specificPhrase: "tests",
      broadPhrase: "test suite",
    };
  }

  return {
    specificPhrase: "project files",
    broadPhrase: "codebase",
  };
}

export function generateHeuristicSuggestions(
  changes: readonly StagedFileChange[],
): readonly [Suggestion, Suggestion, Suggestion] {
  if (!changes || changes.length === 0) {
    throw new VibeCommitError("Cannot generate suggestions for empty staged changes list");
  }

  const scope = deriveScope(changes);
  const typeSelection = selectCommitTypes(changes);
  const verb = deriveVerb(changes);
  const { specificPhrase, broadPhrase } = buildPhrases(changes, scope);

  // 1. Primary specific suggestion (with scope if available)
  const subject1 = sanitizeSubject(`${verb} ${specificPhrase}`);
  const suggestion1: Suggestion = {
    type: typeSelection.primary,
    scope,
    subject: subject1,
    reason: `Primary heuristic based on ${typeSelection.categoryReason} (${changes.length} file${changes.length === 1 ? "" : "s"})`,
  };

  // 2. Plausible alternative suggestion
  const altVerb = typeSelection.alt1 === "fix" ? "fix" : verb;
  let subject2 = sanitizeSubject(`${altVerb} ${specificPhrase}`);
  // If subject2 collides with subject1 under the same type or formatted message, adjust wording
  if (
    formatCommitMessage({ type: typeSelection.alt1, scope, subject: subject2 }) ===
    formatCommitMessage(suggestion1)
  ) {
    subject2 = sanitizeSubject(`apply updates to ${specificPhrase}`);
  }
  const suggestion2: Suggestion = {
    type: typeSelection.alt1,
    scope,
    subject: subject2,
    reason: `Alternative ${typeSelection.alt1} heuristic based on file change types`,
  };

  // 3. Broader, scope-less variant
  const broadType = typeSelection.alt2 !== typeSelection.primary ? typeSelection.alt2 : "chore";
  let subject3 = sanitizeSubject(`${verb} ${broadPhrase}`);
  if (
    formatCommitMessage({ type: broadType, scope: null, subject: subject3 }) ===
      formatCommitMessage(suggestion1) ||
    formatCommitMessage({ type: broadType, scope: null, subject: subject3 }) ===
      formatCommitMessage(suggestion2)
  ) {
    subject3 = sanitizeSubject(
      `update ${changes.length} staged file${changes.length === 1 ? "" : "s"}`,
    );
  }
  const suggestion3: Suggestion = {
    type: broadType,
    scope: null,
    subject: subject3,
    reason: `Broad scope-less heuristic covering all staged changes`,
  };

  // Ensure all three suggestions have genuinely distinct formatted messages
  const suggestions = [suggestion1, suggestion2, suggestion3] as const;
  const formatted = suggestions.map(formatCommitMessage);
  const uniqueFormatted = new Set(formatted);

  if (uniqueFormatted.size !== 3) {
    // Deterministic adjustment if any collision remains
    const fallbackSubjects = [
      suggestion1.subject,
      sanitizeSubject(`modify ${specificPhrase}`),
      sanitizeSubject(`update codebase files`),
    ];
    return [
      SuggestionSchema.parse({
        type: suggestion1.type,
        scope: suggestion1.scope,
        subject: fallbackSubjects[0],
        reason: suggestion1.reason,
      }),
      SuggestionSchema.parse({
        type: suggestion2.type,
        scope: suggestion2.scope,
        subject: fallbackSubjects[1],
        reason: suggestion2.reason,
      }),
      SuggestionSchema.parse({
        type: suggestion3.type,
        scope: null,
        subject: fallbackSubjects[2],
        reason: suggestion3.reason,
      }),
    ];
  }

  // Validate all through SuggestionSchema and validateCommitMessage before returning
  for (const s of suggestions) {
    SuggestionSchema.parse(s);
    const valid = validateCommitMessage(formatCommitMessage(s));
    if (!valid.ok) {
      throw new VibeCommitError(
        `Generated heuristic suggestion '${formatCommitMessage(s)}' failed validation: ${valid.errors.join(", ")}`,
      );
    }
  }

  return suggestions;
}
