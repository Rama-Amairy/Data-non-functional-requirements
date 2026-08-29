"""Database engine and session management."""

from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine, select
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from src.config import DATABASE_URL, DB_ECHO


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models."""

    pass


class DatabaseManager:
    """Manages the database engine lifecycle and session creation."""

    def __init__(self, db_url: str):
        self.db_url = db_url
        # 1. Initialize engine
        self.engine = create_engine(
            self.db_url,
            connect_args={"check_same_thread": False} if "sqlite" in db_url else {},
            echo=DB_ECHO,
            # pool_pre_ping: checks a connection before using it and replaces
            # dead connections automatically. This is what lets the application
            # recover on its own after the database server restarts, without
            # restarting the application server.
            pool_pre_ping=True,
            pool_recycle=1800,
        )
        # 2. Configure SessionFactory
        self._session_factory = sessionmaker(
            autocommit=False, autoflush=False, bind=self.engine
        )

    def create_db_and_tables(self) -> None:
        """Utility to create all tables directly (useful for local dev/testing without Alembic)."""
        # Imported here (not at the top of the file) so every model is
        # registered in ``Base.metadata`` before creation, and without making
        # the infrastructure layer depend on the domain layer.
        import src.domain.models  # noqa: F401

        Base.metadata.create_all(bind=self.engine)

    def ping(self) -> bool:
        """Checks that the database is alive and answers a simple query."""
        with self.engine.connect() as connection:
            connection.execute(select(1))
        return True

    @contextmanager
    def session(self) -> Generator[Session, None, None]:
        """Context manager to handle session commit, rollback, and closing automatically.

        Usage:
            with db_manager.session() as session:
                session.add(item)
        """
        session = self._session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def dispose(self) -> None:
        """Closes all pooled connections (called at application shutdown)."""
        self.engine.dispose()


# Create a single global manager instance
db_manager = DatabaseManager(DATABASE_URL)
