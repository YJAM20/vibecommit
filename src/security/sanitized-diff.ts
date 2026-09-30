import type { StagedFileChange } from "../domain/staged-change.js";
import type { DiffBudgetOptions } from "../domain/diff-budget.js";
import {
  applyDiffBudget,
  extractHeaderLines,
  matchesHeader,
  splitDiffSections,
} from "../domain/diff-budget.js";
import { evaluatePathPolicy } from "./policy.js";
import { redactSecrets } from "./redactor.js";
import type { SanitizationReport, SanitizedDiff } from "./types.js";

export function buildSanitizedDiff(
  files: readonly StagedFileChange[],
  rawDiff: string,
  options?: DiffBudgetOptions,
): SanitizedDiff {
  const originalCharacterCount = rawDiff.length;

  // 1. Group files by policy decisions
  const filesWithheldByPolicy: string[] = [];
  const filesSummarizedByPolicy: string[] = [];
  const binaryFilesWithheld: string[] = [];
  const fileDecisionMap = new Map<string, ReturnType<typeof evaluatePathPolicy>>();

  for (const file of files) {
    const decision = evaluatePathPolicy(file);
    fileDecisionMap.set(file.path, decision);

    if (decision.handling === "metadata-only") {
      if (decision.category === "binary" || file.isBinary) {
        binaryFilesWithheld.push(file.path);
      } else {
        filesWithheldByPolicy.push(file.path);
      }
    } else if (decision.handling === "summary-only") {
      filesSummarizedByPolicy.push(file.path);
    }
  }

  // 2. Process diff sections according to path policy
  const rawSections = splitDiffSections(rawDiff);
  const processedSections: string[] = [];
  const usedFileIndices = new Set<number>();

  for (const section of rawSections) {
    const firstLine = section.split("\n")[0] ?? "";
    let matchedFile: StagedFileChange | undefined;

    for (let j = 0; j < files.length; j++) {
      if (!usedFileIndices.has(j) && matchesHeader(firstLine, files[j]!)) {
        usedFileIndices.add(j);
        matchedFile = files[j];
        break;
      }
    }

    const { headerLines } = extractHeaderLines(section);

    if (!matchedFile) {
      processedSections.push(section);
      continue;
    }

    const decision = fileDecisionMap.get(matchedFile.path) ?? evaluatePathPolicy(matchedFile);

    if (decision.handling === "metadata-only") {
      // Completely omit diff body content
      const marker = `[content withheld by path policy: ${matchedFile.path}]`;
      processedSections.push([...headerLines, marker].join("\n"));
    } else if (decision.handling === "summary-only") {
      const countSuffix =
        matchedFile.additions !== null && matchedFile.deletions !== null
          ? ` (+${matchedFile.additions}, -${matchedFile.deletions})`
          : "";
      const marker = `[Diff withheld by policy: ${matchedFile.path}${countSuffix}]`;
      processedSections.push([...headerLines, marker].join("\n"));
    } else {
      // "include": keep full diff section for secret redaction
      processedSections.push(section);
    }
  }

  const intermediateText = processedSections.join("\n");

  // 3. Secret Redaction on eligible text (strictly runs before budget)
  const { sanitizedText, report: redactionReport } = redactSecrets(intermediateText);
  const sanitizedCharacterCount = sanitizedText.length;

  // 4. Diff Budgeting and size capping (strictly runs on sanitized content)
  const budgetResult = applyDiffBudget(sanitizedText, files, options);
  const budgetedCharacterCount = budgetResult.text.length;
  const truncated = budgetResult.stats.wasReduced;
  const omittedCharacterCount = Math.max(0, sanitizedCharacterCount - budgetedCharacterCount);

  // 5. Construct frozen SanitizedDiff
  const report: SanitizationReport = {
    totalRedactions: redactionReport.totalRedactions,
    redactionsByCategory: Object.freeze({ ...redactionReport.redactionsByCategory }),
    filesWithheldByPolicyCount: filesWithheldByPolicy.length,
    filesSummarizedByPolicyCount: filesSummarizedByPolicy.length,
    binaryFilesWithheldCount: binaryFilesWithheld.length,
    truncated,
    debug: {
      filesWithheldByPolicy: Object.freeze([...filesWithheldByPolicy]),
      filesSummarizedByPolicy: Object.freeze([...filesSummarizedByPolicy]),
      binaryFilesWithheld: Object.freeze([...binaryFilesWithheld]),
    },
  };

  const sanitizedDiff = Object.freeze({
    content: budgetResult.text,
    report,
    originalCharacterCount,
    sanitizedCharacterCount,
    budgetedCharacterCount,
    truncated,
    omittedCharacterCount,
    budgetStats: budgetResult.stats,
  });

  return sanitizedDiff as unknown as SanitizedDiff;
}
