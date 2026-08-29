"""Health check endpoint."""

from datetime import datetime, timezone

from fastapi import APIRouter
from sqlalchemy.exc import SQLAlchemyError

from src.domain.schema import HealthResponse
from src.infrastructure.db import db_manager
from src.observability.loggers import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Checks that the server is alive and connected to the database.

    It does not raise an error when the database goes down; it returns
    ``status="degraded"`` instead: the application server is alive and the front
    end still works from its local cache, which is an essential distinction when
    measuring availability. In phase two this endpoint is the source for
    measuring recovery time (RTO) after the database goes down.
    """
    try:
        db_manager.ping()
        database_status = "up"
        status = "ok"
    except SQLAlchemyError as error:
        logger.error("Database health check failed: %s", error)
        database_status = "down"
        status = "degraded"

    return HealthResponse(
        status=status,
        database=database_status,
        server_time=datetime.now(timezone.utc),
    )
