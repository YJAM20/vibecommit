import { z } from "zod";
import { COMMIT_TYPES, type CommitType } from "./commit-types.js";

export function containsControlCharacters(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

const scopeRegex = /^[a-z0-9][a-z0-9._/-]{0,23}$/;

export const CommitTypeSchema = z.enum(COMMIT_TYPES);

export const ScopeSchema = z
  .string()
  .min(1, "Scope must be at least 1 character")
  .max(24, "Scope must be at most 24 characters")
  .regex(
    scopeRegex,
    "Scope must start with a lowercase letter or digit and contain only lowercase letters, digits, '.', '_', '/', or '-'",
  );

export const SubjectSchema = z
  .string()
  .min(1, "Subject must not be empty")
  .max(72, "Subject must be at most 72 characters")
  .refine((val) => val === val.trim(), "Subject must not have leading or trailing whitespace")
  .refine((val) => !/[\r\n]/.test(val), "Subject must be a single line")
  .refine((val) => !containsControlCharacters(val), "Subject must not contain control characters")
  .refine((val) => !val.endsWith("."), "Subject must not end with a period");

export const ReasonSchema = z
  .string()
  .min(1, "Reason must not be empty")
  .max(200, "Reason must be at most 200 characters")
  .refine((val) => val === val.trim(), "Reason must not have leading or trailing whitespace")
  .refine((val) => !/[\r\n]/.test(val), "Reason must be a single line")
  .refine((val) => !containsControlCharacters(val), "Reason must not contain control characters");

export const SuggestionSchema = z
  .object({
    type: CommitTypeSchema,
    scope: ScopeSchema.nullable()
      .optional()
      .transform((val: string | null | undefined): string | null => val ?? null),
    subject: SubjectSchema,
    reason: ReasonSchema,
  })
  .strict();

export interface Suggestion {
  readonly type: CommitType;
  readonly scope: string | null;
  readonly subject: string;
  readonly reason: string;
}

export const SuggestionsResponseSchema = z
  .object({
    suggestions: z.array(SuggestionSchema).length(3, "Must contain exactly three suggestions"),
  })
  .strict();

export type SuggestionsResponse = z.infer<typeof SuggestionsResponseSchema>;

export function formatCommitMessage(suggestion: {
  readonly type: CommitType;
  readonly scope?: string | null;
  readonly subject: string;
  readonly reason?: string;
}): string {
  if (suggestion.scope !== null && suggestion.scope !== undefined && suggestion.scope.length > 0) {
    return `${suggestion.type}(${suggestion.scope}): ${suggestion.subject}`;
  }
  return `${suggestion.type}: ${suggestion.subject}`;
}

export interface ValidationIssueLike {
  readonly path: readonly (string | number | symbol)[];
  readonly message: string;
}

export function formatValidationIssues(
  errorOrIssues:
    { readonly issues: readonly ValidationIssueLike[] } | readonly ValidationIssueLike[],
): string[] {
  const issues: readonly ValidationIssueLike[] =
    "issues" in errorOrIssues && Array.isArray(errorOrIssues.issues)
      ? errorOrIssues.issues
      : (errorOrIssues as readonly ValidationIssueLike[]);

  return issues.map((issue) => {
    const pathStr = issue.path.map(String).join(".");
    return pathStr.length > 0 ? `${pathStr}: ${issue.message}` : issue.message;
  });
}
