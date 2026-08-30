#!/usr/bin/env bash
# Restore-and-verify test: proves a backup taken by scripts/backup-db.sh is
# actually usable, WITHOUT touching the live cluster (pg_node_1/pg_node_2).
# It spins up a disposable container + volume, restores into them, checks
# the data is there, and tells you how to tear it down afterwards.
#
# This intentionally does not restore in place onto a live repmgr node -
# overwriting a cluster member's data directory is destructive and also
# requires re-registering the node with repmgr (repmgr standby clone /
# node rejoin), which is a deliberate, reviewed operation, not something to
# run unattended from a script. Do that by hand if you ever actually need
# to rebuild a node, using the same base.tar.gz this script verifies.
#
# Usage:
#   ./scripts/restore-db.sh [backup_timestamp] [--logical]
#   ./scripts/restore-db.sh                      # restores the newest backup, physical mode
#   ./scripts/restore-db.sh 20260830T120000Z      # restores a specific backup
#   ./scripts/restore-db.sh --logical             # restores dumpall.sql.gz instead
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-${REPO_ROOT}/backups}"
IMAGE="bitnamilegacy/postgresql-repmgr:16.6.0-debian-12-r3"
VERIFY_PORT="${VERIFY_PORT:-5555}"
CONTAINER="pg_restore_verify"
VOLUME="pg_restore_verify_data"
NETWORK="pg_restore_verify_net"
MODE="physical"
BACKUP_STAMP=""

# The full bitnami entrypoint (logical mode) stop/starts postgres several
# times during first-boot bootstrap (password changes, repmgr db/user
# creation, applying pg_hba.conf) before its final, lasting start. A single
# pg_isready success can land in one of those transient up-windows, so
# require two consecutive successes a couple seconds apart before treating
# the server as actually settled.
wait_until_ready() {
  local pg_isready_cmd="$1"
  local attempt
  for attempt in $(seq 1 60); do
    if docker exec "${CONTAINER}" ${pg_isready_cmd} >/dev/null 2>&1; then
      sleep 2
      if docker exec "${CONTAINER}" ${pg_isready_cmd} >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
  done
  echo "ERROR: ${CONTAINER} never became ready; check 'docker logs ${CONTAINER}'." >&2
  exit 1
}

for arg in "$@"; do
  case "${arg}" in
    --logical) MODE="logical" ;;
    *) BACKUP_STAMP="${arg}" ;;
  esac
done

if [[ -z "${BACKUP_STAMP}" ]]; then
  BACKUP_STAMP="$(ls -1t "${BACKUP_ROOT}" 2>/dev/null | head -n1 || true)"
  if [[ -z "${BACKUP_STAMP}" ]]; then
    echo "ERROR: no backups found under ${BACKUP_ROOT}. Run ./scripts/backup-db.sh first." >&2
    exit 1
  fi
fi

BACKUP_DIR="${BACKUP_ROOT}/${BACKUP_STAMP}"
if [[ ! -d "${BACKUP_DIR}" ]]; then
  echo "ERROR: ${BACKUP_DIR} does not exist." >&2
  echo "Available backups:" >&2
  ls -1 "${BACKUP_ROOT}" >&2 || true
  exit 1
fi

echo "==> Restoring backup ${BACKUP_STAMP} (${MODE} mode) into a disposable verification container"

docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
docker volume rm "${VOLUME}" >/dev/null 2>&1 || true
docker volume create "${VOLUME}" >/dev/null
docker network create "${NETWORK}" >/dev/null 2>&1 || true

