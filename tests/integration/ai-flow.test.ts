import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { SuggestionOrchestrator } from "../../src/ai/generate.js";
import { ProviderError, type SuggestionProvider } from "../../src/ai/types.js";
import { main } from "../../src/app.js";
import type { Io } from "../../src/app.js";
import type { Suggestion } from "../../src/domain/suggestion-schema.js";
import { DefaultGitClient } from "../../src/git/git-client.js";
import type { SanitizedDiff } from "../../src/security/types.js";
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

const AI_SUGGESTIONS: readonly Suggestion[] = [
  {
    type: "feat",
    scope: "auth",
    subject: "implement token authentication",
    reason: "adds auth provider support",
  },
  {
    type: "chore",
    scope: "deps",
    subject: "upgrade client library",
    reason: "bumps dependency version",
  },
  {
    type: "test",
    scope: "auth",
    subject: "add token verification test",
    reason: "tests token validator",
  },
];

describe("AI suggestion generation and fallback integration", () => {
  const FAKE_AWS_KEY = "AKIA1234567890ABCDEF";
  const FAKE_GH_PAT = "ghp_123456789012345678901234567890123456";

  test("1. AI happy path: sanitization runs, mock provider receives SanitizedDiff, creates commit with selected AI suggestion", async () => {
    const repo = await createTempRepo();
    const { io, getStdout, getStderr } = createTestIo();

    try {
      await writeFile(
        join(repo.path, "auth.ts"),
        `export const aws = "${FAKE_AWS_KEY}";\nexport const token = true;\n`,
      );
      await repo.runGit(["add", "auth.ts"]);

      let receivedDiff: SanitizedDiff | null = null;
      const mockProvider: SuggestionProvider = {
        generateSuggestions: vi.fn().mockImplementation((diff: SanitizedDiff) => {
          receivedDiff = diff;
          return Promise.resolve(AI_SUGGESTIONS);
        }),
      };

      const orchestrator = new SuggestionOrchestrator({ provider: mockProvider });
      const mockPrompt: PromptInterface = {
        isInteractive: () => true,
        askSelection: () => Promise.resolve(1),
        askConfirmation: () => Promise.resolve(true),
        close: () => {},
      };

      const exitCode = await main(["node", "vibecommit"], {
        io,
        gitClient: new DefaultGitClient(repo.path),
        prompt: mockPrompt,
        orchestrator,
      });

      expect(exitCode).toBe(0);
      expect(getStderr()).toBe("");

      const stdout = getStdout();
      expect(stdout).toContain("AI-generated suggestions");
      expect(stdout).toContain("feat(auth): implement token authentication");
      expect(stdout).toContain("Commit created successfully:");
      expect(stdout).not.toContain("Using local fallback suggestions");

      // Verify Git commit was actually created
      const commitLog = await repo.runGit(["log", "-1", "--oneline"]);
      expect(commitLog.stdout).toContain("feat(auth): implement token authentication");

      // Verify provider received SanitizedDiff with redacted secret
      expect(receivedDiff).not.toBeNull();
      expect(receivedDiff!.content).not.toContain(FAKE_AWS_KEY);
      expect(receivedDiff!.content).toContain("[REDACTED:aws_access_key_id]");
    } finally {
      await repo.cleanup();
    }
  });

  test("2. AI invalid response triggers corrective retry and succeeds", async () => {
    const repo = await createTempRepo();
    const { io, getStdout, getStderr } = createTestIo();

    try {
      await writeFile(join(repo.path, "test.ts"), "export const a = 1;\n");
      await repo.runGit(["add", "test.ts"]);

      const invalidOutput: readonly Suggestion[] = [
        { type: "feat", scope: null, subject: "duplicate message", reason: "r1" },
        { type: "feat", scope: null, subject: "duplicate message", reason: "r2" },
        { type: "chore", scope: null, subject: "other message", reason: "r3" },
      ];

      const generateSuggestions = vi
        .fn()
        .mockResolvedValueOnce(invalidOutput)
        .mockResolvedValueOnce(AI_SUGGESTIONS);

      const mockProvider: SuggestionProvider = {
        generateSuggestions,
      };

      const orchestrator = new SuggestionOrchestrator({ provider: mockProvider });
      const mockPrompt: PromptInterface = {
        isInteractive: () => true,
        askSelection: () => Promise.resolve(2),
        askConfirmation: () => Promise.resolve(true),
        close: () => {},
      };

      const exitCode = await main(["node", "vibecommit"], {
        io,
        gitClient: new DefaultGitClient(repo.path),
        prompt: mockPrompt,
        orchestrator,
      });

      expect(exitCode).toBe(0);
      expect(getStderr()).toBe("");
      expect(generateSuggestions).toHaveBeenCalledTimes(2);

      const stdout = getStdout();
      expect(stdout).toContain("AI-generated suggestions");
      expect(stdout).toContain("chore(deps): upgrade client library");
      expect(stdout).not.toContain("Using local fallback suggestions");

      const commitLog = await repo.runGit(["log", "-1", "--oneline"]);
      expect(commitLog.stdout).toContain("chore(deps): upgrade client library");
    } finally {
      await repo.cleanup();
    }
  });

  test("3. AI failure triggers safe fallback to local heuristics and allows commit", async () => {
    const repo = await createTempRepo();
    const { io, getStdout, getStderr } = createTestIo();

    try {
      await writeFile(join(repo.path, "feature.ts"), "export const b = 2;\n");
      await repo.runGit(["add", "feature.ts"]);

      const mockProvider: SuggestionProvider = {
        generateSuggestions: vi
          .fn()
          .mockRejectedValue(new ProviderError("timeout", "Request timed out", true)),
      };

      const orchestrator = new SuggestionOrchestrator({ provider: mockProvider });
      const mockPrompt: PromptInterface = {
        isInteractive: () => true,
        askSelection: () => Promise.resolve(1),
        askConfirmation: () => Promise.resolve(true),
        close: () => {},
      };

      const exitCode = await main(["node", "vibecommit"], {
        io,
        gitClient: new DefaultGitClient(repo.path),
        prompt: mockPrompt,
        orchestrator,
      });

      expect(exitCode).toBe(0);
      expect(getStderr()).toBe("");

      const stdout = getStdout();
      expect(stdout).toContain("AI request timed out. Using local fallback suggestions.");
      expect(stdout).toContain("Suggested commit messages (local heuristics):");
      expect(stdout).toContain("Commit created successfully:");

      const commitLog = await repo.runGit(["log", "-1", "--oneline"]);
      expect(commitLog.stdout).toContain("feat: add feature");
    } finally {
      await repo.cleanup();
    }
  });

  test("4. --no-ai isolation: never touches provider or API key", async () => {
    const repo = await createTempRepo();
    const { io, getStdout, getStderr } = createTestIo();

    try {
      await writeFile(join(repo.path, "doc.md"), "# Documentation\n");
      await repo.runGit(["add", "doc.md"]);

      const generateSuggestions = vi.fn();
      const mockProvider: SuggestionProvider = {
        generateSuggestions,
      };
      const mockConfigLoader = vi.fn();

      const orchestrator = new SuggestionOrchestrator({
        provider: mockProvider,
        configLoader: mockConfigLoader,
      });

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
        orchestrator,
      });

      expect(exitCode).toBe(0);
      expect(getStderr()).toBe("");
      expect(generateSuggestions).not.toHaveBeenCalled();
      expect(mockConfigLoader).not.toHaveBeenCalled();

      const stdout = getStdout();
      expect(stdout).toContain("AI is disabled.");
      expect(stdout).toContain("Suggested commit messages (local heuristics):");
      expect(stdout).not.toContain("AI request timed out");
      expect(stdout).not.toContain("OPENAI_API_KEY");

      const commitLog = await repo.runGit(["log", "-1", "--oneline"]);
      expect(commitLog.stdout).toContain("docs: add doc");
    } finally {
      await repo.cleanup();
    }
  });

  test("5. No-leak: fake credentials and withheld files never leak to provider, stdout, or stderr", async () => {
    const repo = await createTempRepo();
    const { io, getStdout, getStderr } = createTestIo();

    try {
      // Create sensitive files and code with fake secrets
      await writeFile(join(repo.path, ".env"), `SECRET_TOKEN=${FAKE_GH_PAT}\n`);
      await writeFile(join(repo.path, "id_rsa"), "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n");
      await writeFile(
        join(repo.path, "service.ts"),
        `const awsKey = "${FAKE_AWS_KEY}";\nconst ghPat = "${FAKE_GH_PAT}";\n`,
      );
      await repo.runGit(["add", ".env", "id_rsa", "service.ts"]);

      let receivedDiff: SanitizedDiff | null = null;
      const mockProvider: SuggestionProvider = {
        generateSuggestions: vi.fn().mockImplementation((diff: SanitizedDiff) => {
          receivedDiff = diff;
          return Promise.resolve(AI_SUGGESTIONS);
        }),
      };

      const orchestrator = new SuggestionOrchestrator({ provider: mockProvider });

      const exitCode = await main(["node", "vibecommit", "--dry-run"], {
        io,
        gitClient: new DefaultGitClient(repo.path),
        orchestrator,
      });

      expect(exitCode).toBe(0);

      // Verify provider input is clean
      expect(receivedDiff).not.toBeNull();
      const diffContent = receivedDiff!.content;
      expect(diffContent).not.toContain(FAKE_AWS_KEY);
      expect(diffContent).not.toContain(FAKE_GH_PAT);
      expect(diffContent).not.toContain("-----BEGIN OPENSSH PRIVATE KEY-----");
      expect(diffContent).toContain("[content withheld by path policy: .env]");
      expect(diffContent).toContain("[content withheld by path policy: id_rsa]");

      // Verify stdout and stderr are clean
      const stdout = getStdout();
      const stderr = getStderr();
      expect(stdout).not.toContain(FAKE_AWS_KEY);
      expect(stdout).not.toContain(FAKE_GH_PAT);
      expect(stderr).not.toContain(FAKE_AWS_KEY);
      expect(stderr).not.toContain(FAKE_GH_PAT);

      // Dry run created no commits
      const commitCheck = await repo.runGit(["rev-parse", "HEAD"]);
      expect(commitCheck.exitCode).not.toBe(0);
    } finally {
      await repo.cleanup();
    }
  });
});
