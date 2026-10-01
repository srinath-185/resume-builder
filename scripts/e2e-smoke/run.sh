#!/usr/bin/env bash
# End-to-end smoke test against real services, fully isolated and torn down afterwards:
#   - a throwaway mongod on 127.0.0.1:27999 (needs `mongod` on PATH)
#   - a fake OpenAI-compatible LLM on 127.0.0.1:3999 (wired in through GROQ_BASE_URL)
#   - a local fake job site driven by real headless Chrome
#   - the compiled API on 127.0.0.1:3101 and the built frontend (vite preview) on 127.0.0.1:5301
# Flow: register → upload → parse → listing → tailor → review → approve → assisted apply.
# Usage: scripts/e2e-smoke/run.sh   (after `npm install` in backend/ and frontend/, and `npm run build` in frontend/)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
W=/tmp/rb-smoke
# A stale process on any of these ports would silently answer instead of the code under test.
for port in 27999 3999 3101 5301; do
  if (exec 3<>/dev/tcp/127.0.0.1/$port) 2>/dev/null; then echo "port $port is already in use; stop that process first" >&2; exit 2; fi
done
rm -rf $W && mkdir -p $W/db $W/storage
cleanup() {
  for pid in $(cat $W/pids 2>/dev/null); do kill "$pid" 2>/dev/null; done
  mongod --dbpath $W/db --shutdown >/dev/null 2>&1
  sleep 1
  rm -rf $W
}
trap cleanup EXIT

mongod --dbpath $W/db --port 27999 --bind_ip 127.0.0.1 --fork --logpath $W/mongod.log >/dev/null && echo "mongod up on 27999 (isolated, temporary)"
(cd "$REPO/backend" && npm run build >/dev/null 2>&1) && echo "backend built"
node "$HERE/fake-llm.js" > $W/llm.log 2>&1 & echo $! >> $W/pids
node "$HERE/fake-site.js" > $W/site.log 2>&1 & echo $! >> $W/pids
# The fakes import compiled test helpers (which load the app's modules); wait until they listen.
for _ in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:3999/ && [ -s $W/site-url ] && break; sleep 0.5; done
echo "fakes up: llm $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3999/) · site $(cat $W/site-url)"

(cd "$REPO/backend" && PORT=3101 HOST=127.0.0.1 NODE_ENV=production LOG_LEVEL=warn REGISTRATION_MODE=open \
  MONGODB_URL=mongodb://127.0.0.1:27999/rb_smoke JWT_SECRET=smoke-secret-0123456789-abcdefghij ENCRYPTION_KEY=$(printf 'ab%.0s' $(seq 32)) \
  GROQ_API_KEY=smoke-key GROQ_BASE_URL=http://127.0.0.1:3999 LLM_PROVIDER_CHAIN=groq \
  QUEUE_DRIVER=inline RUN_SCHEDULED_JOBS=false STORAGE_DIR=$W/storage APPLY_FORM_HOSTS=127.0.0.1 CORS_ORIGIN=http://127.0.0.1:5301 \
  exec node dist/index.js > $W/api.log 2>&1) & echo $! >> $W/pids
for _ in $(seq 1 30); do curl -sf http://127.0.0.1:3101/api/health >/dev/null && break; sleep 0.5; done

(cd "$REPO/frontend" && API_TARGET=http://127.0.0.1:3101 exec node node_modules/vite/bin/vite.js preview --port 5301 --strictPort --host 127.0.0.1 > $W/web.log 2>&1) & echo $! >> $W/pids
for _ in $(seq 1 30); do curl -sf http://127.0.0.1:5301/ >/dev/null && break; sleep 0.5; done
echo "frontend index: $(curl -s http://127.0.0.1:5301/ | grep -o '<title>[^<]*</title>')"
echo "frontend → API proxy: $(curl -s http://127.0.0.1:5301/api/health)"
echo "SPA deep link /applications/x: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5301/applications/x)"

node "$HERE/client.js"; STATUS=$?
echo "--- api warnings/errors ---"; grep -E '"level":"(warn|error)"' $W/api.log | head -5
echo "--- llm calls ---"; sort $W/llm.log | uniq -c
exit $STATUS
