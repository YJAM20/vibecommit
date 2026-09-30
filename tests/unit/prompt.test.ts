import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { DefaultPromptService } from "../../src/ui/prompt.js";

function createPromptContext(isInteractive = true) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let stdoutData = "";
  stdout.on("data", (chunk: Buffer | string) => {
    stdoutData += chunk.toString();
  });

  const prompt = new DefaultPromptService({
    stdin,
    stdout,
    isInteractive,
  });

  return {
    prompt,
    stdin,
    stdout,
    getStdout: () => stdoutData,
    sendInput: (text: string) => {
      setImmediate(() => {
        stdin.write(text.endsWith("\n") ? text : `${text}\n`);
      });
    },
  };
}

describe("DefaultPromptService", () => {
  describe("TTY detection", () => {
    test("detects interactive environment based on option or streams", () => {
      const interactive = new DefaultPromptService({ isInteractive: true });
      expect(interactive.isInteractive()).toBe(true);

      const nonInteractive = new DefaultPromptService({ isInteractive: false });
      expect(nonInteractive.isInteractive()).toBe(false);

      const mockStdin = new PassThrough();
      const mockStdout = new PassThrough();
      const defaultDetection = new DefaultPromptService({ stdin: mockStdin, stdout: mockStdout });
      expect(defaultDetection.isInteractive()).toBe(false);
    });
  });

  describe("askSelection", () => {
    test("returns 1 for input '1', 2 for '2', 3 for '3'", async () => {
      for (const expected of [1, 2, 3]) {
        const { prompt, sendInput } = createPromptContext();
        const promise = prompt.askSelection(3);
        sendInput(String(expected));
        const result = await promise;
        expect(result).toBe(expected);
        prompt.close();
      }
    });

    test("re-prompts on invalid inputs (0, abc, empty, 4) until valid input 2 is entered", async () => {
      const { prompt, stdin, getStdout } = createPromptContext();
      const promise = prompt.askSelection(3);

      setImmediate(() => {
        stdin.write("0\n");
        setTimeout(() => {
          stdin.write("abc\n");
          setTimeout(() => {
            stdin.write("\n");
            setTimeout(() => {
              stdin.write("4\n");
              setTimeout(() => {
                stdin.write("2\n");
              }, 20);
            }, 20);
          }, 20);
        }, 20);
      });

      const result = await promise;
      expect(result).toBe(2);
      expect(getStdout()).toContain("Invalid selection. Please enter a number between 1 and 3:");
      prompt.close();
    });

    test("returns null on cancellation inputs 'q', 'quit', 'exit'", async () => {
      for (const cancelInput of ["q", "quit", "exit", "Q", "QUIT"]) {
        const { prompt, sendInput } = createPromptContext();
        const promise = prompt.askSelection(3);
        sendInput(cancelInput);
        const result = await promise;
        expect(result).toBeNull();
        prompt.close();
      }
    });

    test("returns null when stream ends or interface closes", async () => {
      const { prompt, stdin } = createPromptContext();
      const promise = prompt.askSelection(3);
      setImmediate(() => {
        stdin.end();
      });
      const result = await promise;
      expect(result).toBeNull();
      prompt.close();
    });
  });

  describe("askConfirmation", () => {
    test("defaults to No (false) when user presses Enter with empty input", async () => {
      const { prompt, sendInput } = createPromptContext();
      const promise = prompt.askConfirmation("feat: test commit");
      sendInput("");
      const result = await promise;
      expect(result).toBe(false);
      prompt.close();
    });

    test("returns false for explicit No inputs ('n', 'no', 'N', 'NO')", async () => {
      for (const noInput of ["n", "no", "N", "NO"]) {
        const { prompt, sendInput } = createPromptContext();
        const promise = prompt.askConfirmation("feat: test commit");
        sendInput(noInput);
        const result = await promise;
        expect(result).toBe(false);
        prompt.close();
      }
    });

    test("returns true for explicit Yes inputs ('y', 'yes', 'Y', 'YES')", async () => {
      for (const yesInput of ["y", "yes", "Y", "YES"]) {
        const { prompt, sendInput } = createPromptContext();
        const promise = prompt.askConfirmation("feat: test commit");
        sendInput(yesInput);
        const result = await promise;
        expect(result).toBe(true);
        prompt.close();
      }
    });

    test("returns false for arbitrary non-yes text ('maybe', 'sure', 'ok')", async () => {
      for (const arbitrary of ["maybe", "sure", "ok", "1"]) {
        const { prompt, sendInput } = createPromptContext();
        const promise = prompt.askConfirmation("feat: test commit");
        sendInput(arbitrary);
        const result = await promise;
        expect(result).toBe(false);
        prompt.close();
      }
    });

    test("displays preview message and prompt in stdout", async () => {
      const { prompt, sendInput, getStdout } = createPromptContext();
      const promise = prompt.askConfirmation("feat(scope): test preview");
      sendInput("y");
      await promise;
      expect(getStdout()).toContain("Selected commit message:\n  feat(scope): test preview");
      expect(getStdout()).toContain("Create commit? (y/N):");
      prompt.close();
    });
  });
});
