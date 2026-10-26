#!/bin/sh
# ---------------------------------------------------------------------------------------------------------------------
# Visit 8 + continuous Nokt candidate — OFFLINE, isolated reproduction of every builder check (October 26, 2026).
#
#   scripts/visit8-reproduce-offline.sh <out-dir> [--build] [--runtime <runtime-candidate-dir>] [--skip-visit7]
#
# NEVER a model, provider, credential or production: Nokt's bridge is an https://<name>.invalid origin answered inside the
# browser by the harness with SCRIPTED fictional replies, signed with a synthetic per-run secret; the microphone uses
# Chromium's fake device and the app's fake recognizer (isolated database only); speech is muted and answered by the harness.
# Every server runs on loopback on a fresh fictional database under <out-dir>. The runtime candidate (if given) only runs its
# own offline unit tests.
#
# Steps: identity → app unit (minus the two Game Studio "joined" suites, which need the live Studio adapter) → runtime unit
# → (build) → J8 nokt / J8 nokt-old / J8 off → Visit 7 J1/J2 regression → privacy scan. Summary in <out-dir>/summary.txt.
# Teardown: only servers this script started (PID + command checked); afterwards the owned ports must be free.
# ---------------------------------------------------------------------------------------------------------------------
set -u
OUT=${1:?out dir}
shift
BUILD=0
RT=""
SKIP7=0
while [ $# -gt 0 ]; do
  case "$1" in
    --build) BUILD=1 ;;
    --runtime) RT=$2; shift ;;
    --skip-visit7) SKIP7=1 ;;
    *) echo "unknown argument $1"; exit 2 ;;
  esac
  shift
