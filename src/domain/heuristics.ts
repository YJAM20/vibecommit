import type { StagedFileChange } from "./staged-change.js";
import type { CommitType } from "./commit-types.js";
import type { Suggestion } from "./suggestion-schema.js";
import { formatCommitMessage, SuggestionSchema } from "./suggestion-schema.js";
import { validateCommitMessage } from "./validate-message.js";
import { classifyPath } from "./classify-paths.js";
import { VibeCommitError } from "../utils/errors.js";

/**
 * Heuristic Bucket Selection Table (first match wins):
 * -------------------------------------------------------------------------------------
 * Bucket                      | Primary Type | Condition
 * ----------------------------|--------------|-----------------------------------------
 * 1.  binary-only             | chore        | Every staged file is binary
 * 2.  rename-only-pure        | refactor     | Every file renamed, 0 additions/deletions
 * 3.  delete-only             | chore        | Every file deleted
 * 4.  docs-only               | docs         | Every file is in docs category
 * 5.  test-only               | test         | Every file is in test category
 * 6.  lockfile-only           | chore        | Every file is in lockfile category
 * 7.  config-only             | chore        | Only config/lockfiles (at least 1 config)
 * 8.  generated-only          | chore        | Every file is in generated category
 * 9.  source-with-added       | feat         | Added source file with additions > 0
 * 10. source-modified-or-other| chore        | Source files present without added source
 * 11. mixed                   | chore        | Everything else
 *
 * Core Principles:
 * - All three suggestions share the SAME commit type per bucket.
 * - 'fix' is never produced by the heuristic engine.
 * - 'feat' is produced only when at least one added source file with additions > 0 exists.
 * - 'refactor' is produced only for pure renames (zero additions, zero deletions).
 * - Modified-only source changes use 'chore' with neutral wording.
 * - Wording is truthful and neutral, describing known metadata without purpose claims.
 */

export type BucketId =
  | "binary-only"
  | "rename-only-pure"
  | "delete-only"
  | "docs-only"
  | "test-only"
  | "lockfile-only"
  | "config-only"
  | "generated-only"
  | "source-with-added"
  | "source-modified-or-other"
  | "mixed";

function sanitizeSubject(raw: string): string {
  // Strip control characters via character code boundary checks
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
  const sourceChanges = changes.filter((c) => classifyPath(c.path) === "source");
  if (sourceChanges.length === 0) {
    return null;
  }

  const splitDirs: string[][] = [];
  for (const c of sourceChanges) {
    const normalized = c.path.replace(/\\/g, "/");
    const segments = normalized.split("/");
    if (segments.length <= 1) {
      return null;
    }
    splitDirs.push(segments.slice(0, -1));
  }

  if (splitDirs.length === 0) {
    return null;
  }

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
  if (commonSegments.length === 1 && commonSegments[0]?.toLowerCase() === "src") {
    return null;
  }

  const deepest = commonSegments[commonSegments.length - 1]!;
  const sanitized = deepest
    .toLowerCase()
    .replace(/[^a-z0-9._/-]/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 24);

  return sanitized.length > 0 ? sanitized : null;
}

