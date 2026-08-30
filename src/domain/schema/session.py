"""Session schemas: sign-in and starting an attempt."""

from datetime import datetime

from pydantic import BaseModel, Field

# Kept as a plain pattern instead of ``EmailStr`` so the project does not gain
# an ``email-validator`` dependency for one field.
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$"


class LoginRequest(BaseModel):
    """Sign-in request: the student's name and their email.

    The email is the identity — it is what tells two students apart and what
    ties a returning student back to their own attempt.
    """

    name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=5, max_length=150, pattern=EMAIL_PATTERN)


class StartAttemptRequest(BaseModel):
    """Request to open a new attempt for a student who already signed in."""

    student_id: int
    exam_id: int


class SessionOut(BaseModel):
    """Everything the front end needs in order to start or resume an exam.

    ``status`` is one of ``new`` (the attempt was just created), ``resumed``
    (an attempt still in progress was picked up), or ``submitted`` (every
    attempt is finished, so the result is shown instead).
    """

    student_id: int
    student_name: str
    student_email: str
    exam_id: int
    exam_title: str
    duration_minutes: int
    attempt_id: int
    is_submitted: bool
    status: str
    started_at: datetime | None
