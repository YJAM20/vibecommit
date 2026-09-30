import type { StagedChangesResult, StagedFileChange } from "../domain/staged-change.js";
import type { DiffBudgetStats } from "../domain/diff-budget.js";
import type { Suggestion } from "../domain/suggestion-schema.js";
import { formatCommitMessage } from "../domain/suggestion-schema.js";
import type { SanitizationReport } from "../security/types.js";

/**
 * Escapes control characters and ANSI escape sequences in filenames
 * so hostile paths cannot manipulate terminal state or disrupt layouts.
 * Spaces and printable Unicode characters remain untouched.
 */
export function escapeControlCharacters(path: string): string {
  let result = "";

  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);

    if (code === 0x1b) {
      result += "\\x1b";
    } else if (code === 0x0a) {
      result += "\\n";
    } else if (code === 0x0d) {
      result += "\\r";
    } else if (code === 0x09) {
      result += "\\t";
    } else if (code === 0x00) {
      result += "\\0";
    } else if (code < 0x20 || code === 0x7f) {
      result += `\\x${code.toString(16).padStart(2, "0")}`;
    } else if (code >= 0x80 && code <= 0x9f) {
      result += `\\x${code.toString(16).padStart(2, "0")}`;
    } else {
      result += path[i];
    }
  }

  return result;
}

function renderFileLine(file: StagedFileChange): string {
  const statusLabel = `[${file.status}]`.padEnd(10);
  let pathDisplay: string;

  if (file.status === "renamed" && file.previousPath !== undefined) {
    pathDisplay = `${escapeControlCharacters(file.previousPath)} -> ${escapeControlCharacters(file.path)}`;
  } else {
    pathDisplay = escapeControlCharacters(file.path);
  }

  let statsDisplay: string;
  if (file.isBinary) {
    statsDisplay = "(binary)";
  } else if (file.additions !== null && file.deletions !== null) {
    statsDisplay = `(+${file.additions}, -${file.deletions})`;
  } else {
    statsDisplay = "";
  }

  return `  ${statusLabel} ${pathDisplay} ${statsDisplay}`.trimEnd();
}

export function renderStagedSummary(result: StagedChangesResult): string {
  const { summary, files } = result;
  const lines: string[] = [];

  const statusParts: string[] = [];
  if (summary.statusCounts.added > 0) {
    statusParts.push(`${summary.statusCounts.added} added`);
  }
  if (summary.statusCounts.modified > 0) {
    statusParts.push(`${summary.statusCounts.modified} modified`);
  }
  if (summary.statusCounts.deleted > 0) {
    statusParts.push(`${summary.statusCounts.deleted} deleted`);
  }
  if (summary.statusCounts.renamed > 0) {
    statusParts.push(`${summary.statusCounts.renamed} renamed`);
  }
  if (summary.statusCounts.copied > 0) {
    statusParts.push(`${summary.statusCounts.copied} copied`);
  }

  const statusSummaryText = statusParts.length > 0 ? ` (${statusParts.join(", ")})` : "";
  lines.push(`Staged files: ${summary.totalFiles}${statusSummaryText}`);

  for (const file of files) {
    lines.push(renderFileLine(file));
  }

  lines.push(`Total changes: +${summary.additions}, -${summary.deletions}`);

  return lines.join("\n") + "\n";
}

export function renderNoStagedChanges(): string {
  return "No staged changes detected. Use 'git add <files>' to stage changes before running vibecommit.\n";
}

export function renderPrivacySummary(report: SanitizationReport): string {
  const hasRedactions = report.totalRedactions > 0;
  const hasWithheld = report.filesWithheldByPolicyCount > 0;
  const hasBinaryWithheld = report.binaryFilesWithheldCount > 0;
  const hasSummarized = report.filesSummarizedByPolicyCount > 0;
  const isTruncated = report.truncated;

  if (!hasRedactions && !hasWithheld && !hasBinaryWithheld && !hasSummarized && !isTruncated) {
    return "Privacy summary: content inspected, 0 secrets detected, 0 files withheld\n";
  }

  const lines: string[] = ["Privacy summary:"];

  if (hasRedactions) {
    const s = report.totalRedactions === 1 ? "" : "s";
    lines.push(`- ${report.totalRedactions} sensitive-looking value${s} redacted`);
  }

  if (hasWithheld) {
    const s = report.filesWithheldByPolicyCount === 1 ? "" : "s";
    lines.push(`- ${report.filesWithheldByPolicyCount} file content${s} withheld by path policy`);
  }

  if (hasBinaryWithheld) {
    const s = report.binaryFilesWithheldCount === 1 ? "" : "s";
    lines.push(`- ${report.binaryFilesWithheldCount} binary file${s} represented as metadata only`);
  }

  if (hasSummarized) {
    const s = report.filesSummarizedByPolicyCount === 1 ? "" : "s";
    lines.push(`- ${report.filesSummarizedByPolicyCount} file${s} summarized by policy`);
  }

  if (isTruncated) {
    lines.push("- Diff context truncated after sanitization");
  }

  return lines.join("\n") + "\n";
}

export function renderDiffBudgetStats(stats: DiffBudgetStats): string {
  const budgeted = stats.budgetedChars;
  const original = stats.originalChars;

  if (stats.wasReduced) {
    const details: string[] = [];
    if (stats.filesCollapsed > 0) details.push(`${stats.filesCollapsed} collapsed`);
    if (stats.filesTruncated > 0) details.push(`${stats.filesTruncated} truncated`);
    if (stats.filesOmitted > 0) details.push(`${stats.filesOmitted} omitted`);
    const detailsStr = details.length > 0 ? ` (${details.join(", ")})` : "";
    return `Diff budget: ${budgeted.toLocaleString()} chars (original ${original.toLocaleString()} chars, reduced by limits)${detailsStr}\n`;
  }
  return `Diff budget: ${budgeted.toLocaleString()} chars (within limits)\n`;
}

export function renderSuggestions(
  suggestions: readonly Suggestion[],
  source: "ai" | "fallback" = "fallback",
): string {
  const lines: string[] = [];
  const header =
    source === "ai"
      ? "Suggested commit messages (AI-generated suggestions):"
      : "Suggested commit messages (local heuristics):";
  lines.push(header);

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i]!;
    const formatted = formatCommitMessage(s);
    lines.push(`  ${i + 1}. ${escapeControlCharacters(formatted)}`);
    lines.push(`     Reason: ${escapeControlCharacters(s.reason)}`);
  }

  return lines.join("\n") + "\n";
}
