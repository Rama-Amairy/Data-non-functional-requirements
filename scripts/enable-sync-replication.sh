#!/usr/bin/env bash
# Switches the primary node to synchronous replication (RPO=0: a commit is
# only acknowledged once at least one standby has it in its own WAL).
#
# This must run AFTER the standby has joined and is streaming - never bake
# synchronous_standby_names into the image's initial postgresql.conf, since
# the container's own first-boot bootstrap (creating the repmgr role, the
# app database, etc.) commits transactions before any standby can possibly
# exist yet, and those commits would then block forever waiting for an
# acknowledgement no standby can send. See docker/config/postgresql.conf.
set -euo pipefail

PRIMARY_CONTAINER="${1:-docker-pg_node_1-1}"

echo "Waiting for at least one streaming standby on ${PRIMARY_CONTAINER}..."
until docker exec "${PRIMARY_CONTAINER}" psql -U postgres -tAc \
  "SELECT count(*) FROM pg_stat_replication WHERE state = 'streaming';" 2>/dev/null | grep -qv '^0$'; do
  sleep 2
done

docker exec "${PRIMARY_CONTAINER}" psql -U postgres -c \
  "ALTER SYSTEM SET synchronous_standby_names = 'ANY 1 (*)';"
docker exec "${PRIMARY_CONTAINER}" psql -U postgres -c "SELECT pg_reload_conf();"

echo "Synchronous replication enabled. Current state:"
docker exec "${PRIMARY_CONTAINER}" psql -U postgres -c \
  "SELECT application_name, state, sync_state FROM pg_stat_replication;"
