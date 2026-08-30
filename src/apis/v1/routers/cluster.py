"""Database cluster endpoint: replication, WAL, and failover state.

This is the server-side half of the recoverability story. ``/health`` answers
"is the database reachable"; this endpoint answers the three questions the
non-functional requirements are actually about:

* **Replication** — is a standby connected and streaming, and how far behind?
* **WAL** — is the write-ahead log configured so a committed answer survives
  the loss of a node (``wal_level``, and whether commits wait for a standby)?
* **Failover** — did the node we write to change, and was it a promotion?

Failover is detected by watching two values across polls: the address of the
node answering, and the WAL timeline id. PostgreSQL bumps the timeline by one
every time a standby is promoted, so a timeline that moves forward is a
promotion and nothing else.

``POST /cluster/nodes/{index}/{fail|restore}`` is the demonstration half of
the same story: it stops or starts one chosen node -- a container, or a local
instance driven by ``pg_ctl`` -- so the failover can be triggered from the
dashboard instead of from a terminal. It refuses unless ``DEMO_CONTROLS`` is
on, because it is an unauthenticated way to stop a database.

The replication columns in ``pg_stat_replication`` are only fully visible to
superusers and to roles granted ``pg_monitor``. When the application role has
not been granted it, the rows come back with null states — that is reported as
``stats_visible: false`` rather than as an empty cluster.
"""

import socket
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import psycopg2
from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from src.config import (
    DB_NAME,
    DB_NODE_TARGETS,
    DB_NODES,
    DB_PASSWORD,
    DB_USER,
    DEMO_CONTROLS,
    DOCKER_BIN,
    PG_CTL_BIN,
)
from src.domain.schema import (
    ClusterOut,
    FailoverEventOut,
    NodeActionOut,
    NodeOut,
    ReplicaOut,
)
from src.infrastructure.db import db_manager
from src.observability.loggers import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["cluster"])

# How many transitions to keep. The history lives in the process, not the
# database: it has to survive the database being down, which is exactly when it
# matters. The cost of that choice is that each uvicorn worker keeps its own
# history — run a single worker while measuring a failover, or read the
# transitions off the log lines below instead.
_MAX_FAILOVERS = 20
_failovers: list[FailoverEventOut] = []
_last_seen: tuple[str | None, int | None] | None = None


# ``pg_current_wal_lsn()`` raises on a standby, so the LSN pair is chosen by
# ``pg_is_in_recovery()`` and both branches return the same column names.
_NODE_SQL = text(
    """
    SELECT
        pg_is_in_recovery()                                   AS in_recovery,
        current_user                                          AS db_user,
        (current_setting('is_superuser') = 'on'
         OR pg_has_role(current_user, 'pg_monitor', 'USAGE'))  AS can_read_stats,
        current_setting('wal_level')                          AS wal_level,
        current_setting('synchronous_commit')                 AS synchronous_commit,
        current_setting('synchronous_standby_names')          AS sync_names,
        current_setting('archive_mode')                       AS archive_mode,
        host(coalesce(inet_server_addr(), '127.0.0.1'::inet)) AS addr,
        inet_server_port()                                    AS port,
        pg_postmaster_start_time()                            AS started_at,
        CASE WHEN pg_is_in_recovery()
             THEN pg_last_wal_replay_lsn() ELSE pg_current_wal_lsn() END AS lsn,
        CASE WHEN pg_is_in_recovery()
             THEN extract(epoch FROM now() - pg_last_xact_replay_timestamp())
             END                                              AS replay_lag_seconds
    """
)

_REPLICAS_SQL = text(
    """
    SELECT
        coalesce(application_name, '?')                       AS name,
        host(client_addr)                                     AS client_addr,
        state,
        sync_state,
        sent_lsn::text                                        AS sent_lsn,
        pg_wal_lsn_diff(sent_lsn, write_lsn)                  AS write_lag,
        pg_wal_lsn_diff(sent_lsn, flush_lsn)                  AS flush_lag,
        pg_wal_lsn_diff(sent_lsn, replay_lsn)                 AS replay_lag
    FROM pg_stat_replication
    ORDER BY application_name
    """
)


