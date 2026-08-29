#!/usr/bin/env bash
# Start the admin app for local end-to-end runs. Nothing here is a secret:
# every value is a documented local development default (see .env.example).
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgres://gymflow:gymflow_dev_pw@localhost:5432/gymflow_dev}"
export DATABASE_APP_URL="${DATABASE_APP_URL:-postgres://gymflow_app:gymflow_app_dev_pw@localhost:5432/gymflow_dev}"
export MEMBER_TOKEN_SECRET="${MEMBER_TOKEN_SECRET:-$(printf '0%.0s' {1..64})}"
export NEXT_PUBLIC_APP_ORIGIN="${NEXT_PUBLIC_APP_ORIGIN:-http://localhost:3000}"
export PORT="${PORT:-3000}"
exec pnpm --filter @gymflow/admin start
