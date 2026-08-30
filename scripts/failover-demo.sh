#!/usr/bin/env bash
# Drives the failover demonstration on the Docker cluster: kill node 1, watch
# repmgr promote node 2, and watch the application follow it without a restart.
#
# This is HA test 3 from the README, wrapped so it can be run in front of an
# audience one command at a time. Nothing here promotes anything by hand --
# repmgrd on node 2 notices node 1 is gone and promotes itself, which is the
# whole point. The script only stops a container and then reports what the
# cluster and the application say about it.
#
# For the application to follow the promotion, DATABASE_URL must list both
# nodes (see README "Making the app failover-aware"). Without that the app
# stays pinned to node 1's port and the demonstration stops at "the database
# is down" -- `./scripts/failover-demo.sh check` says so before you start.
set -euo pipefail

NODE1="${NODE1_CONTAINER:-docker-pg_node_1-1}"
NODE2="${NODE2_CONTAINER:-docker-pg_node_2-1}"
API="${API_BASE:-http://127.0.0.1:8000/api/v1}"

# `fail`/`restore` take the node number the dashboard shows, so the same node
# can be named on stage whichever way it is stopped. Node 1 is the default
# because it is the primary a fresh cluster starts with -- but the point of
# taking an argument is that after a failover the primary is node 2, and the
# demonstration has to be able to kill *that* one to show it happen again.
container_for() {
  case "$1" in
    1) echo "${NODE1}" ;;
    2) echo "${NODE2}" ;;
    *) echo "unknown node: $1 (expected 1 or 2)" >&2; return 1 ;;
  esac
}

# `repmgr cluster show` has to be asked of a node that is still running, and
# which node that is depends on which one was stopped -- after `fail 2` the
# survivor is node 1, not node 2.
running_container() {
  for name in "${NODE2}" "${NODE1}"; do
    if [ "$(docker inspect -f '{{.State.Running}}' "${name}" 2>/dev/null)" = "true" ]; then
      echo "${name}"
      return 0
    fi
  done
  echo "${NODE2}"   # nothing is up; ask anyway so the failure is reported
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

have_jq() { command -v jq >/dev/null 2>&1; }

# The app's own view: which nodes it can see, and which one it is writing to.
app_nodes() {
  local body
  if ! body=$(curl -fsS --max-time 10 "${API}/cluster" 2>/dev/null); then
    echo "  (the application is not answering on ${API})"
    return
  fi
  if have_jq; then
    echo "${body}" | jq -r '
      if (.nodes | length) == 0 then
        "  (no nodes configured - DATABASE_URL lists a single host)"
      else
        .nodes[] |
        "  node \(.host):\(.port)  " +
        (if .reachable then "up   \(.role // "?")" else "DOWN \(.error // "")" end) +
        (if .serving then "   <- the app is writing here" else "" end)
      end'
    echo "  role=$(echo "${body}" | jq -r '.role // "-"') reachable=$(echo "${body}" | jq -r '.reachable')"
  else
    echo "${body}"
  fi
}

repmgr_show() {
  "${HERE}/repmgr-cluster-show.sh" "$1" 2>/dev/null || echo "  (repmgr cluster show unavailable on $1)"
}

case "${1:-status}" in
  check)
    # Everything that has to be true before the demonstration will work.
    echo "== containers =="
    docker ps --filter "name=pg_node" --format '  {{.Names}}  {{.Status}}'
    echo
    echo "== the application's node list =="
    app_nodes
    echo
    echo "If only one node is listed, the app cannot fail over. Set a"
    echo "multi-host DATABASE_URL in .env and restart it - see the README."
    ;;

  status)
    SURVIVOR=$(running_container)
    echo "== repmgr (asked via ${SURVIVOR}, a node that is still running) =="
    repmgr_show "${SURVIVOR}"
    echo
    echo "== the application's node list =="
    app_nodes
    ;;

  fail)
    # A stopped container is a node that died: no clean shutdown handshake to
    # the rest of the cluster, which is what makes repmgr have to detect it.
    NODE_NUM="${2:-1}"
    TARGET=$(container_for "${NODE_NUM}")
    echo "Stopping ${TARGET} (node ${NODE_NUM}) - repmgrd on the other node should promote itself in ~10-15s."
    docker stop "${TARGET}"
    echo
    echo "Watch it happen:  $0 watch"
    ;;

  restore)
    # The stopped node comes back as a standby of the new primary. repmgr
    # rejoins it automatically only if it can still follow the new timeline;
    # when it cannot, the README's `repmgr node rejoin` step is the way back.
    NODE_NUM="${2:-1}"
    TARGET=$(container_for "${NODE_NUM}")
    echo "Starting ${TARGET} (node ${NODE_NUM}) - it should rejoin as a standby."
    docker start "${TARGET}"
    sleep 5
    "$0" status
    ;;

  watch)
    watch -n 2 "$0 status"
    ;;

  *)
    echo "usage: $0 {check|status|watch} | $0 {fail|restore} [node]" >&2
    echo >&2
    echo "  check          verify the cluster and the app are ready for the demo" >&2
    echo "  status         show the cluster and which node the app is writing to" >&2
    echo "  fail [1|2]     stop that node so repmgr promotes the other (default 1)" >&2
    echo "  restore [1|2]  bring that node back as a standby (default 1)" >&2
    echo "  watch          status on a 2-second loop, for the projector" >&2
    exit 2
    ;;
esac
