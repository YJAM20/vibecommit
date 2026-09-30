import { execa } from "execa";
import type {
  FileChangeStatus,
  StagedChangesResult,
  StagedChangesSummary,
  StagedFileChange,
} from "../domain/staged-change.js";
import { VibeCommitError } from "../utils/errors.js";
import { parseNumstatOutput, reconcileStagedChanges } from "./parse-numstat.js";
import { parseStatusOutput } from "./parse-status.js";

export interface GitRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type GitRunner = (
  args: readonly string[],
  options: {
    cwd: string;
    env: Record<string, string | undefined>;
    maxBuffer?: number;
  },
) => Promise<GitRunResult>;

export const defaultGitRunner: GitRunner = async (args, options) => {
  const result = await execa("git", [...args], {
    cwd: options.cwd,
    env: options.env,
    maxBuffer: options.maxBuffer,
    reject: false,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 0,
  };
};

export interface GitClient {
  checkGitInstalled(): Promise<void>;
  getRepoRoot(): Promise<string>;
  getStagedDiff(): Promise<string>;
  getStagedChanges(): Promise<StagedChangesResult>;
}

export class DefaultGitClient implements GitClient {
  private readonly cwd: string;
  private readonly runner: GitRunner;
  private readonly diffMaxBuffer = 50 * 1024 * 1024; // 50MB safety limit

  constructor(cwd: string = process.cwd(), runner: GitRunner = defaultGitRunner) {
    this.cwd = cwd;
    this.runner = runner;
  }

  private getSanitizedEnv(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env };
    delete env["GIT_DIR"];
    delete env["GIT_WORK_TREE"];
    delete env["GIT_INDEX_FILE"];
    env["LC_ALL"] = "C";
    return env;
  }

  private async runGit(args: readonly string[], maxBuffer?: number): Promise<GitRunResult> {
    try {
      const result = await this.runner(args, {
        cwd: this.cwd,
        env: this.getSanitizedEnv(),
        maxBuffer,
      });

      return result;
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null) {
        const err = error as { code?: string; message?: string };
        if (err.code === "ENOENT") {
          throw new VibeCommitError("Git is not installed or not found in PATH", {
            hint: "Please install Git and ensure it is available in your PATH environment variable.",
            cause: error,
          });
        }
        if (
          err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
          (err.message !== undefined && err.message.includes("maxBuffer"))
        ) {
          throw new VibeCommitError("Git diff output exceeded maximum buffer limit", {
            hint: "Stage fewer or smaller files before running vibecommit.",
            cause: error,
          });
        }
      }
      throw new VibeCommitError("Failed to execute Git command", { cause: error });
    }
  }

  async checkGitInstalled(): Promise<void> {
    const result = await this.runGit(["--version"]);
    if (result.exitCode !== 0) {
      const firstLine = result.stderr.split(/\r?\n/)[0]?.trim() ?? "";
      throw new VibeCommitError(
        `Git executable check failed${firstLine.length > 0 ? `: ${firstLine}` : ""}`,
        {
          hint: "Please install Git and ensure it is available in your PATH environment variable.",
        },
      );
    }
  }

  async getRepoRoot(): Promise<string> {
    const result = await this.runGit(["rev-parse", "--show-toplevel"]);
    if (result.exitCode !== 0) {
      const firstLine = result.stderr.split(/\r?\n/)[0]?.trim() ?? "";
      if (firstLine.toLowerCase().includes("not a git repository")) {
        throw new VibeCommitError("Not inside a Git repository", {
          hint: "Run vibecommit inside a Git repository or initialize one with 'git init'.",
        });
      }
      throw new VibeCommitError(
        `Git repository check failed: ${firstLine.length > 0 ? firstLine : "Unknown error"}`,
        {
          hint: "Ensure current working directory is a valid Git repository with proper permissions.",
        },
      );
    }

    const root = result.stdout.trim();
    if (root.length === 0) {
      throw new VibeCommitError("Git returned an empty repository root path");
    }
    return root;
  }

  async getStagedDiff(): Promise<string> {
    const result = await this.runGit(
      ["diff", "--staged", "--no-color", "--no-ext-diff", "-M"],
      this.diffMaxBuffer,
    );

    if (result.exitCode !== 0) {
      const firstLine = result.stderr.split(/\r?\n/)[0]?.trim() ?? "";
      throw new VibeCommitError(
        `Failed to read staged diff${firstLine.length > 0 ? `: ${firstLine}` : ""}`,
      );
    }

    return result.stdout;
  }

  async getStagedChanges(): Promise<StagedChangesResult> {
    const repoRoot = await this.getRepoRoot();

    const statusResult = await this.runGit(["diff", "--staged", "--name-status", "-z", "-M"]);
    if (statusResult.exitCode !== 0) {
      const firstLine = statusResult.stderr.split(/\r?\n/)[0]?.trim() ?? "";
      throw new VibeCommitError(
        `Failed to inspect staged status${firstLine.length > 0 ? `: ${firstLine}` : ""}`,
      );
    }

    const numstatResult = await this.runGit(["diff", "--staged", "--numstat", "-z", "-M"]);
    if (numstatResult.exitCode !== 0) {
      const firstLine = numstatResult.stderr.split(/\r?\n/)[0]?.trim() ?? "";
      throw new VibeCommitError(
        `Failed to inspect staged numstat${firstLine.length > 0 ? `: ${firstLine}` : ""}`,
      );
    }

    const statusItems = parseStatusOutput(statusResult.stdout);
    const numstatItems = parseNumstatOutput(numstatResult.stdout);

    if (statusItems.length === 0) {
      const summary: StagedChangesSummary = {
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
      };
      return {
        repoRoot,
        files: [],
        summary,
        diffText: "",
      };
    }

    const diffText = await this.getStagedDiff();
    const files: StagedFileChange[] = reconcileStagedChanges(statusItems, numstatItems);

    let totalAdditions = 0;
    let totalDeletions = 0;
    const statusCounts: Record<FileChangeStatus, number> = {
      added: 0,
      modified: 0,
      deleted: 0,
      renamed: 0,
      copied: 0,
    };

    for (const file of files) {
      statusCounts[file.status] += 1;
      if (file.additions !== null) {
        totalAdditions += file.additions;
      }
      if (file.deletions !== null) {
        totalDeletions += file.deletions;
      }
    }

    const summary: StagedChangesSummary = {
      totalFiles: files.length,
      additions: totalAdditions,
      deletions: totalDeletions,
      statusCounts,
    };

    return {
      repoRoot,
      files,
      summary,
      diffText,
    };
  }
}
