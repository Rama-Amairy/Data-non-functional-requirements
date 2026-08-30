"""Domain logic shared between more than one router: exam content, sessions, and scoring."""

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.domain.models import Answer, Exam, ExamAttempt, Question, Student

EXAM_TITLE = "اختبار هندسة البرمجيات"
EXAM_DURATION_MINUTES = 30

EXAM_QUESTIONS = [
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


# --- Exam content ---------------------------------------------------------


def ensure_exam(db: Session) -> Exam:
    """Ensures the exam and its questions exist, and returns the exam.

    Idempotent: it writes only the first time, because the login endpoint calls
    it on every sign-in. The exam is content shared by every student — it is not
    tied to any one of them.
    """
    exam = db.execute(select(Exam).order_by(Exam.id).limit(1)).scalar_one_or_none()
    if exam is not None:
        return exam

    exam = Exam(title=EXAM_TITLE, duration_minutes=EXAM_DURATION_MINUTES)
    db.add(exam)
    db.flush()

    for question in EXAM_QUESTIONS:
        db.add(Question(exam_id=exam.id, **question))
    db.flush()

    return exam


def count_questions(db: Session, exam_id: int) -> int:
    """Number of questions in an exam."""
    return db.execute(
        select(func.count(Question.id)).where(Question.exam_id == exam_id)
    ).scalar_one()


# --- Students -------------------------------------------------------------


def get_or_create_student(db: Session, name: str, email: str) -> Student:
    """Fetches the student by email, or creates them the first time they sign in.

    The email is the identity: it is normalised to lower case so
    ``Ali@Mail.com`` and ``ali@mail.com`` are one student, not two. The name is
    refreshed on every sign-in so a correction to its spelling is kept.

    ``IntegrityError`` is handled because two browsers can sign in with the same
    new email at the same moment; the loser of that race reads the row the
    winner wrote instead of failing.
    """
    normalized_email = email.strip().lower()
    clean_name = name.strip()

    student = db.execute(
        select(Student).where(Student.email == normalized_email)
    ).scalar_one_or_none()

    if student is None:
        student = Student(name=clean_name, email=normalized_email)
        db.add(student)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            student = db.execute(
                select(Student).where(Student.email == normalized_email)
            ).scalar_one()

    if student.name != clean_name:
        student.name = clean_name

    return student


# --- Attempts -------------------------------------------------------------


def find_open_attempt(db: Session, student_id: int, exam_id: int) -> ExamAttempt | None:
    """The student's attempt that is still in progress, if there is one."""
    return db.execute(
        select(ExamAttempt)
        .where(
            ExamAttempt.student_id == student_id,
            ExamAttempt.exam_id == exam_id,
            ExamAttempt.is_submitted.is_(False),
        )
        .order_by(ExamAttempt.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def find_latest_attempt(db: Session, student_id: int, exam_id: int) -> ExamAttempt | None:
    """The student's most recent attempt whatever its state."""
    return db.execute(
        select(ExamAttempt)
        .where(
            ExamAttempt.student_id == student_id,
            ExamAttempt.exam_id == exam_id,
        )
        .order_by(ExamAttempt.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def create_attempt(db: Session, student_id: int, exam_id: int) -> ExamAttempt:
    """Opens a new attempt for the student.

    Creating the row here is not a minor detail: the ``answers`` table is tied
    to it by a foreign key, so any autosave before it exists would fail.
    """
    attempt = ExamAttempt(student_id=student_id, exam_id=exam_id, is_submitted=False)
    db.add(attempt)
    db.flush()
    return attempt


def start_session(db: Session, student: Student, exam: Exam) -> tuple[ExamAttempt, str]:
    """Resolves which attempt the student continues into, and how.

    * an attempt still in progress -> ``resumed`` (reloading the page or coming
      back after a disconnect must never lose the answers already saved);
    * no attempt at all -> ``new``;
    * every attempt submitted -> ``submitted``, so the front end shows the
      result instead of silently starting a retake. A deliberate retake goes
      through ``POST /attempts/start``.
    """
    open_attempt = find_open_attempt(db, student.id, exam.id)
    if open_attempt is not None:
        return open_attempt, "resumed"

    latest = find_latest_attempt(db, student.id, exam.id)
    if latest is not None:
        return latest, "submitted"

    return create_attempt(db, student.id, exam.id), "new"


# --- Scoring --------------------------------------------------------------


def calculate_score(db: Session, attempt: ExamAttempt) -> dict:
    """Computes the number of correct answers against the exam's total questions.

    Grading happens on the server exclusively, because ``correct_answer`` is
    never sent to the browser from any endpoint.
    """
    total = count_questions(db, attempt.exam_id)

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
