#!/bin/sh
# ---------------------------------------------------------------------------------------------------------------------
# Visit 7 + Nokt candidate — OFFLINE, isolated reproduction of every builder gate (round 13).
#
#   scripts/visit7-reproduce-offline.sh <out-dir> [--build] [--runtime <runtime-candidate-dir>]
#                                       [--heldout <heldout-r5.mjs> --artifact-spec <spec.json>]
#
# NEVER a model, provider, credential or production: the only "bridge" is the loopback STUB (scripts/visit7-nokt-stub-bridge.mjs)
# with a synthetic per-run secret; FAMILY_NOKT_SUBSCRIPTION is never set and no credentials file is read; the runtime candidate
# (if given) only runs its own offline unit tests. Every server runs on loopback on a fresh fictional DB under <out-dir>.
#
# Steps: identity → app unit tests → runtime unit tests → (build) → J1/J2 (Nokt unavailable) → J3 stub → J3F provider-429
# fault → J4 browser-mediated turn through the stub → J6 dry outcome personas through the stub (SCRIPTED final replies,
# labelled so; they are not model evidence) → held-out → parent gate probe. Summary in <out-dir>/summary.txt.
#
# Teardown: only processes this script started (PID + command + cwd checked), on exit, error, INT or TERM; afterwards the
# owned ports must be free. Nothing is killed by name or port.
# ---------------------------------------------------------------------------------------------------------------------
set -u
OUT=${1:?out dir}
shift
BUILD=0
RT=""
HELDOUT=""
SPEC=""
while [ $# -gt 0 ]; do
  case "$1" in
    --build) BUILD=1 ;;
    --runtime) RT=$2; shift ;;
    --heldout) HELDOUT=$2; shift ;;
    --artifact-spec) SPEC=$2; shift ;;
    *) echo "unknown argument $1"; exit 2 ;;
  esac
  shift
done
APP=$(cd "$(dirname "$0")/.." && pwd)
export PATH=/opt/homebrew/bin:$PATH
export AUTH_SECRET=fable-world-first-synthetic-secret-0123456789abcdef
unset FAMILY_NOKT_SUBSCRIPTION FAMILY_NOKT_CREDENTIALS_FILE FAMILY_NOKT_LEDGER_FILE FAMILY_BRIDGE_TOKEN_SECRET
STUB_SECRET="visit7-reproduce-stub-synthetic-secret-$(date +%s)-0123456789"
PORTS="3187 3196 3197 3198 3199 3299"
mkdir -p "$OUT/out"
SUMMARY="$OUT/summary.txt"
: > "$SUMMARY"
STUB_PID=""
H_PID=""
H_FRAG=""
CUR_DB=""
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
  return 0
}
stop_server() { # db-dir
  [ -n "$1" ] && [ -f "$1/server.pid" ] && owned_stop "$(cat "$1/server.pid")" "next start" "$APP" "next-server" && rm -f "$1/server.pid"
  return 0
}
cleanup() {
  status=$?
  trap - EXIT INT TERM
  owned_stop "$H_PID" "$H_FRAG" "$APP"
  stop_server "$CUR_DB"
  owned_stop "$STUB_PID" "visit7-nokt-stub-bridge.mjs" "$APP"
  left=""
  for p in $PORTS; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && left="$left $p"; done
  if [ -n "$left" ]; then echo "OWNED PORTS STILL LISTENING:$left" | tee -a "$SUMMARY"; status=1; else echo "owned ports free ($PORTS)" | tee -a "$SUMMARY"; fi
  [ "$FAILED" = 0 ] || [ "$status" != 0 ] || status=1
  exit $status
}
trap cleanup EXIT
trap 'exit 130' INT TERM

for p in $PORTS; do
  if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; then echo "port $p is in use; refusing to start (nothing was killed)"; exit 3; fi
done

