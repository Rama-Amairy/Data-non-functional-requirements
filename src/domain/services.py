"""Domain logic shared between more than one router: demo data and score calculation."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.domain.models import Answer, Exam, ExamAttempt, Question, Student

# Fixed identifiers for phase one (until a real login is added).
DEMO_STUDENT_ID = 1
DEMO_EXAM_ID = 1
DEMO_ATTEMPT_ID = 1

DEMO_QUESTIONS = [
    {
        "order_num": 1,
        "text": "ما هو الـ MTBF؟",
        "option_a": "متوسط الزمن بين الأعطال",
        "option_b": "متوسط زمن التعافي",
        "option_c": "الحد الأقصى للتوقف",
        "option_d": "معدل الأخطاء اليومي",
        "correct_answer": "a",
    },
    {
        "order_num": 2,
        "text": "ما الفرق بين RPO و RTO؟",
        "option_a": "RPO للأمان و RTO للسرعة",
        "option_b": "RPO لكمية البيانات المفقودة و RTO لزمن التعطل",
        "option_c": "لا فرق بينهما",
        "option_d": "RPO للخادم و RTO للعميل",
        "correct_answer": "b",
    },
    {
        "order_num": 3,
        "text": "ما هو نمط Circuit Breaker؟",
        "option_a": "تشفير البيانات",
        "option_b": "قطع الطلبات نحو خدمة فاشلة لمنع الفشل المتتالي",
        "option_c": "ضغط البيانات",
        "option_d": "موازنة الحمل",
        "correct_answer": "b",
    },
    {
        "order_num": 4,
        "text": "ماذا تعني إتاحة 99.99%؟",
        "option_a": "نحو 8 ساعات توقف سنوياً",
        "option_b": "نحو 52 دقيقة توقف سنوياً",
        "option_c": "نحو 5 دقائق توقف سنوياً",
        "option_d": "لا توقف أبداً",
        "correct_answer": "b",
    },
    {
        "order_num": 5,
        "text": "أي نموذج اتساق يناسب العدّادات والتفاعلات؟",
        "option_a": "الاتساق القوي Strong",
        "option_b": "الاتساق السببي Causal",
        "option_c": "الاتساق النهائي Eventual",
        "option_d": "لا يوجد نموذج مناسب",
        "correct_answer": "c",
    },
]


def ensure_demo_data(db: Session) -> dict:
    """Ensures the demo student, exam, questions, and attempt exist.

    The operation is idempotent: if the exam already exists, nothing is written
    and the status ``already_seeded`` is returned. This matters because the
    front end calls it every time a student starts an exam.

    Creating the ``ExamAttempt`` here is not a minor detail: the ``answers``
    table is tied to it by a foreign key, so any autosave before it exists
    would fail.
    """
    exam = db.get(Exam, DEMO_EXAM_ID)
    if exam is not None:
        questions_count = db.execute(
            select(func.count(Question.id)).where(Question.exam_id == DEMO_EXAM_ID)
        ).scalar_one()
        return {
            "status": "already_seeded",
            "exam_id": DEMO_EXAM_ID,
            "attempt_id": DEMO_ATTEMPT_ID,
            "student_id": DEMO_STUDENT_ID,
            "questions_count": questions_count,
        }

    db.add(Student(id=DEMO_STUDENT_ID, name="طالب تجريبي", email="test@example.com"))
    db.add(Exam(id=DEMO_EXAM_ID, title="اختبار هندسة البرمجيات", duration_minutes=30))
    db.flush()

    for question in DEMO_QUESTIONS:
        db.add(Question(exam_id=DEMO_EXAM_ID, **question))

    db.add(
        ExamAttempt(
            id=DEMO_ATTEMPT_ID,
            student_id=DEMO_STUDENT_ID,
            exam_id=DEMO_EXAM_ID,
            is_submitted=False,
        )
    )
    db.flush()

    return {
        "status": "seeded",
        "exam_id": DEMO_EXAM_ID,
        "attempt_id": DEMO_ATTEMPT_ID,
        "student_id": DEMO_STUDENT_ID,
        "questions_count": len(DEMO_QUESTIONS),
    }


def calculate_score(db: Session, attempt: ExamAttempt) -> dict:
    """Computes the number of correct answers against the exam's total questions.

    Grading happens on the server exclusively, because ``correct_answer`` is
    never sent to the browser from any endpoint.
    """
    total = db.execute(
        select(func.count(Question.id)).where(Question.exam_id == attempt.exam_id)
    ).scalar_one()

    correct = db.execute(
        select(func.count(Answer.id))
        .join(Question, Question.id == Answer.question_id)
        .where(
            Answer.attempt_id == attempt.id,
            Answer.selected_answer == Question.correct_answer,
        )
    ).scalar_one()

    answered = db.execute(
        select(func.count(Answer.id)).where(
            Answer.attempt_id == attempt.id,
            Answer.selected_answer.isnot(None),
        )
    ).scalar_one()

    return {
        "correct_count": correct,
        "answered_count": answered,
        "total_questions": total,
        "percentage": round(correct / total * 100, 1) if total else 0.0,
    }
