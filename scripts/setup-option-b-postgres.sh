#!/usr/bin/env bash
# Option B: local dev — set postgres password + create DB, then Prisma push + seed.
# Run from anywhere:  bash /path/to/RentixLatest/back/scripts/setup-option-b-postgres.sh
# You will be prompted for your sudo password once (or twice).

set -euo pipefail
BACK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BACK_ROOT"

echo "==> Step 1/3: PostgreSQL (sudo) — set user postgres password to 'postgres'"
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"

echo "==> Step 2/3: PostgreSQL (sudo) — create database rentix_local (if missing)"
if sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'rentix_local'" | grep -q 1; then
  echo "    Database rentix_local already exists."
else
  sudo -u postgres psql -c "CREATE DATABASE rentix_local;"
fi

export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/rentix_local"

echo "==> Step 3/3: Prisma (no sudo) — db push + seed"
npx prisma db push
npx prisma db seed

echo ""
echo "Done. Restart your backend (npm run dev). Login: superadmin@codebraze.lk / SuperAdmin@codebraze"
