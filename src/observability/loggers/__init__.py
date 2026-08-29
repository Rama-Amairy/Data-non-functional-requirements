"""Logging setup for the project.

In phase two these logs are the written evidence of how the system behaves
during an outage: the moment the database connection is lost, the number of
reconnection attempts, and the moment service returns — the raw material from
which recovery time is computed.
"""

import logging
import sys

from src.config import LOG_LEVEL

_LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
_configured = False


def setup_logging() -> None:
    """Configures the root logger once (called at application startup)."""
    global _configured
    if _configured:
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_LOG_FORMAT))

    root = logging.getLogger()
    root.setLevel(LOG_LEVEL)
    root.addHandler(handler)

    _configured = True


def get_logger(name: str) -> logging.Logger:
    """Returns a logger named after the requested module, ensuring the root logger is configured."""
    setup_logging()
    return logging.getLogger(name)


__all__ = ["setup_logging", "get_logger"]
