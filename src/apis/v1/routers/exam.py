"""Exam and question endpoints."""

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from src.apis.dependencies import DbSession
from src.domain.models import Exam, Question
from src.domain.schema import ExamOut, QuestionOut, SeedResponse
from src.domain.services import count_questions, ensure_exam

router = APIRouter(prefix="/exams", tags=["exams"])


@router.post("/seed", response_model=SeedResponse)
def seed_data(db: DbSession) -> SeedResponse:
    """Makes sure the exam and its questions exist.

    Idempotent: if the exam is already there it returns ``already_seeded``
    without writing anything. Students and attempts are not created here — they
    are created per person at login.
    """
    existing = db.execute(select(Exam).order_by(Exam.id).limit(1)).scalar_one_or_none()
    exam = ensure_exam(db)
    db.commit()

    return SeedResponse(
        status="already_seeded" if existing is not None else "seeded",
        exam_id=exam.id,
        questions_count=count_questions(db, exam.id),
    )


@router.get("/{exam_id}", response_model=ExamOut)
def get_exam(exam_id: int, db: DbSession) -> ExamOut:
    """Fetches the exam and its questions ordered by ``order_num``.

    The ``correct_answer`` field is never sent to the browser; grading happens
    on the server at submission time only.
    """
    exam = db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(404, "الاختبار غير موجود")

    questions = (
        db.execute(
            select(Question)
            .where(Question.exam_id == exam_id)
            .order_by(Question.order_num)
        )
        .scalars()
        .all()
    )

    return ExamOut(
        id=exam.id,
        title=exam.title,
        duration_minutes=exam.duration_minutes,
        questions=[
            QuestionOut(
                id=question.id,
                text=question.text,
                options={
                    "a": question.option_a,
                    "b": question.option_b,
                    "c": question.option_c,
                    "d": question.option_d,
                },
                order=question.order_num,
            )
            for question in questions
        ],
    )
