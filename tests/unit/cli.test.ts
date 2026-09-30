import { describe, expect, test } from "vitest";
import { main } from "../../src/app.js";
import type { Io } from "../../src/app.js";
import type { GitClient, GitCommitResult } from "../../src/git/git-client.js";
import type { PromptInterface } from "../../src/ui/prompt.js";

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
    createCommit: () =>
      Promise.resolve({
        success: true,
        commitHash: "mock123",
        summaryLine: "[master mock123] chore: mock",
        rawOutput: "mock",
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

describe("staged changes CLI flow in Phase 3", () => {
  function createStagedTestContext() {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const mockGitClient: GitClient = {
      checkGitInstalled: () => Promise.resolve(),
      getRepoRoot: () => Promise.resolve("/mock/repo"),
      getStagedDiff: () => Promise.resolve("diff --git a/src/app.ts b/src/app.ts\n+line"),
      getStagedChanges: () =>
        Promise.resolve({
          repoRoot: "/mock/repo",
          files: [
            {
              status: "modified",
              path: "src/domain/app.ts",
              isBinary: false,
              additions: 1,
              deletions: 0,
              hasTextDiff: true,
            },
          ],
          summary: {
            totalFiles: 1,
            additions: 1,
            deletions: 0,
            statusCounts: {
              added: 0,
              modified: 1,
              deleted: 0,
              renamed: 0,
              copied: 0,
            },
          },
          diffText: "diff --git a/src/domain/app.ts b/src/domain/app.ts\n+line",
        }),
      createCommit: (msg: string) =>
        Promise.resolve({
          success: true,
          commitHash: "mock456",
          summaryLine: `[master mock456] ${msg}`,
          rawOutput: `[master mock456] ${msg}`,
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

  test("with staged changes and --no-ai --dry-run: outputs summary, diff budget line, 3 suggestions, and dry-run preview", async () => {
    const { io, gitClient, getStdout, getStderr } = createStagedTestContext();
    const exitCode = await main(["node", "vibecommit", "--no-ai", "--dry-run"], { io, gitClient });

    expect(exitCode).toBe(0);
    const stdout = getStdout();
    expect(stdout).toContain("Staged files: 1");
    expect(stdout).toContain("Diff budget:");
    expect(stdout).toContain("1. chore(domain):");
    expect(stdout).toContain("2. chore:");
    expect(stdout).toContain("3. chore:");
    expect(stdout).toContain("Suggestions generated using local heuristics");
    expect(stdout).toContain("Selected commit message:");
    expect(stdout).toContain("Dry-run mode is active: no commit will be created.");
    expect(getStderr()).toBe("");
  });

  test("in non-TTY environment without --dry-run: reports friendly error and exits with code 1", async () => {
    const { io, gitClient, getStderr } = createStagedTestContext();
    const mockPrompt: PromptInterface = {
      isInteractive: () => false,
      askSelection: () => Promise.resolve(null),
      askConfirmation: () => Promise.resolve(false),
      close: () => {},
    };

    const exitCode = await main(["node", "vibecommit", "--no-ai"], {
      io,
      gitClient,
      prompt: mockPrompt,
    });

    expect(exitCode).toBe(1);
    expect(getStderr()).toContain(
      "Error: VibeCommit requires an interactive terminal for commit creation",
    );
    expect(getStderr()).toContain("Use '--dry-run' in non-interactive environments.");
  });

  test("in interactive environment: prompts user, creates commit on confirmation, and reports success", async () => {
    const { io, gitClient, getStdout, getStderr } = createStagedTestContext();
    let commitCalledWithMessage: string | undefined;
    (
      gitClient as unknown as { createCommit: (msg: string) => Promise<GitCommitResult> }
    ).createCommit = (msg: string) => {
      commitCalledWithMessage = msg;
      return Promise.resolve({
        success: true,
        commitHash: "1a2b3c4",
        summaryLine: `[master 1a2b3c4] ${msg}`,
        rawOutput: `[master 1a2b3c4] ${msg}\n 1 file changed, 1 insertion(+)`,
      });
    };

    const mockPrompt: PromptInterface = {
      isInteractive: () => true,
      askSelection: () => Promise.resolve(1),
      askConfirmation: () => Promise.resolve(true),
      close: () => {},
    };

    const exitCode = await main(["node", "vibecommit", "--no-ai"], {
      io,
      gitClient,
      prompt: mockPrompt,
    });

    expect(exitCode).toBe(0);
    expect(commitCalledWithMessage).toBe("chore(domain): update app");
    const stdout = getStdout();
    expect(stdout).toContain("Commit created successfully:");
    expect(stdout).toContain("[master 1a2b3c4] chore(domain): update app");
    expect(getStderr()).toBe("");
  });

  test("in interactive environment: exits cleanly with code 0 on user cancellation", async () => {
    const { io, gitClient, getStdout, getStderr } = createStagedTestContext();
    const mockPrompt: PromptInterface = {
      isInteractive: () => true,
      askSelection: () => Promise.resolve(null),
      askConfirmation: () => Promise.resolve(false),
      close: () => {},
    };

    const exitCode = await main(["node", "vibecommit", "--no-ai"], {
      io,
      gitClient,
      prompt: mockPrompt,
    });

    expect(exitCode).toBe(0);
    expect(getStdout()).toContain("Commit aborted by user.");
    expect(getStderr()).toBe("");
  });

  test("in interactive environment: exits cleanly with code 0 when user declines confirmation", async () => {
    const { io, gitClient, getStdout, getStderr } = createStagedTestContext();
    const mockPrompt: PromptInterface = {
      isInteractive: () => true,
      askSelection: () => Promise.resolve(2),
      askConfirmation: () => Promise.resolve(false),
      close: () => {},
    };

    const exitCode = await main(["node", "vibecommit", "--no-ai"], {
      io,
      gitClient,
      prompt: mockPrompt,
    });

    expect(exitCode).toBe(0);
    expect(getStdout()).toContain("Commit cancelled. Staged changes remain staged.");
    expect(getStderr()).toBe("");
  });

  test("with staged changes and no flags: outputs summary, notes missing OPENAI_API_KEY, and uses local fallback suggestions", async () => {
    const { io, gitClient, getStdout, getStderr } = createStagedTestContext();
    const mockPrompt: PromptInterface = {
      isInteractive: () => true,
      askSelection: () => Promise.resolve(null),
      askConfirmation: () => Promise.resolve(false),
      close: () => {},
    };
    const exitCode = await main(["node", "vibecommit"], { io, gitClient, prompt: mockPrompt });

    expect(exitCode).toBe(0);
    const stdout = getStdout();
    expect(stdout).toContain("Staged files: 1");
    expect(stdout).toContain("Diff budget:");
    expect(stdout).toContain("OPENAI_API_KEY is not configured. Using local fallback suggestions.");
    expect(stdout).toContain("1. chore(domain):");
    expect(stdout).toContain("Suggestions generated using local heuristics");
    expect(getStderr()).toBe("");
  });

  test("proves only read-only Git subcommands are executed and never write commands", async () => {
    const executedCommands: string[][] = [];
    const recordingRunner = (args: readonly string[]) => {
      executedCommands.push([...args]);
      if (args[0] === "--version") {
        return Promise.resolve({ stdout: "git version 2.45.0\n", stderr: "", exitCode: 0 });
      }
      if (args[0] === "rev-parse") {
        return Promise.resolve({ stdout: "/mock/repo\n", stderr: "", exitCode: 0 });
      }
      if (args[0] === "diff" && args.includes("--name-status")) {
        return Promise.resolve({ stdout: "M\0src/app.ts\0", stderr: "", exitCode: 0 });
      }
      if (args[0] === "diff" && args.includes("--numstat")) {
        return Promise.resolve({ stdout: "1\t0\tsrc/app.ts\0", stderr: "", exitCode: 0 });
      }
      if (args[0] === "diff") {
        return Promise.resolve({
          stdout: "diff --git a/src/app.ts b/src/app.ts\n+line",
          stderr: "",
          exitCode: 0,
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const { DefaultGitClient } = await import("../../src/git/git-client.js");
    const recordingClient = new DefaultGitClient("/mock/repo", recordingRunner);

    const stdoutChunks: string[] = [];
    const io: Io = {
      stdout: (chunk: string) => stdoutChunks.push(chunk),
      stderr: () => {},
    };

    const exitCode = await main(["node", "vibecommit", "--no-ai", "--dry-run"], {
      io,
      gitClient: recordingClient,
    });

    expect(exitCode).toBe(0);
    expect(executedCommands.length).toBeGreaterThan(0);

    const forbiddenSubcommands = [
      "commit",
      "add",
      "reset",
      "push",
      "checkout",
      "rm",
      "branch",
      "clean",
      "merge",
      "rebase",
    ];
    for (const cmd of executedCommands) {
      for (const forbidden of forbiddenSubcommands) {
        expect(cmd).not.toContain(forbidden);
      }
    }
  });
});
