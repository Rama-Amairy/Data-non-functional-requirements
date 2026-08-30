"""Schemas for the database cluster view: replication, WAL, and failover."""

from datetime import datetime

from pydantic import BaseModel


class ReplicaOut(BaseModel):
    """One standby as the primary sees it, from ``pg_stat_replication``.

    The lag figures are in bytes of WAL: ``write`` is what reached the
    standby's operating system, ``flush`` what reached its disk (this is the
    one synchronous replication waits for), and ``replay`` what is visible to
    readers on the standby.
    """

    name: str
    client_addr: str | None
    state: str | None
    sync_state: str | None
    sent_lsn: str | None
    write_lag_bytes: int | None
    flush_lag_bytes: int | None
    replay_lag_bytes: int | None


class NodeOut(BaseModel):
    """One configured node of the cluster, probed on its own connection.

    ``/cluster`` otherwise only describes the node the application happens to
    be bound to, which cannot answer "is the other node still there?" — the
    question a failover demonstration is entirely about. Each node is
    contacted separately, so a node that is down is reported as down rather
    than as absent.

    ``serving`` marks the node the application's own engine is currently
    writing to.

    ``target`` and ``controllable`` are the demonstration half: the node is
    controllable when something this server knows how to stop is mapped to it
    (see ``DB_NODE_TARGETS``) *and* ``DEMO_CONTROLS`` is on, which is what
    tells the dashboard it may offer to stop this node.
    """

    host: str
    port: int
    reachable: bool
    role: str | None = None       # primary | standby
    serving: bool = False
    error: str | None = None
    target: str | None = None
    controllable: bool = False


class FailoverEventOut(BaseModel):
    """A recorded change of the node the application is writing to.

    ``kind`` is ``promotion`` when the WAL timeline moved forward (a standby
    was promoted), ``switch`` when the same timeline is served by a different
    node, and ``first_seen`` for the first observation after the app started.
    """

    at: datetime
    kind: str
    from_node: str | None
    from_timeline: int | None
    to_node: str | None
    to_timeline: int | None


class NodeActionOut(BaseModel):
    """The result of stopping or starting one node.

    ``ok`` only says the command succeeded. Whether the cluster failed over is
    a separate question, answered by polling ``GET /cluster`` for the ten to
    fifteen seconds repmgr takes to notice and promote.
    """

    ok: bool
    action: str                  # fail | restore
    node: str                    # host:port of the node acted on
    target: str                  # what was stopped or started
    detail: str | None = None


class ClusterOut(BaseModel):
    """Replication, WAL, and failover state of the node the app is bound to.

    ``reachable`` is false when the database cannot be queried at all — the
    dashboard shows the last known state and starts counting downtime instead
    of blanking the panel.
    """

    reachable: bool
    error: str | None = None

    # --- Node identity ---
    role: str | None = None            # primary | standby | unknown
    node: str | None = None            # address:port of the node answering
    db_user: str | None = None         # the role the app connects as
    timeline: int | None = None        # increments by one on every promotion
    started_at: datetime | None = None  # postmaster start time

    # --- WAL ---
    wal_level: str | None = None
    synchronous_commit: str | None = None
    synchronous_standby_names: str | None = None
    archive_mode: str | None = None
    current_lsn: str | None = None
    wal_file: str | None = None

    # --- Replication ---
    sync_mode: str | None = None       # sync | async | none
    replicas: list[ReplicaOut] = []
    replay_lag_seconds: float | None = None   # standby only
    stats_visible: bool = True         # false => the app role lacks pg_monitor

    # --- The cluster's nodes ---
    # Every configured node, probed separately, so a node that is down is
    # visible as down instead of simply missing from the picture.
    nodes: list[NodeOut] = []

    # --- Failover ---
    failovers: list[FailoverEventOut] = []

    server_time: datetime
