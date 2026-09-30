import { describe, expect, test } from "vitest";
import { classifyPath, isContentCollapsedCategory } from "../../src/domain/classify-paths.js";

describe("classifyPath", () => {
  describe("individual categories", () => {
    test("lockfiles", () => {
      const lockfiles = [
        "package-lock.json",
        "npm-shrinkwrap.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "bun.lockb",
        "Cargo.lock",
        "poetry.lock",
        "Pipfile.lock",
        "Gemfile.lock",
        "composer.lock",
        "go.sum",
        "subproject/package-lock.json",
      ];
      for (const p of lockfiles) {
        expect(classifyPath(p)).toBe("lockfile");
      }
    });

    test("generated files", () => {
      const generated = [
        "dist/bundle.js",
        "build/output.css",
        "coverage/lcov.info",
        "out/main.js",
        ".next/server.js",
        "node_modules/package/index.js",
        "vendor/bundle.js",
        "src/app.min.js",
        "styles/theme.min.css",
        "dist/app.js.map",
      ];
      for (const p of generated) {
        expect(classifyPath(p)).toBe("generated");
      }
    });

    test("test files", () => {
      const tests = [
        "tests/unit/cli.test.ts",
        "test/index.spec.js",
        "__tests__/helper.ts",
        "spec/runner.rb",
        "src/domain/foo.test.ts",
        "src/components/bar.spec.tsx",
        "tests/fixtures/data.json",
      ];
      for (const p of tests) {
        expect(classifyPath(p)).toBe("test");
      }
    });

    test("docs", () => {
      const docs = [
        "README.md",
        "README",
        "CHANGELOG.md",
        "LICENSE",
        "CONTRIBUTING.txt",
        "docs/guide.md",
        "docs/architecture.rst",
        "notes.txt",
        "component.mdx",
      ];
      for (const p of docs) {
        expect(classifyPath(p)).toBe("docs");
      }
    });

    test("config files", () => {
      const configs = [
        "package.json",
        "tsconfig.json",
        "tsconfig.build.json",
        "eslint.config.js",
        ".eslintrc.json",
        ".prettierrc",
        ".prettierignore",
        ".gitignore",
        ".gitattributes",
        ".editorconfig",
        ".env.example",
        "Dockerfile",
        "docker-compose.yml",
        "vitest.config.ts",
        "vite.config.js",
        ".github/workflows/ci.yml",
        "settings.json",
        "config.toml",
        "deploy.yaml",
      ];
      for (const p of configs) {
        expect(classifyPath(p)).toBe("config");
      }
    });

    test("source files", () => {
      const sources = [
        "src/index.ts",
        "src/components/Button.tsx",
        "lib/utils.js",
        "server/handler.mjs",
        "scripts/tool.cjs",
        "backend/main.py",
        "backend/Service.java",
        "backend/Main.kt",
        "server/main.go",
        "core/src/lib.rs",
        "native/module.c",
        "native/module.h",
        "native/module.cpp",
        "backend/Program.cs",
        "app/model.rb",
        "public/index.php",
        "ios/App.swift",
        "deploy.sh",
        "styles/global.css",
        "styles/theme.scss",
        "public/index.html",
        "db/migration.sql",
      ];
      for (const p of sources) {
        expect(classifyPath(p)).toBe("source");
      }
    });

    test("other files", () => {
      const others = [
        "assets/logo.png",
        "media/video.mp4",
        "data/archive.zip",
        "fonts/inter.woff2",
        "src/data/raw-dump.bin",
      ];
      for (const p of others) {
        expect(classifyPath(p)).toBe("other");
      }
    });
  });

  describe("precedence cases", () => {
    test("generated vs test: dist/app.test.js is generated", () => {
      expect(classifyPath("dist/app.test.js")).toBe("generated");
    });

    test("test vs config: tests/fixtures/data.json is test", () => {
      expect(classifyPath("tests/fixtures/data.json")).toBe("test");
    });

    test("docs vs source: docs/guide.md is docs", () => {
      expect(classifyPath("docs/guide.md")).toBe("docs");
    });

    test("config vs source: .github/workflows/ci.yml is config", () => {
      expect(classifyPath(".github/workflows/ci.yml")).toBe("config");
    });

    test("lockfile vs config: package-lock.json is lockfile", () => {
      expect(classifyPath("package-lock.json")).toBe("lockfile");
    });
  });

  describe("path normalization and case insensitivity", () => {
    test("handles Windows backslashes", () => {
      expect(classifyPath("src\\domain\\index.ts")).toBe("source");
      expect(classifyPath("tests\\unit\\cli.test.ts")).toBe("test");
      expect(classifyPath("dist\\bundle.js")).toBe("generated");
    });

    test("handles uppercase variants", () => {
      expect(classifyPath("SRC/INDEX.TS")).toBe("source");
      expect(classifyPath("README.MD")).toBe("docs");
      expect(classifyPath("PACKAGE-LOCK.JSON")).toBe("lockfile");
    });

    test("handles leading slashes or dots", () => {
      expect(classifyPath("./src/index.ts")).toBe("source");
      expect(classifyPath("/src/index.ts")).toBe("source");
    });
  });
});

describe("isContentCollapsedCategory", () => {
  test("returns true for lockfile and generated only", () => {
    expect(isContentCollapsedCategory("lockfile")).toBe(true);
    expect(isContentCollapsedCategory("generated")).toBe(true);
    expect(isContentCollapsedCategory("test")).toBe(false);
    expect(isContentCollapsedCategory("docs")).toBe(false);
    expect(isContentCollapsedCategory("config")).toBe(false);
    expect(isContentCollapsedCategory("source")).toBe(false);
    expect(isContentCollapsedCategory("other")).toBe(false);
  });
});