# A step runs as an owned background job the script waits on (INT/TERM interrupt it promptly).
step() { # name expected-fails command...
  name=$1; expect=$2; shift 2
  H_FRAG=$1
  "$@" > "$OUT/$name.log" 2>&1 &
  H_PID=$!
  wait "$H_PID"; rc=$?; H_PID=""
  plain=$(sed 's/\x1b\[[0-9;]*m//g' "$OUT/$name.log")
  if printf '%s\n' "$plain" | grep -q '^ℹ fail '; then # node --test summary
    pass=$(printf '%s\n' "$plain" | sed -n 's/^ℹ pass //p' | tail -1); fail=$(printf '%s\n' "$plain" | sed -n 's/^ℹ fail //p' | tail -1)
  else
    pass=$(printf '%s\n' "$plain" | grep -c '^PASS'); fail=$(printf '%s\n' "$plain" | grep -c '^FAIL')
  fi
  verdict=ok; { [ "$rc" = 0 ] || [ "$expect" != 0 ]; } && [ "$fail" -le "$expect" ] || { verdict=FAILED; FAILED=1; }
  echo "$name: exit $rc · PASS $pass · FAIL $fail (allowed $expect) → $verdict" | tee -a "$SUMMARY"
}
server() { # db-dir port [ENV=VAL ...]
  CUR_DB=$1; port=$2; shift 2
  mkdir -p "$CUR_DB"
  env "$@" sh "$APP/scripts/run-learning-world-server.sh" "$APP" "$CUR_DB" "$port" >/dev/null || { echo "server on $port did not start" | tee -a "$SUMMARY"; exit 1; }
}

cd "$APP" || exit 1
{
  echo "app: $(git rev-parse HEAD) ($(git rev-parse --abbrev-ref HEAD)) dirty=$( [ -z "$(git status --porcelain)" ] && echo no || echo YES )"
  [ -n "$RT" ] && echo "runtime: $(git -C "$RT" rev-parse HEAD) dirty=$( [ -z "$(git -C "$RT" status --porcelain)" ] && echo no || echo YES )"
} | tee -a "$SUMMARY"

# 1. unit tests (the pre-existing kitchen planner-save-boundary failure is the one allowed failure)
step app-unit 1 npm test
[ -n "$RT" ] && step runtime-unit 0 npm --prefix "$RT" test

# 2. build (optional; the known SQLITE_BUSY on the empty synthetic DB is retried)
if [ "$BUILD" = 1 ]; then
  for i in 1 2 3 4 5; do
    D=$(mktemp -d "$OUT/build-db.XXXX")
    env -i PATH="$PATH" HOME="$HOME" AUTH_SECRET="$AUTH_SECRET" NABU_DB_DIR="$D" NEXT_TELEMETRY_DISABLED=1 npx next build > "$OUT/build-$i.log" 2>&1 && { echo "build: ok on attempt $i" | tee -a "$SUMMARY"; break; }
    echo "build attempt $i failed ($(grep -m1 -o SQLITE_BUSY "$OUT/build-$i.log" || echo other))" | tee -a "$SUMMARY"
    [ $i = 5 ] && { FAILED=1; exit 1; }
  done
fi
echo "served build: $(cat .next/BUILD_ID) (built from the source in this worktree at build time; see build logs / inventory)" | tee -a "$SUMMARY"

# 3. rendered gates
server "$OUT/db-j1" 3197
step j1-j2 0 node scripts/verify-learning-visit7.mjs --base http://127.0.0.1:3197 --db "$OUT/db-j1/nabu.db" --out "$OUT/out"
stop_server "$CUR_DB"; CUR_DB=""
server "$OUT/db-j3" 3198 FAMILY_NOKT_FICTIONAL_STUB=1
step j3-stub 0 node scripts/verify-learning-visit7.mjs --base http://127.0.0.1:3198 --stub-base http://127.0.0.1:3198 --only-stub --db "$OUT/db-j3/nabu.db" --out "$OUT/out"
stop_server "$CUR_DB"; CUR_DB=""
server "$OUT/db-j3f" 3199 FAMILY_NOKT_FICTIONAL_STUB=1 FAMILY_NOKT_STT_FAKE_FAULT=quota
step j3f-fault 0 node scripts/verify-learning-visit7.mjs --base http://127.0.0.1:3199 --stub-base http://127.0.0.1:3199 --only-stub --stub-fault --db "$OUT/db-j3f/nabu.db" --out "$OUT/out"
stop_server "$CUR_DB"; CUR_DB=""

