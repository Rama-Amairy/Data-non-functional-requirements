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
from urllib.parse import quote_plus

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
