export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied";

export interface StagedFileChange {
  readonly status: FileChangeStatus;
  readonly path: string;
  readonly previousPath?: string;
  readonly isBinary: boolean;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly hasTextDiff: boolean;
}

export interface StagedChangesSummary {
  readonly totalFiles: number;
  readonly additions: number;
  readonly deletions: number;
  readonly statusCounts: Readonly<Record<FileChangeStatus, number>>;
}

export interface StagedChangesResult {
  readonly repoRoot: string;
  readonly files: readonly StagedFileChange[];
  readonly summary: StagedChangesSummary;
  readonly diffText: string;
}
