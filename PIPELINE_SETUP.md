# Trip Planner — Claude Code Pipeline Setup

This drops a 5-agent implement → test → gate → PR → review/merge pipeline into your repo, driven by a single Claude Code slash command per user story.

## What's in here

```
.claude/agents/
  implement-story.md        Agent 1 — implements one user story
  write-unit-tests.md       Agent 2 — writes unit tests for it
  create-pr.md               Agent 4 — opens the GitHub PR (only after tests pass)
  review-and-merge-pr.md    Agent 5 — reviews, auto-merges on a clean pass
.claude/commands/
  run-story.md               Orchestrator — chains all 5 steps for one story
scripts/
  setup-branches.sh          One-time: renames main -> master, creates development
playwright.config.ts         Playwright config (serves the static site for tests)
tests/e2e/trip-planner.spec.ts   Starter Playwright suite — scaffold, expand per story
.github/workflows/playwright.yml GitHub Actions CI running the suite on every PR to development
```

Note there's no separate "Agent 3" file — running Playwright is a deterministic pass/fail check, not something that benefits from an LLM's judgment, so it's a direct `npx playwright test` call inside `run-story.md` rather than a subagent. That keeps the gate honest (it can't talk itself into "close enough").

## One-time setup

1. **Copy these files into your repo**, preserving the directory structure (`.claude/`, `scripts/`, `playwright.config.ts`, `tests/`, `.github/`).

2. **Install Playwright:**
   ```bash
   npm init -y   # if there's no package.json yet
   npm install -D @playwright/test serve
   npx playwright install
   ```
   (`serve` is used by `playwright.config.ts` to serve the static HTML app for tests — swap it for whatever your actual build/serve command ends up being once the app is scaffolded.)

3. **Set up the branch structure:**
   ```bash
   chmod +x scripts/setup-branches.sh
   ./scripts/setup-branches.sh
   ```
   This renames `main` → `master`, sets `master` as the GitHub default branch, and creates `development` off it. Requires `gh` CLI authenticated with admin access to the repo.

4. **(Recommended) Add branch protection on `development`** in GitHub settings: require the `Playwright Tests` check to pass before merge, so even if the pipeline's own gate is ever bypassed, CI backstops it.

5. **Make sure the PRD is in the repo** so `run-story` can read it — copy `trip-planner-prd.md` into the repo root (or update the path in `run-story.md` if you keep it elsewhere).

## Running the pipeline

Per story:
```
/run-story next
```
Picks the next unimplemented P0 user story from the PRD automatically, in the order it's listed.

Or target a specific story:
```
/run-story flexible destination multi-stop entry
```

Each run: creates `story/<slug>` off `development` → implements → writes unit tests → runs Playwright (auto-retries the implementation up to 3 times total on failure) → opens a PR into `development` → reviews and auto-merges on a clean pass (up to 2 additional implement/review loops if the reviewer requests changes) → reports a final status.

## Recursing over the whole backlog

To run every remaining P0 story back-to-back, just re-invoke `/run-story next` in a loop — each run only picks up a story once the previous ones are either merged or explicitly reported as blocked, since `run-story` checks existing `story/*` branches and merged PR history before picking the next one. Blocked stories (failed after 3 implementation attempts, or still not clean after the review loop) are left as open branches/PRs for you to look at — the orchestrator won't silently retry them forever or skip past them without telling you.

## Things worth deciding as you go

- **Auto-merge is live** — Agent 5 merges into `development` on a clean review with no human step. If that ever feels too aggressive for a particular story (e.g. anything touching the price cross-verification logic or budget math), you can run `/run-story` up through Step 5 manually and review the PR yourself before telling it to continue — the command doesn't have to be run start-to-finish unattended.
- **`development` → `master` promotion is intentionally not part of this pipeline** — that's a separate, deliberate release step you trigger yourself when you're ready to ship, not something any of these five agents do.
- **Retry caps exist to prevent infinite loops** (3 implementation attempts on test failure, 2 additional review loops) — if a story keeps failing past those, that's a signal the story itself needs a closer look, not more automated retries.
