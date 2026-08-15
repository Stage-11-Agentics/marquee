#!/bin/bash
# SessionStart hook: prepare a Claude Code on the web container so `npm test`,
# the typechecks, and `npm run pr-gate` work without a manual setup round.
# Local checkouts already have their dependencies, so this is remote-only.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# The lockfile is the dependency contract (README "Clean local checkout"), so a
# fresh container installs from it. A container that already has node_modules —
# a resumed or restored session — takes the incremental path instead, because
# `npm ci` would delete and refetch the tree it already has.
if [ -d node_modules ] && [ -n "$(ls -A node_modules 2>/dev/null)" ]; then
  npm install --no-audit --no-fund
else
  npm ci --no-audit --no-fund
fi

# Wrangler and the worker test pool read .dev.vars. The example holds
# Cloudflare's published always-pass Turnstile pair and deterministic fake R2
# values — local-only by design, and never deployed. Never overwrite an
# existing file: it may hold real per-session values.
if [ ! -f .dev.vars ]; then
  cp .dev.vars.example .dev.vars
fi

echo "session-start: dependencies installed; .dev.vars present"
