"""
app.db_sync — Synchronous SQLAlchemy engine for Celery task workers.

Celery workers run in regular Python threads and cannot share the asyncpg
engine used by the FastAPI request handlers.  This module exposes a
synchronous engine (psycopg3 driver, matching the ``postgresql+psycopg://``
connection URL) plus a session factory and a context-manager helper that
task functions can use directly.

Usage inside a task::

    from app.db_sync import get_sync_db, sync_engine

    with get_sync_db() as db:
        db.execute(text("..."), {...})
        db.commit()

For statements that must run outside a transaction (e.g.
``REFRESH MATERIALIZED VIEW CONCURRENTLY``), use the engine directly::

    with sync_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_community_leaderboard"))
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

# ---------------------------------------------------------------------------
# Engine — psycopg3 synchronous driver (postgresql+psycopg://)
# ---------------------------------------------------------------------------
sync_engine = create_engine(
    settings.SYNC_DATABASE_URL,
    pool_size=5,
    max_overflow=2,
    pool_pre_ping=True,
    future=True,
)

SyncSessionLocal = sessionmaker(
    bind=sync_engine,
    class_=Session,
    expire_on_commit=False,
    autoflush=False,
)


# ---------------------------------------------------------------------------
# Context-manager helper
# ---------------------------------------------------------------------------
@contextmanager
def get_sync_db() -> Generator[Session, None, None]:
    """Yield a transaction-managed synchronous Session; always closes on exit."""
    with SyncSessionLocal() as session:
        try:
            yield session
        finally:
            session.close()
