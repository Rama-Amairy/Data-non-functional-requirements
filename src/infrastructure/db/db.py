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

    def __init__(self, database_url: str) -> None:
        """Initializes the database engine and session factory."""

        self.db_url = database_url

        # 1. Build connection arguments based on the database type
        connect_args = {}

        # Force the driver to only accept connections to the Primary node
        # This handles the automatic failover if the primary node crashes
        connect_args["target_session_attrs"] = "read-write"
        connect_args["connect_timeout"] = 5

        # Initialize the SQLAlchemy engine with the given database URL and connection arguments
        try:
            self.engine = create_engine(
                self.db_url,
                connect_args=connect_args,
                echo=False,  # Set your DB_ECHO variable here
                # pool_pre_ping is critical for HA: it checks the connection
                # before using it and silently replaces it if the database restarted
                pool_pre_ping=True,
                pool_recycle=1800,
            )

            # 3. Configure SessionFactory
            self._session_factory = sessionmaker(
                autocommit=False,
                autoflush=False,
                bind=self.engine,
                expire_on_commit=False,
            )
        except Exception as e:
            raise RuntimeError(f"Failed to initialize the database engine: {e}") from e

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
