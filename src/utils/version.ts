import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VibeCommitError } from "./errors.js";

export function getVersion(): string {
  const candidateUrls = [
    new URL("../../package.json", import.meta.url),
    new URL("../package.json", import.meta.url),
  ];

  let rawContent: string | undefined;

  for (const candidateUrl of candidateUrls) {
    const filePath = fileURLToPath(candidateUrl);
    if (existsSync(filePath)) {
      try {
        rawContent = readFileSync(filePath, "utf-8");
        break;
      } catch (cause) {
        throw new VibeCommitError("Failed to read package.json", { cause });
      }
    }
  }

  if (rawContent === undefined) {
    throw new VibeCommitError("Unable to locate package.json");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (cause) {
    throw new VibeCommitError("Failed to parse package.json as JSON", { cause });
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    typeof parsed.version !== "string" ||
    parsed.version.trim().length === 0
  ) {
    throw new VibeCommitError("Invalid or missing version in package.json");
  }

  return parsed.version;
}
