#!/usr/bin/env bash
#
# Restore an OpenLibry backup produced by scripts/backup.sh.
#
# Usage:
#   ./scripts/restore.sh backups/openlibry-backup-YYYYMMDD-HHMMSS.tar.gz
#
# Restores into the paths from the CURRENT .env (DATABASE_URL,
# COVERIMAGE_FILESTORAGE_PATH), so you can restore a dev backup into a Docker
# layout or vice versa. STOP OpenLibry before running this.

set -euo pipefail

ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "Usage: $0 <backup-archive.tar.gz>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

read_env() {
  local key="$1" file=".env" line
  [ -f "$file" ] || return 0
  line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n1 || true)"
  [ -n "$line" ] || return 0
  line="${line#*=}"; line="${line%%#*}"
  line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  line="${line%\"}"; line="${line#\"}"; line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

DB_URL="$(read_env DATABASE_URL)"; DB_URL="${DB_URL:-file:./database/dev.db}"
DB_PATH="${DB_URL#file:}"; DB_PATH="${DB_PATH%%\?*}"
case "$DB_PATH" in /*) : ;; *) DB_PATH="$ROOT/${DB_PATH#./}" ;; esac

IMG_DIR="$(read_env COVERIMAGE_FILESTORAGE_PATH)"; IMG_DIR="${IMG_DIR:-./public/coverimages}"
case "$IMG_DIR" in /*) : ;; *) IMG_DIR="$ROOT/${IMG_DIR#./}" ;; esac

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
tar -xzf "$ARCHIVE" -C "$STAGE"

echo "Restoring from $ARCHIVE"
[ -f "$STAGE/manifest.txt" ] && sed 's/^/  | /' "$STAGE/manifest.txt"
echo
echo "Target db    : $DB_PATH"
echo "Target images: $IMG_DIR"
read -r -p "This OVERWRITES the above. Continue? [y/N] " ans
[ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "Aborted."; exit 1; }

# Database (clear any stale WAL/SHM sidecars so they can't shadow the restore).
mkdir -p "$(dirname "$DB_PATH")"
cp "$STAGE/database/dev.db" "$DB_PATH"
rm -f "$DB_PATH-wal" "$DB_PATH-shm"
[ -f "$STAGE/database/dev.db-wal" ] && cp "$STAGE/database/dev.db-wal" "$DB_PATH-wal"
[ -f "$STAGE/database/dev.db-shm" ] && cp "$STAGE/database/dev.db-shm" "$DB_PATH-shm"
echo "  ✓ database restored"

# Images.
if [ -d "$STAGE/coverimages" ]; then
  mkdir -p "$IMG_DIR"
  cp -a "$STAGE/coverimages/." "$IMG_DIR/"
  echo "  ✓ images restored ($(find "$STAGE/coverimages" -type f | wc -l | tr -d ' ') files)"
fi

echo
echo "Done. Start OpenLibry."
