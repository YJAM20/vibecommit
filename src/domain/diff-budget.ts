import type { StagedFileChange } from "./staged-change.js";
import { classifyPath, isContentCollapsedCategory } from "./classify-paths.js";

/**
 * IMPORTANT ARCHITECTURAL NOTE:
 * This module performs diff budgeting and size capping ONLY.
 * It performs NO secret redaction and NO data sanitization.
 * In Phase 4, the pipeline order will be: (1) Redact first, then (2) Budget.
 * In Phase 3, the budgeted text is computed for size metrics and statistics only;
 * it must NOT be printed, logged, or sent anywhere.
 */

export const DEFAULT_TOTAL_BUDGET = 24000;
export const DEFAULT_PER_FILE_CAP = 4000;

export interface DiffBudgetOptions {
  readonly totalBudget?: number;
  readonly perFileCap?: number;
}

export interface DiffBudgetStats {
  readonly originalChars: number;
  readonly budgetedChars: number;
  readonly filesTruncated: number;
  readonly filesCollapsed: number;
  readonly filesOmitted: number;
  readonly unmatchedSections: number;
  readonly wasReduced: boolean;
}

export interface DiffBudgetResult {
  readonly text: string;
  readonly stats: DiffBudgetStats;
}

function toCQuoted(str: string): string {
  const buf = Buffer.from(str, "utf8");
  let out = "";
  let hasQuoted = false;
  for (const byte of buf) {
    if (byte === 0x22 || byte === 0x5c) {
      out += "\\" + String.fromCharCode(byte);
      hasQuoted = true;
    } else if (byte < 0x20 || byte >= 0x7f) {
      out += "\\" + byte.toString(8).padStart(3, "0");
      hasQuoted = true;
    } else {
      out += String.fromCharCode(byte);
    }
  }
  return hasQuoted ? out : "";
}

export function splitDiffSections(diffText: string): string[] {
  const lines = diffText.split(/\r?\n/);
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      sections.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    sections.push(current.join("\n"));
  }

  return sections;
}

export function extractHeaderLines(section: string): {
  headerLines: string[];
  bodyLines: string[];
} {
  const lines = section.split("\n");
  const headerLines: string[] = [];
  const bodyLines: string[] = [];
  let inBody = false;

  for (const line of lines) {
    if (!inBody && (line.startsWith("@@ ") || line.startsWith("Binary files "))) {
      inBody = true;
    }
    if (inBody) {
      bodyLines.push(line);
    } else {
      headerLines.push(line);
    }
  }

  return { headerLines, bodyLines };
}

export function matchesHeader(headerLine: string, file: StagedFileChange): boolean {
  if (headerLine.includes(file.path)) {
    return true;
  }
  if (file.previousPath !== undefined && headerLine.includes(file.previousPath)) {
    return true;
  }

  const quotedPath = toCQuoted(file.path);
  if (quotedPath.length > 0 && headerLine.includes(quotedPath)) {
    return true;
  }

  if (file.previousPath !== undefined) {
    const quotedPrev = toCQuoted(file.previousPath);
    if (quotedPrev.length > 0 && headerLine.includes(quotedPrev)) {
      return true;
    }
  }

  return false;
}

