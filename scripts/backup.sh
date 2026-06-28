#!/usr/bin/env bash
#
# Full backup of an OpenLibry instance: the SQLite database AND the cover images.
#
# Produces one timestamped, self-describing tarball:
#   backups/openlibry-backup-YYYYMMDD-HHMMSS.tar.gz
#       ├── manifest.txt        # what's inside, when, from which paths + git rev
#       ├── database/dev.db      # consistent online snapshot (safe while running)
#       └── coverimages/...      # every cover image
#
# Paths are read from .env (DATABASE_URL, COVERIMAGE_FILESTORAGE_PATH) so the same
# script works for local dev and inside Docker, where the paths differ.
#
# Usage:
#   ./scripts/backup.sh                 # writes into ./backups
#   ./scripts/backup.sh /mnt/usb/olib   # writes into a custom directory
#   BACKUP_DIR=/mnt/usb ./scripts/backup.sh
#
# Restore: see scripts/restore.sh (or the manifest inside the tarball).

set -euo pipefail

# ── Locate the project root (one dir up from this script) ───────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# ── Read a value from .env: strips the `KEY=`, surrounding quotes, whitespace ─
read_env() {
  local key="$1" file=".env" line
  [ -f "$file" ] || return 0
  line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n1 || true)"
  [ -n "$line" ] || return 0
  line="${line#*=}"                       # drop KEY=
  line="${line%%#*}"                      # drop trailing comment
  line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  line="${line%\"}"; line="${line#\"}"    # strip double quotes
  line="${line%\'}"; line="${line#\'}"    # strip single quotes
  printf '%s' "$line"
}

# ── Resolve the DB file path from DATABASE_URL ──────────────────────────────
DB_URL="$(read_env DATABASE_URL)"
DB_URL="${DB_URL:-file:./database/dev.db}"
DB_PATH="${DB_URL#file:}"                  # strip the file: scheme
DB_PATH="${DB_PATH%%\?*}"                  # strip any ?connection=params
case "$DB_PATH" in
  /*) : ;;                                 # already absolute
  *)  DB_PATH="$ROOT/${DB_PATH#./}" ;;     # resolve relative to project root
esac

# ── Resolve the cover-image directory ───────────────────────────────────────
IMG_DIR="$(read_env COVERIMAGE_FILESTORAGE_PATH)"
IMG_DIR="${IMG_DIR:-./public/coverimages}"
case "$IMG_DIR" in
  /*) : ;;
  *)  IMG_DIR="$ROOT/${IMG_DIR#./}" ;;
esac

# ── Output location ─────────────────────────────────────────────────────────
BACKUP_DIR="${1:-${BACKUP_DIR:-$ROOT/backups}}"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="openlibry-backup-$STAMP"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$BACKUP_DIR" "$STAGE/database" "$STAGE/coverimages"

echo "OpenLibry backup"
echo "  database : $DB_PATH"
echo "  images   : $IMG_DIR"
echo "  output   : $BACKUP_DIR/$NAME.tar.gz"
echo

# ── 1. Consistent database snapshot ─────────────────────────────────────────
if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: database not found at $DB_PATH" >&2
  exit 1
fi

DB_METHOD=""
if command -v sqlite3 >/dev/null 2>&1; then
  # Online backup via the sqlite3 CLI — consistent even with the app running.
  sqlite3 "$DB_PATH" ".backup '$STAGE/database/dev.db'"
  DB_METHOD="sqlite3 .backup"
elif node -e "require('better-sqlite3')" >/dev/null 2>&1; then
  # Consistent online backup via better-sqlite3 (a project dependency).
  node -e '
    const Database = require("better-sqlite3");
    const db = new Database(process.argv[1]);
    db.backup(process.argv[2])
      .then(() => { db.close(); })
      .catch((e) => { console.error(e); process.exit(1); });
  ' "$DB_PATH" "$STAGE/database/dev.db"
  DB_METHOD="better-sqlite3 backup()"
else
  # Last resort: plain copy (include WAL/SHM sidecars if present). Only fully
  # safe when the app is stopped.
  cp "$DB_PATH" "$STAGE/database/dev.db"
  [ -f "$DB_PATH-wal" ] && cp "$DB_PATH-wal" "$STAGE/database/"
  [ -f "$DB_PATH-shm" ] && cp "$DB_PATH-shm" "$STAGE/database/"
  DB_METHOD="file copy (stop the app for a guaranteed-consistent copy)"
fi
DB_BYTES="$(wc -c < "$STAGE/database/dev.db" | tr -d ' ')"
echo "  ✓ database snapshot ($DB_METHOD, $DB_BYTES bytes)"

# ── 2. Cover images ─────────────────────────────────────────────────────────
IMG_COUNT=0
if [ -d "$IMG_DIR" ]; then
  # Copy contents (not the dir itself) so restore is path-independent.
  cp -a "$IMG_DIR/." "$STAGE/coverimages/" 2>/dev/null || true
  IMG_COUNT="$(find "$STAGE/coverimages" -type f | wc -l | tr -d ' ')"
  echo "  ✓ cover images ($IMG_COUNT files)"
else
  echo "  ! image directory $IMG_DIR not found — backing up database only"
fi

# ── 3. Manifest ─────────────────────────────────────────────────────────────
GIT_REV="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo 'n/a')"
cat > "$STAGE/manifest.txt" <<EOF
OpenLibry backup
created      : $(date -Iseconds)
host         : $(hostname)
git revision : $GIT_REV
source db    : $DB_PATH
source images: $IMG_DIR
db method    : $DB_METHOD
db bytes     : $DB_BYTES
image files  : $IMG_COUNT

Contents:
  database/dev.db    SQLite database (schema + all records)
  coverimages/       all cover image files

Restore:
  1. Stop OpenLibry.
  2. Restore the DB:     cp database/dev.db   <DATABASE_URL path>
  3. Restore images:     cp -a coverimages/.  <COVERIMAGE_FILESTORAGE_PATH>/
  4. Start OpenLibry.
  (or run scripts/restore.sh <this-archive.tar.gz>)
EOF

# ── 4. Bundle ───────────────────────────────────────────────────────────────
tar -czf "$BACKUP_DIR/$NAME.tar.gz" -C "$STAGE" database coverimages manifest.txt
OUT_BYTES="$(wc -c < "$BACKUP_DIR/$NAME.tar.gz" | tr -d ' ')"

echo
echo "Done → $BACKUP_DIR/$NAME.tar.gz ($OUT_BYTES bytes)"
