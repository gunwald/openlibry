#!/usr/bin/env bash
#
# Create a full OpenLibry data backup.
#
# The normal Docker setup mounts ./database on the host to /app/database in the
# container. That directory contains the SQLite database, uploaded cover images,
# and custom files. This script backs up that whole directory into one tarball.
#
# Usage:
#   ./scripts/backup.sh
#   ./scripts/backup.sh /mnt/backup
#   OPENLIBRY_DATA_DIR=/srv/openlibry/database ./scripts/backup.sh
#
# Container fallback:
#   OPENLIBRY_CONTAINER=openlibry ./scripts/backup.sh
#
# For the most reliable backup, stop OpenLibry first. If sqlite3 is available
# and the local data directory is used, the dev.db file is copied through
# sqlite3's online backup command.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$(basename "$SCRIPT_DIR")" = "scripts" ]; then
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  ROOT="$SCRIPT_DIR"
fi
cd "$ROOT"

usage() {
  cat <<EOF
Usage: $0 [backup-directory]

Environment:
  OPENLIBRY_DATA_DIR             Host data directory. Default: ./database
  OPENLIBRY_CONTAINER            Optional container name for docker cp fallback.
  OPENLIBRY_CONTAINER_DATA_DIR   Container data directory. Default: /app/database
  BACKUP_DIR                     Backup output directory if no argument is given.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

resolve_path() {
  case "$1" in
    /*) printf "%s\n" "$1" ;;
    *) printf "%s\n" "$ROOT/${1#./}" ;;
  esac
}

DATA_DIR="$(resolve_path "${OPENLIBRY_DATA_DIR:-./database}")"
CONTAINER="${OPENLIBRY_CONTAINER:-}"
CONTAINER_DATA_DIR="${OPENLIBRY_CONTAINER_DATA_DIR:-/app/database}"
BACKUP_DIR="$(resolve_path "${1:-${BACKUP_DIR:-./backups}}")"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="openlibry-backup-$STAMP"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$BACKUP_DIR" "$STAGE/data"

echo "OpenLibry backup"
echo "  output: $BACKUP_DIR/$NAME.tar.gz"

SOURCE_KIND=""
SOURCE_DATA="$DATA_DIR"
DB_METHOD="not found"

if [ -d "$DATA_DIR" ]; then
  SOURCE_KIND="host directory"
  echo "  source: $DATA_DIR"

  cp -a "$DATA_DIR/." "$STAGE/data/"

  if [ -f "$DATA_DIR/dev.db" ] && command -v sqlite3 >/dev/null 2>&1; then
    rm -f "$STAGE/data/dev.db" "$STAGE/data/dev.db-wal" "$STAGE/data/dev.db-shm"
    sqlite3 "$DATA_DIR/dev.db" ".backup '$STAGE/data/dev.db'"
    DB_METHOD="sqlite3 online backup"
  elif [ -f "$DATA_DIR/dev.db" ]; then
    DB_METHOD="plain file copy"
    echo "  warning: sqlite3 was not found; stop OpenLibry before relying on this backup."
  fi
elif [ -n "$CONTAINER" ]; then
  SOURCE_KIND="container copy"
  SOURCE_DATA="$CONTAINER:$CONTAINER_DATA_DIR"
  echo "  source: $CONTAINER:$CONTAINER_DATA_DIR"
  echo "  warning: stop OpenLibry first for the most reliable container copy."

  docker cp "$CONTAINER:$CONTAINER_DATA_DIR/." "$STAGE/data/"
  [ -f "$STAGE/data/dev.db" ] && DB_METHOD="docker cp"
else
  echo "ERROR: data directory not found: $DATA_DIR" >&2
  echo "Set OPENLIBRY_DATA_DIR or OPENLIBRY_CONTAINER." >&2
  exit 1
fi

if [ ! -f "$STAGE/data/dev.db" ]; then
  echo "ERROR: backup source did not contain dev.db." >&2
  exit 1
fi

FILE_COUNT="$(find "$STAGE/data" -type f | wc -l | tr -d ' ')"
DB_BYTES="$(wc -c < "$STAGE/data/dev.db" | tr -d ' ')"
GIT_REV="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo 'n/a')"

cat > "$STAGE/manifest.txt" <<EOF
OpenLibry backup
created       : $(date -Iseconds)
host          : $(hostname)
git revision  : $GIT_REV
source kind   : $SOURCE_KIND
source data   : $SOURCE_DATA
db method     : $DB_METHOD
db bytes      : $DB_BYTES
files         : $FILE_COUNT

Contents:
  data/        Full OpenLibry data directory.
  data/dev.db  SQLite database.

Restore:
  1. Stop OpenLibry.
  2. Run scripts/restore.sh <this-archive.tar.gz>.
  3. Start OpenLibry.
EOF

tar -czf "$BACKUP_DIR/$NAME.tar.gz" -C "$STAGE" data manifest.txt
OUT_BYTES="$(wc -c < "$BACKUP_DIR/$NAME.tar.gz" | tr -d ' ')"

echo "  files : $FILE_COUNT"
echo "  db    : $DB_BYTES bytes ($DB_METHOD)"
echo
echo "Done: $BACKUP_DIR/$NAME.tar.gz ($OUT_BYTES bytes)"
