#!/bin/sh
set -eu
# Migrations run with the schema-owner role; the server then uses the least-privilege app role.
if [ -n "${MIGRATE_DATABASE_URL:-}" ]; then
  DATABASE_URL="$MIGRATE_DATABASE_URL" ./node_modules/.bin/prisma migrate deploy
fi
exec node dist/server.js