export function classifyBucket(changes: readonly StagedFileChange[]): BucketId {
  const categories = changes.map((c) => classifyPath(c.path));

  // 1. binary-only: every staged file is binary, any category
  if (changes.every((c) => c.isBinary)) {
    return "binary-only";
  }

  // 2. rename-only-pure: every file is a rename with zero additions and zero deletions or no text diff
  if (
    changes.length > 0 &&
    changes.every(
      (c) =>
        c.status === "renamed" &&
        (!c.hasTextDiff || ((c.additions ?? 0) === 0 && (c.deletions ?? 0) === 0)),
    )
  ) {
    return "rename-only-pure";
  }

  // 3. delete-only: every file is deleted
  if (changes.every((c) => c.status === "deleted")) {
    return "delete-only";
  }

  // 4. docs-only: every file is in the docs category
  if (categories.every((cat) => cat === "docs")) {
    return "docs-only";
  }

  // 5. test-only: every file is in the test category
  if (categories.every((cat) => cat === "test")) {
    return "test-only";
  }

  // 6. lockfile-only: every file is in the lockfile category
  if (categories.every((cat) => cat === "lockfile")) {
    return "lockfile-only";
  }

  // 7. config-only: every file is in config or lockfile category (at least one config file)
  if (
    categories.every((cat) => cat === "config" || cat === "lockfile") &&
    categories.some((cat) => cat === "config")
  ) {
    return "config-only";
  }

  // 8. generated-only: every file is in the generated category
  if (categories.every((cat) => cat === "generated")) {
    return "generated-only";
  }

  // 9. source-with-added: at least one added source-category file with additions > 0
  if (
    changes.some(
      (c) => classifyPath(c.path) === "source" && c.status === "added" && (c.additions ?? 0) > 0,
    )
  ) {
    return "source-with-added";
  }

  // 10. source-modified-or-other: source files present without added source file with additions
  if (categories.includes("source")) {
    return "source-modified-or-other";
  }

  // 11. mixed: everything else
  return "mixed";
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

interface BucketPlan {
  readonly type: CommitType;
  readonly categoryName: string;
  readonly s1Subject: string;
  readonly s1Scope: string | null;
  readonly s2Candidates: readonly { readonly subject: string; readonly scope: string | null }[];
  readonly s3Candidates: readonly string[];
}

function createBucketPlan(
  bucket: BucketId,
  changes: readonly StagedFileChange[],
  derivedSourceScope: string | null,
): BucketPlan {
  const isSingle = changes.length === 1;
  const singleFile = isSingle ? changes[0]! : null;
  const singleBase = singleFile ? extractBasename(singleFile.path) : "";
  const singleVerb = singleFile
    ? singleFile.status === "added"
      ? "add"
      : singleFile.status === "deleted"
        ? "remove"
        : singleFile.status === "renamed"
          ? "rename"
          : "update"
    : deriveVerb(changes);

  switch (bucket) {
    case "binary-only": {
      const s1Subject = isSingle ? `${singleVerb} ${singleBase}` : `${singleVerb} project assets`;
      return {
        type: "chore",
        categoryName: "binary asset",
        s1Subject,
        s1Scope: null,
        s2Candidates: [
          { subject: "refresh binary assets", scope: "assets" },
          { subject: "update binary files", scope: "assets" },
        ],
        s3Candidates: ["maintain repository assets", "update repository media"],
      };
    }

    case "rename-only-pure": {
      const s1Subject =
        isSingle && singleFile?.previousPath
          ? `rename ${extractBasename(singleFile.previousPath)} to ${singleBase}`
          : "rename project files";
      return {
        type: "refactor",
        categoryName: "file rename",
        s1Subject,
        s1Scope: null,
        s2Candidates: [
          { subject: "reorganize project file structure", scope: null },
          { subject: "relocate tracked files", scope: null },
        ],
        s3Candidates: ["update project file paths", "restructure repository layout"],
      };
    }

    case "delete-only": {
      const s1Subject = isSingle ? `remove ${singleBase}` : "remove project files";
      return {
        type: "chore",
        categoryName: "file deletion",
        s1Subject,
        s1Scope: null,
        s2Candidates: [
          { subject: "remove repository files", scope: null },
          { subject: "prune tracked files", scope: null },
        ],
        s3Candidates: ["prune repository files", "delete staged files"],
      };
    }

    case "docs-only": {
      const s1Subject = isSingle
        ? `${singleVerb} ${singleBase}`
        : `${singleVerb} project documentation`;
      return {
        type: "docs",
        categoryName: "documentation",
        s1Subject,
        s1Scope: null,
        s2Candidates: [
          { subject: "update project documentation", scope: null },
          { subject: "revise project documentation", scope: null },
        ],
        s3Candidates: ["revise documentation files", "maintain repository documentation"],
      };
    }

    case "test-only": {
      const s1Subject = isSingle ? `${singleVerb} ${singleBase}` : `${singleVerb} project tests`;
      return {
        type: "test",
        categoryName: "test",
        s1Subject,
        s1Scope: null,
        s2Candidates: [
          { subject: "update test coverage", scope: null },
          { subject: "maintain test suite", scope: null },
        ],
        s3Candidates: ["revise test files", "update repository tests"],
      };
    }

    case "lockfile-only": {
      const s1Subject = changes.every((c) => c.status === "added")
        ? "add dependency lockfile"
        : "update dependency lockfile";
      return {
        type: "chore",
        categoryName: "dependency lockfile",
        s1Subject,
        s1Scope: null,
        s2Candidates: [
          { subject: "refresh dependency lockfile", scope: "deps" },
          { subject: "update package lockfile", scope: "deps" },
        ],
        s3Candidates: ["synchronize dependency metadata", "maintain lockfile metadata"],
      };
    }

    case "config-only": {
      const s1Subject = isSingle
        ? `${singleVerb} ${singleBase}`
        : `${singleVerb} project configuration`;
      return {
        type: "chore",
        categoryName: "configuration",
        s1Subject,
        s1Scope: null,
        s2Candidates: [
          { subject: "revise development tooling", scope: "tooling" },
          { subject: "update project tooling", scope: "tooling" },
        ],
        s3Candidates: ["maintain repository configuration", "synchronize configuration files"],
      };
    }

    case "generated-only": {
      const s1Subject = isSingle ? `${singleVerb} ${singleBase}` : `${singleVerb} generated files`;
      return {
        type: "chore",
        categoryName: "generated",
        s1Subject,
        s1Scope: null,
        s2Candidates: [
          { subject: "refresh generated output", scope: null },
          { subject: "update build output", scope: null },
        ],
        s3Candidates: ["maintain generated artifacts", "synchronize generated files"],
      };
    }

    case "source-with-added": {
      const s1Subject = isSingle
        ? `add ${singleBase}`
        : derivedSourceScope !== null
          ? `add ${derivedSourceScope} files`
          : "add source files";
      return {
        type: "feat",
        categoryName: "new source",
        s1Subject,
        s1Scope: derivedSourceScope,
        s2Candidates: [
          { subject: "add source files", scope: null },
          { subject: "add project features", scope: null },
          { subject: "add project components", scope: null },
        ],
        s3Candidates: ["add codebase files", "add implementation files", "add repository features"],
      };
    }

    case "source-modified-or-other": {
      const s1Subject = isSingle
        ? `${singleVerb} ${singleBase}`
        : derivedSourceScope !== null
          ? `${singleVerb} ${derivedSourceScope} files`
          : `${singleVerb} source files`;
      return {
        type: "chore",
        categoryName: "source",
        s1Subject,
        s1Scope: derivedSourceScope,
        s2Candidates: [
          { subject: "update project source", scope: null },
          { subject: "revise source files", scope: null },
        ],
        s3Candidates: [
          "maintain project files",
          "synchronize project codebase",
          "update repository source",
        ],
      };
    }

    case "mixed": {
      return {
        type: "chore",
        categoryName: "project",
        s1Subject: "update staged project files",
        s1Scope: null,
        s2Candidates: [
          { subject: "maintain project files", scope: null },
          { subject: "revise staged files", scope: null },
        ],
        s3Candidates: ["synchronize repository changes", "update repository files"],
      };
    }
  }
}

export function generateHeuristicSuggestions(
  changes: readonly StagedFileChange[],
): readonly [Suggestion, Suggestion, Suggestion] {
  if (!changes || changes.length === 0) {
    throw new VibeCommitError("Cannot generate suggestions for empty staged changes list");
  }

  const bucket = classifyBucket(changes);
  const derivedSourceScope = deriveScope(changes);
  const plan = createBucketPlan(bucket, changes, derivedSourceScope);

  const fileCount = changes.length;
  const fileWord = fileCount === 1 ? "file" : "files";

  // 1. Suggestion 1: most specific truthful variant
  const subject1 = sanitizeSubject(plan.s1Subject);
  const suggestion1: Suggestion = {
    type: plan.type,
    scope: plan.s1Scope,
    subject: subject1,
    reason: `Primary heuristic based on ${fileCount} staged ${plan.categoryName} ${fileWord}`,
  };

  const usedFormatted = new Set<string>();
  usedFormatted.add(formatCommitMessage(suggestion1));

  // 2. Suggestion 2: alternate specificity, optional conventional scope
  let s2Item = plan.s2Candidates[0]!;
  let subject2 = sanitizeSubject(s2Item.subject);
  let formatted2 = formatCommitMessage({
    type: plan.type,
    scope: s2Item.scope,
    subject: subject2,
  });

  if (usedFormatted.has(formatted2) && plan.s2Candidates.length > 1) {
    s2Item = plan.s2Candidates[1]!;
    subject2 = sanitizeSubject(s2Item.subject);
    formatted2 = formatCommitMessage({
      type: plan.type,
      scope: s2Item.scope,
      subject: subject2,
    });
  }

  if (usedFormatted.has(formatted2)) {
    subject2 = sanitizeSubject(`revise staged ${plan.categoryName} files`);
    formatted2 = formatCommitMessage({
      type: plan.type,
      scope: s2Item.scope,
      subject: subject2,
    });
  }

  const suggestion2: Suggestion = {
    type: plan.type,
    scope: s2Item.scope,
    subject: subject2,
    reason: `Alternative phrasing based on ${plan.categoryName} file metadata`,
  };
  usedFormatted.add(formatted2);

  // 3. Suggestion 3: broad project-level wording, scope-less
  let subject3Candidate = plan.s3Candidates[0]!;
  let subject3 = sanitizeSubject(subject3Candidate);
  let formatted3 = formatCommitMessage({
    type: plan.type,
    scope: null,
    subject: subject3,
  });

  if (usedFormatted.has(formatted3) && plan.s3Candidates.length > 1) {
    subject3Candidate = plan.s3Candidates[1]!;
    subject3 = sanitizeSubject(subject3Candidate);
    formatted3 = formatCommitMessage({
      type: plan.type,
      scope: null,
      subject: subject3,
    });
  }

  if (usedFormatted.has(formatted3)) {
    subject3 = sanitizeSubject(`synchronize ${fileCount} staged ${fileWord}`);
    formatted3 = formatCommitMessage({
      type: plan.type,
      scope: null,
      subject: subject3,
    });
  }

  const suggestion3: Suggestion = {
    type: plan.type,
    scope: null,
    subject: subject3,
    reason: `Broad phrasing covering all ${fileCount} staged ${fileWord}`,
  };
  usedFormatted.add(formatted3);

  const suggestions = [suggestion1, suggestion2, suggestion3] as const;

  // Defensive validation of all through SuggestionSchema and validateCommitMessage
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
