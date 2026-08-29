"""Application startup and shutdown.

The startup sequence is deliberately tolerant of a database that is not ready
yet: it retries the connection instead of crashing. That behaviour is the first
building block of recoverability on the server side — in phase two the same
retry loop is what will carry the application across a failover to the replica.
"""

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.exc import SQLAlchemyError

from src.config import (
    DB_AUTO_CREATE,
    DB_CONNECT_RETRIES,
    DB_CONNECT_RETRY_DELAY,
    safe_database_url,
)
from src.infrastructure.db import db_manager
from src.observability.loggers import get_logger, setup_logging

logger = get_logger(__name__)


def wait_for_database() -> bool:
    """Pings the database, retrying up to ``DB_CONNECT_RETRIES`` times.

    Returns True once the connection succeeds, or False after the last attempt
    fails. A failure does not stop the server: the front end keeps working from
    its local cache, and ``/api/v1/health`` reports ``degraded`` until the
    database comes back.
    """
    for attempt_number in range(1, DB_CONNECT_RETRIES + 1):
        try:
            db_manager.ping()
            logger.info("Database connection established (%s)", safe_database_url())
            return True
        except SQLAlchemyError as error:
            logger.warning(
                "Database connection attempt %s/%s failed: %s",
                attempt_number,
                DB_CONNECT_RETRIES,
                str(error).splitlines()[0],
            )
            if attempt_number < DB_CONNECT_RETRIES:
                time.sleep(DB_CONNECT_RETRY_DELAY)

    logger.error(
        "Could not reach the database after %s attempts — starting in degraded mode",
        DB_CONNECT_RETRIES,
    )
    return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Prepares the database at startup and releases connections at shutdown."""
    setup_logging()
    logger.info("Starting the exam platform")

    if wait_for_database() and DB_AUTO_CREATE:
        db_manager.create_db_and_tables()
        logger.info("Schema is ready (DB_AUTO_CREATE=1)")

    yield

    db_manager.dispose()
    logger.info("Shutting down — database connections released")
