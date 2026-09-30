#!/bin/sh
# Runs the follow-on browser/HTTP check against a local production server on an isolated database.
# Usage: scripts/run-learning-followon-check.sh /tmp/<fresh-dir> [--backdate-days N]
set -e
export PATH=/opt/homebrew/bin:$PATH
APP=/Users/claweberle/Projects/companion-app/app
DIR=${1:?fresh dir}
shift
PORT=${PORT:-3151}
SECRET=${AUTH_SECRET:-fable-followon-synthetic-secret-0123456789abcdef}
mkdir -p "$DIR"
cd "$APP"
node scripts/verify-learning-followon.mjs --seed --dir "$DIR" "$@"
lsof -ti tcp:$PORT | xargs kill 2>/dev/null || true
env -i PATH="$PATH" HOME="$HOME" AUTH_SECRET="$SECRET" AUTH_URL=http://127.0.0.1:$PORT GOOGLE_CLIENT_ID=synthetic GOOGLE_CLIENT_SECRET=synthetic \
  NABU_DB_DIR="$DIR" NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next start -p $PORT -H 127.0.0.1 > "$DIR/server.log" 2>&1 &
SERVER=$!
for i in $(seq 1 60); do
  if curl -s -o /dev/null http://127.0.0.1:$PORT/login; then break; fi
  sleep 1
done
set +e
AUTH_SECRET="$SECRET" node scripts/verify-learning-followon.mjs --base http://127.0.0.1:$PORT --out "$DIR/out" --db "$DIR/nabu.db"
CODE=$?
kill $SERVER 2>/dev/null; lsof -ti tcp:$PORT | xargs kill 2>/dev/null || true
echo "remaining listeners on $PORT: $(lsof -ti tcp:$PORT | wc -l | tr -d ' ')"
exit $CODE
