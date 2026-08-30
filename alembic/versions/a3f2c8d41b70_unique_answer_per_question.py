"""one answer row per question per attempt

Revision ID: a3f2c8d41b70
Revises: 976b8ff70660
Create Date: 2026-08-30 06:20:00.000000

The autosave path used to read an answer and then write it in two separate
statements, so two overlapping requests for the same question could both find
no row and both insert one. That is not a rare interleaving: on ``pagehide``
the browser beacons every answer that is not yet synced, including the ones the
in-flight batch is already carrying.

The duplicates were not merely untidy. ``scalar_one_or_none()`` in the save
endpoint raised ``MultipleResultsFound`` on the next request, so autosave
stayed broken for that attempt for the rest of the exam, and ``calculate_score``
counted answer rows rather than questions, so the score could exceed 100%.

This migration removes any duplicates already written and adds the unique key
that stops them coming back.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a3f2c8d41b70'
down_revision: Union[str, Sequence[str], None] = '976b8ff70660'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Keep the winner of the version arbitration the application would have
    # applied — the highest version, and the row written last where two rows
    # share it — and drop the rest.
    op.execute(
        """
        DELETE FROM answers AS a
        USING answers AS b
        WHERE a.attempt_id = b.attempt_id
          AND a.question_id = b.question_id
          AND (COALESCE(a.version, 0), a.id) < (COALESCE(b.version, 0), b.id)
        """
    )

    op.create_unique_constraint(
        "uq_answers_attempt_question", "answers", ["attempt_id", "question_id"]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("uq_answers_attempt_question", "answers", type_="unique")
