"""Pydantic schemas for the API requests and responses."""

from src.domain.schema.attempt import (
    AnswerSave,
    AttemptAnswersOut,
    BulkSaveRequest,
    SavedAnswerOut,
    SaveResponse,
    ScoreOut,
)
from src.domain.schema.exam import (
    DemoLoginRequest,
    DemoLoginResponse,
    ExamOut,
    HealthResponse,
    QuestionOut,
    SeedResponse,
)

__all__ = [
    "AnswerSave",
    "AttemptAnswersOut",
    "BulkSaveRequest",
    "SaveResponse",
    "SavedAnswerOut",
    "ScoreOut",
    "DemoLoginRequest",
    "DemoLoginResponse",
    "ExamOut",
    "HealthResponse",
    "QuestionOut",
    "SeedResponse",
]