def _timeline_of(wal_file: str | None) -> int | None:
    """Reads the timeline id out of a WAL file name.

    A WAL file name is 24 hex characters: 8 for the timeline, then 16 for the
    segment. ``pg_control_checkpoint()`` would give the timeline directly but
    is superuser-only, and ``pg_walfile_name()`` is not.
    """
    if not wal_file or len(wal_file) < 8:
        return None
    try:
        return int(wal_file[:8], 16)
    except ValueError:
        return None


def _record_transition(node: str | None, timeline: int | None) -> None:
    """Appends a failover event when the node or the WAL timeline changed."""
    global _last_seen

    current = (node, timeline)
    if _last_seen == current:
        return

    if _last_seen is None:
        kind = "first_seen"
        previous: tuple[str | None, int | None] = (None, None)
    else:
        previous = _last_seen
        moved_forward = (
            timeline is not None
            and previous[1] is not None
            and timeline > previous[1]
        )
        kind = "promotion" if moved_forward else "switch"

    _failovers.append(
        FailoverEventOut(
            at=datetime.now(timezone.utc),
            kind=kind,
            from_node=previous[0],
            from_timeline=previous[1],
            to_node=node,
            to_timeline=timeline,
        )
    )
    del _failovers[:-_MAX_FAILOVERS]
    _last_seen = current

    if kind != "first_seen":
        logger.warning(
            "Cluster transition (%s): %s (timeline %s) -> %s (timeline %s)",
            kind, previous[0], previous[1], node, timeline,
        )


# How long to wait on a node that is not answering. Short on purpose: the
# dashboard polls every five seconds and a down node must be reported as down
# within one poll, not hold the whole response open until it times out.
_PROBE_TIMEOUT_SECONDS = 2


def _probe_node(host: str, port: int) -> NodeOut:
    """Asks one node directly whether it is up and whether it is in recovery.

    Deliberately not routed through the application's engine: that engine
    connects to whichever node is currently writable, which is the one thing
    this cannot ask it. Each node gets its own short-lived connection, so
    "node 1 is down" and "node 1 is a standby now" are distinguishable.
    """
    try:
        connection = psycopg2.connect(
            host=host,
            port=port,
            user=DB_USER,
            password=DB_PASSWORD,
            dbname=DB_NAME,
            connect_timeout=_PROBE_TIMEOUT_SECONDS,
            # Any node at all: refusing a standby here is exactly backwards,
            # since a standby is what we are trying to see.
            target_session_attrs="any",
        )
    except psycopg2.Error as error:
        return NodeOut(
            host=host,
            port=port,
            reachable=False,
            error=str(error).strip().splitlines()[0][:200] or "unreachable",
        )

    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_is_in_recovery()")
            in_recovery = cursor.fetchone()[0]
        return NodeOut(
            host=host,
            port=port,
            reachable=True,
            role="standby" if in_recovery else "primary",
        )
    except psycopg2.Error as error:
        return NodeOut(
            host=host, port=port, reachable=False,
            error=str(error).strip().splitlines()[0][:200],
        )
    finally:
        connection.close()



def _target_for(index: int) -> str | None:
    """What has to be stopped to take the node at ``index`` down, if anything.

    ``docker:<container>`` or ``pgctl:<data dir>``; see ``DB_NODE_TARGETS``.
    """
    if index >= len(DB_NODE_TARGETS):
        return None
    return DB_NODE_TARGETS[index] or None


def _is_serving(node: NodeOut, addr: str | None, port: int | None) -> bool:
    """Whether this configured node is the one the engine is bound to.

    The configuration says ``localhost`` while the server reports the address
    it is actually listening on, so the two are compared after resolving the
    configured name rather than as strings.
    """
    if port is None or node.port != port:
        return False
    if addr is None or node.host == addr:
        return True
    try:
        return socket.gethostbyname(node.host) == addr
    except OSError:
        return False


