#!/usr/bin/env bash
# std-only Rust tests for the player core + cross-language trailer check against the TS exporter.
# Needs only `rustc` (any host) and the repo's node_modules. Does NOT build the Tauri app.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"; repo="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
html="${1:-$tmp/sample.html}"
[ -f "$html" ] || printf '<!doctype html><title>t</title><script id="btg-manifest" type="application/json">{"title":"样例"}</script>' > "$html"
"$repo/node_modules/.bin/tsx" "$here/scripts/make-ts-exe.ts" "$html" "$tmp/ts.exe"
rustc --edition 2021 --test -A dead_code "$here/tests-std/core_tests.rs" -o "$tmp/core-tests"
BTG_TS_EXE="$tmp/ts.exe" BTG_TS_HTML="$html" "$tmp/core-tests"
