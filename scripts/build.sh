#!/usr/bin/env bash
# Stages the static site into _site/, which wrangler uploads as the Worker's
# assets. Everything excluded here is either server-side (worker/), tooling,
# or secrets that must never reach the edge.
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf _site
mkdir -p _site

rsync -a . _site/ \
  --exclude '_site' \
  --exclude '.git' \
  --exclude '.github' \
  --exclude '.claude' \
  --exclude '.wrangler' \
  --exclude 'node_modules' \
  --exclude 'worker' \
  --exclude 'scripts' \
  --exclude 'server.js' \
  --exclude 'package.json' \
  --exclude 'package-lock.json' \
  --exclude 'wrangler.toml' \
  --exclude '.gitignore' \
  --exclude '.nojekyll' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '*.md' \
  --exclude 'youdahe.com' \
  --exclude 'data/daily.json' \
  --exclude 'data/notes.json'

# data/*.json ships as the seed the Worker falls back to when a KV key has
# never been written. The daily log and notes are private, so their seeds stay
# out of the build: a static asset is readable by anyone, and the /api gate
# would not apply. Those two live only in KV, loaded by `npm run seed`.

echo "staged $(find _site -type f | wc -l | tr -d ' ') files into _site/"
