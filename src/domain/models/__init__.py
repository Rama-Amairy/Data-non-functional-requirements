"""Domain models.

Importing every model here is required so their tables are registered in
``Base.metadata``, which is what Alembic relies on to generate migrations and
what ``create_db_and_tables`` relies on as well.
"""

from src.domain.models.exam import Answer, Exam, ExamAttempt, Question, Student

__all__ = ["Student", "Exam", "Question", "ExamAttempt", "Answer"]
