import * as readlinePromises from "node:readline/promises";

export interface PromptOptions {
  readonly stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  readonly stdout?: NodeJS.WritableStream & { isTTY?: boolean };
  readonly isInteractive?: boolean;
}

export interface PromptInterface {
  isInteractive(): boolean;
  askSelection(maxOptions: number): Promise<number | null>;
  askConfirmation(previewMessage: string): Promise<boolean>;
  close(): void;
}

export class DefaultPromptService implements PromptInterface {
  private readonly stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  private readonly stdout: NodeJS.WritableStream & { isTTY?: boolean };
  private readonly interactiveOverride?: boolean;
  private rl?: readlinePromises.Interface;
  private abortController?: AbortController;

  constructor(options: PromptOptions = {}) {
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;
    this.interactiveOverride = options.isInteractive;
  }

  isInteractive(): boolean {
    if (this.interactiveOverride !== undefined) {
      return this.interactiveOverride;
    }
    if (process.env["FORCE_TTY"] === "1") {
      return true;
    }
    return Boolean(this.stdin.isTTY && this.stdout.isTTY);
  }

  private getReadline(): { rl: readlinePromises.Interface; ac: AbortController } {
    if (!this.rl || (this.rl as unknown as { closed?: boolean }).closed) {
      this.abortController = new AbortController();
      const ac = this.abortController;
      const rl = readlinePromises.createInterface({
        input: this.stdin,
        output: this.stdout,
        terminal: this.isInteractive(),
      });

      rl.on("close", () => {
        ac.abort();
      });

      rl.on("SIGINT", () => {
        ac.abort();
        rl.close();
      });

      this.rl = rl;
      return { rl, ac };
    }

    if (!this.abortController || this.abortController.signal.aborted) {
      this.abortController = new AbortController();
    }

    return { rl: this.rl, ac: this.abortController };
  }

  async askSelection(maxOptions: number): Promise<number | null> {
    let query = `Choose a suggestion (1-${maxOptions}): `;

    while (true) {
      const { rl, ac } = this.getReadline();
      try {
        const answer = await rl.question(query, {
          signal: ac.signal,
        });

        const trimmed = answer.trim().toLowerCase();
        if (trimmed === "q" || trimmed === "quit" || trimmed === "exit") {
          return null;
        }

        const num = Number(trimmed);
        if (/^\d+$/.test(trimmed) && Number.isInteger(num) && num >= 1 && num <= maxOptions) {
          return num;
        }

        query = `Invalid selection. Please enter a number between 1 and ${maxOptions}: `;
      } catch {
        return null;
      }
    }
  }

  async askConfirmation(previewMessage: string): Promise<boolean> {
    const { rl, ac } = this.getReadline();
    const promptText = `\nSelected commit message:\n  ${previewMessage}\n\nCreate commit? (y/N): `;

    try {
      const answer = await rl.question(promptText, {
        signal: ac.signal,
      });

      const trimmed = answer.trim().toLowerCase();
      return trimmed === "y" || trimmed === "yes";
    } catch {
      return false;
    }
  }

  close(): void {
    if (this.rl) {
      this.abortController?.abort();
      this.rl.close();
      this.rl = undefined;
      this.abortController = undefined;
    }
  }
}
