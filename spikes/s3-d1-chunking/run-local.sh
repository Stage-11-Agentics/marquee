#!/usr/bin/env bash
set -euo pipefail

SPIKE_DIR=$(cd "$(dirname "$0")" && pwd)
PORT=${PORT:-8796}
BASE_URL="http://127.0.0.1:${PORT}"
RUN_TMP=$(mktemp -d)
WRANGLER_PID=""

cleanup() {
  if [[ -n "$WRANGLER_PID" ]]; then
    kill "$WRANGLER_PID" 2>/dev/null || true
    wait "$WRANGLER_PID" 2>/dev/null || true
  fi
  rm -f "$RUN_TMP/wrangler.log"
  rmdir "$RUN_TMP" 2>/dev/null || true
}
trap cleanup EXIT

cd "$SPIKE_DIR"
npx wrangler d1 execute s3-d1-chunking-local --local --file schema.sql
npx wrangler dev --local --port "$PORT" >"$RUN_TMP/wrangler.log" 2>&1 &
WRANGLER_PID=$!

for _ in {1..80}; do
  if curl --fail --silent "$BASE_URL/health" >/dev/null; then
    break
  fi
  if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then
    cat "$RUN_TMP/wrangler.log"
    exit 1
  fi
  sleep 0.25
done
curl --fail --silent "$BASE_URL/health" >/dev/null

curl --fail --silent --request POST "$BASE_URL/setup"
printf '\n'
curl --fail --silent --request POST "$BASE_URL/probe-bound-limit"
printf '\n'

for rows in 150 1000; do
  for pattern in chunked json_each; do
    for trial in {1..10}; do
      curl --fail --silent --request POST \
        "$BASE_URL/trial?rows=$rows&pattern=$pattern&trial=$trial"
      printf '\n'
    done
  done
done
