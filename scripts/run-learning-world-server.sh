#!/bin/sh
# Starts a LOCAL production server of the given app checkout on an isolated database for the world-first
# learning checks (world-first 2026-10-03). Synthetic AUTH_SECRET, no real env, no external service.
#   scripts/run-learning-world-server.sh <app-dir> <db-dir> <port>        start; prints the PID, writes <db-dir>/server.pid
#   scripts/run-learning-world-server.sh --stop <db-dir>                   stops ONLY the server started by this script
# Never kills an arbitrary listener: an occupied port is an error (repair round 1).
set -e
export PATH=/opt/homebrew/bin:$PATH
if [ "$1" = "--stop" ]; then
  DIR=${2:?db dir}
  if [ -f "$DIR/server.pid" ]; then
    PID=$(cat "$DIR/server.pid")
    if kill -0 "$PID" 2>/dev/null && ps -o command= -p "$PID" | grep -q 'next'; then kill "$PID"; echo "stopped $PID"; else echo "no owned server running ($PID)"; fi
    rm -f "$DIR/server.pid"
  else
    echo "no server.pid in $DIR"
  fi
  exit 0
fi
APP=${1:?app dir}
DIR=${2:?db dir}
PORT=${3:-3171}
SECRET=${AUTH_SECRET:-fable-world-first-synthetic-secret-0123456789abcdef}
mkdir -p "$DIR"
cd "$APP"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is already in use; refusing to start (nothing was killed)" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  exit 3
fi
# FAMILY_LEARNING_CONTENT_CAP is forwarded when set (Visit 4 rollback checks start a capped second instance).
# FAMILY_ASSISTANT_BRIDGE_URL / FAMILY_BRIDGE_TOKEN_SECRET are forwarded when set (Visit 5 repair round 1: the harness runs a
# loopback STUB bridge for the plumbing; never the real bridge, never a real secret).
# FAMILY_NOKT_FICTIONAL_STUB is forwarded when set (Visit 7: renders the planned Nokt flow with canned fictional replies; honoured
# by the app only on this kind of isolated local database — never with a Turso URL or on Vercel).
# FAMILY_NOKT_CONVERSATION is forwarded when set (round 16, J7: the real conversation mode against an in-browser bridge answer).
# FAMILY_NOKT_STT_FAKE_FAULT=quota is forwarded when set: the stub's FAKE recognizer then answers like an exhausted provider
# account (429), for the microphone failure regression. Never a provider key, never a real provider.
# FAMILY_NOKT_STT_FAKE=1 is forwarded when set (Visit 8): the FAKE recognizer beside the real conversation mode, honoured only on
# this isolated database — the push-to-talk path without any provider.
env -i PATH="$PATH" HOME="$HOME" AUTH_SECRET="$SECRET" AUTH_URL=http://127.0.0.1:$PORT GOOGLE_CLIENT_ID=synthetic GOOGLE_CLIENT_SECRET=synthetic ${FAMILY_LEARNING_CONTENT_CAP:+FAMILY_LEARNING_CONTENT_CAP="$FAMILY_LEARNING_CONTENT_CAP"} ${FAMILY_ASSISTANT_BRIDGE_URL:+FAMILY_ASSISTANT_BRIDGE_URL="$FAMILY_ASSISTANT_BRIDGE_URL"} ${FAMILY_BRIDGE_TOKEN_SECRET:+FAMILY_BRIDGE_TOKEN_SECRET="$FAMILY_BRIDGE_TOKEN_SECRET"} ${FAMILY_NOKT_FICTIONAL_STUB:+FAMILY_NOKT_FICTIONAL_STUB="$FAMILY_NOKT_FICTIONAL_STUB"} ${FAMILY_NOKT_CONVERSATION:+FAMILY_NOKT_CONVERSATION="$FAMILY_NOKT_CONVERSATION"} ${FAMILY_NOKT_STT_FAKE_FAULT:+FAMILY_NOKT_STT_FAKE_FAULT="$FAMILY_NOKT_STT_FAKE_FAULT"} ${FAMILY_NOKT_STT_FAKE:+FAMILY_NOKT_STT_FAKE="$FAMILY_NOKT_STT_FAKE"} \
  NABU_DB_DIR="$DIR" NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next start -p $PORT -H 127.0.0.1 > "$DIR/server.log" 2>&1 &
SERVER=$!
echo "$SERVER" > "$DIR/server.pid"
for i in $(seq 1 90); do
  if curl -s -o /dev/null http://127.0.0.1:$PORT/login; then echo "$SERVER"; exit 0; fi
  if ! kill -0 "$SERVER" 2>/dev/null; then echo "server exited early; see $DIR/server.log" >&2; exit 1; fi
  sleep 1
done
echo "server did not come up" >&2
exit 1
