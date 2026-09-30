# VibeCommit

Privacy-aware AI-powered Git CLI for Conventional Commit suggestions.

## Status

Status: under active development (Phase 6: OpenAI provider integration, structured suggestions, retry, and safe local fallback)

## Current Behavior

- `vibecommit`: Generates Conventional Commit suggestions using OpenAI when `OPENAI_API_KEY` is configured. If OpenAI is unconfigured, times out, or fails, VibeCommit safely falls back to deterministic local heuristic suggestions.
- `vibecommit --no-ai`: Uses local heuristic suggestions directly without loading, configuring, or calling OpenAI.
- `vibecommit --dry-run`: Displays suggestions and previews the selected message without creating a Git commit.

## Privacy and Data Boundary

- Only sanitized and budgeted staged diff content is ever sent to the AI provider (`SanitizedDiff`).
- Content policy withholds high-risk paths, binary files, lockfiles, and generated files.
- Regex-based secret redaction masks credential patterns before budgeting or transmission. Pattern-based redaction is a risk reduction layer, not an absolute guarantee.

## Configuration

To use OpenAI suggestions, set your API key in your shell environment:

```powershell
$env:OPENAI_API_KEY = "your-api-key-here"
```

Optional settings:

- `$env:VIBECOMMIT_OPENAI_MODEL = "gpt-4o-mini"`
- `$env:VIBECOMMIT_OPENAI_TIMEOUT_MS = "15000"`

## Development

Available npm scripts:

- `npm run dev`: Run CLI directly with `tsx` (e.g. `npm run dev -- --dry-run`)
- `npm run build`: Compile TypeScript source to `dist/`
- `npm run typecheck`: Run TypeScript type checking without emitting files
- `npm run lint`: Lint source and test files with ESLint
- `npm run format`: Format code using Prettier
- `npm run format:check`: Check code formatting with Prettier
- `npm test`: Run unit tests with Vitest
- `npm run test:watch`: Run Vitest in interactive watch mode
- `npm run check`: Run formatting check, linting, typechecking, and tests in sequence
