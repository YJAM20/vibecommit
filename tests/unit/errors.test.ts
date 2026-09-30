import { describe, expect, test } from "vitest";
import { ExitCode, VibeCommitError, reportError } from "../../src/utils/errors.js";

describe("errors utility", () => {
  test("VibeCommitError with default exit code returns 1 and prints Error: <message>", () => {
    const output: string[] = [];
    const err = new VibeCommitError("something failed");
    const code = reportError(err, (str: string) => {
      output.push(str);
    });

    expect(code).toBe(1);
    expect(output.join("")).toBe("Error: something failed\n");
  });

  test("VibeCommitError with hint and custom exit code prints both Error: and Hint: lines and returns custom code", () => {
    const output: string[] = [];
    const err = new VibeCommitError("invalid config", {
      hint: "check your settings",
      exitCode: ExitCode.UsageError,
    });
    const code = reportError(err, (str: string) => {
      output.push(str);
    });

    expect(code).toBe(2);
    expect(output.join("")).toBe("Error: invalid config\nHint: check your settings\n");
  });

  test("plain Error with sensitive message returns 1, prints generic message, and leaks neither message nor stack", () => {
    const output: string[] = [];
    const secret = "SECRET_TOKEN_xyz123";
    const err = new Error(`Connection failed with token: ${secret}`);
    const code = reportError(err, (str: string) => {
      output.push(str);
    });
    const text = output.join("");

    expect(code).toBe(1);
    expect(text).toContain("An unexpected error occurred");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("Connection failed");
    expect(text).not.toContain("Error:");
    expect(text).not.toContain("at ");
  });

  test.each([
    ["string error", "RAW_SECRET_STRING_VALUE"],
    ["object error", { token: "API_SECRET_987" }],
    ["undefined error", undefined],
  ])(
    "non-Error thrown value (%s) returns 1 with generic message and no value leakage",
    (_label: string, thrownValue: unknown) => {
      const output: string[] = [];
      const code = reportError(thrownValue, (str: string) => {
        output.push(str);
      });
      const text = output.join("");

      expect(code).toBe(1);
      expect(text).toContain("An unexpected error occurred");
      expect(text).not.toContain("RAW_SECRET_STRING_VALUE");
      expect(text).not.toContain("API_SECRET_987");
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("object");
    },
  );

  test("cause is preserved on VibeCommitError", () => {
    const cause = new Error("root cause");
    const err = new VibeCommitError("wrapped error", { cause });

    expect(err.cause).toBe(cause);
    expect(err.name).toBe("VibeCommitError");
  });

  test("exit-code constants have expected values (0, 1, 2)", () => {
    expect(ExitCode.Success).toBe(0);
    expect(ExitCode.RuntimeError).toBe(1);
    expect(ExitCode.UsageError).toBe(2);
  });
});
