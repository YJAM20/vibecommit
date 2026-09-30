import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { main } from "../../src/app.js";
import type { Io } from "../../src/app.js";
import { DefaultGitClient } from "../../src/git/git-client.js";
import type { GitClient } from "../../src/git/git-client.js";
import { VibeCommitError } from "../../src/utils/errors.js";
import { createTempDir, createTempRepo } from "../helpers/temp-repo.js";

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

describe("CLI flow integration with real and simulated repositories", () => {
  test("outside a Git repository: returns 1 with friendly error and hint", async () => {
    const plainDir = await createTempDir();
    const { io, getStdout, getStderr } = createTestIo();

    try {
      const exitCode = await main(["node", "vibecommit"], {
        io,
        gitClient: new DefaultGitClient(plainDir.path),
      });

      expect(exitCode).toBe(1);
      expect(getStdout()).toContain("vibecommit v0.1.0");
      expect(getStderr()).toContain("Error: Not inside a Git repository");
      expect(getStderr()).toContain(
        "Hint: Run vibecommit inside a Git repository or initialize one with 'git init'.",
      );
    } finally {
      await plainDir.cleanup();
    }
  });

  test("inside repository with no staged changes: returns 0 with git add guidance and no side effects", async () => {
    const repo = await createTempRepo();
    const { io, getStdout, getStderr } = createTestIo();

    try {
      const statusBefore = await repo.runGit(["status", "--short"]);
      const exitCode = await main(["node", "vibecommit"], {
        io,
        gitClient: new DefaultGitClient(repo.path),
      });

      expect(exitCode).toBe(0);
      expect(getStderr()).toBe("");
      const stdout = getStdout();
      expect(stdout).toContain("vibecommit v0.1.0");
      expect(stdout).toContain("No staged changes detected");
      expect(stdout).toContain("git add <files>");

      const statusAfter = await repo.runGit(["status", "--short"]);
      expect(statusAfter.stdout).toBe(statusBefore.stdout);
    } finally {
      await repo.cleanup();
    }
  });

  test("with staged changes: prints summary, preserves repo state, and NEVER leaks raw diff text", async () => {
    const repo = await createTempRepo();
    const { io, getStdout, getStderr } = createTestIo();

    try {
      const secretMarker = "SUPER_SECRET_DIFF_CONTENT_XYZ_12345";
      await writeFile(join(repo.path, "secret.txt"), `Header\n${secretMarker}\nFooter\n`);
      await repo.runGit(["add", "secret.txt"]);

      const diffBefore = await repo.runGit(["diff", "--staged"]);
      expect(diffBefore.stdout).toContain(secretMarker);

      const exitCode = await main(["node", "vibecommit"], {
        io,
        gitClient: new DefaultGitClient(repo.path),
      });

      expect(exitCode).toBe(0);
      expect(getStderr()).toBe("");

      const stdout = getStdout();
      expect(stdout).toContain("vibecommit v0.1.0");
      expect(stdout).toContain("Staged files: 1 (1 added)");
      expect(stdout).toContain("[added]    secret.txt (+3, -0)");
      expect(stdout).toContain("Total changes: +3, -0");

      // Verify raw diff text is NEVER printed
      expect(stdout).not.toContain(secretMarker);
      expect(getStderr()).not.toContain(secretMarker);

      // Verify repository commit count and staged set are completely unchanged
      const diffAfter = await repo.runGit(["diff", "--staged"]);
      expect(diffAfter.stdout).toBe(diffBefore.stdout);

      const commitCheck = await repo.runGit(["rev-parse", "HEAD"]);
      // HEAD should still have no commits
      expect(commitCheck.exitCode).not.toBe(0);
    } finally {
      await repo.cleanup();
    }
  });

  test("Git missing simulated via mock GitClient throws friendly error without crashing", async () => {
    const { io, getStdout, getStderr } = createTestIo();

    const mockGitClient: GitClient = {
      checkGitInstalled: () => {
        throw new VibeCommitError("Git is not installed or not found in PATH", {
          hint: "Please install Git and ensure it is available in your PATH environment variable.",
        });
      },
      getRepoRoot: () => Promise.resolve("/mock/root"),
      getStagedDiff: () => Promise.resolve(""),
      getStagedChanges: () =>
        Promise.reject(new Error("Should not be called when Git check fails")),
    };

    const exitCode = await main(["node", "vibecommit"], { io, gitClient: mockGitClient });
    expect(exitCode).toBe(1);
    expect(getStdout()).toContain("vibecommit v0.1.0");
    expect(getStderr()).toContain("Error: Git is not installed or not found in PATH");
    expect(getStderr()).toContain("Hint: Please install Git");
  });
});
