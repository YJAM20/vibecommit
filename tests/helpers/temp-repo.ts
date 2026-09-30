import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

export interface TempRepo {
  readonly path: string;
  runGit(args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  cleanup(): Promise<void>;
}

export async function createTempDir(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const baseTemp = await realpath(tmpdir());
  const dir = await mkdtemp(join(baseTemp, "vibecommit-plain-"));
  return {
    path: dir,
    cleanup: async () => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup on Windows
      }
    },
  };
}

export async function createTempRepo(): Promise<TempRepo> {
  const baseTemp = await realpath(tmpdir());
  const repoDir = await mkdtemp(join(baseTemp, "vibecommit-test-"));
  const emptyGlobalConfig = join(repoDir, ".empty-gitconfig");
  await writeFile(emptyGlobalConfig, "");

  const isolatedEnv: Record<string, string | undefined> = {
    ...process.env,
    GIT_CONFIG_GLOBAL: emptyGlobalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    LC_ALL: "C",
  };
  delete isolatedEnv["GIT_DIR"];
  delete isolatedEnv["GIT_WORK_TREE"];
  delete isolatedEnv["GIT_INDEX_FILE"];

  const runGit = async (args: readonly string[]) => {
    const result = await execa("git", [...args], {
      cwd: repoDir,
      env: isolatedEnv,
      reject: false,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 0,
    };
  };

  // Initialize repo and configure isolation locally inside temp repo only
  await runGit(["init"]);
  await runGit(["config", "user.name", "Test User"]);
  await runGit(["config", "user.email", "test@example.com"]);
  await runGit(["config", "commit.gpgsign", "false"]);
  await runGit(["config", "core.autocrlf", "false"]);

  const cleanup = async () => {
    try {
      await rm(repoDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup on Windows
    }
  };

  return {
    path: repoDir,
    runGit,
    cleanup,
  };
}
