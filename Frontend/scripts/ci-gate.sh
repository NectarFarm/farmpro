#!/bin/sh
# Compose startup gate: start the built app, wait until healthy, run the unit +
# integration suites against it, then stop. Exit code = test result, so the `app`
# service (which depends on this completing successfully) never starts on red tests.
set -u

echo "▶ starting app for the integration gate…"
pnpm exec next start -p 13000 >/tmp/app.log 2>&1 &
APP=$!

echo "▶ waiting for app health…"
i=0
until node -e "fetch('http://127.0.0.1:13000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then echo "✗ app never became healthy"; tail -40 /tmp/app.log; kill "$APP" 2>/dev/null; exit 1; fi
  sleep 2
done

echo "▶ running unit + integration tests…"
TEST_BASE_URL=http://127.0.0.1:13000 pnpm test:ci
RESULT=$?

kill "$APP" 2>/dev/null || true
[ "$RESULT" -eq 0 ] && echo "✓ tests passed — app may start" || echo "✗ tests failed — blocking app startup"
exit "$RESULT"
