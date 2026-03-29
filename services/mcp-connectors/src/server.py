"""Minimal MCP invoke server for connectors."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .jira_connector import JiraConnector


def _load_local_env() -> None:
    env_file = Path(__file__).resolve().parents[1] / '.env'
    if not env_file.exists():
        return

    for raw_line in env_file.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue

        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


_load_local_env()

app = FastAPI(title="NexusMCP Connectors", version="0.1.0")
jira_connector = JiraConnector()


class InvokeRequest(BaseModel):
    tool: str
    input: Dict[str, Any] = Field(default_factory=dict)


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/tools")
async def tools() -> Dict[str, Any]:
    return {
        "tools": [
            {
                "name": "jira.create_issue",
                "description": "Create a Jira issue",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                    },
                    "required": ["title"],
                },
            }
        ]
    }


@app.post("/invoke")
async def invoke(request: InvokeRequest) -> Dict[str, Any]:
    if request.tool not in {"jira.create_issue", "jira_create_issue"}:
        raise HTTPException(status_code=404, detail=f"Unknown tool: {request.tool}")

    result = await jira_connector.call_tool(request.tool, request.input)

    if result.type.value == "error":
        raise HTTPException(status_code=400, detail=result.error or "Tool execution failed")

    return {
        "type": result.type.value,
        "content": result.content,
        "metadata": result.metadata,
    }
