#!/bin/sh
# Starts a LOCAL production server of this checkout on an isolated database for the Family Home / paid-play
# self-checks (2026-10-04). Synthetic AUTH_SECRET and FAMILY_GAMES_TOKEN_SECRET, no real env, no external service.
#   scripts/run-family-home-server.sh <app-dir> <db-dir> <port> [studio-url]   start; prints the PID, writes <db-dir>/server.pid
#   scripts/run-family-home-server.sh --stop <db-dir>                          stops ONLY the server started by this script
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
PORT=${3:-3181}
STUDIO=${4:-}
SECRET=${AUTH_SECRET:-fable-family-home-synthetic-secret-0123456789abcdef}
GAMES_SECRET=${FAMILY_GAMES_TOKEN_SECRET:-fable-family-games-synthetic-secret-0123456789abcdef}
mkdir -p "$DIR"
cd "$APP"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is already in use; refusing to start (nothing was killed)" >&2
  exit 3
fi
env -i PATH="$PATH" HOME="$HOME" AUTH_SECRET="$SECRET" AUTH_URL=http://127.0.0.1:$PORT GOOGLE_CLIENT_ID=synthetic GOOGLE_CLIENT_SECRET=synthetic \
  FAMILY_GAMES_TOKEN_SECRET="$GAMES_SECRET" ${STUDIO:+FAMILY_GAMES_STUDIO_URL="$STUDIO"} \
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
