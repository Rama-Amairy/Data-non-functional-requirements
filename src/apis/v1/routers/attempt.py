"""Attempt endpoints: autosave, restore, submission, and score.

This file is the heart of the client-side recoverability requirement.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from src.apis.dependencies import DbSession, get_attempt_or_404
from src.domain.models import Answer
from src.domain.schema import (
    AttemptAnswersOut,
    BulkSaveRequest,
    SavedAnswerOut,
    SaveResponse,
    ScoreOut,
)
from src.domain.services import calculate_score
from src.observability.loggers import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/attempts", tags=["attempts"])


@router.get("/{attempt_id}/answers", response_model=AttemptAnswersOut)
def get_saved_answers(attempt_id: int, db: DbSession) -> AttemptAnswersOut:
    """Returns every saved answer for an attempt — the client-side recovery point.

    When the page is opened after a lost connection or a browser crash, the
    front end calls this endpoint and merges the result with its local copy;
    the higher ``version`` number wins.
    """
    attempt = get_attempt_or_404(attempt_id, db)

    answers = (
        db.execute(select(Answer).where(Answer.attempt_id == attempt_id))
        .scalars()
        .all()
    )

    return AttemptAnswersOut(
        attempt_id=attempt_id,
        is_submitted=bool(attempt.is_submitted),
        started_at=attempt.started_at,
        answers=[
            SavedAnswerOut(
                question_id=answer.question_id,
                selected_answer=answer.selected_answer,
                version=answer.version,
                updated_at=answer.updated_at,
            )
            for answer in answers
        ],
    )


@router.post("/{attempt_id}/save", response_model=SaveResponse)
def save_answers(
    attempt_id: int, request: BulkSaveRequest, db: DbSession
) -> SaveResponse:
    """Batched autosave of answers (called every 30 seconds from the browser).

    Version arbitration rules:

    * If the answer does not exist, it is created as received.
    * If it does exist, it is accepted only when the incoming ``version`` is
      greater than or equal to the stored one; otherwise it is ignored and
      counted in ``skipped_count``.

    This rule makes the request safe to resend (idempotent): resending the same
    batch after a network failure does not corrupt the data, and an old batch
    arriving late after the connection returns cannot overwrite a newer answer.
    """
    attempt = get_attempt_or_404(attempt_id, db)
    if attempt.is_submitted:
        raise HTTPException(409, "تم تسليم هذه المحاولة، لا يمكن تعديل الإجابات")

    saved = 0
    skipped = 0
    for incoming in request.answers:
        existing = db.execute(
            select(Answer).where(
                Answer.attempt_id == attempt_id,
                Answer.question_id == incoming.question_id,
            )
        ).scalar_one_or_none()

        if existing is None:
            db.add(
                Answer(
                    attempt_id=attempt_id,
                    question_id=incoming.question_id,
                    selected_answer=incoming.selected_answer,
                    version=incoming.version,
                )
            )
            saved += 1
        elif incoming.version >= existing.version:
            existing.selected_answer = incoming.selected_answer
            existing.version = incoming.version
            saved += 1
        else:
            skipped += 1

    logger.info(
        "autosave: attempt=%s saved=%s skipped=%s", attempt_id, saved, skipped
    )

    return SaveResponse(
        status="ok",
        saved_count=saved,
        skipped_count=skipped,
        server_time=datetime.now(timezone.utc),
    )


@router.post("/{attempt_id}/submit", response_model=ScoreOut)
def submit_exam(attempt_id: int, db: DbSession) -> ScoreOut:
    """Submits the attempt and computes the score on the server.

    Idempotent: if the attempt was already submitted, the original submission
    time and the same score are returned unchanged, so pressing the button twice
    or resending the request after a disconnect cannot produce a different
    result.
    """
    attempt = get_attempt_or_404(attempt_id, db)

    if not attempt.is_submitted:
        attempt.is_submitted = True
        attempt.finished_at = datetime.now(timezone.utc)
        db.flush()
        logger.info("attempt %s submitted", attempt_id)

    return ScoreOut(
        attempt_id=attempt_id,
        status="submitted",
        finished_at=attempt.finished_at,
        **calculate_score(db, attempt),
    )


@router.get("/{attempt_id}/result", response_model=ScoreOut)
def get_result(attempt_id: int, db: DbSession) -> ScoreOut:
    """Returns the score of a submitted attempt (to show the result page after a reload)."""
    attempt = get_attempt_or_404(attempt_id, db)
    if not attempt.is_submitted:
        raise HTTPException(409, "لم يتم تسليم هذه المحاولة بعد")

    return ScoreOut(
        attempt_id=attempt_id,
        status="submitted",
        finished_at=attempt.finished_at,
        **calculate_score(db, attempt),
    )
