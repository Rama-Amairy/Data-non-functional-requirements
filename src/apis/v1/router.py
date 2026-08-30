"""Aggregates every v1 router behind a single prefix.

Route map (all paths are relative to ``/api/v1``):

| Method | Path                          | Purpose                                     |
|--------|-------------------------------|---------------------------------------------|
| GET    | /health                       | Server and database liveness                |
| GET    | /cluster                      | Replication, WAL, and failover state        |
| POST   | /cluster/nodes/{i}/{action}   | Stop or start a node (demo controls only)   |
| POST   | /students/login               | Sign in by email, resume or open an attempt |
| POST   | /exams/seed                   | Ensure the exam content exists (idempotent) |
| GET    | /exams/{exam_id}              | Exam and its questions (no correct answers) |
| POST   | /attempts/start               | Open a new attempt for a signed-in student  |
| GET    | /attempts/{id}/answers        | Restore saved answers                       |
| POST   | /attempts/{id}/save           | Batched autosave with version arbitration   |
| POST   | /attempts/{id}/submit         | Submit and grade                            |
| GET    | /attempts/{id}/result         | Score of a submitted attempt                |
"""

from fastapi import APIRouter

from src.apis.v1.routers import attempt, cluster, exam, health, student
from src.config import API_V1_PREFIX

api_router = APIRouter(prefix=API_V1_PREFIX)

api_router.include_router(health.router)
api_router.include_router(cluster.router)
api_router.include_router(student.router)
api_router.include_router(exam.router)
api_router.include_router(attempt.router)

__all__ = ["api_router"]
