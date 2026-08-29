"""Aggregates every v1 router behind a single prefix.

Route map (all paths are relative to ``/api/v1``):

| Method | Path                          | Purpose                                    |
|--------|-------------------------------|--------------------------------------------|
| GET    | /health                       | Server and database liveness               |
| POST   | /students/demo-login          | Phase-one login, returns the fixed ids      |
| POST   | /exams/seed                   | Seed the demo data (idempotent)            |
| GET    | /exams/{exam_id}              | Exam and its questions (no correct answers) |
| GET    | /attempts/{id}/answers        | Restore saved answers                       |
| POST   | /attempts/{id}/save           | Batched autosave with version arbitration   |
| POST   | /attempts/{id}/submit         | Submit and grade                            |
| GET    | /attempts/{id}/result         | Score of a submitted attempt                |
"""

from fastapi import APIRouter

from src.apis.v1.routers import attempt, exam, health, student
from src.config import API_V1_PREFIX

api_router = APIRouter(prefix=API_V1_PREFIX)

api_router.include_router(health.router)
api_router.include_router(student.router)
api_router.include_router(exam.router)
api_router.include_router(attempt.router)

__all__ = ["api_router"]
