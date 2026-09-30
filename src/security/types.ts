import type { DiffBudgetStats } from "../domain/diff-budget.js";

export type ContentHandling = "include" | "metadata-only" | "summary-only";

export interface PathPolicyDecision {
  readonly handling: ContentHandling;
  readonly reason: string;
  readonly category: string;
}

export interface RedactionReport {
  readonly totalRedactions: number;
  readonly redactionsByCategory: Readonly<Record<string, number>>;
}

export interface SanitizationReport {
  readonly totalRedactions: number;
  readonly redactionsByCategory: Readonly<Record<string, number>>;
  readonly filesWithheldByPolicyCount: number;
  readonly filesSummarizedByPolicyCount: number;
  readonly binaryFilesWithheldCount: number;
  readonly truncated: boolean;
  readonly debug?: {
    readonly filesWithheldByPolicy?: readonly string[];
    readonly filesSummarizedByPolicy?: readonly string[];
    readonly binaryFilesWithheld?: readonly string[];
  };
}

declare const SanitizedDiffBrand: unique symbol;

export type SanitizedDiff = {
  readonly [SanitizedDiffBrand]: true;
  readonly content: string;
  readonly report: SanitizationReport;
  readonly originalCharacterCount: number;
  readonly sanitizedCharacterCount: number;
  readonly budgetedCharacterCount: number;
  readonly truncated: boolean;
  readonly omittedCharacterCount: number;
  readonly budgetStats: DiffBudgetStats;
};
