"""Student endpoints: signing in and opening a session.

There is no password yet — the email is the identity. That is enough to keep
each student on their own attempt, which is what recoverability needs: a
student who reconnects has to land back on their own answers and nobody
else's.
"""

from fastapi import APIRouter

from src.apis.dependencies import DbSession
from src.domain.schema import LoginRequest, SessionOut
from src.domain.services import ensure_exam, get_or_create_student, start_session
from src.observability.loggers import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/students", tags=["students"])


@router.post("/login", response_model=SessionOut)
def login(request: LoginRequest, db: DbSession) -> SessionOut:
    """Signs a student in and hands back the session they should continue into.

    One request does everything the front end needs at startup: it creates the
    student the first time their email is seen, makes sure the exam content
    exists, then either resumes their attempt in progress, creates a new one,
    or reports that their attempt is already submitted.
    """
    student = get_or_create_student(db, request.name, request.email)
    exam = ensure_exam(db)
    attempt, status = start_session(db, student, exam)

    # The front end fetches the exam as soon as this returns, so the student and
    # the attempt have to be committed before the response leaves.
    db.commit()

    logger.info(
        "login: student=%s attempt=%s status=%s", student.id, attempt.id, status
    )

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
