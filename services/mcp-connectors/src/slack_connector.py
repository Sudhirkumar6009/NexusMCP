"""
Slack MCP Connector
"""

from __future__ import annotations

from typing import Any, Dict, List
import logging

from .base import MCPConnector, ToolDefinition, ToolResult

logger = logging.getLogger(__name__)


class SlackConnector(MCPConnector):
    """MCP connector for Slack messaging"""

    @property
    def service_name(self) -> str:
        return "slack"

    def get_tools(self) -> List[ToolDefinition]:
        return [
            ToolDefinition(
                name="slack_post_message",
                description="Post a message to a Slack channel",
                input_schema={
                    "type": "object",
                    "properties": {
                        "channel": {"type": "string", "description": "Channel name or ID"},
                        "text": {"type": "string", "description": "Message text"},
                        "thread_ts": {"type": "string", "description": "Thread timestamp for replies"},
                    },
                    "required": ["channel", "text"],
                },
            ),
            ToolDefinition(
                name="slack_add_reaction",
                description="Add a reaction to a message",
                input_schema={
                    "type": "object",
                    "properties": {
                        "channel": {"type": "string"},
                        "timestamp": {"type": "string"},
                        "emoji": {"type": "string"},
                    },
                    "required": ["channel", "timestamp", "emoji"],
                },
            ),
        ]

    async def initialize(self) -> None:
        logger.info("Initializing Slack connector")
        self._client = None

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> ToolResult:
        await self.ensure_initialized()

        try:
            if tool_name == "slack_post_message":
                return await self._post_message(arguments)
            elif tool_name == "slack_add_reaction":
                return await self._add_reaction(arguments)
            else:
                return self._make_error(f"Unknown tool: {tool_name}")
        except Exception as e:
            logger.exception(f"Error executing {tool_name}")
            return self._make_error(str(e))

    async def _post_message(self, args: Dict[str, Any]) -> ToolResult:
        import time
        ts = str(time.time())
        return self._make_success({
            "msg_ts": ts,
            "thread_ts": args.get("thread_ts", ts),
            "channel": args["channel"],
        })

    async def _add_reaction(self, args: Dict[str, Any]) -> ToolResult:
        return self._make_success({"ok": True})
