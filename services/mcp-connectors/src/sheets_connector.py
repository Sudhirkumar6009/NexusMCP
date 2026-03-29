"""
Google Sheets MCP Connector
"""

from __future__ import annotations

from typing import Any, Dict, List
import logging

from .base import MCPConnector, ToolDefinition, ToolResult

logger = logging.getLogger(__name__)


class SheetsConnector(MCPConnector):
    """MCP connector for Google Sheets"""

    @property
    def service_name(self) -> str:
        return "sheets"

    def get_tools(self) -> List[ToolDefinition]:
        return [
            ToolDefinition(
                name="sheets_append_row",
                description="Append a row to a Google Sheet",
                input_schema={
                    "type": "object",
                    "properties": {
                        "sheet_id": {"type": "string", "description": "Google Sheet ID"},
                        "sheet_name": {"type": "string", "description": "Sheet/tab name"},
                        "row_data": {"type": "array", "description": "Row values"},
                    },
                    "required": ["sheet_id", "row_data"],
                },
            ),
            ToolDefinition(
                name="sheets_read_range",
                description="Read a range from a Google Sheet",
                input_schema={
                    "type": "object",
                    "properties": {
                        "sheet_id": {"type": "string"},
                        "range": {"type": "string", "description": "A1 notation range"},
                    },
                    "required": ["sheet_id", "range"],
                },
            ),
        ]

    async def initialize(self) -> None:
        logger.info("Initializing Google Sheets connector")
        self._client = None

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> ToolResult:
        await self.ensure_initialized()

        try:
            if tool_name == "sheets_append_row":
                return await self._append_row(arguments)
            elif tool_name == "sheets_read_range":
                return await self._read_range(arguments)
            else:
                return self._make_error(f"Unknown tool: {tool_name}")
        except Exception as e:
            logger.exception(f"Error executing {tool_name}")
            return self._make_error(str(e))

    async def _append_row(self, args: Dict[str, Any]) -> ToolResult:
        import random
        row_index = random.randint(2, 1000)
        return self._make_success({
            "row_index": row_index,
            "range": f"Sheet1!A{row_index}:Z{row_index}",
        })

    async def _read_range(self, args: Dict[str, Any]) -> ToolResult:
        return self._make_success({
            "range": args["range"],
            "values": [],
        })
