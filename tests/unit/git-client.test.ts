import { describe, expect, test } from "vitest";
import type { GitRunner } from "../../src/git/git-client.js";
import { DefaultGitClient } from "../../src/git/git-client.js";
import { VibeCommitError } from "../../src/utils/errors.js";

describe("DefaultGitClient with mocked runner", () => {
  test("throws friendly error when Git is missing (ENOENT)", async () => {
    const mockRunner: GitRunner = () => {
      const err = new Error("spawn git ENOENT") as Error & { code: string };
      err.code = "ENOENT";
      return Promise.reject(err);
    };

    const client = new DefaultGitClient("/test/repo", mockRunner);
    await expect(client.checkGitInstalled()).rejects.toThrow(VibeCommitError);
    await expect(client.checkGitInstalled()).rejects.toThrow(
      "Git is not installed or not found in PATH",
    );
  });

  test("throws friendly error when not in a Git repository", async () => {
    const mockRunner: GitRunner = (args) => {
      if (args[0] === "rev-parse") {
        return Promise.resolve({
          stdout: "",
          stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
          exitCode: 128,
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const client = new DefaultGitClient("/test/repo", mockRunner);
    await expect(client.getRepoRoot()).rejects.toThrow(VibeCommitError);
    await expect(client.getRepoRoot()).rejects.toThrow("Not inside a Git repository");
  });

  test("generic Git failure includes first line of stderr only without diff content", async () => {
    const mockRunner: GitRunner = (args) => {
      if (args[0] === "diff") {
        return Promise.resolve({
          stdout: "secret raw diff content that should not be in error",
          stderr: "fatal: dubious ownership detected\nadditional internal lines\n",
          exitCode: 128,
        });
      }
      if (args[0] === "rev-parse") {
        return Promise.resolve({ stdout: "/test/repo", stderr: "", exitCode: 0 });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const client = new DefaultGitClient("/test/repo", mockRunner);
    let thrownError: Error | undefined;
    try {
      await client.getStagedDiff();
    } catch (err: unknown) {
      thrownError = err as Error;
    }

    expect(thrownError).toBeInstanceOf(VibeCommitError);
    expect(thrownError?.message).toBe(
      "Failed to read staged diff: fatal: dubious ownership detected",
    );
    expect(thrownError?.message).not.toContain("additional internal lines");
    expect(thrownError?.message).not.toContain("secret raw diff content");
  });

  test("handles buffer overflow as friendly error", async () => {
    const mockRunner: GitRunner = () => {
      const err = new Error("stdout maxBuffer length exceeded") as Error & { code: string };
      err.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
      return Promise.reject(err);
    };

    const client = new DefaultGitClient("/test/repo", mockRunner);
    await expect(client.getStagedDiff()).rejects.toThrow(VibeCommitError);
    await expect(client.getStagedDiff()).rejects.toThrow(
      "Git diff output exceeded maximum buffer limit",
    );
  });

  test("scrubs GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE and sets LC_ALL=C", async () => {
    let capturedEnv: Record<string, string | undefined> | undefined;

    const mockRunner: GitRunner = (_args, options) => {
      capturedEnv = options.env;
      return Promise.resolve({ stdout: "git version 2.40.0\n", stderr: "", exitCode: 0 });
    };

    process.env["GIT_DIR"] = "/bad/git/dir";
    process.env["GIT_WORK_TREE"] = "/bad/work/tree";
    process.env["GIT_INDEX_FILE"] = "/bad/index";

    try {
      const client = new DefaultGitClient("/test/repo", mockRunner);
      await client.checkGitInstalled();

      expect(capturedEnv).toBeDefined();
      expect(capturedEnv?.["GIT_DIR"]).toBeUndefined();
      expect(capturedEnv?.["GIT_WORK_TREE"]).toBeUndefined();
      expect(capturedEnv?.["GIT_INDEX_FILE"]).toBeUndefined();
      expect(capturedEnv?.["LC_ALL"]).toBe("C");
    } finally {
      delete process.env["GIT_DIR"];
      delete process.env["GIT_WORK_TREE"];
      delete process.env["GIT_INDEX_FILE"];
    }
  });

  test("passes arguments as arrays and never executes write subcommands", async () => {
    const recordedCalls: string[][] = [];

    const mockRunner: GitRunner = (args) => {
      recordedCalls.push([...args]);

      if (args[0] === "--version") {
        return Promise.resolve({ stdout: "git version 2.40.0\n", stderr: "", exitCode: 0 });
      }
      if (args[0] === "rev-parse") {
        return Promise.resolve({ stdout: "/test/repo\n", stderr: "", exitCode: 0 });
      }
      if (args[0] === "diff" && args.includes("--name-status")) {
        return Promise.resolve({ stdout: "M\0file.ts\0", stderr: "", exitCode: 0 });
      }
      if (args[0] === "diff" && args.includes("--numstat")) {
        return Promise.resolve({ stdout: "1\t1\tfile.ts\0", stderr: "", exitCode: 0 });
      }
      if (args[0] === "diff") {
        return Promise.resolve({ stdout: "mock diff\n", stderr: "", exitCode: 0 });
      }

      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const client = new DefaultGitClient("/test/repo", mockRunner);
    await client.checkGitInstalled();
    await client.getStagedChanges();

    expect(recordedCalls.length).toBeGreaterThan(0);

    const allowedSubcommands = new Set(["--version", "rev-parse", "diff"]);
    const forbiddenSubcommands = [
      "add",
      "commit",
      "reset",
      "restore",
      "checkout",
      "branch",
      "push",
      "pull",
      "fetch",
      "stash",
      "rm",
    ];

    for (const call of recordedCalls) {
      expect(Array.isArray(call)).toBe(true);
      const sub = call[0];
      expect(sub).toBeDefined();
      expect(allowedSubcommands.has(sub!)).toBe(true);

      for (const forbidden of forbiddenSubcommands) {
        expect(call).not.toContain(forbidden);
      }
    }
  });
});
