#!/bin/sh
# Runs before each deploy (Railway preDeployCommand / compose "migrate" service):
# apply migrations, seed reference data, optionally bootstrap the first super admin.
set -e
npx prisma migrate deploy
npx ts-node --transpile-only prisma/seed.ts
if [ -n "$BOOTSTRAP_ADMIN_EMAIL" ] && [ -n "$BOOTSTRAP_ADMIN_PASSWORD" ]; then
  ADMIN_PASSWORD="$BOOTSTRAP_ADMIN_PASSWORD" npx ts-node --transpile-only scripts/create-admin.ts \
    --email "$BOOTSTRAP_ADMIN_EMAIL" --nickname "${BOOTSTRAP_ADMIN_NICKNAME:-Owner}" --role SUPERADMIN \
    || echo "WARNING: admin bootstrap failed (deploy continues)"
fi
