#!/usr/bin/env bash
#
# Bring GymFlow up on your own machine so you can open the member app in
# Expo Go, and print the two commands to run with your LAN IP filled in.
#
# Everything here is the fiddly half of docs/LOCAL_DEVELOPMENT.md — creating
# the database and roles, applying migrations, seeding the demo gym, writing
# apps/admin/.env.local with a real secret, and working out which address
# your phone can actually reach. It is idempotent: run it as often as you
# like. It never drops data.
#
#   ./ops/try-it.sh
#
# The dev-only passwords below are the same ones docs/LOCAL_DEVELOPMENT.md
# documents. They are fine on a laptop and nowhere else; for anything
# shared, set SEED_PASSWORD and SEED_MEMBER_PASSWORD before running.
set -euo pipefail
cd "$(dirname "$0")/.."

DB_OWNER_PW="${DB_OWNER_PW:-gymflow_dev_pw}"
DB_APP_PW="${DB_APP_PW:-gymflow_app_dev_pw}"
DB_NAME="${DB_NAME:-gymflow_dev}"
export DATABASE_URL="postgres://gymflow:${DB_OWNER_PW}@localhost:5432/${DB_NAME}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---- prerequisites -------------------------------------------------------
say "Checking prerequisites"
command -v node >/dev/null || die "Node.js not found. Install Node 20+ (22 recommended)."
node -e 'process.exit(parseInt(process.versions.node) >= 20 ? 0 : 1)' \
  || die "Node $(node -v) is too old; this needs 20 or newer."
ok "node $(node -v)"
command -v pnpm >/dev/null || die "pnpm not found. Run: corepack enable"
ok "pnpm $(pnpm -v)"
command -v psql >/dev/null || die "psql not found. Install PostgreSQL 16 and make sure it is running."
pg_isready -h localhost -q 2>/dev/null \
  || die "PostgreSQL is not accepting connections on localhost:5432. Start it and re-run."
ok "postgres is up"

# ---- dependencies --------------------------------------------------------
if [ ! -d node_modules ]; then
  say "Installing dependencies (first run, this takes a few minutes)"
  pnpm install
else
  ok "dependencies already installed"
fi

# ---- database ------------------------------------------------------------
# Created through whichever superuser path this machine offers: the local
# `postgres` OS account on Linux, or the current user on a Homebrew install.
say "Setting up the database"
as_super() {
  if sudo -n -u postgres psql -tAc 'SELECT 1' >/dev/null 2>&1; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 "$@"
  elif psql -U postgres -h localhost -tAc 'SELECT 1' >/dev/null 2>&1; then
    psql -U postgres -h localhost -v ON_ERROR_STOP=1 "$@"
  elif psql -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; then
    psql -d postgres -v ON_ERROR_STOP=1 "$@"   # Homebrew: you own the cluster
  else
    die "Cannot reach PostgreSQL as a superuser. Create the role and database by hand — see docs/LOCAL_DEVELOPMENT.md."
  fi
}

if as_super -tAc "SELECT 1 FROM pg_roles WHERE rolname='gymflow'" | grep -q 1; then
  ok "role gymflow exists"
else
  as_super -c "CREATE ROLE gymflow LOGIN PASSWORD '${DB_OWNER_PW}' SUPERUSER"
  ok "created role gymflow"
fi

if as_super -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  ok "database ${DB_NAME} exists"
else
  as_super -c "CREATE DATABASE ${DB_NAME} OWNER gymflow"
  ok "created database ${DB_NAME}"
fi

say "Applying migrations"
pnpm db:migrate >/dev/null
ok "schema up to date"

# The migrations create gymflow_app; it needs a password the app can use.
as_super -c "ALTER ROLE gymflow_app PASSWORD '${DB_APP_PW}'" >/dev/null
ok "runtime role gymflow_app ready"

say "Seeding the demo gym"
# Refuses to run twice on its own, so a re-run is a no-op rather than an error.
pnpm db:seed 2>&1 | sed 's/^/  /'

# ---- admin app env -------------------------------------------------------
say "Configuring the admin app"
ENV_FILE=apps/admin/.env.local
if [ -f "$ENV_FILE" ]; then
  ok "$ENV_FILE already exists (left untouched)"
else
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  cat > "$ENV_FILE" <<EOF
DATABASE_APP_URL=postgres://gymflow_app:${DB_APP_PW}@localhost:5432/${DB_NAME}
MEMBER_TOKEN_SECRET=${SECRET}
EOF
  ok "wrote $ENV_FILE with a freshly generated token secret"
fi

# ---- the address your phone can reach ------------------------------------
# Not localhost: to the phone, localhost is the phone. Pick the first
# non-loopback IPv4 on a real interface.
LAN_IP="$(node -e '
const os = require("os");
const skip = /^(lo|docker|br-|veth|utun|tun|tap|virbr|vmnet|zt)/;
for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
  if (skip.test(name)) continue;
  for (const a of addrs || []) {
    if (a.family === "IPv4" && !a.internal) { console.log(a.address); process.exit(0); }
  }
}
')"

say "Ready"
if [ -z "$LAN_IP" ]; then
  warn "Could not detect a LAN address. Find yours (ipconfig / ifconfig / ip addr) and use it below."
  LAN_IP="<your-LAN-IP>"
else
  ok "your machine is $LAN_IP on this network"
fi

cat <<EOF

Run these in two terminals. Your phone and this machine must be on the
same Wi-Fi, and Expo Go must be installed on the phone.

  Terminal 1 — the gym's admin app and the API the phone talks to:

      pnpm dev:admin

  Terminal 2 — the member app; scan the QR code with Expo Go:

      GYMFLOW_API_URL=http://${LAN_IP}:3000 pnpm dev:member

  Log in on the phone with:

      gym code   apfitness
      mobile     9876543210
      password   ${SEED_MEMBER_PASSWORD:-member-dev-123}

  And the admin app at http://localhost:3000 with:

      reception@demo.gymflow.local / ${SEED_PASSWORD:-gymflow-dev-password}

If the phone cannot reach the API, it is almost always the laptop firewall
blocking port 3000, or the two devices being on different networks (guest
Wi-Fi, or the laptop on Ethernet). Check http://${LAN_IP}:3000 in the
phone's browser first — if that does not load, Expo Go will not either.
EOF
