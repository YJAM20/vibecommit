import { describe, expect, test } from "vitest";
import type { GitRunner } from "../../src/git/git-client.js";
import { DefaultGitClient } from "../../src/git/git-client.js";
import { VibeCommitError } from "../../src/utils/errors.js";

describe("GitClient.createCommit unit tests", () => {
  test("calls 'git commit -F -' with message passed via stdin input and never in args", async () => {
    let capturedArgs: readonly string[] = [];
    let capturedInput: string | undefined;

    const mockRunner: GitRunner = (args, options) => {
      capturedArgs = args;
      capturedInput = options.input;
      return Promise.resolve({
        stdout: "[master a1b2c3d] feat: add real commit\n 1 file changed, 1 insertion(+)",
        stderr: "",
        exitCode: 0,
      });
    };

    const client = new DefaultGitClient("/fake/repo", mockRunner);
    const complexMessage = 'feat(core): subject with "quotes", $VAR, and `backticks`\n\nBody line';

    const result = await client.createCommit(complexMessage);

    // INVARIANT: Exactly ['commit', '-F', '-'] without message in args
    expect(capturedArgs).toEqual(["commit", "-F", "-"]);
    expect(capturedInput).toBe(complexMessage);

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe("a1b2c3d");
    expect(result.summaryLine).toBe("[master a1b2c3d] feat: add real commit");
  });

  test("parses root-commit stdout properly to extract commit hash and summary line", async () => {
    const mockRunner: GitRunner = () =>
      Promise.resolve({
        stdout:
          "[master (root-commit) 9f8e7d6] chore: initial scaffold\n 1 file changed, 10 insertions(+)",
        stderr: "",
        exitCode: 0,
      });

    const client = new DefaultGitClient("/fake/repo", mockRunner);
    const result = await client.createCommit("chore: initial scaffold");

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe("9f8e7d6");
    expect(result.summaryLine).toBe("[master (root-commit) 9f8e7d6] chore: initial scaffold");
  });

  test("throws VibeCommitError with first error line when git commit exits with non-zero code", async () => {
    const mockRunner: GitRunner = () =>
      Promise.resolve({
        stdout: "",
        stderr: "pre-commit hook failed (exit code 1)\nSome hook detail line 2",
        exitCode: 1,
      });

    const client = new DefaultGitClient("/fake/repo", mockRunner);

    await expect(client.createCommit("feat: failing hook")).rejects.toThrow(VibeCommitError);
    await expect(client.createCommit("feat: failing hook")).rejects.toThrow(
      "Failed to create commit: pre-commit hook failed (exit code 1)",
    );
  });

  test("throws VibeCommitError when stdout contains failure message on non-zero exit", async () => {
    const mockRunner: GitRunner = () =>
      Promise.resolve({
        stdout: "error: pathspec 'nonexistent' did not match any file(s) known to git",
        stderr: "",
        exitCode: 128,
      });

    const client = new DefaultGitClient("/fake/repo", mockRunner);

    await expect(client.createCommit("feat: failure")).rejects.toThrow(VibeCommitError);
    await expect(client.createCommit("feat: failure")).rejects.toThrow(
      "Failed to create commit: error: pathspec 'nonexistent' did not match any file(s) known to git",
    );
  });
});