def _probe_all(addr: str | None = None, port: int | None = None) -> list[NodeOut]:
    """Probes every configured node at once, in the configured order.

    In parallel because the timeout is per node: probing a two-node cluster
    with both nodes down would otherwise cost twice the timeout, and the
    dashboard's poll interval is not much longer than that.
    """
    if len(DB_NODES) == 1:
        results = [_probe_node(*DB_NODES[0])]
    else:
        with ThreadPoolExecutor(max_workers=len(DB_NODES)) as pool:
            results = list(pool.map(lambda node: _probe_node(*node), DB_NODES))

    for index, node in enumerate(results):
        node.serving = _is_serving(node, addr, port)
        node.target = _target_for(index)
        node.controllable = DEMO_CONTROLS and _command_for(node.target, "fail") is not None
    return results


@router.get("/cluster", response_model=ClusterOut)
def cluster() -> ClusterOut:
    """Reports replication, WAL, and failover state of the write node.

    Like ``/health`` it never raises when the database is down: it answers
    ``reachable: false`` so the dashboard can keep the recorded failover
    history on screen and measure how long the outage lasted.
    """
    now = datetime.now(timezone.utc)

    try:
        with db_manager.engine.connect() as connection:
            node_row = connection.execute(_NODE_SQL).mappings().one()

            lsn = node_row["lsn"]
            wal_file = None
            if lsn is not None:
                wal_file = connection.execute(
                    text("SELECT pg_walfile_name(:lsn)"), {"lsn": str(lsn)}
                ).scalar()

            replica_rows = (
                []
                if node_row["in_recovery"]
                else connection.execute(_REPLICAS_SQL).mappings().all()
            )
    except SQLAlchemyError as error:
        logger.error("Cluster status query failed: %s", error)
        # No node is serving, but each one is still asked separately: that is
        # what turns "the database is down" into "node 1 is down, node 2 is
        # up and still a standby" — the difference between an outage and a
        # failover that has not happened yet.
        return ClusterOut(
            reachable=False,
            error=str(error.__cause__ or error).strip().splitlines()[0][:200],
            nodes=_probe_all(),
            failovers=list(_failovers),
            server_time=now,
        )

    replicas = [
        ReplicaOut(
            name=row["name"],
            client_addr=row["client_addr"],
            state=row["state"],
            sync_state=row["sync_state"],
            sent_lsn=row["sent_lsn"],
            write_lag_bytes=row["write_lag"],
            flush_lag_bytes=row["flush_lag"],
            replay_lag_bytes=row["replay_lag"],
        )
        for row in replica_rows
    ]

    # Without pg_monitor the walsender rows come back with their states nulled,
    # which would read as "no replication" instead of "not allowed to look".
    stats_visible = bool(node_row["can_read_stats"])

    streaming_sync = [r for r in replicas if r.sync_state in {"sync", "quorum"}]
    if streaming_sync:
        sync_mode = "sync"
    elif replicas:
        sync_mode = "async"
    else:
        sync_mode = "none"

    node = f"{node_row['addr']}:{node_row['port']}"
    timeline = _timeline_of(wal_file)
    _record_transition(node, timeline)

    return ClusterOut(
        reachable=True,
        role="standby" if node_row["in_recovery"] else "primary",
        db_user=node_row["db_user"],
        node=node,
        timeline=timeline,
        started_at=node_row["started_at"],
        wal_level=node_row["wal_level"],
        synchronous_commit=node_row["synchronous_commit"],
        synchronous_standby_names=node_row["sync_names"] or None,
        archive_mode=node_row["archive_mode"],
        current_lsn=str(lsn) if lsn is not None else None,
        wal_file=wal_file,
        sync_mode=sync_mode,
        replicas=replicas,
        replay_lag_seconds=(
            float(node_row["replay_lag_seconds"])
            if node_row["replay_lag_seconds"] is not None
            else None
        ),
        stats_visible=stats_visible,
        nodes=_probe_all(node_row["addr"], node_row["port"]),
        failovers=list(_failovers),
        server_time=now,
    )


# ---------------------------------------------------------------- demo control

# Long enough for a container to be stopped and for a PostgreSQL instance to
# come back up and answer, short enough that a wedged command does not hold
# the dashboard's request open forever.
_CONTROL_TIMEOUT_SECONDS = 30

