export const ExitCode = {
  Success: 0,
  RuntimeError: 1,
  UsageError: 2,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export interface VibeCommitErrorOptions {
  exitCode?: ExitCode;
  hint?: string;
  cause?: unknown;
}

export class VibeCommitError extends Error {
  readonly exitCode: ExitCode;
  readonly hint?: string;

  constructor(message: string, options?: VibeCommitErrorOptions) {
    super(message, { cause: options?.cause });
    this.name = "VibeCommitError";
    this.exitCode = options?.exitCode ?? ExitCode.RuntimeError;
    this.hint = options?.hint;
  }
}

export function reportError(error: unknown, write: (message: string) => void): ExitCode {
  if (error instanceof VibeCommitError) {
    write(`Error: ${error.message}\n`);
    if (error.hint !== undefined && error.hint.length > 0) {
      write(`Hint: ${error.hint}\n`);
    }
    return error.exitCode;
  }

  write("An unexpected error occurred. Please run with --help or report an issue.\n");
  return ExitCode.RuntimeError;
}
