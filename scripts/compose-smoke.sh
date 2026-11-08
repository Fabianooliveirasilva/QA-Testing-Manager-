#!/usr/bin/env bash
# Docker Compose smoke test: builds and starts the full production stack, verifies it end to end
# through nginx, checks persistence across a restart and graceful shutdown, then tears it down.
# Requires Docker with the Compose plugin, curl and openssl. Uses an isolated project name and
# throwaway credentials; removes its containers and volumes on exit.
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT=qtm-smoke
PORT=${SMOKE_PORT:-8080}
BASE="http://localhost:${PORT}"
ENV_FILE=$(mktemp)
JAR=$(mktemp)
OWNER_PW=$(openssl rand -hex 16)
APP_PW=$(openssl rand -hex 16)
USER_PW="Smoke-$(openssl rand -hex 8)-A1"
EMAIL="smoke.$(date +%s)@example.test"

cat >"$ENV_FILE" <<EOF
POSTGRES_USER=qtm_owner
POSTGRES_PASSWORD=${OWNER_PW}
APP_DB_USER=qtm_app
APP_DB_PASSWORD=${APP_PW}
WEB_PORT=${PORT}
WEB_ORIGIN=${BASE}
APP_URL=${BASE}
COOKIE_SECURE=true
AI_PROVIDER=none
REGISTRATION_ENABLED=true
EOF

compose() { docker compose --env-file "$ENV_FILE" -p "$PROJECT" "$@"; }
pass() { printf '  \033[32m✔\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✘\033[0m %s\n' "$1"; exit 1; }
# Every check fails the script explicitly (a failing command left of `&&` would not trip `set -e`).
expect_contains() { # description, haystack, needle (fixed string, case-insensitive)
  if grep -qiF -- "$3" <<<"$2"; then pass "$1"; else fail "$1"; fi
}
expect_eq() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got '$2', expected '$3')"; fi; }

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "---- smoke test failed; recent container logs ----"
    compose logs --no-color --tail 80 || true
  fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ENV_FILE" "$JAR"
  exit "$status"
}
trap cleanup EXIT

echo "▶ Building and starting the stack (waits for health checks)"
compose up -d --build --wait --wait-timeout 300
pass "db, api and web are healthy"

echo "▶ Database"
if compose exec -T db pg_isready -U qtm_owner -d qtm >/dev/null; then pass "PostgreSQL accepts connections"; else fail "PostgreSQL not ready"; fi
expected=$(find apps/api/prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
applied=$(compose exec -T db psql -U qtm_owner -d qtm -tAc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL" | tr -d '[:space:]')
expect_eq "migrations applied" "$applied" "$expected"
if compose exec -T db psql -U qtm_app -d qtm -tAc "SELECT count(*) FROM users" >/dev/null; then pass "app role can read data"; else fail "app role cannot read data"; fi
if compose exec -T db psql -U qtm_app -d qtm -c "CREATE TABLE smoke_should_fail (id int)" >/dev/null 2>&1; then
  fail "app role was able to run DDL (least privilege broken)"
else
  pass "app role cannot run DDL (least privilege)"
fi

echo "▶ API through nginx"
expect_contains "readiness: database ok" "$(curl -fsS "${BASE}/api/health/ready")" '"database":"ok"'
expect_contains "liveness ok" "$(curl -fsS "${BASE}/api/health/live")" '"status":"ok"'
expect_contains "X-Request-Id propagated" "$(curl -fsSI "${BASE}/api/health/live")" 'x-request-id:'
uid=$(compose exec -T api id -u | tr -d '\r')
if [ "$uid" != "0" ]; then pass "API runs as non-root (uid ${uid})"; else fail "API runs as root"; fi

echo "▶ Frontend"
expect_contains "SPA served" "$(curl -fsS "${BASE}/")" '<div id="root">'
expect_contains "SPA fallback for deep links" "$(curl -fsS "${BASE}/projects/some-deep-link")" '<div id="root">'
headers=$(curl -fsSI "${BASE}/")
expect_contains "Content-Security-Policy header" "$headers" 'content-security-policy:'
expect_contains "X-Frame-Options header" "$headers" 'x-frame-options: DENY'
asset=$(grep -oE '/assets/[^"]+\.js' <<<"$(curl -fsS "${BASE}/")" | head -1)
[ -n "$asset" ] || fail "no JS asset referenced by index.html"
asset_headers=$(curl -fsSI "${BASE}${asset}")
expect_contains "static assets keep the CSP header" "$asset_headers" 'content-security-policy:'
expect_contains "static assets are immutable-cached" "$asset_headers" 'immutable'
api_headers=$(curl -fsSI "${BASE}/api/health/live")
expect_eq "API responses carry a single X-Frame-Options header" "$(grep -ci '^x-frame-options:' <<<"$api_headers")" "1"

echo "▶ End-to-end request flow (cookie session + CSRF through the proxy)"
status=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke\",\"email\":\"${EMAIL}\",\"password\":\"${USER_PW}\",\"organizationName\":\"Smoke Org\"}" "${BASE}/api/auth/register")
expect_eq "register" "$status" "201"
expect_contains "HttpOnly session cookie issued" "$(grep qtm_session "$JAR" || true)" '#HttpOnly_localhost'
csrf=$(awk '$6=="qtm_csrf"{print $7}' "$JAR")
me=$(curl -fsS -b "$JAR" "${BASE}/api/auth/me")
org=$(sed -E 's/.*"organizations":\[\{"id":"([^"]+)".*/\1/' <<<"$me")
[[ "$org" =~ ^[0-9a-f-]{36}$ ]] || fail "could not read organization id from /api/auth/me"
status=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -H 'Content-Type: application/json' -d '{"name":"Smoke project"}' "${BASE}/api/organizations/${org}/projects")
expect_eq "write without CSRF header rejected" "$status" "403"
status=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -H 'Content-Type: application/json' -H "x-csrf-token: ${csrf}" \
  -d '{"name":"Smoke project"}' "${BASE}/api/organizations/${org}/projects")
expect_eq "project created through the proxy" "$status" "201"

echo "▶ Persistence across restart"
compose down >/dev/null 2>&1
compose up -d --wait --wait-timeout 180 >/dev/null
status=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${USER_PW}\"}" "${BASE}/api/auth/login")
expect_eq "data survived restart (login ok)" "$status" "200"

echo "▶ Graceful shutdown"
compose stop -t 20 api >/dev/null
code=$(docker inspect -f '{{.State.ExitCode}}' "$(compose ps -a -q api)")
expect_eq "API exited cleanly on SIGTERM" "$code" "0"

echo "✅ Compose smoke test passed"
