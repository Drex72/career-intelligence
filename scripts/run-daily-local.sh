#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CAREER_DB_PATH:=career.db}"
export PYTHONPATH="${PWD}/services/worker/src"
python -m career.cli --db "$CAREER_DB_PATH" discover
python -m career.cli --db "$CAREER_DB_PATH" generate-batch
