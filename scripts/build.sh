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

# Fingerprint the stylesheet and the top-level scripts in every page, so a
# deploy changes their URLs. GitHub Pages lets browsers cache them for ten
# minutes, and without this a visitor can get new HTML against an old
# stylesheet. perl rather than sed -i, which differs between macOS and Linux.
#
# Modules import each other too (aim.js imports bots.js), so those imports get
# the same treatment first, and each page is then stamped with the hash of the
# staged file, so a change to an imported module changes its importer's URL.
for asset in *.js; do
  [ -f "$asset" ] || continue
  hash=$(shasum "$asset" | cut -c1-8)
  perl -pi -e "s#from '\./\Q$asset\E'#from './$asset?v=$hash'#g" _site/*.js
done
for asset in styles.css *.js; do
  [ -f "_site/$asset" ] || continue
  hash=$(shasum "_site/$asset" | cut -c1-8)
  perl -pi -e "s#(href|src)=\"\Q$asset\E\"#\$1=\"$asset?v=$hash\"#g" _site/*.html
done

echo "staged $(find _site -type f | wc -l | tr -d ' ') files into _site/"
