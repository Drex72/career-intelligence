#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"
for role in discovery eligibility matching people outreach conversation; do
  if ! sudo docker compose -f compose.yaml ps --status running --services | grep -qx "$role"; then
    echo "Worker not running: $role" >&2
    exit 1
  fi
done
sudo docker compose -f compose.yaml ps
echo "All six services have running container processes. Verify their persisted DB heartbeats separately."
