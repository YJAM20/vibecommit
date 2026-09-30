import type { FileChangeStatus } from "../domain/staged-change.js";
import { VibeCommitError } from "../utils/errors.js";

export interface ParsedStatusItem {
  readonly status: FileChangeStatus;
  readonly path: string;
  readonly previousPath?: string;
}

export function parseStatusOutput(output: string): ParsedStatusItem[] {
  if (output.length === 0) {
    return [];
  }

  if (!output.endsWith("\0")) {
    throw new VibeCommitError("Malformed git status output: missing trailing NUL byte");
  }

  const tokens = output.slice(0, -1).split("\0");
  const items: ParsedStatusItem[] = [];
  let i = 0;

  while (i < tokens.length) {
    const rawStatus = tokens[i];
    if (rawStatus === undefined || rawStatus.length === 0) {
      throw new VibeCommitError("Malformed git status output: empty status token");
    }

    const statusCode = rawStatus[0];
    const isRenameOrCopy = statusCode === "R" || statusCode === "C";

    if (isRenameOrCopy) {
      const oldPath = tokens[i + 1];
      const newPath = tokens[i + 2];
      if (oldPath === undefined || newPath === undefined) {
        throw new VibeCommitError(
          `Malformed git status output: incomplete rename record for ${rawStatus}`,
        );
      }
      const status: FileChangeStatus = statusCode === "R" ? "renamed" : "copied";
      items.push({
        status,
        path: newPath,
        previousPath: oldPath,
      });
      i += 3;
    } else {
      const path = tokens[i + 1];
      if (path === undefined) {
        throw new VibeCommitError(
          `Malformed git status output: incomplete record for ${rawStatus}`,
        );
      }
      let status: FileChangeStatus;
      switch (statusCode) {
        case "A":
          status = "added";
          break;
        case "M":
          status = "modified";
          break;
        case "D":
          status = "deleted";
          break;
        case "T":
          status = "modified";
          break;
        default:
          throw new VibeCommitError(`Unknown git status code: ${rawStatus}`);
      }
      items.push({ status, path });
      i += 2;
    }
  }

  return items;
}