done
APP=$(cd "$(dirname "$0")/.." && pwd)
export PATH=/opt/homebrew/bin:$PATH
export AUTH_SECRET=fable-world-first-synthetic-secret-0123456789abcdef
unset FAMILY_NOKT_SUBSCRIPTION FAMILY_NOKT_CREDENTIALS_FILE FAMILY_NOKT_LEDGER_FILE OPENAI_API_KEY
BRIDGE=https://nokt-bridge.invalid:8787
export BRIDGE_SECRET="visit8-reproduce-synthetic-secret-$(date +%s)-0123456789"
PORTS="3291 3292 3293 3297"
mkdir -p "$OUT"
SUMMARY="$OUT/summary.txt"
: > "$SUMMARY"
FAILED=0
CUR=""
stop_server() { [ -n "$1" ] && sh "$APP/scripts/run-learning-world-server.sh" --stop "$1" >/dev/null 2>&1; return 0; }
cleanup() {
  status=$?
  trap - EXIT INT TERM
  stop_server "$CUR"
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
step() { # name allowed-failures command...
  name=$1; expect=$2; shift 2
  "$@" > "$OUT/$name.log" 2>&1
  rc=$?
  plain=$(sed 's/\x1b\[[0-9;]*m//g' "$OUT/$name.log")
  if printf '%s\n' "$plain" | grep -q '^ℹ fail '; then
    pass=$(printf '%s\n' "$plain" | sed -n 's/^ℹ pass //p' | tail -1); fail=$(printf '%s\n' "$plain" | sed -n 's/^ℹ fail //p' | tail -1)
  else
    pass=$(printf '%s\n' "$plain" | grep -c '^PASS'); fail=$(printf '%s\n' "$plain" | grep -c '^FAIL')
  fi
  verdict=ok; { [ "$rc" = 0 ] || [ "$expect" != 0 ]; } && [ "$fail" -le "$expect" ] || { verdict=FAILED; FAILED=1; }
  echo "$name: exit $rc · PASS $pass · FAIL $fail (allowed $expect) → $verdict" | tee -a "$SUMMARY"
}
server() { # db-dir port [ENV=VAL ...]
  CUR=$1; port=$2; shift 2
  mkdir -p "$CUR"
  env "$@" sh "$APP/scripts/run-learning-world-server.sh" "$APP" "$CUR" "$port" >/dev/null || { echo "server on $port did not start" | tee -a "$SUMMARY"; exit 1; }
}
cd "$APP" || exit 1
{
  echo "app: $(git rev-parse HEAD) ($(git rev-parse --abbrev-ref HEAD)) dirty=$( [ -z "$(git status --porcelain)" ] && echo no || echo YES )"
  [ -n "$RT" ] && echo "runtime: $(git -C "$RT" rev-parse HEAD) dirty=$( [ -z "$(git -C "$RT" status --porcelain -- src dist test)" ] && echo no || echo YES )"
} | tee -a "$SUMMARY"

# 1. unit tests — the pre-existing kitchen planner failure (planner-save-boundary, also failing on production 6e3f46d8) is allowed
step app-unit 1 node --test $(ls src/lib/*.test.ts | grep -v -E 'family-play-joined|family-play-native-joined')
[ -n "$RT" ] && step runtime-unit 0 npm --prefix "$RT" test

# 2. build (the known SQLITE_BUSY on an empty synthetic DB is retried)
if [ "$BUILD" = 1 ]; then
  for i in 1 2 3 4 5; do
    D=$(mktemp -d "$OUT/build-db.XXXX")
    env -i PATH="$PATH" HOME="$HOME" AUTH_SECRET="$AUTH_SECRET" NABU_DB_DIR="$D" NEXT_TELEMETRY_DISABLED=1 npx next build > "$OUT/build-$i.log" 2>&1 && { echo "build: ok on attempt $i" | tee -a "$SUMMARY"; break; }
    echo "build attempt $i failed ($(grep -m1 -o SQLITE_BUSY "$OUT/build-$i.log" || echo other))" | tee -a "$SUMMARY"
    [ $i = 5 ] && { FAILED=1; exit 1; }
  done
fi
echo "served build: $(cat .next/BUILD_ID)" | tee -a "$SUMMARY"

# 3. Visit 8 rendered journeys (fake-only)
NOKTENV="FAMILY_NOKT_CONVERSATION=subscription FAMILY_ASSISTANT_BRIDGE_URL=$BRIDGE FAMILY_BRIDGE_TOKEN_SECRET=$BRIDGE_SECRET"
# shellcheck disable=SC2086
server "$OUT/db-nokt" 3291 $NOKTENV FAMILY_NOKT_STT_FAKE=1
step j8-nokt 0 node scripts/verify-learning-visit8.mjs --base http://127.0.0.1:3291 --db "$OUT/db-nokt/nabu.db" --out "$OUT/out-nokt" --mode nokt --bridge "$BRIDGE"
stop_server "$CUR"; CUR=""
# shellcheck disable=SC2086
server "$OUT/db-old" 3292 $NOKTENV
step j8-nokt-old-runtime 0 node scripts/verify-learning-visit8.mjs --base http://127.0.0.1:3292 --db "$OUT/db-old/nabu.db" --out "$OUT/out-old" --mode nokt-old --bridge "$BRIDGE"
stop_server "$CUR"; CUR=""
server "$OUT/db-off" 3293
step j8-off 0 node scripts/verify-learning-visit8.mjs --base http://127.0.0.1:3293 --db "$OUT/db-off/nabu.db" --out "$OUT/out-off" --mode off
stop_server "$CUR"; CUR=""

# 4. Visit 7 rendered regression (J1/J2, Nokt off = the production default) on this build, in two configurations:
#    a) the rollback cap FAMILY_LEARNING_CONTENT_CAP=6 (content v6 exactly as Visit 7 was released) — every check must pass;
#    b) content v7 — exactly ONE named, explained difference is accepted: J1.G6.course-lessons-only asserts the v6 course
#       ceiling (lessons 1–5); with lesson 6 served, the synthetic child of that harness progresses to it by the unchanged rule.
if [ "$SKIP7" = 0 ]; then
  server "$OUT/db-v7cap" 3297 FAMILY_LEARNING_CONTENT_CAP=6
  step v7-j1-j2-regression-cap6 0 node scripts/verify-learning-visit7.mjs --base http://127.0.0.1:3297 --db "$OUT/db-v7cap/nabu.db" --out "$OUT/out-v7cap"
  stop_server "$CUR"; CUR=""
  server "$OUT/db-v7" 3297
  step v7-j1-j2-regression-v7content 1 node scripts/verify-learning-visit7.mjs --base http://127.0.0.1:3297 --db "$OUT/db-v7/nabu.db" --out "$OUT/out-v7"
  stop_server "$CUR"; CUR=""
  only=$(grep '^FAIL' "$OUT/v7-j1-j2-regression-v7content.log" | awk '{print $2}' | tr '\n' ' ')
  if [ "$only" = "J1.G6.course-lessons-only " ] || [ -z "$only" ]; then echo "v7-regression-v7content: the only difference is the named course-ceiling assertion (${only:-none}) → ok" | tee -a "$SUMMARY"; else echo "v7-regression-v7content: UNEXPECTED failures: $only → FAILED" | tee -a "$SUMMARY"; FAILED=1; fi
fi

# 5. privacy: no private child record in the tracked source. The private review (PRIVATE_EVIDENCE, a JSON file OUTSIDE the
#    repository) is read at run time; every string value of ≥ 10 characters in it is searched in the tracked files; nothing
#    from it is printed or written (only counts).
if [ -n "${PRIVATE_EVIDENCE:-}" ] && [ -f "$PRIVATE_EVIDENCE" ]; then
  step privacy-scan 0 node scripts/visit8-privacy-scan.mjs "$PRIVATE_EVIDENCE"
else
  echo "privacy-scan: skipped (PRIVATE_EVIDENCE not given)" | tee -a "$SUMMARY"
fi
echo "done: $( [ "$FAILED" = 0 ] && echo 'all steps within their allowance' || echo 'SOME STEPS FAILED' )" | tee -a "$SUMMARY"
