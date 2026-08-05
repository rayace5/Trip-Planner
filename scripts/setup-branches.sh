#!/usr/bin/env bash
# One-time branch setup for the Trip Planner repo.
# Renames main -> master, creates development off it, and pushes both.
# Run this once, before any story pipeline runs.

set -euo pipefail

echo "Current branch: $(git branch --show-current)"
echo "This will rename 'main' to 'master' and create 'development' off it."
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

# 1. Rename local main -> master
git checkout main
git branch -m main master

# 2. Push master, set upstream
git push -u origin master

# 3. Update the repo's default branch on GitHub to master
#    (requires gh CLI authenticated with repo admin access)
gh repo edit --default-branch master

# 4. Delete the old main branch on the remote (only after default-branch switch succeeds)
git push origin --delete main || echo "Note: could not delete remote 'main' — delete it manually on GitHub if desired."

# 5. Create development off master, push it
git checkout -b development master
git push -u origin development

echo ""
echo "Done. Branch structure:"
echo "  master       <- production / release branch"
echo "  development  <- PRs from story/* branches merge here"
echo "  story/*      <- created per user story by /run-story"
echo ""
echo "Next: configure a GitHub branch protection rule on 'development'"
echo "(require the Playwright check to pass before merge, if you wire up CI - see playwright.yml)."
