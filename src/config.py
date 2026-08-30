"""Application settings.

Values are read from environment variables, and from a ``.env`` file at the
project root if one exists (a real environment variable always takes
precedence over the file).

Why they are gathered in one place: ``alembic/env.py`` and
``src/infrastructure/db`` need the same URL, and its definition must not be
duplicated across two files.
"""

import os
from pathlib import Path
from urllib.parse import parse_qs, quote_plus, urlsplit

BASE_DIR = Path(__file__).resolve().parent.parent
UI_DIR = BASE_DIR / "UI"
ENV_FILE = BASE_DIR / ".env"


def _load_env_file(path: Path) -> None:
    """Loads a simple ``.env`` file (``KEY=VALUE`` lines) without external libraries."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file(ENV_FILE)


# --- Database -------------------------------------------------------------

DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "exam_platform")

# All of the above can be overridden with a full URL, which is what we will use
# in phase two to switch to the replica when the primary server goes down.
DATABASE_URL = os.getenv("DATABASE_URL") or (
    f"postgresql+psycopg2://{quote_plus(DB_USER)}:{quote_plus(DB_PASSWORD)}"
    f"@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)

# Reconnection attempts at startup: the basis for measuring recovery time (RTO) later.
DB_CONNECT_RETRIES = int(os.getenv("DB_CONNECT_RETRIES", "5"))
DB_CONNECT_RETRY_DELAY = float(os.getenv("DB_CONNECT_RETRY_DELAY", "2"))

# Create the tables automatically at startup.
# Set it to 0 once Alembic is adopted so migrations stay the single source of
# truth for the schema.
DB_AUTO_CREATE = os.getenv("DB_AUTO_CREATE", "1").lower() in {"1", "true", "yes"}

DB_ECHO = os.getenv("DB_ECHO", "0").lower() in {"1", "true", "yes"}

# --- The cluster's nodes --------------------------------------------------
#
# Every node the application may be served by, most preferred first, as a
# comma-separated ``host:port`` list. Two things read it:
#
# * the engine, which hands the whole list to libpq. Together with
#   ``target_session_attrs=read-write`` (set in the database manager) that is
#   the failover itself: libpq walks the list and refuses any node still in
#   recovery, so once a standby is promoted the next connection lands on it
#   with no restart and no configuration change.
# * ``GET /cluster``, which probes each node separately so the dashboard can
#   say which node is up, which is down, and which one is being served.
#
# Left unset it holds the single node from DB_HOST/DB_PORT, which is the
# previous behaviour exactly: one node, and nothing to fail over to.


def _parse_nodes(raw: str) -> list[tuple[str, int]]:
    """Parses ``host:port,host:port`` into pairs, keeping the given order."""
    nodes: list[tuple[str, int]] = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        host, _, port = entry.rpartition(":")
        if not host:  # bare hostname, no port
            host, port = entry, DB_PORT
        try:
            pair = (host, int(port))
        except ValueError:
            continue
        if pair not in nodes:
            nodes.append(pair)
    return nodes


def _nodes_from_url(url: str) -> list[tuple[str, int]]:
    """Reads the node list out of a libpq-style multi-host DATABASE_URL.

    The failover-aware URL documented in the README carries its hosts in the
    query string rather than in the authority::

        postgresql+psycopg2://user:pw@/app_db
            ?host=localhost,localhost&port=5434,5433&target_session_attrs=read-write

    libpq pairs the two lists positionally, and so does this. A single-host
    URL of the ordinary ``@host:port/db`` shape yields its one node.
    """
    parts = urlsplit(url)
    query = parse_qs(parts.query)

    hosts = [h for h in (query.get("host", [""])[0]).split(",") if h.strip()]
    if hosts:
        ports = [p for p in (query.get("port", [""])[0]).split(",") if p.strip()]
        # A shorter port list repeats its last entry, the way libpq does.
        return _parse_nodes(
            ",".join(
                f"{host.strip()}:{(ports[i] if i < len(ports) else (ports[-1] if ports else DB_PORT)).strip()}"
                for i, host in enumerate(hosts)
            )
        )

    if parts.hostname:
        return _parse_nodes(f"{parts.hostname}:{parts.port or DB_PORT}")
    return []


# DB_NODES wins when set; otherwise the list is read back out of DATABASE_URL,
# so the failover-aware URL in the README lights up the dashboard's node panel
# without having to configure the same two nodes twice.
DB_NODES = (
    _parse_nodes(os.getenv("DB_NODES", ""))
    or _nodes_from_url(DATABASE_URL)
    or [(DB_HOST, int(DB_PORT))]
)


# --- Demonstration controls -----------------------------------------------
#
# The failover demonstration needs a node killed while the audience watches.
# ``scripts/failover-demo.sh`` does that from a terminal; with this flag on,
# the dashboard can do it too, so the presenter picks the node on screen
# instead of switching to a shell mid-sentence.
#
# Off by default, and it must stay off anywhere the API is reachable by anyone
# else: the endpoint it opens stops a database and there is no authentication
# in front of it. It is a demonstration aid for a laptop, not a feature of the
# platform.
DEMO_CONTROLS = os.getenv("DEMO_CONTROLS", "0").lower() in {"1", "true", "yes"}

DOCKER_BIN = os.getenv("DOCKER_BIN", "docker")

# Debian and Ubuntu keep pg_ctl out of PATH, under /usr/lib/postgresql/<ver>/bin.
PG_CTL_BIN = os.getenv("PG_CTL_BIN", "pg_ctl")

# What has to be stopped to take each node of DB_NODES down, positionally: the
# first target belongs to the first node. Two kinds are understood, because
# the cluster is run both ways:
#
#   docker:<container>   the compose cluster of docker/docker-compose.yml
#   pgctl:<data dir>     a PostgreSQL instance started directly by pg_ctl
#
# A bare name with no prefix is taken as a container. An empty entry leaves
# that node uncontrollable, which is how a node nobody may stop -- a system
# cluster owned by another user, say -- is declared. Unset, the container
# names Docker Compose derives from docker/docker-compose.yml are assumed, the
# same default scripts/failover-demo.sh uses.


def _node_targets(count: int) -> list[str]:
    """Reads the per-node control targets, positionally against DB_NODES."""
    raw = os.getenv("DB_NODE_TARGETS", "").strip()
    if not raw:
        return [f"docker:docker-pg_node_{index + 1}-1" for index in range(count)]
    targets = [target.strip() for target in raw.split(",")]
    # A short list leaves the remaining nodes uncontrollable rather than
    # shifting the mapping onto the wrong node.
    return (targets + [""] * count)[:count]


DB_NODE_TARGETS = _node_targets(len(DB_NODES))


# --- Server and logging ---------------------------------------------------

APP_HOST = os.getenv("HOST", "127.0.0.1")
APP_PORT = int(os.getenv("PORT", "8000"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

API_V1_PREFIX = "/api/v1"


def safe_database_url() -> str:
    """Returns the database URL with the password masked, for use in logs."""
    if "@" not in DATABASE_URL:
        return DATABASE_URL
    scheme_and_credentials, _, host_part = DATABASE_URL.rpartition("@")
    scheme, _, credentials = scheme_and_credentials.partition("://")
    user = credentials.partition(":")[0]
    return f"{scheme}://{user}:***@{host_part}"
