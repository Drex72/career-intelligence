#!/usr/bin/env bash
# Operator-initiated script. This does not run in ChatGPT's sandbox.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v gh >/dev/null || { echo 'Install GitHub CLI and run gh auth login'; exit 1; }
login=$(gh api user --jq .login)
if [[ "$login" != "Drex72" ]]; then
  echo "Authenticated as $login, expected Drex72. Abort to avoid wrong account."; exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Commit or stash changes before publishing'; exit 1
fi
if git remote get-url origin >/dev/null 2>&1; then
  echo 'An origin remote already exists; inspect it before publishing';exit 1
fi
# Creates a PRIVATE repository. No existing repositories are modified.
gh repo create "$login/career-intelligence" --private --description 'Personal career intelligence system' --disable-wiki
repo_url="https://github.com/$login/career-intelligence.git"
git remote add origin "$repo_url"
git push -u origin main
git push -u origin feat/discovery-foundation
gh pr create --repo "$login/career-intelligence" \
  --base main --head feat/discovery-foundation --draft \
  --title 'feat: career intelligence application foundation' \
  --body-file .github/PULL_REQUEST_TEMPLATE.md
echo 'Private repository and draft PR created.'
