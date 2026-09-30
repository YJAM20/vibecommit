export const COMMIT_TYPES = [
  "feat",
  "fix",
  "docs",
  "refactor",
  "test",
  "chore",
  "security",
] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];
