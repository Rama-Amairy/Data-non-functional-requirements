#!/usr/bin/env bash
# `docker exec <container> repmgr ... cluster show` fails with
# "could not get current user name: Success" because repmgr does a
# getpwuid() lookup for the current UID, and the fake passwd entry the
# entrypoint set up via nss_wrapper only exists in the environment of the
# container's PID 1 - `docker exec` does not inherit it. This re-reads those
# env vars from PID 1 and passes them through explicitly.
set -euo pipefail

CONTAINER="${1:-docker-pg_node_1-1}"

ENV_LINE=$(docker exec "${CONTAINER}" sh -c \
  "tr '\0' '\n' < /proc/1/environ | grep -E '^NSS_WRAPPER_(GROUP|PASSWD)=' | cut -d= -f2 | tr '\n' ' '")
read -r NSS_GROUP NSS_PASSWD <<< "${ENV_LINE}"

docker exec \
  -e NSS_WRAPPER_GROUP="${NSS_GROUP}" \
  -e NSS_WRAPPER_PASSWD="${NSS_PASSWD}" \
  -e LD_PRELOAD=/opt/bitnami/common/lib/libnss_wrapper.so \
  -e HOME=/ \
  "${CONTAINER}" repmgr -f /opt/bitnami/repmgr/conf/repmgr.conf cluster show
