import type { StagedFileChange } from "../domain/staged-change.js";
import { VibeCommitError } from "../utils/errors.js";
import type { ParsedStatusItem } from "./parse-status.js";

export interface ParsedNumstatItem {
  readonly path: string;
  readonly previousPath?: string;
  readonly isBinary: boolean;
  readonly additions: number | null;
  readonly deletions: number | null;
}

export function parseNumstatOutput(output: string): ParsedNumstatItem[] {
  if (output.length === 0) {
    return [];
  }

  if (!output.endsWith("\0")) {
    throw new VibeCommitError("Malformed git numstat output: missing trailing NUL byte");
  }

  const tokens = output.slice(0, -1).split("\0");
  const items: ParsedNumstatItem[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    if (token === undefined) {
      break;
    }

    const firstTab = token.indexOf("\t");
    if (firstTab === -1) {
      throw new VibeCommitError("Malformed git numstat output: missing first tab separator");
    }

    const secondTab = token.indexOf("\t", firstTab + 1);
    if (secondTab === -1) {
      throw new VibeCommitError("Malformed git numstat output: missing second tab separator");
    }

    const addedStr = token.slice(0, firstTab);
    const deletedStr = token.slice(firstTab + 1, secondTab);
    const pathField = token.slice(secondTab + 1);

    const isBinary = addedStr === "-" && deletedStr === "-";
    let additions: number | null = null;
    let deletions: number | null = null;

    if (!isBinary) {
      const parsedAdd = parseInt(addedStr, 10);
      const parsedDel = parseInt(deletedStr, 10);
      if (Number.isNaN(parsedAdd) || Number.isNaN(parsedDel)) {
        throw new VibeCommitError(
          `Malformed git numstat output: invalid counts '${addedStr}', '${deletedStr}'`,
        );
      }
      additions = parsedAdd;
      deletions = parsedDel;
    }

    if (pathField === "") {
      const oldPath = tokens[i + 1];
      const newPath = tokens[i + 2];
      if (oldPath === undefined || newPath === undefined) {
        throw new VibeCommitError("Malformed git numstat output: incomplete rename paths");
      }
      items.push({
        path: newPath,
        previousPath: oldPath,
        isBinary,
        additions,
        deletions,
      });
      i += 3;
    } else {
      items.push({
        path: pathField,
        isBinary,
        additions,
        deletions,
      });
      i += 1;
    }
  }

  return items;
}

export function reconcileStagedChanges(
  statusItems: readonly ParsedStatusItem[],
  numstatItems: readonly ParsedNumstatItem[],
): StagedFileChange[] {
  if (statusItems.length !== numstatItems.length) {
    throw new VibeCommitError(
      `Failed to reconcile git status (${statusItems.length} files) and numstat (${numstatItems.length} files): count mismatch`,
    );
  }

  const numstatMap = new Map<string, ParsedNumstatItem>();
  for (const item of numstatItems) {
    if (numstatMap.has(item.path)) {
      throw new VibeCommitError(
        `Failed to reconcile git status and numstat: duplicate path '${item.path}' in numstat`,
      );
    }
    numstatMap.set(item.path, item);
  }

  const result: StagedFileChange[] = [];
  for (const statusItem of statusItems) {
    const numstatItem = numstatMap.get(statusItem.path);
    if (!numstatItem) {
      throw new VibeCommitError(
        `Failed to reconcile git status and numstat: path '${statusItem.path}' missing from numstat`,
      );
    }

    const isBinary = numstatItem.isBinary;
    const additions = numstatItem.additions;
    const deletions = numstatItem.deletions;
    const hasTextDiff =
      !isBinary && ((additions !== null && additions > 0) || (deletions !== null && deletions > 0));

    result.push({
      status: statusItem.status,
      path: statusItem.path,
      previousPath: statusItem.previousPath ?? numstatItem.previousPath,
      isBinary,
      additions,
      deletions,
      hasTextDiff,
    });
  }

  return result;
}
