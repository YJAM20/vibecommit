import { describe, expect, test } from "vitest";
import { evaluatePathPolicy, normalizePath } from "../../src/security/policy.js";

describe("Path-based Content Policy Unit Tests", () => {
  describe("Path normalization", () => {
    test("normalizes Windows backslashes to forward slashes", () => {
      expect(normalizePath("config\\secrets\\.env")).toBe("config/secrets/.env");
    });

    test("removes leading ./ prefix and whitespace", () => {
      expect(normalizePath("  ./src/app.ts  ")).toBe("src/app.ts");
    });
  });

  describe("High-risk secret-bearing paths (metadata-only)", () => {
    const highRiskPaths = [
      ".env",
      ".env.local",
      ".env.production",
      ".env.staging",
      ".env.test",
      "config/.env",
      "backend/services/.env.production",
      "secrets/private.pem",
      "certs/service.key",
      "certs/bundle.pkcs12",
      "certs/identity.pfx",
      "id_rsa",
      "id_rsa.backup",
      "id_ed25519",
      "id_dsa",
      "id_ecdsa",
      ".ssh/id_rsa_custom",
      ".gnupg/secring.gpg",
      ".bash_history",
      ".zsh_history",
      "passwords.kdbx",
      "credentials.json",
      "service-account.json",
      "service-account-prod.json",
      "service_account_credentials.json",
    ];

    for (const path of highRiskPaths) {
      test(`withholds ${path} as metadata-only`, () => {
        const decision = evaluatePathPolicy({ path });
        expect(decision.handling).toBe("metadata-only");
        expect(decision.category).toBe("secret-path");
      });
    }

    test("does not classify .pub public-key files as secret-bearing", () => {
      expect(evaluatePathPolicy({ path: "id_rsa.pub" }).handling).not.toBe("metadata-only");
      expect(evaluatePathPolicy({ path: ".ssh/id_rsa.pub" }).handling).not.toBe("metadata-only");
    });

    test("evaluates Windows-style path with backslashes as high-risk", () => {
      const decision = evaluatePathPolicy({ path: "config\\.env" });
      expect(decision.handling).toBe("metadata-only");
      expect(decision.category).toBe("secret-path");
    });

    test("withholds deleted high-risk file as metadata-only", () => {
      const decision = evaluatePathPolicy({ path: ".env" });
      expect(decision.handling).toBe("metadata-only");
    });

    test("withholds rename from high-risk to normal path as metadata-only", () => {
      const decision = evaluatePathPolicy({
        path: "src/safe.ts",
        previousPath: ".env",
      });
      expect(decision.handling).toBe("metadata-only");
      expect(decision.reason).toContain("previous path");
    });

    test("withholds rename from normal to high-risk path as metadata-only", () => {
      const decision = evaluatePathPolicy({
        path: ".env",
        previousPath: "src/safe.ts",
      });
      expect(decision.handling).toBe("metadata-only");
    });
  });

  describe("Binary files (metadata-only)", () => {
    test("withholds explicitly marked binary file", () => {
      const decision = evaluatePathPolicy({ path: "data/file.bin", isBinary: true });
      expect(decision.handling).toBe("metadata-only");
      expect(decision.category).toBe("binary");
    });

    test("withholds image files by extension", () => {
      expect(evaluatePathPolicy({ path: "assets/logo.png" }).handling).toBe("metadata-only");
      expect(evaluatePathPolicy({ path: "assets/photo.jpg" }).handling).toBe("metadata-only");
      expect(evaluatePathPolicy({ path: "assets/favicon.ico" }).handling).toBe("metadata-only");
    });

    test("withholds archives and compiled binaries by extension", () => {
      expect(evaluatePathPolicy({ path: "bundle.zip" }).handling).toBe("metadata-only");
      expect(evaluatePathPolicy({ path: "app.exe" }).handling).toBe("metadata-only");
      expect(evaluatePathPolicy({ path: "lib.so" }).handling).toBe("metadata-only");
    });
  });

  describe("Dependency lockfiles (summary-only)", () => {
    const lockfiles = [
      "package-lock.json",
      "npm-shrinkwrap.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "bun.lockb",
      "Cargo.lock",
      "poetry.lock",
      "composer.lock",
      "go.sum",
    ];

    for (const lockfile of lockfiles) {
      test(`summarizes ${lockfile} as summary-only`, () => {
        const decision = evaluatePathPolicy({ path: lockfile });
        expect(decision.handling).toBe("summary-only");
        expect(decision.category).toBe("lockfile");
      });
    }
  });

  describe("Generated and minified files (summary-only)", () => {
    const generated = [
      "dist/bundle.js",
      "build/app.js",
      "coverage/lcov.info",
      "src/vendor/lib.js",
      "assets/style.min.css",
      "scripts/main.min.js",
      "dist/main.js.map",
      "out/bundle.js",
    ];

    for (const path of generated) {
      test(`summarizes generated path ${path} as summary-only`, () => {
        const decision = evaluatePathPolicy({ path });
        expect(decision.handling).toBe("summary-only");
        expect(decision.category).toBe("generated");
      });
    }
  });

  describe("Normal permitted text files (include)", () => {
    test("permits normal source code files", () => {
      expect(evaluatePathPolicy({ path: "src/index.ts" }).handling).toBe("include");
      expect(evaluatePathPolicy({ path: "src/components/App.tsx" }).handling).toBe("include");
      expect(evaluatePathPolicy({ path: "lib/util.py" }).handling).toBe("include");
      expect(evaluatePathPolicy({ path: "cmd/main.go" }).handling).toBe("include");
    });

    test("permits normal documentation files", () => {
      expect(evaluatePathPolicy({ path: "README.md" }).handling).toBe("include");
      expect(evaluatePathPolicy({ path: "docs/architecture.md" }).handling).toBe("include");
      expect(evaluatePathPolicy({ path: "LICENSE" }).handling).toBe("include");
    });

    test("permits normal test files", () => {
      expect(evaluatePathPolicy({ path: "tests/unit/app.test.ts" }).handling).toBe("include");
      expect(evaluatePathPolicy({ path: "src/__tests__/util.spec.js" }).handling).toBe("include");
    });

    test("permits normal configuration files", () => {
      expect(evaluatePathPolicy({ path: "package.json" }).handling).toBe("include");
      expect(evaluatePathPolicy({ path: "tsconfig.json" }).handling).toBe("include");
      expect(evaluatePathPolicy({ path: ".gitignore" }).handling).toBe("include");
      expect(evaluatePathPolicy({ path: "Dockerfile" }).handling).toBe("include");
    });

    test("handles filenames with spaces and Unicode characters safely", () => {
      expect(evaluatePathPolicy({ path: "src/my safe file.ts" }).handling).toBe("include");
      expect(evaluatePathPolicy({ path: "docs/über uns.md" }).handling).toBe("include");
    });
  });

  describe("Unrecognized files (conservative summary-only default)", () => {
    test("summarizes unknown extensions conservatively", () => {
      const decision = evaluatePathPolicy({ path: "data/records.unknown" });
      expect(decision.handling).toBe("summary-only");
      expect(decision.category).toBe("unknown");
    });

    test("summarizes files with unrecognized extensions", () => {
      const decision = evaluatePathPolicy({ path: "custom.xyz" });
      expect(decision.handling).toBe("summary-only");
      expect(decision.category).toBe("unknown");
    });
  });
});
