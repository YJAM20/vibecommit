export type PathCategory =
  "lockfile" | "generated" | "test" | "docs" | "config" | "source" | "other";

/**
 * Category precedence table (first match wins):
 * 1. lockfile   : Package manager lockfiles (package-lock.json, yarn.lock, etc.)
 * 2. generated  : Build artifacts, dist/, coverage/, minified files, sourcemaps
 * 3. test       : Test directories (tests/, __tests__/) and test files (*.test.*)
 * 4. docs       : Documentation files (README, docs/, .md, .txt)
 * 5. config     : Project configurations (.github/, tsconfig, eslint, etc.)
 * 6. source     : Programming language source code files (.ts, .js, .py, etc.)
 * 7. other      : Uncategorized files
 */

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "cargo.lock",
  "poetry.lock",
  "pipfile.lock",
  "gemfile.lock",
  "composer.lock",
  "go.sum",
]);

const GENERATED_DIR_REGEX = /(?:^|\/)(dist|build|coverage|out|\.next|node_modules|vendor)\//i;
const TEST_DIR_REGEX = /(?:^|\/)(tests|test|__tests__|spec)\//i;
const TEST_FILE_REGEX = /\.(test|spec)\.[^.]+$/i;
const DOCS_DIR_REGEX = /(?:^|\/)docs\//i;
const DOCS_EXT_REGEX = /\.(md|mdx|rst|txt)$/i;
const GITHUB_DIR_REGEX = /(?:^|\/)\.github\//i;
const ROOT_CONFIG_EXT_REGEX = /\.(json|ya?ml|toml)$/i;

const SOURCE_EXT_REGEX =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|java|kt|go|rs|c|h|cpp|cs|rb|php|swift|sh|css|scss|html|sql)$/i;

export function classifyPath(rawPath: string): PathCategory {
  const normalized = rawPath.replace(/\\/g, "/");
  const filename = normalized.split("/").pop() ?? "";
  const lowerPath = normalized.toLowerCase();
  const lowerFilename = filename.toLowerCase();

  // 1. Lockfile
  if (LOCKFILES.has(lowerFilename)) {
    return "lockfile";
  }

  // 2. Generated
  if (
    GENERATED_DIR_REGEX.test(lowerPath) ||
    lowerFilename.endsWith(".min.js") ||
    lowerFilename.endsWith(".min.css") ||
    lowerFilename.endsWith(".map")
  ) {
    return "generated";
  }

  // 3. Test
  if (TEST_DIR_REGEX.test(lowerPath) || TEST_FILE_REGEX.test(lowerFilename)) {
    return "test";
  }

  // 4. Docs
  if (
    lowerFilename.startsWith("readme") ||
    lowerFilename.startsWith("changelog") ||
    lowerFilename.startsWith("license") ||
    lowerFilename.startsWith("contributing") ||
    DOCS_DIR_REGEX.test(lowerPath) ||
    DOCS_EXT_REGEX.test(lowerFilename)
  ) {
    return "docs";
  }

  // 5. Config
  if (
    lowerFilename === "package.json" ||
    (lowerFilename.startsWith("tsconfig") && lowerFilename.endsWith(".json")) ||
    lowerFilename.startsWith("eslint.config.") ||
    lowerFilename.startsWith(".eslintrc") ||
    lowerFilename.startsWith(".prettierrc") ||
    lowerFilename === ".prettierignore" ||
    lowerFilename === ".gitignore" ||
    lowerFilename === ".gitattributes" ||
    lowerFilename === ".editorconfig" ||
    lowerFilename === ".env.example" ||
    lowerFilename === "dockerfile" ||
    lowerFilename.startsWith("dockerfile.") ||
    lowerFilename.startsWith("docker-compose") ||
    lowerFilename.startsWith("vitest.config.") ||
    lowerFilename.startsWith("vite.config.") ||
    GITHUB_DIR_REGEX.test(lowerPath) ||
    (!normalized.includes("/") && ROOT_CONFIG_EXT_REGEX.test(lowerFilename))
  ) {
    return "config";
  }

  // 6. Source
  if (SOURCE_EXT_REGEX.test(lowerFilename)) {
    return "source";
  }

  // 7. Other
  return "other";
}

export function isContentCollapsedCategory(category: PathCategory): boolean {
  return category === "lockfile" || category === "generated";
}
