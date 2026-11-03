#!/usr/bin/env bash
# Logical PostgreSQL backup with rotation. Schedule it (cron / k8s CronJob) and copy the files off-site.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$DIR"
FILE="$DIR/nardi-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --dbname="${DATABASE_URL%%\?*}" --file="$FILE"
sha256sum "$FILE" > "$FILE.sha256"
find "$DIR" -name 'nardi-*.dump*' -mtime +"$KEEP_DAYS" -delete
echo "Backup written: $FILE"
# Restore (superuser, empty DB): pg_restore --clean --if-exists --no-owner --disable-triggers --dbname="$DATABASE_URL" "$FILE"
