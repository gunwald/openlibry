#!/usr/bin/env bash
#
# Restore a backup created by scripts/backup.sh.
#
# Usage:
#   ./scripts/restore.sh backups/openlibry-backup-YYYYMMDD-HHMMSS.tar.gz
#   OPENLIBRY_DATA_DIR=/srv/openlibry/database ./scripts/restore.sh backup.tar.gz
#
# Stop OpenLibry before restoring. The current target data directory is moved
# aside before the backup is copied into place.

set -euo pipefail

ARCHIVE="${1:-}"
if [ "${ARCHIVE:-}" = "-h" ] || [ "${ARCHIVE:-}" = "--help" ]; then
  echo "Usage: $0 <backup-archive.tar.gz>" >&2
  echo "Set OPENLIBRY_DATA_DIR to restore into a different host data directory." >&2
  exit 0
fi

if [ -z "$ARCHIVE" ]; then
  echo "Usage: $0 <backup-archive.tar.gz>" >&2
  exit 1
fi

if [ ! -f "$ARCHIVE" ]; then
  echo "ERROR: backup archive not found: $ARCHIVE" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$(basename "$SCRIPT_DIR")" = "scripts" ]; then
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  ROOT="$SCRIPT_DIR"
fi
cd "$ROOT"

resolve_path() {
  case "$1" in
    /*) printf "%s\n" "$1" ;;
    *) printf "%s\n" "$ROOT/${1#./}" ;;
  esac
}

DATA_DIR="$(resolve_path "${OPENLIBRY_DATA_DIR:-./database}")"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

tar -xzf "$ARCHIVE" -C "$STAGE"

if [ ! -d "$STAGE/data" ] || [ ! -f "$STAGE/data/dev.db" ]; then
  echo "ERROR: archive does not look like an OpenLibry full data backup." >&2
  exit 1
fi

echo "Restoring OpenLibry backup"
if [ -f "$STAGE/manifest.txt" ]; then
  sed 's/^/  | /' "$STAGE/manifest.txt"
fi
echo
echo "Target data directory: $DATA_DIR"
echo "Stop OpenLibry before continuing."
read -r -p "This replaces the target data directory. Continue? [y/N] " ANSWER

case "$ANSWER" in
  y|Y) ;;
  *) echo "Aborted."; exit 1 ;;
esac

mkdir -p "$(dirname "$DATA_DIR")"

if [ -e "$DATA_DIR" ]; then
  OLD_DIR="$DATA_DIR.before-restore-$(date +%Y%m%d-%H%M%S)"
  mv "$DATA_DIR" "$OLD_DIR"
  echo "Moved previous data directory to: $OLD_DIR"
fi

mkdir -p "$DATA_DIR"
cp -a "$STAGE/data/." "$DATA_DIR/"
rm -f "$DATA_DIR/dev.db-wal" "$DATA_DIR/dev.db-shm"

echo
echo "Done. Start OpenLibry."