export function applyDiffBudget(
  diffText: string,
  files: readonly StagedFileChange[],
  options?: DiffBudgetOptions,
): DiffBudgetResult {
  const originalLength = diffText.length;
  if (originalLength === 0 || !diffText.trim()) {
    return {
      text: "",
      stats: {
        originalChars: 0,
        budgetedChars: 0,
        filesTruncated: 0,
        filesCollapsed: 0,
        filesOmitted: 0,
        unmatchedSections: 0,
        wasReduced: false,
      },
    };
  }

  const totalBudget = options?.totalBudget ?? DEFAULT_TOTAL_BUDGET;
  const perFileCap = options?.perFileCap ?? DEFAULT_PER_FILE_CAP;

  const rawSections = splitDiffSections(diffText);
  let filesTruncated = 0;
  let filesCollapsed = 0;
  let filesOmitted = 0;
  let unmatchedSections = 0;

  // Step 1: Match each section to a known StagedFileChange
  const matchedFiles: Array<StagedFileChange | undefined> = [];
  const usedFileIndices = new Set<number>();

  for (const section of rawSections) {
    const firstLine = section.split("\n")[0] ?? "";
    let matchedIndex = -1;

    for (let j = 0; j < files.length; j++) {
      if (!usedFileIndices.has(j) && matchesHeader(firstLine, files[j]!)) {
        matchedIndex = j;
        break;
      }
    }

    if (matchedIndex !== -1) {
      usedFileIndices.add(matchedIndex);
      matchedFiles.push(files[matchedIndex]);
    } else {
      matchedFiles.push(undefined);
    }
  }

  // Positional fallback if section count matches file count
  if (rawSections.length === files.length) {
    for (let i = 0; i < rawSections.length; i++) {
      if (matchedFiles[i] === undefined) {
        matchedFiles[i] = files[i];
      }
    }
  }

  // Step 2: Per-file capping and content collapsing
  const processedSections: string[] = [];

  for (let i = 0; i < rawSections.length; i++) {
    const section = rawSections[i]!;
    const file = matchedFiles[i];

    if (!file) {
      unmatchedSections += 1;
      // Process unmatched section generically with perFileCap
      if (section.length > perFileCap) {
        filesTruncated += 1;
        const { headerLines, bodyLines } = extractHeaderLines(section);
        const headerText = headerLines.join("\n");
        const capForBody = Math.max(0, perFileCap - headerText.length - 60);
        let currentLen = 0;
        const keptBody: string[] = [];
        let omittedCount = 0;

        for (const line of bodyLines) {
          if (currentLen + line.length + 1 <= capForBody) {
            keptBody.push(line);
            currentLen += line.length + 1;
          } else {
            omittedCount += 1;
          }
        }

        const truncatedSection = [
          ...headerLines,
          ...keptBody,
          `[... truncated: ${omittedCount} more lines omitted ...]`,
        ].join("\n");
        processedSections.push(truncatedSection);
      } else {
        processedSections.push(section);
      }
      continue;
    }

    const category = classifyPath(file.path);
    const { headerLines, bodyLines } = extractHeaderLines(section);

    // Content-collapsed files (lockfile or generated)
    if (isContentCollapsedCategory(category)) {
      filesCollapsed += 1;
      const countSuffix =
        file.additions !== null && file.deletions !== null
          ? `, +${file.additions} -${file.deletions}`
          : "";
      const summaryMarker = `[content omitted: ${category}${countSuffix}]`;
      const collapsedSection = [...headerLines, summaryMarker].join("\n");
      processedSections.push(collapsedSection);
      continue;
    }

    // Binary files: keep existing binary line
    if (file.isBinary) {
      processedSections.push(section);
      continue;
    }

    // Standard text files: check per-file cap
    if (section.length > perFileCap) {
      filesTruncated += 1;
      const headerText = headerLines.join("\n");
      const capForBody = Math.max(0, perFileCap - headerText.length - 60);
      let currentLen = 0;
      const keptBody: string[] = [];
      let omittedCount = 0;

      for (const line of bodyLines) {
        if (currentLen + line.length + 1 <= capForBody) {
          keptBody.push(line);
          currentLen += line.length + 1;
        } else {
          omittedCount += 1;
        }
      }

      const truncatedSection = [
        ...headerLines,
        ...keptBody,
        `[... truncated: ${omittedCount} more lines omitted ...]`,
      ].join("\n");
      processedSections.push(truncatedSection);
    } else {
      processedSections.push(section);
    }
  }

  // Step 3: Total budget enforcement
  const finalSections: string[] = [];
  let currentTotal = 0;

  for (let i = 0; i < processedSections.length; i++) {
    const section = processedSections[i]!;
    const separatorCost = finalSections.length > 0 ? 1 : 0;

    if (currentTotal + separatorCost + section.length <= totalBudget) {
      finalSections.push(section);
      currentTotal += separatorCost + section.length;
    } else {
      // Exceeds total budget: keep header + omission line
      filesOmitted += 1;
      const { headerLines } = extractHeaderLines(section);
      const omittedSection = [...headerLines, "[content omitted: diff size budget reached]"].join(
        "\n",
      );
      finalSections.push(omittedSection);
      currentTotal += separatorCost + omittedSection.length;
    }
  }

  const resultText = finalSections.join("\n");
  const wasReduced =
    filesTruncated > 0 ||
    filesCollapsed > 0 ||
    filesOmitted > 0 ||
    resultText.length < originalLength;

  return {
    text: resultText,
    stats: {
      originalChars: originalLength,
      budgetedChars: resultText.length,
      filesTruncated,
      filesCollapsed,
      filesOmitted,
      unmatchedSections,
      wasReduced,
    },
  };
}
