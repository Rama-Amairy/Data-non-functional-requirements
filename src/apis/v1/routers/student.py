"""Student endpoints.

In phase one there is no authentication system yet, so login goes through a
single demo endpoint that returns the fixed identifiers (student 1, exam 1,
attempt 1).
"""

from fastapi import APIRouter, HTTPException

from src.apis.dependencies import DbSession
from src.domain.models import ExamAttempt, Student
from src.domain.schema import DemoLoginRequest, DemoLoginResponse
from src.domain.services import DEMO_ATTEMPT_ID, DEMO_EXAM_ID, DEMO_STUDENT_ID, ensure_demo_data

router = APIRouter(prefix="/students", tags=["students"])


@router.post("/demo-login", response_model=DemoLoginResponse)
def demo_login(request: DemoLoginRequest, db: DbSession) -> DemoLoginResponse:
    """Demo login with the student name only.

    It does three things in one request so the front end does not need several
    calls at startup: it makes sure the demo data exists, updates the demo
    student's name with the one entered, then returns the identifiers and the
    attempt state (``is_submitted``) so the front end can decide whether to show
    the exam or go straight to the result page.

    This endpoint will later be replaced by a real login with one attempt per
    student.
    """
    ensure_demo_data(db)

    student = db.get(Student, DEMO_STUDENT_ID)
    if student is None:
        raise HTTPException(500, "تعذّر تجهيز الطالب التجريبي")
    student.name = request.name

    attempt = db.get(ExamAttempt, DEMO_ATTEMPT_ID)
    if attempt is None:
        raise HTTPException(500, "تعذّر تجهيز المحاولة التجريبية")

    return DemoLoginResponse(
        student_id=student.id,
        student_name=student.name,
        exam_id=DEMO_EXAM_ID,
        attempt_id=attempt.id,
        is_submitted=bool(attempt.is_submitted),
    )
