"""Attempt endpoints: autosave, restore, submission, and score.

This file is the heart of the client-side recoverability requirement.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from src.apis.dependencies import DbSession, get_attempt_or_404
from src.domain.models import Answer, Exam, Student
from src.domain.schema import (
    AttemptAnswersOut,
    BulkSaveRequest,
    SavedAnswerOut,
    SaveResponse,
    ScoreOut,
    SessionOut,
    StartAttemptRequest,
)
from src.domain.services import calculate_score, create_attempt, find_open_attempt
from src.observability.loggers import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/attempts", tags=["attempts"])


@router.post("/start", response_model=SessionOut)
def start_attempt(request: StartAttemptRequest, db: DbSession) -> SessionOut:
    """Opens a new attempt for a student who has already signed in (a retake).

    Login never starts a retake on its own — reloading the page after
    submitting has to show the result, not silently wipe it — so a new attempt
    is only ever created through this explicit request.

    If the student still has an attempt in progress, that one is returned
    instead of a second open attempt: pressing the button twice must not split
    the answers across two rows.
    """
    student = db.get(Student, request.student_id)
    if student is None:
        raise HTTPException(404, "الطالب غير موجود")

    exam = db.get(Exam, request.exam_id)
    if exam is None:
        raise HTTPException(404, "الاختبار غير موجود")

    attempt = find_open_attempt(db, student.id, exam.id)
    status = "resumed"
    if attempt is None:
        attempt = create_attempt(db, student.id, exam.id)
        status = "new"

    # The browser starts saving answers into this attempt right away, so the row
    # has to be durable before the response leaves.
    db.commit()

    logger.info("attempt %s opened for student %s (%s)", attempt.id, student.id, status)

    return SessionOut(
        student_id=student.id,
        student_name=student.name,
        student_email=student.email,
        exam_id=exam.id,
        exam_title=exam.title,
        duration_minutes=exam.duration_minutes,
        attempt_id=attempt.id,
        is_submitted=bool(attempt.is_submitted),
        status=status,
        started_at=attempt.started_at,
    )


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
    if request.attempt_id != attempt_id:
        # A tab left open from an earlier session would otherwise write one
        # student's answers into another student's attempt.
        raise HTTPException(400, "رقم المحاولة في الطلب لا يطابق المسار")

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

    # Commit before answering: the browser turns this response into
    # "✓ saved" and stops treating those answers as pending, so the data has
    # to be durable first.
    db.commit()

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
        db.commit()
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
