#!/bin/sh
# ---------------------------------------------------------------------------------------------------------------------
# Nov 18 — Nokt prompt v5: the FICTIONAL turns on the real subscription model (≤ 14 bridge calls, no retry).
#
#   NOKT_V5_REFRESH_APPROVED=yes sh scripts/nokt-v5-live-fictional.sh <out-dir>
#
# WHY THE GATE: the shared Nokt access token expired on 2026-11-15 13:04 UTC. The first model turn of ANY runtime process
# refreshes it, which ROTATES the refresh token in the one shared credential file the live bridge (the children's Nokt) also
# uses. The runtime does this under a file lock and re-reads first, so a shared refresh is how the live bridge works too —
# but earlier rounds (Oct 26) treated a refresh from an isolated run as needing David's explicit OK. Do not run this without it.
# NEVER point FAMILY_NOKT_CREDENTIALS_FILE at a COPY: a refresh in a copy would leave the live file with a used refresh token.
#
# What it starts, on loopback only: the INSTALLED runtime's dist (read-only use) on 127.0.0.1:3788 with a synthetic bridge
# secret, its own NEW ceiling ledger in <out-dir> (14 attempts; the historical 14/14 ledger and the live 60/day allowance file
# are not touched), allowed origin http://127.0.0.1:3781. Then the harness (fictional fixtures, the app's real engine and guards).
# Only the runtime process this script started is stopped (PID and command checked).
# ---------------------------------------------------------------------------------------------------------------------
set -u
OUT=${1:?out dir}
[ "${NOKT_V5_REFRESH_APPROVED:-}" = "yes" ] || { echo "refused: needs David's OK for one shared token refresh (set NOKT_V5_REFRESH_APPROVED=yes)"; exit 3; }
APP=$(cd "$(dirname "$0")/.." && pwd)
RT=$HOME/Projects/family-assistant-runtime
CFG=$HOME/.config/family-assistant-runtime/nokt-subscription
PORT=3788
mkdir -p "$OUT"
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then echo "port $PORT in use; nothing started"; exit 3; fi
SECRET="nokt-v5-live-synthetic-secret-$(date +%s)-0123456789abcdef"
cd "$RT" || exit 1
env -i PATH="$PATH" HOME="$HOME" FAMILY_BRIDGE_TOKEN_SECRET="$SECRET" FAMILY_BRIDGE_BIND=127.0.0.1 FAMILY_BRIDGE_PORT=$PORT \
  FAMILY_BRIDGE_ALLOWED_ORIGINS=http://127.0.0.1:3781 FAMILY_BRIDGE_AUDIT_LOG="$OUT/runtime-audit.jsonl" \
  FAMILY_NOKT_SUBSCRIPTION=on FAMILY_NOKT_CREDENTIALS_FILE="$CFG/credentials.json" FAMILY_NOKT_LEDGER_FILE="$OUT/ceiling-ledger.json" \
  FAMILY_NOKT_MODEL=gpt-6.1-sol FAMILY_NOKT_ATTEMPT_CEILING=14 node dist/bridge/main.js > "$OUT/runtime.log" 2>&1 &
RT_PID=$!
cleanup() {
  cmd=$(ps -o command= -p "$RT_PID" 2>/dev/null)
  case "$cmd" in *"dist/bridge/main.js"*) kill -TERM "$RT_PID" 2>/dev/null; echo "stopped owned runtime $RT_PID" ;; esac
}
trap cleanup EXIT INT TERM
i=0; until curl -s -o /dev/null "http://127.0.0.1:$PORT/healthz" || [ $i -ge 50 ]; do sleep 0.2; i=$((i + 1)); done
curl -s "http://127.0.0.1:$PORT/healthz" > "$OUT/runtime-health.json" || { echo "runtime did not come up"; exit 1; }
cd "$APP" || exit 1
FAMILY_BRIDGE_TOKEN_SECRET="$SECRET" node scripts/nokt-v5-fictional-turns.ts --bridge "http://127.0.0.1:$PORT" --origin http://127.0.0.1:3781 --out "$OUT/fictional-turns.json" --max 14 --label real-model