_ACTIONS = ("fail", "restore")


def _command_for(target: str | None, action: str) -> list[str] | None:
    """Turns one node target into the command that fails or restores it.

    ``None`` when nothing is mapped to the node or the kind is not one this
    knows how to drive -- which is also what makes a node uncontrollable in
    the node list, so the dashboard never offers a button that cannot work.
    """
    if not target:
        return None

    kind, separator, value = target.partition(":")
    if not separator:                     # a bare name is a container
        kind, value = "docker", target
    if not value:
        return None

    if kind == "docker":
        # Stopping rather than killing is what the README's HA test 3 and
        # scripts/failover-demo.sh do, so the button and the terminal command
        # demonstrate the same event.
        return [DOCKER_BIN, "stop" if action == "fail" else "start", value]

    if kind == "pgctl":
        if action == "fail":
            # Immediate: no clean shutdown handshake, which is the point --
            # a node that died, not a node that was asked to leave.
            return [PG_CTL_BIN, "-D", value, "-m", "immediate", "stop"]
        return [PG_CTL_BIN, "-D", value, "-l", f"{value}/pg_ctl.log", "start"]

    return None


def _run(command: list[str]) -> tuple[bool, str]:
    """Runs one control command, returning success and a one-line message."""
    try:
        finished = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=_CONTROL_TIMEOUT_SECONDS,
            check=False,
        )
    except FileNotFoundError:
        return False, f"{command[0]} is not installed on this machine"
    except PermissionError:
        return False, f"not allowed to run {command[0]}"
    except subprocess.TimeoutExpired:
        return False, f"{command[0]} did not answer within {_CONTROL_TIMEOUT_SECONDS}s"

    if finished.returncode != 0:
        message = (finished.stderr or finished.stdout).strip().splitlines()
        return False, (message[0][:200] if message else f"exit code {finished.returncode}")

    output = finished.stdout.strip().splitlines()
    return True, (output[-1][:200] if output else "")


@router.post("/cluster/nodes/{index}/{action}", response_model=NodeActionOut)
def node_action(index: int, action: str) -> NodeActionOut:
    """Stops (``fail``) or starts (``restore``) one chosen node of the cluster.

    Nothing here promotes anything: stopping the primary is the whole input to
    the demonstration, and the cluster's own failover manager decides the rest.
    The response says only that the command succeeded -- the promotion shows up
    ten to fifteen seconds later in ``GET /cluster``, as a node whose role
    changed and a failover event on a new WAL timeline.

    Guarded by ``DEMO_CONTROLS`` because it stops a database over plain HTTP
    with nothing authenticating the caller.
    """
    if action not in _ACTIONS:
        raise HTTPException(status_code=404, detail=f"Unknown action: {action}")

    if not DEMO_CONTROLS:
        raise HTTPException(
            status_code=403,
            detail="Node controls are off. Set DEMO_CONTROLS=1 to enable them.",
        )

    if not 0 <= index < len(DB_NODES):
        raise HTTPException(status_code=404, detail=f"No node {index + 1} is configured")

    target = _target_for(index)
    command = _command_for(target, action)
    if command is None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Node {index + 1} cannot be controlled from here"
                f"{f' (target: {target})' if target else ''} -- see DB_NODE_TARGETS"
            ),
        )

    host, port = DB_NODES[index]
    logger.warning(
        "Demonstration control: %s node %d (%s:%s) with %s",
        action, index + 1, host, port, " ".join(command),
    )

    ok, detail = _run(command)

    # Every pooled connection to a stopped node is dead, and the ones to a node
    # that just came back are pinned to whatever role it had before. Dropping
    # the pool makes the next request open a fresh connection, which is what
    # walks the node list again and lands on the new primary -- the same thing
    # pool_pre_ping would do eventually, without waiting for it.
    if ok:
        db_manager.engine.dispose()

    return NodeActionOut(
        ok=ok,
        action=action,
        node=f"{host}:{port}",
        target=target or "",
        detail=detail or None,
    )
