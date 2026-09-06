"""
app.database — Async SQLAlchemy engine, session factory, and a FastAPI dependency.

Exposes:
* ``engine``               — singleton async engine (asyncpg driver)
* ``AsyncSessionLocal``    — session factory bound to the engine
* ``get_db``               — dependency that yields a session per request/WS
"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=10,
    max_overflow=5,
    pool_pre_ping=True,
    future=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency — yields a transaction-managed AsyncSession."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
