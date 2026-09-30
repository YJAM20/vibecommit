# VibeCommit

Privacy-aware AI-powered Git CLI for Conventional Commit suggestions.

## Status

Status: under active development (Phase 3: Domain model, validation, heuristic generator, diff budgeting)

## Current behavior

`--no-ai` generates three local Conventional Commit suggestions from staged Git changes using deterministic heuristics. Default mode summarizes staged changes and diff budget limits without AI suggestions (AI generation is not implemented yet). Nothing is committed.

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
