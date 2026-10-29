#!/bin/sh
# ---------------------------------------------------------------------------------------------------------------------
# Isabel Visit 2 «Idas Garten» + narration standard — OFFLINE, isolated reproduction of every builder check (2026-10-29).
#
#   scripts/isabel-visit2-reproduce-offline.sh <out-dir> [--build] [--skip-santiago]
#
# NEVER a model, provider, credential or production: loopback servers on fresh fictional databases under <out-dir>, synthetic
# AUTH_SECRET, Nokt's bridge an https://<name>.invalid origin, device voices mocked, browser audio guarded (host must be muted).
# Steps: identity → app unit (minus the two Game Studio "joined" suites) → (build) → Isabel Visit 2 journey (Nokt conversation
# ON, as in production) → device variants (no German voice / autoplay refused with recorded clips) → Isabel rollback cap 1 →
# Isabel Visit 1 released journey under cap 1 and under content v2 → Isabel content off → Santiago-capped rollout → Santiago
# Visit 8 (Nokt / old runtime / off) → Visit 7 J1/J2 (cap 6 and content v7). Summary in <out-dir>/summary.txt.
# Teardown: only servers this script started (PID + command checked); afterwards the owned ports must be free.
# ---------------------------------------------------------------------------------------------------------------------
set -u
OUT=${1:?out dir}
shift
BUILD=0
SKIPS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --build) BUILD=1 ;;
    --skip-santiago) SKIPS=1 ;;
    *) echo "unknown argument $1"; exit 2 ;;
  esac
  shift
done
APP=$(cd "$(dirname "$0")/.." && pwd)
export PATH=/opt/homebrew/bin:$PATH
export AUTH_SECRET=fable-world-first-synthetic-secret-0123456789abcdef
unset FAMILY_NOKT_SUBSCRIPTION FAMILY_NOKT_CREDENTIALS_FILE FAMILY_NOKT_LEDGER_FILE OPENAI_API_KEY ELEVENLABS_API_KEY ELEVENLABS_VOICE_DE_FEMALE_ID ELEVENLABS_VOICE_DE_MALE_ID ELEVENLABS_VOICE_ES_FEMALE_ID ELEVENLABS_VOICE_ES_MALE_ID ELEVENLABS_VOICE_EN_FEMALE_ID ELEVENLABS_VOICE_EN_MALE_ID BLOB_READ_WRITE_TOKEN
BRIDGE=https://nokt-bridge.invalid:8787
export BRIDGE_SECRET="isabel-v2-reproduce-synthetic-secret-$(date +%s)-0123456789"
PORTS="3291 3292 3293 3294 3295 3297"
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
if [ "$(osascript -e 'output muted of (get volume settings)' 2>/dev/null)" != "true" ]; then echo "host audio is not muted; refusing to run rendered checks (mute it first)" | tee -a "$SUMMARY"; exit 4; fi
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
echo "app: $(git rev-parse HEAD) ($(git rev-parse --abbrev-ref HEAD)) dirty=$( [ -z "$(git status --porcelain)" ] && echo no || echo YES )" | tee -a "$SUMMARY"

