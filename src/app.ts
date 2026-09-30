import { Command, CommanderError } from "commander";
import { SuggestionOrchestrator } from "./ai/generate.js";
import { formatCommitMessage } from "./domain/suggestion-schema.js";
import { validateCommitMessage } from "./domain/validate-message.js";
import type { GitClient } from "./git/git-client.js";
import { DefaultGitClient } from "./git/git-client.js";
import { buildSanitizedDiff } from "./security/sanitized-diff.js";
import type { SanitizedDiff } from "./security/types.js";
import type { PromptInterface } from "./ui/prompt.js";
import { DefaultPromptService } from "./ui/prompt.js";
import {
  renderDiffBudgetStats,
  renderNoStagedChanges,
  renderPrivacySummary,
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
  readonly prompt?: PromptInterface;
  readonly orchestrator?: SuggestionOrchestrator;
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
  prompt: PromptInterface;
  orchestrator: SuggestionOrchestrator;
} {
  if (isIo(ioOrDeps)) {
    return {
      io: ioOrDeps,
      gitClient: new DefaultGitClient(),
      prompt: new DefaultPromptService(),
      orchestrator: new SuggestionOrchestrator(),
    };
  }

  const appIo = ioOrDeps.io ?? defaultIo;
  const appGitClient = ioOrDeps.gitClient ?? new DefaultGitClient();
  const appPrompt = ioOrDeps.prompt ?? new DefaultPromptService();
  const appOrchestrator = ioOrDeps.orchestrator ?? new SuggestionOrchestrator();

  return {
    io: appIo,
    gitClient: appGitClient,
    prompt: appPrompt,
    orchestrator: appOrchestrator,
  };
}

async function runFlow(
  options: CliOptions,
  io: Io,
  gitClient: GitClient,
  prompt: PromptInterface,
  orchestrator: SuggestionOrchestrator,
): Promise<void> {
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

  let sanitizedDiff: SanitizedDiff;
  try {
    sanitizedDiff = buildSanitizedDiff(stagedResult.files, stagedResult.diffText);
  } catch (error: unknown) {
    throw new VibeCommitError("Failed to sanitize staged diff", {
      hint: "Inspect staged changes or retry with smaller files.",
      cause: error,
    });
  }

  io.stdout(renderPrivacySummary(sanitizedDiff.report));
  io.stdout(renderDiffBudgetStats(sanitizedDiff.budgetStats));

  if (options.noAi) {
    io.stdout("AI is disabled.\n");
  }

  const generationResult = await orchestrator.getSuggestions(sanitizedDiff, stagedResult.files, {
    noAi: options.noAi,
  });

  if (generationResult.safeFallbackMessage) {
    io.stdout(`${generationResult.safeFallbackMessage}\n`);
  }

  const suggestions = generationResult.suggestions;
  io.stdout(renderSuggestions(suggestions, generationResult.source));

  if (generationResult.source === "ai") {
    io.stdout("Suggestions generated using OpenAI.\n");
  } else {
    io.stdout("Suggestions generated using local heuristics (no AI model called).\n");
  }

  if (options.dryRun) {
    const defaultSuggestion = suggestions[0];
    const preview = defaultSuggestion ? formatCommitMessage(defaultSuggestion) : "";
    io.stdout(`\nSelected commit message:\n  ${preview}\n\n`);
    io.stdout("Dry-run mode is active: no commit will be created.\n");
    return;
  }

  if (!prompt.isInteractive()) {
    throw new VibeCommitError(
      "VibeCommit requires an interactive terminal for commit creation. Use '--dry-run' in non-interactive environments.",
    );
  }

  const selection = await prompt.askSelection(suggestions.length);
  if (selection === null) {
    io.stdout("Commit aborted by user.\n");
    return;
  }

  const chosenSuggestion = suggestions[selection - 1];
  if (!chosenSuggestion) {
    throw new VibeCommitError("Selected suggestion is invalid.");
  }

  const formattedMessage = formatCommitMessage(chosenSuggestion);
  const validation = validateCommitMessage(formattedMessage);
  if (!validation.ok) {
    throw new VibeCommitError(
      `Selected commit message failed validation: ${validation.errors.join(", ")}`,
    );
  }

  const confirmed = await prompt.askConfirmation(formattedMessage);
  if (!confirmed) {
    io.stdout("Commit cancelled. Staged changes remain staged.\n");
    return;
  }

  const commitResult = await gitClient.createCommit(formattedMessage);
  const displaySummary = commitResult.summaryLine || formattedMessage;
  io.stdout(`Commit created successfully:\n  ${displaySummary}\n`);
}

export async function main(
  argv: string[],
  ioOrDeps: Io | AppDependencies = defaultIo,
): Promise<number> {
  const { io, gitClient, prompt, orchestrator } = resolveDependencies(ioOrDeps);

  try {
    const program = createProgram(io);
    program.parse(argv);

    const rawOptions = program.opts<RawOptions>();
    const options: CliOptions = {
      dryRun: Boolean(rawOptions.dryRun),
      noAi: rawOptions.ai === false,
    };

    await runFlow(options, io, gitClient, prompt, orchestrator);
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
  } finally {
    prompt.close();
  }
}
