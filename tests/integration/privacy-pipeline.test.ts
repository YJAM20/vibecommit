import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { main } from "../../src/app.js";
import type { Io } from "../../src/app.js";
import { DefaultGitClient } from "../../src/git/git-client.js";
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

describe("End-to-End Privacy Pipeline Integration Tests", () => {
  const FAKE_CONFIG_KEY = "sk-fakeKeyInConfig1234567890abcdef";
  const FAKE_ENV_SECRET = "superSecretPasswordInsideEnvFile987";
  const FAKE_PEM_LINE = "MIIEfakePrivateRSAKeyContentLine1Testing";

  test("runs full pipeline on staged files with fake secrets and preserves all invariants", async () => {
    const repo = await createTempRepo();
    const { io, getStdout, getStderr } = createTestIo();

    try {
      // 1. Normal source file with fake OpenAI API key
      await mkdir(join(repo.path, "src"), { recursive: true });
      await writeFile(
        join(repo.path, "src", "config.ts"),
        `export const API_KEY = "${FAKE_CONFIG_KEY}";\nexport const PORT = 3000;\n`,
      );

      // 2. High-risk .env file with fake database credentials
      await writeFile(
        join(repo.path, ".env"),
        `DATABASE_URL=postgres://user:${FAKE_ENV_SECRET}@localhost:5432/db\n`,
      );

      // 3. High-risk PEM certificate file
      await mkdir(join(repo.path, "certs"), { recursive: true });
      await writeFile(
        join(repo.path, "certs", "server.pem"),
        `-----BEGIN RSA PRIVATE KEY-----\n${FAKE_PEM_LINE}\n-----END RSA PRIVATE KEY-----\n`,
      );

      // 4. Dependency lockfile fixture
      await writeFile(
        join(repo.path, "package-lock.json"),
        JSON.stringify({ name: "fixture", lockfileVersion: 3 }, null, 2),
      );

      // 5. Binary fixture
      const binaryPngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await mkdir(join(repo.path, "assets"), { recursive: true });
      await writeFile(join(repo.path, "assets", "logo.png"), binaryPngHeader);

      // 6. Normal documentation file
      await writeFile(join(repo.path, "README.md"), "# Project Readme\nSafe documentation text.\n");

      // Stage the intended test files explicitly
      await repo.runGit([
        "add",
        "src/config.ts",
        ".env",
        "certs/server.pem",
        "package-lock.json",
        "assets/logo.png",
        "README.md",
      ]);

      const diffBefore = await repo.runGit(["diff", "--staged"]);
      expect(diffBefore.stdout).toContain(FAKE_CONFIG_KEY);
      expect(diffBefore.stdout).toContain(FAKE_ENV_SECRET);

      // Execute CLI with --no-ai --dry-run
      const exitCode = await main(["node", "vibecommit", "--no-ai", "--dry-run"], {
        io,
        gitClient: new DefaultGitClient(repo.path),
      });

      expect(exitCode).toBe(0);
      expect(getStderr()).toBe("");

      const stdout = getStdout();

      // INVARIANT 1: Zero fake secrets leaked into stdout or stderr
      expect(stdout).not.toContain(FAKE_CONFIG_KEY);
      expect(stdout).not.toContain(FAKE_ENV_SECRET);
      expect(stdout).not.toContain(FAKE_PEM_LINE);

      // INVARIANT 2: Privacy summary is rendered with correct categories and counts
      expect(stdout).toContain("Privacy summary:");
      expect(stdout).toContain("1 sensitive-looking value redacted");
      expect(stdout).toContain("2 file contents withheld by path policy");
      expect(stdout).toContain("1 binary file represented as metadata only");
      expect(stdout).toContain("1 file summarized by policy");

      // INVARIANT 3: Staged files summary is preserved and readable
      expect(stdout).toContain("Staged files: 6");
      expect(stdout).toContain("Total changes:");

      // INVARIANT 4: Exactly three valid local heuristic suggestions are generated
      expect(stdout).toContain("Suggested commit messages (local heuristics):");
      expect(stdout).toContain("1. ");
      expect(stdout).toContain("2. ");
      expect(stdout).toContain("3. ");

      // INVARIANT 5: Diff budget line is printed
      expect(stdout).toContain("Diff budget:");

      // INVARIANT 6: Staged repository state is completely untouched (no commit created)
      const diffAfter = await repo.runGit(["diff", "--staged"]);
      expect(diffAfter.stdout).toBe(diffBefore.stdout);

      const commitCheck = await repo.runGit(["rev-parse", "HEAD"]);
      expect(commitCheck.exitCode).not.toBe(0);
    } finally {
      await repo.cleanup();
    }
  });

  test("runs safely on clean repository without secrets and reports clean privacy summary", async () => {
    const repo = await createTempRepo();
    const { io, getStdout, getStderr } = createTestIo();

    try {
      await writeFile(join(repo.path, "README.md"), "# Title\nDocumentation only\n");
      await repo.runGit(["add", "README.md"]);

      const exitCode = await main(["node", "vibecommit", "--no-ai", "--dry-run"], {
        io,
        gitClient: new DefaultGitClient(repo.path),
      });

      expect(exitCode).toBe(0);
      expect(getStderr()).toBe("");

      const stdout = getStdout();
      expect(stdout).toContain(
        "Privacy summary: content inspected, 0 secrets detected, 0 files withheld",
      );
    } finally {
      await repo.cleanup();
    }
  });
});
