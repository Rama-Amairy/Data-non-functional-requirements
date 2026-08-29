from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from src.infrastructure.db import Base


class Student(Base):
    """Student model"""
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationship with exam attempts
    attempts = relationship("ExamAttempt", back_populates="student")


class Exam(Base):
    """Exam model"""
    __tablename__ = "exams"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    duration_minutes = Column(Integer, default=60)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationship with questions
    questions = relationship("Question", back_populates="exam")


class Question(Base):
    """Question model"""
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=False)
    text = Column(Text, nullable=False)
    option_a = Column(String(300), nullable=False)
    option_b = Column(String(300), nullable=False)
    option_c = Column(String(300), nullable=False)
    option_d = Column(String(300), nullable=False)
    correct_answer = Column(String(1), nullable=False)  # a, b, c, d
    order_num = Column(Integer, default=0)

    exam = relationship("Exam", back_populates="questions")


class ExamAttempt(Base):
    """Exam attempt — tracks the student's exam session state"""
    __tablename__ = "exam_attempts"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=False)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)
    is_submitted = Column(Boolean, default=False)

    student = relationship("Student", back_populates="attempts")
    answers = relationship("Answer", back_populates="attempt")


class Answer(Base):
    """Student answer — the most critical table for recoverability"""
    __tablename__ = "answers"

    id = Column(Integer, primary_key=True, index=True)
    attempt_id = Column(Integer, ForeignKey("exam_attempts.id"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    selected_answer = Column(String(1), nullable=True)  # a, b, c, d

    # ---- Recovery fields (Phase 2) ----
    # Version number: increments with each Auto-Save to detect conflicts
    version = Column(Integer, default=1)
    # Last update timestamp: determines which copy is newer (server vs local)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    attempt = relationship("ExamAttempt", back_populates="answers")