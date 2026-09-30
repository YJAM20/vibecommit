import { Command, CommanderError } from "commander";
import { ExitCode, reportError } from "./utils/errors.js";
import { getVersion } from "./utils/version.js";

export interface Io {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface CliOptions {
  dryRun: boolean;
  noAi: boolean;
}

interface RawOptions {
  dryRun?: boolean;
  ai?: boolean;
}

export const defaultIo: Io = {
  stdout: (message: string) => {
    process.stdout.write(message);
  },
  stderr: (message: string) => {
    process.stderr.write(message);
  },
};

export function createProgram(io: Io): Command {
  const version = getVersion();
  const program = new Command();

  program
    .name("vibecommit")
    .description("Privacy-aware AI-powered Git CLI for Conventional Commit suggestions")
    .version(version, "-V, --version")
    .option("--dry-run", "show suggestions and the final preview without ever creating a commit")
    .option("--no-ai", "skip the AI provider and use local heuristic suggestions")
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({
      writeOut: (message: string) => {
        io.stdout(message);
      },
      writeErr: (message: string) => {
        io.stderr(message);
      },
    });

  return program;
}

function run(options: CliOptions, io: Io): void {
  const version = getVersion();
  io.stdout(`vibecommit v${version}\n`);
  io.stdout(
    "Phase 1 skeleton: Git analysis, redaction, and AI suggestions are not implemented yet.\n",
  );
  if (options.dryRun) {
    io.stdout("Dry-run mode is active.\n");
  }
  if (options.noAi) {
    io.stdout("AI is disabled.\n");
  }
}

export function main(argv: string[], io: Io = defaultIo): Promise<number> {
  try {
    const program = createProgram(io);
    program.parse(argv);

    const rawOptions = program.opts<RawOptions>();
    const options: CliOptions = {
      dryRun: Boolean(rawOptions.dryRun),
      noAi: rawOptions.ai === false,
    };

    run(options, io);
    return Promise.resolve(ExitCode.Success);
  } catch (error: unknown) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        return Promise.resolve(ExitCode.Success);
      }
      io.stderr("Run 'vibecommit --help' for usage details.\n");
      return Promise.resolve(ExitCode.UsageError);
    }
    return Promise.resolve(reportError(error, io.stderr));
  }
}
