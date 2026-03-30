"""Configuration loader for the agentic flow service."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel


def _load_local_env() -> None:
    env_file = Path(__file__).resolve().parents[1] / ".env"
    if not env_file.exists():
        return

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


class Settings(BaseModel):
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3-flash-preview"
    request_timeout_seconds: float = 30.0
    agentic_host: str = "0.0.0.0"
    agentic_port: int = 8010


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    _load_local_env()

    return Settings(
        gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-3-flash-preview").strip(),
        request_timeout_seconds=float(os.getenv("REQUEST_TIMEOUT_SECONDS", "30")),
        agentic_host=os.getenv("AGENTIC_HOST", "0.0.0.0").strip(),
        agentic_port=int(os.getenv("AGENTIC_PORT", "8010")),
    )
