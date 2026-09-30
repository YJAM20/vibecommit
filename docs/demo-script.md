# VibeCommit Demo Recording Script

This script provides a safe, reproducible 30–45 second terminal workflow for recording a demonstration of VibeCommit (as a GIF, video, or screenshot series) without leaking personal data, actual API keys, or raw diff contents.

---

## Pre-Recording Checklist

Before starting your recording terminal:

- [ ] Use a clean throwaway directory (e.g. `repo-demo/`) located outside your user home or personal folders.
- [ ] Set your terminal prompt to a generic string (e.g. `demo$ ` or `$` via `function prompt { "$ " }` in PowerShell or `PS1='$ '` in bash) to hide local usernames and paths.
- [ ] Do **NOT** set a real `OPENAI_API_KEY` in the recording shell.
- [ ] Ensure no personal bookmarks, open tabs, or sensitive files are visible in the background.
- [ ] Set terminal font size to 16–18pt and window dimensions to approximately 100 columns by 30 rows.

---

## 30–45 Second Demo Sequence

### Step 1: Initialize throwaway repository (0:00 – 0:08)

```powershell
mkdir vibecommit-demo
cd vibecommit-demo
git init
```

### Step 2: Create staged sample files with safe fake data (0:08 – 0:18)

Create a sample feature file and a fake environment file with synthetic placeholder content:

```powershell
# Safe documentation file
"## Authentication Guide" | Out-File -Encoding utf8 docs.md

# Source change
"export function authenticateUser(token: string): boolean { return Boolean(token); }" | Out-File -Encoding utf8 auth.ts

# Fake configuration with synthetic placeholder pattern
"DB_PASSWORD=demo-synthetic-placeholder-not-real" | Out-File -Encoding utf8 .env

git add docs.md auth.ts .env
```

### Step 3: Run VibeCommit in Safe Dry-Run Mode (0:18 – 0:30)

Demonstrate the privacy boundary and instant deterministic heuristics without modifying Git state:

```powershell
vibecommit --no-ai --dry-run
```

**Expected terminal output display:**

- Staged file summary (`docs.md`, `auth.ts`, `.env` withheld by policy)
- Privacy summary confirming redaction/withholding counts:
  - `.env` withheld by path policy
  - `DB_PASSWORD` assignment redacted (`[REDACTED:sensitive_assignment]`)
- Exactly three Conventional Commit suggestions:
  1. `feat(auth): authenticate user`
  2. `feat(auth): update authentication logic`
  3. `feat(auth): implement user authentication`
- Preview of selected commit message
- Notice: `Dry-run mode is active: no commit will be created.`

### Step 4: Interactive Commit Creation (0:30 – 0:42)

Demonstrate interactive human-in-the-loop selection and confirmation:

```powershell
vibecommit --no-ai
```

- When prompted `Choose a suggestion (1-3):`, enter `1`.
- When prompted `Create commit? (y/N):`, enter `y`.
- Observe commit creation confirmation:
  ```text
  Commit created successfully:
    [master abc1234] feat(auth): authenticate user
  ```

### Step 5: Verify Git History (0:42 – 0:45)

```powershell
git log -1 --oneline
```

---

## Post-Recording Verification Checklist

Before publishing any recorded asset:

- [ ] Confirm no real API key or token was typed, echoed, or visible in terminal history.
- [ ] Confirm no raw diff text is shown in the output (VibeCommit outputs structured summaries, never raw diffs).
- [ ] Confirm no local absolute paths (e.g. `C:\Users\username\...`) are visible.
- [ ] Confirm terminal prompt displays generic `$` instead of local user account name.
- [ ] Confirm clean exit and expected commit message format.

## Cleanup

Remove the temporary demonstration directory:

```powershell
cd ..
Remove-Item -Recurse -Force vibecommit-demo
```
