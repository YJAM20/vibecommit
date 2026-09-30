import { describe, expect, test } from "vitest";
import { main } from "../../src/app.js";
import type { Io } from "../../src/app.js";
import type { GitClient } from "../../src/git/git-client.js";

function createTestContext(): {
  io: Io;
  gitClient: GitClient;
  getStdout: () => string;
  getStderr: () => string;
} {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const mockGitClient: GitClient = {
    checkGitInstalled: () => Promise.resolve(),
    getRepoRoot: () => Promise.resolve("/mock/repo"),
    getStagedDiff: () => Promise.resolve(""),
    getStagedChanges: () =>
      Promise.resolve({
        repoRoot: "/mock/repo",
        files: [],
        summary: {
          totalFiles: 0,
          additions: 0,
          deletions: 0,
          statusCounts: {
            added: 0,
            modified: 0,
            deleted: 0,
            renamed: 0,
            copied: 0,
          },
        },
        diffText: "",
      }),
  };

  return {
    io: {
      stdout: (chunk: string) => {
        stdoutChunks.push(chunk);
      },
      stderr: (chunk: string) => {
        stderrChunks.push(chunk);
      },
    },
    gitClient: mockGitClient,
    getStdout: () => stdoutChunks.join(""),
    getStderr: () => stderrChunks.join(""),
  };
}

describe("CLI argument handling and output", () => {
  test("no flags: returns 0, stdout contains banner with version and not implemented yet, stderr empty", async () => {
    const { io, gitClient, getStdout, getStderr } = createTestContext();
    const exitCode = await main(["node", "vibecommit"], { io, gitClient });

    expect(exitCode).toBe(0);
    const stdout = getStdout();
    expect(stdout).toContain("vibecommit v0.1.0");
    expect(stdout).toContain("not implemented yet");
    expect(stdout).not.toContain("Dry-run mode is active");
    expect(stdout).not.toContain("AI is disabled");
    expect(getStderr()).toBe("");
  });

  test("--dry-run: returns 0, stdout includes dry-run line only", async () => {
    const { io, gitClient, getStdout, getStderr } = createTestContext();
    const exitCode = await main(["node", "vibecommit", "--dry-run"], { io, gitClient });

    expect(exitCode).toBe(0);
    const stdout = getStdout();
    expect(stdout).toContain("vibecommit v0.1.0");
    expect(stdout).toContain("not implemented yet");
    expect(stdout).toContain("Dry-run mode is active");
    expect(stdout).not.toContain("AI is disabled");
    expect(getStderr()).toBe("");
  });

  test("--no-ai: returns 0, stdout includes AI-disabled line only", async () => {
    const { io, gitClient, getStdout, getStderr } = createTestContext();
    const exitCode = await main(["node", "vibecommit", "--no-ai"], { io, gitClient });

    expect(exitCode).toBe(0);
    const stdout = getStdout();
    expect(stdout).toContain("vibecommit v0.1.0");
    expect(stdout).toContain("not implemented yet");
    expect(stdout).toContain("AI is disabled");
    expect(stdout).not.toContain("Dry-run mode is active");
    expect(getStderr()).toBe("");
  });

  test("both flags together: returns 0, both lines present", async () => {
    const { io, gitClient, getStdout, getStderr } = createTestContext();
    const exitCode = await main(["node", "vibecommit", "--dry-run", "--no-ai"], { io, gitClient });

    expect(exitCode).toBe(0);
    const stdout = getStdout();
    expect(stdout).toContain("vibecommit v0.1.0");
    expect(stdout).toContain("not implemented yet");
    expect(stdout).toContain("Dry-run mode is active");
    expect(stdout).toContain("AI is disabled");
    expect(getStderr()).toBe("");
  });

  test("--help: returns 0, stdout mentions both flags and program name", async () => {
    const { io, gitClient, getStdout, getStderr } = createTestContext();
    const exitCode = await main(["node", "vibecommit", "--help"], { io, gitClient });

    expect(exitCode).toBe(0);
    const stdout = getStdout();
    expect(stdout).toContain("vibecommit");
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--no-ai");
    expect(getStderr()).toBe("");
  });

  test("--version and -V: returns 0, stdout contains version read from real package.json", async () => {
    const { io: io1, gitClient: client1, getStdout: getStdout1 } = createTestContext();
    const code1 = await main(["node", "vibecommit", "--version"], {
      io: io1,
      gitClient: client1,
    });
    expect(code1).toBe(0);
    expect(getStdout1().trim()).toBe("0.1.0");

    const { io: io2, gitClient: client2, getStdout: getStdout2 } = createTestContext();
    const code2 = await main(["node", "vibecommit", "-V"], { io: io2, gitClient: client2 });
    expect(code2).toBe(0);
    expect(getStdout2().trim()).toBe("0.1.0");
  });

  test("unknown option: returns 2, stderr contains unknown-option message once and help hint, stdout empty, no stack trace", async () => {
    const { io, gitClient, getStdout, getStderr } = createTestContext();
    const exitCode = await main(["node", "vibecommit", "--bogus"], { io, gitClient });

    expect(exitCode).toBe(2);
    expect(getStdout()).toBe("");
    const stderr = getStderr();
    expect(stderr).toContain("error: unknown option '--bogus'");
    const matches = stderr.match(/unknown option '--bogus'/g);
    expect(matches).not.toBeNull();
    expect(matches).toHaveLength(1);
    expect(stderr).toContain("vibecommit --help");
    expect(stderr).not.toContain("at ");
    expect(stderr).not.toContain("node_modules");
  });

  test("unexpected positional argument: returns 2 with a usage error", async () => {
    const { io, gitClient, getStdout, getStderr } = createTestContext();
    const exitCode = await main(["node", "vibecommit", "extra-positional-argument"], {
      io,
      gitClient,
    });

    expect(exitCode).toBe(2);
    expect(getStdout()).toBe("");
    const stderr = getStderr();
    expect(stderr).toContain("error: too many arguments");
    expect(stderr).toContain("vibecommit --help");
  });
});
