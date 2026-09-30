import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DefaultGitClient } from "../../src/git/git-client.js";
import { createTempDir, createTempRepo } from "../helpers/temp-repo.js";

describe("Git read layer integration (DefaultGitClient on real temp repos)", () => {
  test("plain temp directory throws friendly 'Not inside a Git repository' error", async () => {
    const plainDir = await createTempDir();
    try {
      const client = new DefaultGitClient(plainDir.path);
      await expect(client.getRepoRoot()).rejects.toThrow("Not inside a Git repository");
    } finally {
      await plainDir.cleanup();
    }
  });

  test("empty repository with no staged changes returns empty files", async () => {
    const repo = await createTempRepo();
    try {
      const client = new DefaultGitClient(repo.path);
      const result = await client.getStagedChanges();

      expect(result.files).toHaveLength(0);
      expect(result.summary.totalFiles).toBe(0);
      expect(result.summary.additions).toBe(0);
      expect(result.summary.deletions).toBe(0);
    } finally {
      await repo.cleanup();
    }
  });

  test("staged added file", async () => {
    const repo = await createTempRepo();
    try {
      const filePath = join(repo.path, "new-file.txt");
      await writeFile(filePath, "line 1\nline 2\nline 3\n");
      await repo.runGit(["add", "new-file.txt"]);

      const client = new DefaultGitClient(repo.path);
      const result = await client.getStagedChanges();

      expect(result.files).toHaveLength(1);
      const file = result.files[0]!;
      expect(file.status).toBe("added");
      expect(file.path).toBe("new-file.txt");
      expect(file.additions).toBe(3);
      expect(file.deletions).toBe(0);
      expect(file.isBinary).toBe(false);
      expect(file.hasTextDiff).toBe(true);
    } finally {
      await repo.cleanup();
    }
  });

  test("staged modified and deleted files", async () => {
    const repo = await createTempRepo();
    try {
      // Base setup
      await writeFile(join(repo.path, "mod.txt"), "original line\n");
      await writeFile(join(repo.path, "del.txt"), "delete me\n");
      await repo.runGit(["add", "mod.txt", "del.txt"]);
      await repo.runGit(["commit", "-m", "initial commit"]);

      // Modify and delete
      await writeFile(join(repo.path, "mod.txt"), "original line\nnew second line\n");
      await unlink(join(repo.path, "del.txt"));
      await repo.runGit(["add", "mod.txt", "del.txt"]);

      const client = new DefaultGitClient(repo.path);
      const result = await client.getStagedChanges();

      expect(result.files).toHaveLength(2);
      const mod = result.files.find((f) => f.path === "mod.txt");
      const del = result.files.find((f) => f.path === "del.txt");

      expect(mod).toBeDefined();
      expect(mod?.status).toBe("modified");
      expect(mod?.additions).toBe(1);
      expect(mod?.deletions).toBe(0);

      expect(del).toBeDefined();
      expect(del?.status).toBe("deleted");
      expect(del?.deletions).toBe(1);
    } finally {
      await repo.cleanup();
    }
  });

  test("staged renamed file with large body to trigger rename detection", async () => {
    const repo = await createTempRepo();
    try {
      const content = Array.from({ length: 30 }, (_, i) => `line content number ${i}\n`).join("");
      await writeFile(join(repo.path, "source-file.txt"), content);
      await repo.runGit(["add", "source-file.txt"]);
      await repo.runGit(["commit", "-m", "add source file"]);

      // Rename
      await repo.runGit(["mv", "source-file.txt", "renamed-target.txt"]);

      const client = new DefaultGitClient(repo.path);
      const result = await client.getStagedChanges();

      expect(result.files).toHaveLength(1);
      const file = result.files[0]!;
      expect(file.status).toBe("renamed");
      expect(file.previousPath).toBe("source-file.txt");
      expect(file.path).toBe("renamed-target.txt");
      expect(file.isBinary).toBe(false);
      // Pure rename has 0 additions and 0 deletions
      expect(file.hasTextDiff).toBe(false);
    } finally {
      await repo.cleanup();
    }
  });

  test("staged binary file, spaces in filename, and Unicode filename", async () => {
    const repo = await createTempRepo();
    try {
      // Binary file (contains null bytes)
      const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      await writeFile(join(repo.path, "image.png"), binaryData);

      // Filename with spaces
      await writeFile(join(repo.path, "file with spaces.txt"), "space content\n");

      // Unicode filename
      await writeFile(join(repo.path, "документ-測試.txt"), "unicode content\n");

      await repo.runGit(["add", "image.png", "file with spaces.txt", "документ-測試.txt"]);

      const client = new DefaultGitClient(repo.path);
      const result = await client.getStagedChanges();

      expect(result.files).toHaveLength(3);

      const binaryFile = result.files.find((f) => f.path === "image.png");
      const spaceFile = result.files.find((f) => f.path === "file with spaces.txt");
      const unicodeFile = result.files.find((f) => f.path === "документ-測試.txt");

      expect(binaryFile).toBeDefined();
      expect(binaryFile?.isBinary).toBe(true);
      expect(binaryFile?.additions).toBeNull();
      expect(binaryFile?.deletions).toBeNull();
      expect(binaryFile?.hasTextDiff).toBe(false);

      expect(spaceFile).toBeDefined();
      expect(spaceFile?.path).toBe("file with spaces.txt");

      expect(unicodeFile).toBeDefined();
      expect(unicodeFile?.path).toBe("документ-測試.txt");
    } finally {
      await repo.cleanup();
    }
  });
});
