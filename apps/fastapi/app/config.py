"""
app.config — Centralized environment settings.

Loads values from ``DATABASE_URL`` / ``APP_ENV`` etc. and is importable
as ``settings`` throughout the service.  Uses ``pydantic-settings`` so
env-file fallback (``.env`` in the repo root and the FastAPI work dir)
works automatically when running outside docker-compose.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "apps/fastapi/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- Core ---------------------------------------------------------------
    APP_ENV: str = Field(default="development")
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://stm_user:stm_password@localhost:5432/signtrustmap",
        description="SQLAlchemy async connection URL (driver: asyncpg).",
    )
    # Sync URL is used by Celery workers (psycopg), not by this service directly,
    # but exposed here so future celery tasks can share the same settings module.
    SYNC_DATABASE_URL: str = Field(
        default="postgresql+psycopg://stm_user:stm_password@localhost:5432/signtrustmap",
    )
    REDIS_URL: str = Field(default="redis://localhost:6379/1")
    CELERY_BROKER_URL: str = Field(default="redis://localhost:6379/2")
    CELERY_RESULT_BACKEND: str = Field(default="redis://localhost:6379/3")
    MINIO_ENDPOINT: str = Field(default="localhost:9000")
    MINIO_ACCESS_KEY: str = Field(default="stm_minio")
    MINIO_SECRET_KEY: str = Field(default="stm_minio_secret_123")
    MINIO_SECURE: bool = Field(default=False)
    MINIO_REGION: str | None = Field(default=None)
    AI_INFERENCE_URL: str = Field(default="http://localhost:8001")
    AI_INFERENCE_TIMEOUT_SECONDS: float = Field(default=3600.0, gt=0)
    INTERNAL_API_TOKEN: str = Field(default="stm_internal_secret_dev")
    NESTJS_INTERNAL_URL: str = Field(default="http://localhost:3000")

    # ---- Offline PMTiles maps ----------------------------------------------
    PMTILES_DATA_DIR: str = Field(
        default="/data/pmtiles",
        description="Path to directory containing offline PMTiles archives.",
    )
    PMTILES_DEFAULT_FILE: str = Field(
        default="osm.pmtiles",
        description="Default PMTiles file name.",
    )

    # ---- Spatial / Navigation tuning ----------------------------------------
    # Search radius (metres) for ST_DWithin when finding nearby signs.
    NAVIGATION_SEARCH_RADIUS_M: int = Field(default=50, gt=0, le=500)
    # Heading match half-opening angle (degrees).  A sign matches when
    # |angular difference| <= threshold.  Default 30 gives a ±30 / 60 cone.
    NAVIGATION_HEADING_THRESHOLD_DEG: float = Field(default=30.0, gt=0, le=90)
    # How many navigation_route_points to buffer before a bulk INSERT.
    NAVIGATION_ROUTE_POINT_BUFFER_SIZE: int = Field(default=5, ge=1, le=100)

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        if not v:
            raise ValueError("DATABASE_URL must not be empty")
        # Accept postgres://, postgresql://, and postgresql+asyncpg:// forms.
        if v.startswith("postgres://"):
            v = v.replace("postgres://", "postgresql+asyncpg://", 1)
        elif v.startswith("postgresql://") and not v.startswith("postgresql+"):
            v = v.replace("postgresql://", "postgresql+asyncpg://", 1)
        # asyncpg uses 'ssl' instead of 'sslmode'
        if "sslmode=" in v:
            v = v.replace("sslmode=", "ssl=")
        return v

    @field_validator("SYNC_DATABASE_URL")
    @classmethod
    def validate_sync_database_url(cls, v: str) -> str:
        if not v:
            return v
        if v.startswith("postgres://"):
            v = v.replace("postgres://", "postgresql+psycopg://", 1)
        elif v.startswith("postgresql://") and not v.startswith("postgresql+"):
            v = v.replace("postgresql://", "postgresql+psycopg://", 1)
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
