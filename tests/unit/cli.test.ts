import { describe, expect, test } from "vitest";
import { main } from "../../src/app.js";
import type { Io } from "../../src/app.js";

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

describe("CLI argument handling and output", () => {
  test("no flags: returns 0, stdout contains banner with version and not implemented yet, stderr empty", async () => {
    const { io, getStdout, getStderr } = createTestIo();
    const exitCode = await main(["node", "vibecommit"], io);

    expect(exitCode).toBe(0);
    const stdout = getStdout();
    expect(stdout).toContain("vibecommit v0.1.0");
    expect(stdout).toContain("not implemented yet");
    expect(stdout).not.toContain("Dry-run mode is active");
    expect(stdout).not.toContain("AI is disabled");
    expect(getStderr()).toBe("");
  });

  test("--dry-run: returns 0, stdout includes dry-run line only", async () => {
    const { io, getStdout, getStderr } = createTestIo();
    const exitCode = await main(["node", "vibecommit", "--dry-run"], io);

    expect(exitCode).toBe(0);
    const stdout = getStdout();
    expect(stdout).toContain("vibecommit v0.1.0");
    expect(stdout).toContain("not implemented yet");
    expect(stdout).toContain("Dry-run mode is active");
    expect(stdout).not.toContain("AI is disabled");
    expect(getStderr()).toBe("");
  });

  test("--no-ai: returns 0, stdout includes AI-disabled line only", async () => {
    const { io, getStdout, getStderr } = createTestIo();
    const exitCode = await main(["node", "vibecommit", "--no-ai"], io);

    expect(exitCode).toBe(0);
    const stdout = getStdout();
    expect(stdout).toContain("vibecommit v0.1.0");
    expect(stdout).toContain("not implemented yet");
    expect(stdout).toContain("AI is disabled");
    expect(stdout).not.toContain("Dry-run mode is active");
    expect(getStderr()).toBe("");
  });

  test("both flags together: returns 0, both lines present", async () => {
    const { io, getStdout, getStderr } = createTestIo();
    const exitCode = await main(["node", "vibecommit", "--dry-run", "--no-ai"], io);

    expect(exitCode).toBe(0);
    const stdout = getStdout();
    expect(stdout).toContain("vibecommit v0.1.0");
    expect(stdout).toContain("not implemented yet");
    expect(stdout).toContain("Dry-run mode is active");
    expect(stdout).toContain("AI is disabled");
    expect(getStderr()).toBe("");
  });

  test("--help: returns 0, stdout mentions both flags and program name", async () => {
    const { io, getStdout, getStderr } = createTestIo();
    const exitCode = await main(["node", "vibecommit", "--help"], io);

    expect(exitCode).toBe(0);
    const stdout = getStdout();
    expect(stdout).toContain("vibecommit");
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--no-ai");
    expect(getStderr()).toBe("");
  });

  test("--version and -V: returns 0, stdout contains version read from real package.json", async () => {
    const { io: io1, getStdout: getStdout1 } = createTestIo();
    const code1 = await main(["node", "vibecommit", "--version"], io1);
    expect(code1).toBe(0);
    expect(getStdout1().trim()).toBe("0.1.0");

    const { io: io2, getStdout: getStdout2 } = createTestIo();
    const code2 = await main(["node", "vibecommit", "-V"], io2);
    expect(code2).toBe(0);
    expect(getStdout2().trim()).toBe("0.1.0");
  });

  test("unknown option: returns 2, stderr contains unknown-option message once and help hint, stdout empty, no stack trace", async () => {
    const { io, getStdout, getStderr } = createTestIo();
    const exitCode = await main(["node", "vibecommit", "--bogus"], io);

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
    const { io, getStdout, getStderr } = createTestIo();
    const exitCode = await main(["node", "vibecommit", "extra-positional-argument"], io);

    expect(exitCode).toBe(2);
    expect(getStdout()).toBe("");
    const stderr = getStderr();
    expect(stderr).toContain("error: too many arguments");
    expect(stderr).toContain("vibecommit --help");
  });
});
