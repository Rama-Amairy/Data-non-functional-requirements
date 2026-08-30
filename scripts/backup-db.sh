#!/usr/bin/env bash
# Takes a full backup of the cluster from the current primary:
#   - base.tar.gz    physical base backup (pg_basebackup, tar format, WAL
#                     fetched inline via -X fetch so the tar alone is
#                     enough to start a consistent standalone copy - note
#                     -X stream isn't supported together with tar-to-stdout)
#   - dumpall.sql.gz  logical backup (pg_dumpall) - human-readable, easy to
#                     restore into any fresh instance regardless of version
#
# Auth note: local pg_hba.conf only grants the "repmgr" role a replication
# connection (needed for pg_basebackup), and only over TCP - not the unix
# socket. Same story for "postgres" over psql/pg_dumpall. Hence -U/-h below;
# see scripts/enable-sync-replication.sh for the same pattern.
set -euo pipefail

PRIMARY_CONTAINER="${1:-docker-pg_node_1-1}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-${REPO_ROOT}/backups}"
KEEP="${BACKUP_KEEP:-7}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_ROOT}/${STAMP}"
mkdir -p "${DEST}"

echo "==> Confirming ${PRIMARY_CONTAINER} is actually the primary..."
IS_PRIMARY=$(docker exec "${PRIMARY_CONTAINER}" psql -U postgres -h 127.0.0.1 -tAc \
  "SELECT NOT pg_is_in_recovery();")
if [[ "${IS_PRIMARY}" != "t" ]]; then
  echo "ERROR: ${PRIMARY_CONTAINER} is not the primary (pg_is_in_recovery() = true)." >&2
  echo "Run ./scripts/repmgr-cluster-show.sh to find the current primary and pass it as \$1." >&2
  exit 1
fi

echo "==> Physical base backup -> ${DEST}/base.tar.gz"
docker exec "${PRIMARY_CONTAINER}" pg_basebackup \
  -U repmgr -h 127.0.0.1 \
  -D - -Ft -z -X fetch --checkpoint=fast \
  > "${DEST}/base.tar.gz"

echo "==> Logical backup -> ${DEST}/dumpall.sql.gz"
docker exec "${PRIMARY_CONTAINER}" pg_dumpall -U postgres -h 127.0.0.1 \
  | gzip > "${DEST}/dumpall.sql.gz"

echo "${PRIMARY_CONTAINER}" > "${DEST}/SOURCE"
date -u +%Y-%m-%dT%H:%M:%SZ > "${DEST}/TIMESTAMP"

echo "==> Backup complete: ${DEST}"
du -sh "${DEST}"/base.tar.gz "${DEST}"/dumpall.sql.gz

if [[ "${KEEP}" -gt 0 ]]; then
  echo "==> Pruning old backups, keeping the newest ${KEEP}"
  # shellcheck disable=SC2012
  ls -1dt "${BACKUP_ROOT}"/*/ 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
    echo "removing ${old}"
    rm -rf "${old}"
  done
fi