# 1. unit tests — the pre-existing kitchen planner failure (planner-save-boundary, also failing on production 39e4fef8) is allowed
step app-unit 1 node --test $(ls src/lib/*.test.ts | grep -v -E 'family-play-joined|family-play-native-joined')
step isabel-unit 0 node --test src/lib/family-learning-isabel.test.ts src/lib/family-learning-isabel-visit2.test.ts
step content-parity 0 node scripts/sync-family-learning.mjs --check

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
NOKTENV="FAMILY_NOKT_CONVERSATION=subscription FAMILY_ASSISTANT_BRIDGE_URL=$BRIDGE FAMILY_BRIDGE_TOKEN_SECRET=$BRIDGE_SECRET"

# 3. Isabel Visit 2 (rendered, fake-only) and its device variants
# shellcheck disable=SC2086
server "$OUT/db-v2" 3291 $NOKTENV
step isabel-v2-journey 0 node scripts/verify-learning-isabel-visit2.mjs --base http://127.0.0.1:3291 --db "$OUT/db-v2/nabu.db" --out "$OUT/out-v2" --mode v2
stop_server "$CUR"; CUR=""
server "$OUT/db-branches" 3292
step isabel-v2-branches 0 node scripts/verify-learning-isabel-visit2.mjs --base http://127.0.0.1:3292 --db "$OUT/db-branches/nabu.db" --out "$OUT/out-branches" --mode branches
stop_server "$CUR"; CUR=""
server "$OUT/db-voices" 3292 FAMILY_STORY_VOICES=recorded ELEVENLABS_VOICE_DE_FEMALE_ID=FakeVoiceDeF123 ELEVENLABS_VOICE_ES_FEMALE_ID=FakeVoiceEsF123 ELEVENLABS_VOICE_EN_FEMALE_ID=FakeVoiceEnF123
step story-voices-configured-unrecorded 0 node scripts/verify-learning-isabel-visit2.mjs --base http://127.0.0.1:3292 --db "$OUT/db-voices/nabu.db" --out "$OUT/out-voices" --mode voices
stop_server "$CUR"; CUR=""
# Voice ids configured but the children's switch still off (the parked release): child pages keep their earlier routes.
server "$OUT/db-voices-off" 3292 ELEVENLABS_VOICE_DE_FEMALE_ID=FakeVoiceDeF123 ELEVENLABS_VOICE_ES_FEMALE_ID=FakeVoiceEsF123 ELEVENLABS_VOICE_EN_FEMALE_ID=FakeVoiceEnF123
step story-voices-configured-switch-off 0 node scripts/verify-learning-isabel-visit2.mjs --base http://127.0.0.1:3292 --db "$OUT/db-voices-off/nabu.db" --out "$OUT/out-voices-off" --mode voices-off
stop_server "$CUR"; CUR=""
server "$OUT/db-novoice" 3292
step isabel-v2-no-german-voice 0 node scripts/verify-learning-isabel-visit2.mjs --base http://127.0.0.1:3292 --db "$OUT/db-novoice/nabu.db" --out "$OUT/out-novoice" --mode novoice
stop_server "$CUR"; CUR=""
server "$OUT/db-denied" 3293
step isabel-v2-autoplay-refused 0 node scripts/verify-learning-isabel-visit2.mjs --base http://127.0.0.1:3293 --db "$OUT/db-denied/nabu.db" --out "$OUT/out-denied" --mode denied
stop_server "$CUR"; CUR=""

# 4. Isabel rollback (cap 1) and Visit 1 as released
server "$OUT/db-cap1" 3294 FAMILY_LEARNING_ISABEL_CONTENT_CAP=1
step isabel-cap1-rollback 0 node scripts/verify-learning-isabel-visit2.mjs --base http://127.0.0.1:3294 --db "$OUT/db-cap1/nabu.db" --out "$OUT/out-cap1" --mode cap1
stop_server "$CUR"; CUR=""
# shellcheck disable=SC2086
server "$OUT/db-v1cap" 3295 FAMILY_LEARNING_ISABEL_CONTENT_CAP=1 $NOKTENV
step isabel-v1-journey-cap1 0 node scripts/verify-learning-isabel.mjs --base http://127.0.0.1:3295 --db "$OUT/db-v1cap/nabu.db" --out "$OUT/out-v1cap" --mode isabel
stop_server "$CUR"; CUR=""
# Under content v2 the released Visit 1 journey runs unchanged except exactly two named, intended differences:
#   I1-01.visit-started-own-content (her record now carries content version 2) and
#   I1-08.hub-after-shows-done-and-her-wish-not-a-new-visit (Visit 2 is offered after Visit 1). Checked by name below.
# shellcheck disable=SC2086
server "$OUT/db-v1v2" 3295 $NOKTENV
step isabel-v1-journey-content-v2 2 node scripts/verify-learning-isabel.mjs --base http://127.0.0.1:3295 --db "$OUT/db-v1v2/nabu.db" --out "$OUT/out-v1v2" --mode isabel
stop_server "$CUR"; CUR=""
if [ "$(sed 's/\x1b\[[0-9;]*m//g' "$OUT/isabel-v1-journey-content-v2.log" | grep '^FAIL' | awk '{print $2}' | sort | tr '\n' ' ')" != "I1-01.visit-started-own-content I1-08.hub-after-shows-done-and-her-wish-not-a-new-visit " ]; then echo "isabel-v1-journey-content-v2: unexpected failure set → FAILED" | tee -a "$SUMMARY"; FAILED=1; else echo "isabel-v1-journey-content-v2: exactly the two named differences" | tee -a "$SUMMARY"; fi
server "$OUT/db-off" 3295 FAMILY_LEARNING_ISABEL_CONTENT=off
step isabel-content-off 0 node scripts/verify-learning-isabel.mjs --base http://127.0.0.1:3295 --db "$OUT/db-off/nabu.db" --out "$OUT/out-off" --mode isabel-off
stop_server "$CUR"; CUR=""
# shellcheck disable=SC2086
server "$OUT/db-rollout" 3295 FAMILY_LEARNING_CONTENT_CAP=6 $NOKTENV
step santiago-capped-rollout 0 node scripts/verify-learning-isabel.mjs --base http://127.0.0.1:3295 --db "$OUT/db-rollout/nabu.db" --out "$OUT/out-rollout" --mode rollout-isabel-only
stop_server "$CUR"; CUR=""

# 5. Santiago regressions (unchanged harnesses)
if [ "$SKIPS" = 0 ]; then
  # shellcheck disable=SC2086
  server "$OUT/db-j8" 3291 $NOKTENV FAMILY_NOKT_STT_FAKE=1
  step santiago-j8-nokt 0 node scripts/verify-learning-visit8.mjs --base http://127.0.0.1:3291 --db "$OUT/db-j8/nabu.db" --out "$OUT/out-j8" --mode nokt --bridge "$BRIDGE"
  stop_server "$CUR"; CUR=""
  # shellcheck disable=SC2086
  server "$OUT/db-j8old" 3292 $NOKTENV
  step santiago-j8-nokt-old-runtime 0 node scripts/verify-learning-visit8.mjs --base http://127.0.0.1:3292 --db "$OUT/db-j8old/nabu.db" --out "$OUT/out-j8old" --mode nokt-old --bridge "$BRIDGE"
  stop_server "$CUR"; CUR=""
  server "$OUT/db-j8off" 3293
  step santiago-j8-off 0 node scripts/verify-learning-visit8.mjs --base http://127.0.0.1:3293 --db "$OUT/db-j8off/nabu.db" --out "$OUT/out-j8off" --mode off
  stop_server "$CUR"; CUR=""
  server "$OUT/db-v7cap" 3297 FAMILY_LEARNING_CONTENT_CAP=6
  step santiago-v7-j1-j2-cap6 0 node scripts/verify-learning-visit7.mjs --base http://127.0.0.1:3297 --db "$OUT/db-v7cap/nabu.db" --out "$OUT/out-v7cap"
  stop_server "$CUR"; CUR=""
  server "$OUT/db-v7" 3297
  step santiago-v7-j1-j2-content-v7 0 node scripts/verify-learning-visit7.mjs --base http://127.0.0.1:3297 --db "$OUT/db-v7/nabu.db" --out "$OUT/out-v7"
  stop_server "$CUR"; CUR=""
fi
echo "done: $( [ "$FAILED" = 0 ] && echo 'all steps within their allowance' || echo 'SOME STEPS FAILED' )" | tee -a "$SUMMARY"
