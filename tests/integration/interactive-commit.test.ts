import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { main } from "../../src/app.js";
import type { Io } from "../../src/app.js";
import { DefaultGitClient } from "../../src/git/git-client.js";
import type { PromptInterface } from "../../src/ui/prompt.js";
import { createTempRepo } from "../helpers/temp-repo.js";

function createTestIo(): {
  io: Io;
  getStdout: () => string;
  getStderr: () => string;
} {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  return {
    io: {
      stdout: (chunk: string) => {
        stdoutChunks.push(chunk);
      },
      stderr: (chunk: string) => {
        stderrChunks.push(chunk);
      },
    },
    getStdout: () => stdoutChunks.join(""),
    getStderr: () => stderrChunks.join(""),
  };
}

describe("Interactive fallback flow and real Git commit integration", () => {
  test("creates a real Git commit when user selects option 1 and confirms with yes", async () => {
    const repo = await createTempRepo();
    const { io, getStdout, getStderr } = createTestIo();

    try {
      await writeFile(join(repo.path, "feature.ts"), "export const answer = 42;\n");
      await repo.runGit(["add", "feature.ts"]);

      const diffBefore = await repo.runGit(["diff", "--staged"]);
      expect(diffBefore.stdout).toContain("answer = 42");

      const mockPrompt: PromptInterface = {
        isInteractive: () => true,
        askSelection: () => Promise.resolve(1),
        askConfirmation: () => Promise.resolve(true),
        close: () => {},
      };

      const exitCode = await main(["node", "vibecommit", "--no-ai"], {
        io,
        gitClient: new DefaultGitClient(repo.path),
        prompt: mockPrompt,
      });

      expect(exitCode).toBe(0);
      expect(getStderr()).toBe("");

      const stdout = getStdout();
      expect(stdout).toContain("Commit created successfully:");
      expect(stdout).toContain("feat: add feature");

      // Verify Git history contains the new commit with the exact Conventional Commit message
      const logResult = await repo.runGit(["log", "-1", "--pretty=format:%B"]);
      expect(logResult.exitCode).toBe(0);
      expect(logResult.stdout.trim()).toBe("feat: add feature");

      // Verify staged changes are consumed (no changes staged)
      const diffAfter = await repo.runGit(["diff", "--staged"]);
      expect(diffAfter.stdout.trim()).toBe("");
    } finally {
      await repo.cleanup();
    }
  });

  test("does not create a commit and leaves changes staged when user declines confirmation", async () => {
    const repo = await createTempRepo();
    const { io, getStdout, getStderr } = createTestIo();

    try {
      // First create a baseline commit so HEAD exists
      await writeFile(join(repo.path, "init.txt"), "init\n");
      await repo.runGit(["add", "init.txt"]);
      await repo.runGit(["commit", "-m", "chore: initial commit"]);
      const revBefore = await repo.runGit(["rev-parse", "HEAD"]);

      // Now stage a new file
      await writeFile(join(repo.path, "declined.ts"), "export const x = 1;\n");
      await repo.runGit(["add", "declined.ts"]);

      const mockPrompt: PromptInterface = {
        isInteractive: () => true,
        askSelection: () => Promise.resolve(1),
        askConfirmation: () => Promise.resolve(false),
        close: () => {},
      };

      const exitCode = await main(["node", "vibecommit", "--no-ai"], {
        io,
        gitClient: new DefaultGitClient(repo.path),
        prompt: mockPrompt,
      });

      expect(exitCode).toBe(0);
      expect(getStderr()).toBe("");

      const stdout = getStdout();
      expect(stdout).toContain("Commit cancelled. Staged changes remain staged.");

      // Verify HEAD is unchanged
      const revAfter = await repo.runGit(["rev-parse", "HEAD"]);
      expect(revAfter.stdout.trim()).toBe(revBefore.stdout.trim());

      // Verify changes remain staged
      const statusAfter = await repo.runGit(["status", "--short"]);
      expect(statusAfter.stdout).toContain("A  declined.ts");
    } finally {
      await repo.cleanup();
    }
  });

  test("does not create a commit and leaves changes staged when user aborts selection", async () => {
    const repo = await createTempRepo();
    const { io, getStdout, getStderr } = createTestIo();

    try {
      await writeFile(join(repo.path, "aborted.ts"), "export const y = 2;\n");
      await repo.runGit(["add", "aborted.ts"]);

      const mockPrompt: PromptInterface = {
        isInteractive: () => true,
        askSelection: () => Promise.resolve(null),
        askConfirmation: () => Promise.resolve(false),
        close: () => {},
      };

      const exitCode = await main(["node", "vibecommit", "--no-ai"], {
        io,
        gitClient: new DefaultGitClient(repo.path),
        prompt: mockPrompt,
      });

      expect(exitCode).toBe(0);
      expect(getStderr()).toBe("");

      const stdout = getStdout();
      expect(stdout).toContain("Commit aborted by user.");

      // Verify changes remain staged
      const statusAfter = await repo.runGit(["status", "--short"]);
      expect(statusAfter.stdout).toContain("A  aborted.ts");
    } finally {
      await repo.cleanup();
    }
  });

  test("--dry-run never prompts or creates a commit and leaves changes staged", async () => {
    const repo = await createTempRepo();
    const { io, getStdout, getStderr } = createTestIo();

    try {
      await writeFile(join(repo.path, "dryrun.ts"), "export const z = 3;\n");
      await repo.runGit(["add", "dryrun.ts"]);

      let promptWasCalled = false;
      const mockPrompt: PromptInterface = {
        isInteractive: () => true,
        askSelection: () => {
          promptWasCalled = true;
          return Promise.resolve(1);
        },
        askConfirmation: () => {
          promptWasCalled = true;
          return Promise.resolve(true);
        },
        close: () => {},
      };

      const exitCode = await main(["node", "vibecommit", "--no-ai", "--dry-run"], {
        io,
        gitClient: new DefaultGitClient(repo.path),
        prompt: mockPrompt,
      });

      expect(exitCode).toBe(0);
      expect(getStderr()).toBe("");
      expect(promptWasCalled).toBe(false);

      const stdout = getStdout();
      expect(stdout).toContain("Dry-run mode is active: no commit will be created.");
      expect(stdout).toContain("Selected commit message:");
      expect(stdout).toContain("feat: add dryrun");

      // Verify no commit created
      const commitCheck = await repo.runGit(["rev-parse", "HEAD"]);
      expect(commitCheck.exitCode).not.toBe(0);

      // Verify changes remain staged
      const statusAfter = await repo.runGit(["status", "--short"]);
      expect(statusAfter.stdout).toContain("A  dryrun.ts");
    } finally {
      await repo.cleanup();
    }
  });
});