FAMILY_BRIDGE_TOKEN_SECRET="$STUB_SECRET" node scripts/visit7-nokt-stub-bridge.mjs 3299 "$OUT/stub-bridge.jsonl" http://127.0.0.1:3196 > "$OUT/stub-bridge.log" 2>&1 &
STUB_PID=$!
sleep 1
STUBENV="FAMILY_NOKT_FICTIONAL_STUB=1 FAMILY_ASSISTANT_BRIDGE_URL=http://127.0.0.1:3299 FAMILY_BRIDGE_TOKEN_SECRET=$STUB_SECRET"
# shellcheck disable=SC2086
server "$OUT/db-j4" 3196 $STUBENV
step j4-turn 0 node scripts/verify-learning-visit7.mjs --base http://127.0.0.1:3196 --stub-base http://127.0.0.1:3196 --only-stub --turn --bridge-log "$OUT/stub-bridge.jsonl" --bridge-origin http://127.0.0.1:3299 --db "$OUT/db-j4/nabu.db" --out "$OUT/out"
stop_server "$CUR_DB"; CUR_DB=""

# J6 dry: SCRIPTED final replies through the stub (receipt model openai/stub-fictional) — app binding and parent record only.
# F-null uses the exact bytes of round 12's live F reply (no outcome); F-accepted and G-refused carry scripted judgements.
F_NULL='{"v":1,"say":"Du unterscheidest jetzt zwischen ganz gefüllten Tragen und der Trage mit zwei Setzlingen. Wie rechnest du jetzt weiter?","intent":"ask-method","outcome":null}'
F_ACC='{"v":1,"say":"Wie willst du jetzt neu rechnen?","intent":"close","outcome":{"status":"understood_with_support","support":"clarification","next":"retry"}}'
G_REF='{"v":1,"say":"Probier es oben noch einmal.","intent":"close","outcome":{"status":"understood","support":"none","next":"retry"}}'
for case in "F-null:F:$F_NULL" "F-accepted:F:$F_ACC" "G-refused:G:$G_REF"; do
  label=${case%%:*}; rest=${case#*:}; persona=${rest%%:*}; final=${rest#*:}
  mkdir -p "$OUT/out-$label"
  # shellcheck disable=SC2086
  server "$OUT/db-j6-$label" 3196 $STUBENV
  step "j6-dry-$label" 0 node scripts/verify-learning-visit7.mjs --base http://127.0.0.1:3196 --stub-base http://127.0.0.1:3196 --only-stub --turn --persona "$persona" --bridge-origin http://127.0.0.1:3299 --stub-bridge-origin http://127.0.0.1:3299 --dry-final-scripted "$final" --db "$OUT/db-j6-$label/nabu.db" --out "$OUT/out-$label"
  stop_server "$CUR_DB"; CUR_DB=""
done
owned_stop "$STUB_PID" "visit7-nokt-stub-bridge.mjs" "$APP"; STUB_PID=""

# 4. held-out (Nabu's script, run-time provenance) and the parent gate probe
if [ -n "$HELDOUT" ]; then
  server "$OUT/db-heldout" 3187
  step heldout 0 node "$HELDOUT" --base http://127.0.0.1:3187 --db "$OUT/db-heldout/nabu.db" --out "$OUT/out-heldout" --source "$APP" ${SPEC:+--artifact-spec "$SPEC"}
  stop_server "$CUR_DB"; CUR_DB=""
fi
step gate-probe 0 node scripts/visit7-tutor-gate-probe.mts "$OUT/probe-observations.json"
echo "done: $( [ "$FAILED" = 0 ] && echo 'all steps within their allowance' || echo 'SOME STEPS FAILED' )" | tee -a "$SUMMARY"
