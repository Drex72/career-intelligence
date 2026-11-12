#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"
[[ "$(uname -m)" == "aarch64" ]] || { echo "Not on OCI ARM64" >&2; exit 1; }
[[ -f secrets.env ]] || { echo "Missing private secrets.env" >&2; exit 1; }
perm="$(stat -c %a secrets.env)"
[[ "$perm" == "600" || "$perm" == "400" ]] || { echo "secrets.env must have mode 600 or 400, currently $perm" >&2; exit 1; }
grep -q '^DATABASE_URL=postgresql://' secrets.env || { echo "No valid DATABASE_URL configured" >&2; exit 1; }
grep -q '^CI_WORKER_SIGNING_KEY=' secrets.env || { echo "Missing signing key setting" >&2; exit 1; }
if grep -Eq 'YOUR_PROJECT_REFERENCE|YOUR_PASSWORD|YOUR_SESSION_POOLER_HOST|REPLACE_WITH_EXISTING_SIGNING_KEY' secrets.env; then
  echo "Replace secrets.env example placeholders before continuing" >&2
  exit 1
fi
if grep -Eq ':6543(/|\?)' secrets.env; then
  echo "Use Supabase direct or session pooler on 5432; transaction pooling is unsuitable for LangGraph checkpoints" >&2
  exit 1
fi
echo "Architecture and secrets file checks passed (no credentials printed)."
sudo docker compose -f compose.yaml config --quiet
echo "Compose configuration validated."
