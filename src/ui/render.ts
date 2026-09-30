import type { StagedChangesResult, StagedFileChange } from "../domain/staged-change.js";

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