if [[ "${MODE}" == "physical" ]]; then
  test -f "${BACKUP_DIR}/base.tar.gz" || { echo "ERROR: ${BACKUP_DIR}/base.tar.gz not found" >&2; exit 1; }

  echo "==> Extracting base.tar.gz into volume ${VOLUME}"
  # --user root: a freshly created named volume is root-owned, but the
  # image's default user is the unprivileged postgres UID (1001), which
  # can't write to it. Extract as root, then chown down to 1001 for the
  # actual postgres process below.
  #
  # Bitnami keeps postgresql.conf/pg_hba.conf outside PGDATA (in a separate
  # conf/ dir), so pg_basebackup's tar - which only covers PGDATA - doesn't
  # include them. Standalone `postgres -D` needs both to exist inside
  # PGDATA, so write minimal ones here; this instance is throwaway, so
  # trust auth and default settings are fine.
  docker run --rm --user root \
    -v "${VOLUME}:/pgdata" \
    -v "${BACKUP_DIR}:/backup:ro" \
    "${IMAGE}" \
    bash -c "rm -rf /pgdata/* && tar xzf /backup/base.tar.gz -C /pgdata \
      && printf 'listen_addresses = %s\n' \"'*'\" > /pgdata/postgresql.conf \
      && printf 'local all all trust\nhost all all 0.0.0.0/0 trust\n' > /pgdata/pg_hba.conf \
      && chown -R 1001:0 /pgdata && chmod 700 /pgdata"

  echo "==> Starting standalone postgres on the restored data (port ${VERIFY_PORT})"
  docker run -d --name "${CONTAINER}" \
    -v "${VOLUME}:/pgdata" \
    -p "${VERIFY_PORT}:5432" \
    --user 1001 \
    --entrypoint /opt/bitnami/postgresql/bin/postgres \
    "${IMAGE}" \
    -D /pgdata -c listen_addresses='*' >/dev/null

  echo "==> Waiting for it to become ready..."
  wait_until_ready "/opt/bitnami/postgresql/bin/pg_isready -U postgres"

  echo "==> Verification query (app_db row counts):"
  docker exec "${CONTAINER}" /opt/bitnami/postgresql/bin/psql -U postgres -d app_db -c \
    "SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;"

else
  test -f "${BACKUP_DIR}/dumpall.sql.gz" || { echo "ERROR: ${BACKUP_DIR}/dumpall.sql.gz not found" >&2; exit 1; }

  echo "==> Starting a fresh empty instance on port ${VERIFY_PORT}"
  # This image always runs its repmgr entrypoint, even standalone, so it
  # insists on REPMGR_* being set. Point it at itself as a single-node
  # "cluster" - repmgrd never actually needs to do anything here.
  docker run -d --name "${CONTAINER}" \
    -v "${VOLUME}:/bitnami/postgresql" \
    -p "${VERIFY_PORT}:5432" \
    -e POSTGRESQL_POSTGRES_PASSWORD=admin_password \
    -e POSTGRESQL_USERNAME=custom_user \
    -e POSTGRESQL_PASSWORD=user_password \
    -e ALLOW_EMPTY_PASSWORD=no \
    -e REPMGR_PARTNER_NODES=verify-1 \
    -e REPMGR_PRIMARY_HOST=verify-1 \
    -e REPMGR_NODE_NAME=verify-1 \
    -e REPMGR_NODE_NETWORK_NAME=verify-1 \
    -e REPMGR_NODE_ID=1 \
    -e REPMGR_PASSWORD=repmgr_password \
    --network "${NETWORK}" \
    --network-alias verify-1 \
    "${IMAGE}" >/dev/null

  echo "==> Waiting for it to become ready..."
  wait_until_ready "pg_isready -U postgres"

  echo "==> Loading dumpall.sql.gz"
  gunzip -c "${BACKUP_DIR}/dumpall.sql.gz" | docker exec -i -e PGPASSWORD=admin_password "${CONTAINER}" \
    psql -U postgres -h 127.0.0.1 >/dev/null

  echo "==> Verification query (app_db row counts):"
  docker exec -e PGPASSWORD=admin_password "${CONTAINER}" psql -U postgres -h 127.0.0.1 -d app_db -c \
    "SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;"
fi

cat <<EOF

==> Recovery test complete. The restored instance is running at
    localhost:${VERIFY_PORT} (user postgres / admin_password) for you to
    inspect further if needed.

Tear it down when done:
    docker rm -f ${CONTAINER}
    docker volume rm ${VOLUME}
    docker network rm ${NETWORK}
EOF
