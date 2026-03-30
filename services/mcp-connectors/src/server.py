"""Minimal MCP invoke server for connectors."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .base import MCPConnector, ToolDefinition
from .jira_connector import JiraConnector
from .github_connector import GitHubConnector
from .slack_connector import SlackConnector
from .sheets_connector import SheetsConnector


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

# Initialize all connectors
connectors: Dict[str, MCPConnector] = {
    "jira": JiraConnector(),
    "github": GitHubConnector(),
    "slack": SlackConnector(),
    "sheets": SheetsConnector(),
}


def _get_connector_for_tool(tool_name: str) -> MCPConnector | None:
    """Find the connector that owns a given tool."""
    for connector in connectors.values():
        for tool_def in connector.get_tools():
            if tool_def.name == tool_name or tool_def.name.replace(".", "_") == tool_name:
                return connector
    return None


def _get_all_tools() -> List[Dict[str, Any]]:
    """Collect tools from all registered connectors."""
    all_tools = []
    for connector in connectors.values():
        for tool_def in connector.get_tools():
            all_tools.append({
                "name": tool_def.name,
                "description": tool_def.description,
                "input_schema": tool_def.input_schema,
                "service": connector.service_name,
            })
    return all_tools


class InvokeRequest(BaseModel):
    tool: str
    input: Dict[str, Any] = Field(default_factory=dict)


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/tools")
async def tools() -> Dict[str, Any]:
    """Return all tools from all registered connectors."""
    return {"tools": _get_all_tools()}


@app.get("/connectors")
async def list_connectors() -> Dict[str, Any]:
    """List all available connectors and their status."""
    return {
        "connectors": [
            {
                "service": name,
                "tools_count": len(connector.get_tools()),
                "tools": [t.name for t in connector.get_tools()],
            }
            for name, connector in connectors.items()
        ]
    }


@app.post("/invoke")
async def invoke(request: InvokeRequest) -> Dict[str, Any]:
    """Invoke a tool from any registered connector."""
    # Normalize tool name (handle both dot and underscore formats)
    tool_name = request.tool.replace(".", "_")
    
    # Find the connector that owns this tool
    connector = _get_connector_for_tool(request.tool)
    if connector is None:
        connector = _get_connector_for_tool(tool_name)
    
    if connector is None:
        available_tools = [t["name"] for t in _get_all_tools()]
        raise HTTPException(
            status_code=404,
            detail=f"Unknown tool: {request.tool}. Available tools: {available_tools}"
        )

    result = await connector.call_tool(tool_name, request.input)

    if result.type.value == "error":
        raise HTTPException(status_code=400, detail=result.error or "Tool execution failed")

    return {
        "type": result.type.value,
        "content": result.content,
        "metadata": result.metadata,
        "service": connector.service_name,
    }
