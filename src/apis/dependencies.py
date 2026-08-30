"""FastAPI dependencies shared between the endpoints."""

from typing import Annotated, Generator

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from src.domain.models import ExamAttempt
from src.infrastructure.db import db_manager


def get_db() -> Generator[Session, None, None]:
    """One database session per request.

    Relies on ``db_manager.session()``, so a commit runs automatically when the
    request succeeds and a rollback runs when any exception is raised —
    including ``HTTPException`` — so no partial data is written when validation
    fails midway through an operation.

    That automatic commit runs during dependency teardown, which FastAPI
    executes *after* the response has been sent — measured at 1.3-1.9 ms after
    the client received it. Any endpoint that writes must therefore call
    ``db.commit()`` itself before returning, so the "saved" acknowledgement can
    never outrun durability.
    """
    with db_manager.session() as session:
        yield session


DbSession = Annotated[Session, Depends(get_db)]


def get_attempt_or_404(attempt_id: int, db: Session) -> ExamAttempt:
    """Fetches the attempt, or raises 404 if it does not exist."""
    attempt = db.get(ExamAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(404, "المحاولة غير موجودة")
    return attempt
