---
description: Runs the full implement → test → Playwright gate → PR → review/merge pipeline for one user story from the Trip Planner PRD.
argument-hint: "[story keyword or number, or 'next' for the next unimplemented P0 story]"
---

# Run Story Pipeline

You are orchestrating a five-step pipeline for one user story, using the subagents defined in `.claude/agents/`. Do not implement the story yourself in this top-level context — delegate every content-producing step to the appropriate subagent via the Task tool, and handle only sequencing, gating, and git branch setup yourself.

## Step 0 — Resolve the story

Read `trip-planner-prd.md` (check the repo root and any `docs/`/`requirements/` folder for it).

- If `$ARGUMENTS` is `next`: find the next P0 user story under **User Stories** that doesn't yet have a corresponding branch (check `git branch -a --list 'story/*'` and merged PR history to `development` for stories already done). Pick the first unimplemented one, in the order it appears in the PRD.
- If `$ARGUMENTS` names or references a specific story: match it against the **User Stories** section.
- If you can't confidently resolve a story either way, stop and ask rather than guessing — implementing the wrong story wastes the whole pipeline run.

State the resolved story text and its slug (kebab-case, short, e.g. `flexible-multi-stop-destination`) before continuing.

## Step 1 — Branch setup

```bash
git checkout development
git pull origin development
git checkout -b story/<slug>
```

If `story/<slug>` already exists (a retry of a previously-attempted story), check it out instead of recreating it, and note that this is a retry.

## Step 2 — Implement

Invoke the `implement-story` subagent via the Task tool. Give it:
- The full story text and its acceptance criteria (from the PRD)
- The relevant section of `trip-planner-design-mockup.html` if the story is UI-facing
- If this is a retry after a test failure (see Step 4), the failing test output too

Wait for it to finish and report back before continuing.

## Step 3 — Unit tests

Invoke the `write-unit-tests` subagent via the Task tool. Give it the same story/acceptance-criteria context. Wait for it to finish.

## Step 4 — Playwright gate (not a subagent — run directly)

This step is deliberately **not** delegated to an LLM agent — it's a deterministic pass/fail gate.

```bash
npx playwright test
```

- **If it passes:** continue to Step 5.
- **If it fails:** capture the failure output. If this is the first or second failure for this story, go back to Step 2 (invoke `implement-story` again) with the failure output included as context, then repeat Steps 3–4. **Cap retries at 3 total attempts.** If it's still failing after 3 attempts, stop the pipeline, leave the branch as-is (do not open a PR), and report the story as blocked with the last failure output — don't loop indefinitely.

## Step 5 — Create PR

Only reached if Step 4 passed. Invoke the `create-pr` subagent via the Task tool. Confirm to it explicitly that Playwright passed so it's reflected in the PR description. Wait for the PR number/URL back.

## Step 6 — Review and merge

Invoke the `review-and-merge-pr` subagent via the Task tool with the PR number.

- **If it merges:** report the story as done — PR number, merge commit, one-line summary. Stop here.
- **If it requests changes:** take its feedback, go back to Step 2 (`implement-story`) with the review feedback as context, and repeat Steps 2–6. **Cap this review-feedback loop at 2 additional full passes.** If it's still not clean after that, stop, leave the PR open (don't force-merge), and report the story as needing human attention with the reviewer's last feedback.

## Final report

Whatever the outcome (merged / blocked on tests / blocked on review), end with a short structured summary:
- Story: <text>
- Branch: `story/<slug>`
- Outcome: merged to development (PR #) / blocked on Playwright / blocked on review
- Attempts used: implement×N, review-loop×N
- Anything a human should look at
