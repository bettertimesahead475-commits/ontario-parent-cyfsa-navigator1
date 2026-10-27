#!/usr/bin/env bash
# Owner-side installer. Usage: scripts/official-forms/install.sh <folder-with-the-11-downloaded-files>
# 1. Verifies every file in the folder against the pinned hashes and sizes. Nothing is copied unless all 11 pass.
# 2. Copies them into the directory the official-form tests read, then verifies that directory.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="${1:?usage: install.sh <folder-with-the-downloaded-files>}"
target="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).uploadDirectory)' "$here/manifest.json")"
echo "Checking the folder before copying..."
node "$here/verify.mjs" "$src"
echo "All files match. Installing into: $target"
mkdir -p "$target"
node -e '
const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
for (const f of m.files) console.log(f.fileName);
' "$here/manifest.json" | while read -r name; do cp -f "$src/$name" "$target/$name"; done
echo "Verifying the installed copies..."
node "$here/verify.mjs" "$target"
