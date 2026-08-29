"""Schemas for the exam, its questions, and the demo login."""

from datetime import datetime

from pydantic import BaseModel, Field


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
    """Result of seeding the demo data."""

    status: str
    exam_id: int
    attempt_id: int
    student_id: int
    questions_count: int


class DemoLoginRequest(BaseModel):
    """Phase-one login request: the student name only."""

    name: str = Field(min_length=1, max_length=100)


class DemoLoginResponse(BaseModel):
    """The identifiers the front end needs in order to start the exam."""

    student_id: int
    student_name: str
    exam_id: int
    attempt_id: int
    is_submitted: bool


class HealthResponse(BaseModel):
    """Server and database status."""

    status: str
    database: str
    server_time: datetime
