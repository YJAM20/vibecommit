import { Command, CommanderError } from "commander";
import { applyDiffBudget } from "./domain/diff-budget.js";
import { generateHeuristicSuggestions } from "./domain/heuristics.js";
import { formatCommitMessage } from "./domain/suggestion-schema.js";
import { validateCommitMessage } from "./domain/validate-message.js";
import type { GitClient } from "./git/git-client.js";
import { DefaultGitClient } from "./git/git-client.js";
import {
  renderDiffBudgetStats,
  renderNoStagedChanges,
  renderStagedSummary,
  renderSuggestions,
} from "./ui/render.js";
import { ExitCode, reportError, VibeCommitError } from "./utils/errors.js";
import { getVersion } from "./utils/version.js";

export interface Io {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface CliOptions {
  dryRun: boolean;
  noAi: boolean;
}

export interface AppDependencies {
  readonly io?: Io;
  readonly gitClient?: GitClient;
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

function isIo(value: Io | AppDependencies): value is Io {
  return "stdout" in value && typeof value.stdout === "function";
}

function resolveDependencies(ioOrDeps: Io | AppDependencies): {
  io: Io;
  gitClient: GitClient;
} {
  if (isIo(ioOrDeps)) {
    return {
      io: ioOrDeps,
      gitClient: new DefaultGitClient(),
    };
  }

  const appIo = ioOrDeps.io ?? defaultIo;
  const appGitClient = ioOrDeps.gitClient ?? new DefaultGitClient();

  return {
    io: appIo,
    gitClient: appGitClient,
  };
}

async function runFlow(options: CliOptions, io: Io, gitClient: GitClient): Promise<void> {
  const version = getVersion();
  io.stdout(`vibecommit v${version}\n`);

  await gitClient.checkGitInstalled();
  await gitClient.getRepoRoot();

  const stagedResult = await gitClient.getStagedChanges();

  if (stagedResult.files.length === 0) {
    io.stdout(renderNoStagedChanges());
    if (options.dryRun) {
      io.stdout("Dry-run mode is active.\n");
    }
    if (options.noAi) {
      io.stdout("AI is disabled.\n");
    }
    io.stdout("Redaction, AI suggestions, and commit creation are not implemented yet.\n");
    return;
  }

  io.stdout(renderStagedSummary(stagedResult));

  const budgetResult = applyDiffBudget(stagedResult.diffText, stagedResult.files);
  io.stdout(renderDiffBudgetStats(budgetResult.stats));

  if (options.dryRun) {
    io.stdout("Dry-run mode is active.\n");
  }

  if (options.noAi) {
    io.stdout("AI is disabled.\n");

    const suggestions = generateHeuristicSuggestions(stagedResult.files);

    for (const s of suggestions) {
      const formatted = formatCommitMessage(s);
      const validation = validateCommitMessage(formatted);
      if (!validation.ok) {
        throw new VibeCommitError(
          `Generated suggestion '${formatted}' failed validation: ${validation.errors.join(", ")}`,
        );
      }
    }

    io.stdout(renderSuggestions(suggestions));
    io.stdout("Suggestions generated using local heuristics (no AI model called).\n");
    io.stdout("Interactive selection and commit creation are not implemented yet.\n");
  } else {
    io.stdout(
      "AI commit suggestions are not implemented yet. Use '--no-ai' to view local heuristic suggestions.\n",
    );
    io.stdout("Redaction, AI suggestions, and commit creation are not implemented yet.\n");
  }
}

export async function main(
  argv: string[],
  ioOrDeps: Io | AppDependencies = defaultIo,
): Promise<number> {
  const { io, gitClient } = resolveDependencies(ioOrDeps);

  try {
    const program = createProgram(io);
    program.parse(argv);

    const rawOptions = program.opts<RawOptions>();
    const options: CliOptions = {
      dryRun: Boolean(rawOptions.dryRun),
      noAi: rawOptions.ai === false,
    };

    await runFlow(options, io, gitClient);
    return ExitCode.Success;
  } catch (error: unknown) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        return ExitCode.Success;
      }
      io.stderr("Run 'vibecommit --help' for usage details.\n");
      return ExitCode.UsageError;
    }
    return reportError(error, io.stderr);
  }
}
