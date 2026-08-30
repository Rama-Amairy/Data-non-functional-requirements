"""Schemas for the exam and its questions."""

from datetime import datetime

from pydantic import BaseModel


class QuestionOut(BaseModel):
    """A question as sent to the browser — without the ``correct_answer`` field."""

    id: int
    text: str
    options: dict[str, str]
    order: int


class ExamOut(BaseModel):
    """An exam together with its questions in order."""

    id: int
    title: str
    duration_minutes: int
    questions: list[QuestionOut]


class SeedResponse(BaseModel):
    """Result of making sure the exam content exists."""

    status: str
    exam_id: int
    questions_count: int


class HealthResponse(BaseModel):
    """Server and database status."""

    status: str
    database: str
    server_time: datetime
