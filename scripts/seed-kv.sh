#!/usr/bin/env bash
# One-time (or repeatable) push of the committed data/*.json seed into the
# DATA namespace. Safe to re-run: it overwrites each key with the file on disk,
# so only run it when the repo copy is the version you want live.
set -euo pipefail

cd "$(dirname "$0")/.."

REMOTE_FLAG="--remote"
if [ "${1:-}" = "--local" ]; then
  REMOTE_FLAG="--local"
fi

for file in data/*.json; do
  key="$(basename "$file")"
  echo "seeding $key"
  npx wrangler kv key put "$key" --path "$file" --binding DATA $REMOTE_FLAG
done

echo "done"
