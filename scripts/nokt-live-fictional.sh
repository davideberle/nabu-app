#!/bin/sh
# ---------------------------------------------------------------------------------------------------------------------
# Nokt — live FICTIONAL run on the subscription, isolated candidates only (round 12).
#
#   scripts/nokt-live-fictional.sh <runtime-candidate-dir> <out-dir> <persona> [<persona> ...]
#
# Starts, on loopback only: the runtime candidate (127.0.0.1:8797, FAMILY_NOKT_MODEL=gpt-6.1-sol, ceiling 11 since the
# owner's one-call extension of Oct 23 19:29, the project-owned credential), the loopback stub bridge for SCRIPTED history (127.0.0.1:3299, same per-run synthetic
# secret), and one isolated app server per persona (127.0.0.1:3196, fresh fictional DB). Every model attempt is reserved
# in the runtime's ledger before its request; nothing here retries.
#
# Teardown (round-11 lesson): every process this script starts is recorded with the PID of the PROCESS ITSELF (node is
# exec'd, not wrapped in a subshell), and only those PIDs are stopped — after checking their command and working
# directory — on normal exit, error, INT or TERM. Afterwards the owned ports must be free, or the script exits non-zero.
# It never kills by name or port. The harness runs as an owned background job that the script `wait`s on, so INT/TERM
# interrupt it promptly (Playwright closes its own browser on the signal). Any persona failure → non-zero exit.
# ---------------------------------------------------------------------------------------------------------------------
set -u
RT=${1:?runtime candidate dir}
OUT=${2:?out dir}
shift 2
APP=$(cd "$(dirname "$0")/.." && pwd)
CFG=$HOME/.config/family-assistant-runtime/nokt-subscription
SECRET="nokt-live-run-synthetic-secret-$(date +%s)-0123456789abcdef"
export AUTH_SECRET=fable-world-first-synthetic-secret-0123456789abcdef
mkdir -p "$OUT/out"
RT_PID=""
STUB_PID=""
APP_DB=""
H_PID=""
FAILED=0

owned_stop() { # pid expected-command-fragment expected-cwd [alternative-fragment]
  pid=$1; frag=$2; cwd=$3; alt=${4:-$2}
  [ -n "$pid" ] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  cmd=$(ps -o command= -p "$pid" 2>/dev/null)
  pcwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | tail -1)
  case "$cmd" in *"$frag"* | *"$alt"*) ;; *) echo "not stopping $pid: command is not ours ($cmd)"; return 1 ;; esac
  [ "$pcwd" = "$cwd" ] || { echo "not stopping $pid: cwd $pcwd is not $cwd"; return 1; }
  kill -TERM "$pid" 2>/dev/null
  i=0; while kill -0 "$pid" 2>/dev/null && [ $i -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
  kill -0 "$pid" 2>/dev/null && { echo "owned $pid did not stop"; return 1; }
  echo "stopped owned $frag ($pid)"
}
cleanup() {
  status=$?
  trap - EXIT INT TERM
  owned_stop "$H_PID" "verify-learning-visit7.mjs" "$APP"
  [ -n "$APP_DB" ] && [ -f "$APP_DB/server.pid" ] && owned_stop "$(cat "$APP_DB/server.pid")" "next start" "$APP" "next-server" && rm -f "$APP_DB/server.pid"
  owned_stop "$RT_PID" "dist/bridge/main.js" "$RT"
  owned_stop "$STUB_PID" "visit7-nokt-stub-bridge.mjs" "$APP"
  left=$(lsof -nP -iTCP:3196 -iTCP:8797 -iTCP:3299 -sTCP:LISTEN 2>/dev/null | tail -n +2)
  if [ -n "$left" ]; then echo "OWNED PORTS STILL LISTENING:"; echo "$left"; status=1; else echo "owned ports free (3196, 8797, 3299)"; fi
  [ "$FAILED" = 0 ] || [ "$status" != 0 ] || status=1
  exit $status
}
trap cleanup EXIT
trap 'exit 130' INT TERM

for port in 3196 8797 3299; do
  if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then echo "port $port is in use; refusing to start (nothing was killed)"; exit 3; fi
done

cd "$RT" || exit 1
env -i PATH="$PATH" HOME="$HOME" FAMILY_BRIDGE_TOKEN_SECRET="$SECRET" FAMILY_BRIDGE_BIND=127.0.0.1 FAMILY_BRIDGE_PORT=8797 \
  FAMILY_BRIDGE_ALLOWED_ORIGINS=http://127.0.0.1:3196 FAMILY_BRIDGE_AUDIT_LOG="$OUT/runtime-audit.jsonl" \
  FAMILY_NOKT_SUBSCRIPTION=on FAMILY_NOKT_CREDENTIALS_FILE="$CFG/credentials.json" FAMILY_NOKT_LEDGER_FILE="$CFG/ledger.json" \
  FAMILY_NOKT_MODEL=gpt-6.1-sol FAMILY_NOKT_ATTEMPT_CEILING=11 node dist/bridge/main.js > "$OUT/runtime.log" 2>&1 &
RT_PID=$!
cd "$APP" || exit 1
FAMILY_BRIDGE_TOKEN_SECRET="$SECRET" node scripts/visit7-nokt-stub-bridge.mjs 3299 "$OUT/stub-bridge.jsonl" http://127.0.0.1:3196 > "$OUT/stub-bridge.log" 2>&1 &
STUB_PID=$!
i=0; until curl -s -o /dev/null http://127.0.0.1:8797/healthz || [ $i -ge 50 ]; do sleep 0.2; i=$((i + 1)); done
curl -s http://127.0.0.1:8797/healthz > "$OUT/runtime-health.json" || { echo "runtime did not come up"; exit 1; }
echo "runtime $RT_PID ($(ps -o command= -p $RT_PID)) · stub $STUB_PID · health $(cat "$OUT/runtime-health.json")"

for P in "$@"; do
  APP_DB="$OUT/db-$P"; mkdir -p "$APP_DB"
  FAMILY_BRIDGE_TOKEN_SECRET="$SECRET" FAMILY_NOKT_FICTIONAL_STUB=1 FAMILY_ASSISTANT_BRIDGE_URL=http://127.0.0.1:8797 sh scripts/run-learning-world-server.sh "$APP" "$APP_DB" 3196 >/dev/null || exit 1
  node scripts/verify-learning-visit7.mjs --base http://127.0.0.1:3196 --stub-base http://127.0.0.1:3196 --only-stub --turn --persona "$P" --bridge-origin http://127.0.0.1:8797 --stub-bridge-origin http://127.0.0.1:3299 --db "$APP_DB/nabu.db" --out "$OUT/out" > "$OUT/harness-$P.log" 2>&1 &
  H_PID=$!
  wait "$H_PID"; hs=$?; H_PID=""
  owned_stop "$(cat "$APP_DB/server.pid")" "next start" "$APP" "next-server" && rm -f "$APP_DB/server.pid"; APP_DB=""
  fails=$(grep -c ^FAIL "$OUT/harness-$P.log"); [ "$hs" = 0 ] && [ "$fails" = 0 ] || FAILED=1
  echo "persona $P: PASS $(grep -c ^PASS "$OUT/harness-$P.log") FAIL $fails (harness exit $hs)"
done
