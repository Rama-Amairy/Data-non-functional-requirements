"""Attempt schemas: autosave, restore, submission, and score."""

from datetime import datetime

from pydantic import BaseModel, Field


class AnswerSave(BaseModel):
    """A single answer coming from the browser within an autosave batch."""

    question_id: int
    selected_answer: str = Field(pattern="^[abcd]$")
    version: int = Field(default=1, ge=1)


class BulkSaveRequest(BaseModel):
    """A batch of answers sent together every 30 seconds, or when re-syncing after a disconnect."""

    attempt_id: int
    answers: list[AnswerSave]


class SaveResponse(BaseModel):
    """Result of an autosave operation.

    ``saved_count`` is the number of answers actually written, and
    ``skipped_count`` is the number the server rejected because their version
    was older than the stored one.
    """

    status: str
    saved_count: int
    skipped_count: int = 0
    server_time: datetime


class SavedAnswerOut(BaseModel):
    """A saved answer as returned to the browser during restore."""

    question_id: int
    selected_answer: str | None
    version: int
    updated_at: datetime | None


class AttemptAnswersOut(BaseModel):
    """All the saved answers for an attempt, along with its status."""

    attempt_id: int
    is_submitted: bool
    started_at: datetime | None
    answers: list[SavedAnswerOut]


class ScoreOut(BaseModel):
    """The score of a submitted attempt."""

    attempt_id: int
    status: str
    finished_at: datetime | None
    correct_count: int
    answered_count: int
    total_questions: int
    percentage: float
