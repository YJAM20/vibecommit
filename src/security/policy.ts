import type { PathPolicyDecision } from "./types.js";

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

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "tiff",
  "tif",
  "pdf",
  "zip",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "iso",
  "o",
  "a",
  "lib",
  "class",
  "pyc",
  "wasm",
  "mp3",
  "wav",
  "ogg",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "otf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
]);

const SOURCE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "java",
  "kt",
  "go",
  "rs",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "rb",
  "php",
  "swift",
  "sh",
  "bash",
  "zsh",
  "css",
  "scss",
  "sass",
  "less",
  "html",
  "sql",
  "vue",
  "svelte",
]);

const DOCS_EXTENSIONS = new Set(["md", "mdx", "rst", "txt", "adoc"]);

const CONFIG_EXTENSIONS = new Set([
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "csv",
  "graphql",
  "gql",
  "proto",
  "ini",
  "cfg",
  "conf",
]);

const GENERATED_DIR_REGEX = /(?:^|\/)(dist|build|coverage|out|\.next|node_modules|vendor)\//i;
const TEST_DIR_REGEX = /(?:^|\/)(tests|test|__tests__|spec)\//i;
const TEST_FILE_REGEX = /\.(test|spec)\.[^.]+$/i;
const DOCS_DIR_REGEX = /(?:^|\/)docs\//i;

export function normalizePath(rawPath: string): string {
  return rawPath.trim().replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function getFilename(normalizedPath: string): string {
  return normalizedPath.split("/").pop() ?? "";
}

function getExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? (parts.pop()?.toLowerCase() ?? "") : "";
}

export function isHighRiskSecretPath(normalizedPath: string): boolean {
  const lowerPath = normalizedPath.toLowerCase();
  const filename = getFilename(lowerPath);

  // Do not classify .pub public-key files as secret-bearing
  if (filename.endsWith(".pub")) {
    return false;
  }

  // .env or .env.* (e.g. .env, .env.local, .env.production, nested config/.env)
  if (filename === ".env" || filename.startsWith(".env.")) {
    return true;
  }

  // Private key and certificate extensions
  if (
    filename.endsWith(".pem") ||
    filename.endsWith(".key") ||
    filename.endsWith(".pkcs12") ||
    filename.endsWith(".pfx")
  ) {
    return true;
  }

  // SSH / Cryptographic private key files
  if (
    filename === "id_rsa" ||
    filename.startsWith("id_rsa.") ||
    filename === "id_dsa" ||
    filename.startsWith("id_dsa.") ||
    filename === "id_ed25519" ||
    filename.startsWith("id_ed25519.") ||
    filename === "id_ecdsa" ||
    filename.startsWith("id_ecdsa.")
  ) {
    return true;
  }

  // SSH / GPG directory files
  if (
    lowerPath.includes("/.ssh/") ||
    lowerPath.startsWith(".ssh/") ||
    lowerPath.includes("/.gnupg/") ||
    lowerPath.startsWith(".gnupg/")
  ) {
    return true;
  }

  // Shell history files
  if (filename.endsWith("_history")) {
    return true;
  }

  // KeePass password database
  if (filename.endsWith(".kdbx")) {
    return true;
  }

  // Known credentials / service account JSON files
  if (filename === "credentials.json" || /^service[-_]account.*\.json$/.test(filename)) {
    return true;
  }

  return false;
}

export function evaluatePathPolicy(file: {
  readonly path: string;
  readonly previousPath?: string;
  readonly isBinary?: boolean;
}): PathPolicyDecision {
  const normalizedPath = normalizePath(file.path);
  const normalizedPrevPath = file.previousPath ? normalizePath(file.previousPath) : undefined;

  // 1. High-risk secret-bearing paths (checked for current and previous path)
  if (isHighRiskSecretPath(normalizedPath)) {
    return {
      handling: "metadata-only",
      reason: "High-risk secret-bearing path withheld by policy",
      category: "secret-path",
    };
  }

  if (normalizedPrevPath !== undefined && isHighRiskSecretPath(normalizedPrevPath)) {
    return {
      handling: "metadata-only",
      reason: "High-risk secret-bearing previous path withheld by policy",
      category: "secret-path",
    };
  }

  // 2. Binary files
  const filename = getFilename(normalizedPath).toLowerCase();
  const ext = getExtension(filename);

  if (file.isBinary === true || BINARY_EXTENSIONS.has(ext)) {
    return {
      handling: "metadata-only",
      reason: "Binary file withheld by policy",
      category: "binary",
    };
  }

  // 3. Dependency lockfiles
  if (LOCKFILES.has(filename)) {
    return {
      handling: "summary-only",
      reason: "Dependency lockfile summarized by policy",
      category: "lockfile",
    };
  }

  // 4. Generated and minified files
  if (
    GENERATED_DIR_REGEX.test(normalizedPath) ||
    filename.endsWith(".min.js") ||
    filename.endsWith(".min.css") ||
    filename.endsWith(".map") ||
    filename.endsWith(".bundle.js") ||
    filename.endsWith(".bundle.css")
  ) {
    return {
      handling: "summary-only",
      reason: "Generated or minified file summarized by policy",
      category: "generated",
    };
  }

  // 5. Test files
  if (TEST_DIR_REGEX.test(normalizedPath) || TEST_FILE_REGEX.test(filename)) {
    return {
      handling: "include",
      reason: "Permitted test file content",
      category: "test",
    };
  }

  // 6. Documentation files
  if (
    DOCS_DIR_REGEX.test(normalizedPath) ||
    DOCS_EXTENSIONS.has(ext) ||
    filename.startsWith("readme") ||
    filename.startsWith("license") ||
    filename.startsWith("changelog") ||
    filename.startsWith("contributing") ||
    filename.startsWith("code_of_conduct") ||
    filename.startsWith("notice")
  ) {
    return {
      handling: "include",
      reason: "Permitted documentation content",
      category: "docs",
    };
  }

  // 7. Source code files
  if (SOURCE_EXTENSIONS.has(ext)) {
    return {
      handling: "include",
      reason: "Permitted source code content",
      category: "source",
    };
  }

  // 8. Configuration files
  if (
    CONFIG_EXTENSIONS.has(ext) ||
    filename === "dockerfile" ||
    filename.startsWith("dockerfile.") ||
    filename.startsWith("docker-compose") ||
    filename === "makefile" ||
    filename === ".gitignore" ||
    filename === ".gitattributes" ||
    filename === ".editorconfig" ||
    filename.startsWith(".prettier") ||
    filename.startsWith(".eslint") ||
    filename.startsWith("tsconfig")
  ) {
    return {
      handling: "include",
      reason: "Permitted configuration content",
      category: "config",
    };
  }

  // 9. Unrecognized / Unknown files: conservative summary-only default
  return {
    handling: "summary-only",
    reason: "Unrecognized file type summarized by policy",
    category: "unknown",
  };
}
