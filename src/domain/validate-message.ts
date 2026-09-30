import type { CommitType } from "./commit-types.js";
import { COMMIT_TYPES } from "./commit-types.js";
import { ScopeSchema, SubjectSchema } from "./suggestion-schema.js";

export type ValidationResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly type: CommitType;
        readonly scope: string | null;
        readonly subject: string;
      };
    }
  | {
      readonly ok: false;
      readonly errors: readonly string[];
    };

const allowedTypesSet = new Set<string>(COMMIT_TYPES);

export function validateCommitMessage(rawMessage: string): ValidationResult {
  try {
    if (typeof rawMessage !== "string") {
      return { ok: false, errors: ["Commit message must be a string"] };
    }

    if (rawMessage.includes("\n") || rawMessage.includes("\r")) {
      return { ok: false, errors: ["Commit message must be a single line"] };
    }

    const trimmed = rawMessage.trim();
    if (trimmed.length === 0) {
      return { ok: false, errors: ["Commit message must not be empty"] };
    }

    if (trimmed.length > 100) {
      return {
        ok: false,
        errors: ["Commit message header exceeds maximum length of 100 characters"],
      };
    }

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) {
      return {
        ok: false,
        errors: ["Commit message must follow format 'type: subject' or 'type(scope): subject'"],
      };
    }

    const prefix = trimmed.slice(0, colonIndex);
    const suffix = trimmed.slice(colonIndex + 1);

    if (prefix.endsWith("!")) {
      return {
        ok: false,
        errors: ["Breaking change indicator '!' is not supported in this version"],
      };
    }

    let parsedType: string;
    let parsedScope: string | null = null;

    if (prefix.includes("(") || prefix.includes(")")) {
      const match = /^([a-zA-Z0-9_-]+)\(([^)]*)\)$/.exec(prefix);
      if (!match) {
        return {
          ok: false,
          errors: ["Invalid scope formatting. Format must be 'type(scope): subject'"],
        };
      }
      parsedType = match[1]!;
      parsedScope = match[2]!;

      if (parsedScope.length === 0) {
        return {
          ok: false,
          errors: ["Scope must not be empty when parentheses are present"],
        };
      }
    } else {
      parsedType = prefix;
    }

    if (!allowedTypesSet.has(parsedType)) {
      return {
        ok: false,
        errors: [`Invalid commit type '${parsedType}'. Allowed types: ${COMMIT_TYPES.join(", ")}`],
      };
    }

    if (parsedScope !== null) {
      const scopeValidation = ScopeSchema.safeParse(parsedScope);
      if (!scopeValidation.success) {
        return {
          ok: false,
          errors: scopeValidation.error.issues.map((i) => i.message),
        };
      }
    }

    if (!suffix.startsWith(" ")) {
      return {
        ok: false,
        errors: ["Missing space after colon"],
      };
    }

    const subject = suffix.slice(1);
    const subjectValidation = SubjectSchema.safeParse(subject);
    if (!subjectValidation.success) {
      return {
        ok: false,
        errors: subjectValidation.error.issues.map((i) => i.message),
      };
    }

    return {
      ok: true,
      value: {
        type: parsedType as CommitType,
        scope: parsedScope,
        subject,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : "Validation failed unexpectedly"],
    };
  }
}
