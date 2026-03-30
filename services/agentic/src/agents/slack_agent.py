"""Slack Agent - Handles all Slack-related operations."""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from .base_agent import BaseAgent
from ..gemini_client import GeminiClient

logger = logging.getLogger(__name__)


class SlackOperation(BaseModel):
    """A Slack operation to execute."""

    operation: str  # send_message, send_dm, create_channel, update_message
    arguments: Dict[str, Any] = Field(default_factory=dict)
    description: str = ""
    depends_on: List[str] = Field(default_factory=list)


class SlackWorkflowPlan(BaseModel):
    """Plan for Slack operations."""

    operations: List[SlackOperation] = Field(default_factory=list)
    extracted_params: Dict[str, str] = Field(default_factory=dict)
    summary: str = ""


class SlackAgent(BaseAgent):
    """
    Slack Agent - Specialized for Slack operations.

    Supported Operations:
    1. Send Message
    2. Send DM
    3. Create Channel
    4. Update Message
    """

    name = "slack-agent"

    TOOL_MAPPINGS = {
        "send_message": [
            "slack.send_message",
            "slack_send_message",
            "slack.post_message",
            "slack_post_message",
            "slack.chat.postMessage",
        ],
        "send_dm": [
            "slack.send_dm",
            "slack_send_dm",
            "slack.post_dm",
            "slack_post_dm",
        ],
        "create_channel": [
            "slack.create_channel",
            "slack_create_channel",
            "slack.channels.create",
        ],
        "update_message": [
            "slack.update_message",
            "slack_update_message",
            "slack.chat.update",
        ],
    }

    def __init__(self, gemini: GeminiClient):
        self.gemini = gemini

    async def run(
        self,
        prompt: str,
        available_tools: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
    ) -> SlackWorkflowPlan:
        """Analyze prompt and generate Slack operations."""

        logger.info("SlackAgent analyzing: %s...", prompt[:100])

        slack_tools = self._filter_slack_tools(available_tools)
        if not slack_tools:
            logger.warning("No Slack tools available")
            return SlackWorkflowPlan(summary="No Slack tools available")

        if self.gemini.enabled:
            try:
                plan = await self._llm_plan(prompt, slack_tools, context)
                logger.info("LLM generated %s Slack operations", len(plan.operations))
                return plan
            except Exception as exc:
                logger.warning("LLM planning failed: %s, using heuristic", exc)

        return self._heuristic_plan(prompt, slack_tools, context)

    def _filter_slack_tools(self, tools: Dict[str, Any]) -> Dict[str, Any]:
        """Filter to only include Slack-related tools."""

        slack_tools: Dict[str, Any] = {}
        for name, definition in tools.items():
            lowered = name.lower()
            if "slack" in lowered or "chat.postmessage" in lowered or "chat.update" in lowered:
                slack_tools[name] = definition
        return slack_tools

    async def _llm_plan(
        self,
        prompt: str,
        tools: Dict[str, Any],
        context: Optional[Dict[str, Any]],
    ) -> SlackWorkflowPlan:
        """Use LLM to generate Slack operation plan."""

        system_prompt = f"""You are a Slack operations planner.

Available Slack Tools:
{self._format_tools(tools)}

SLACK OPERATIONS:
1. send_message
   - Post a message to a channel
   - Arguments: channel, text

2. send_dm
   - Send direct message to a user
   - Arguments: user, text

3. create_channel
   - Create a new channel
   - Arguments: name, is_private (optional)

4. update_message
   - Update an existing message
   - Arguments: channel, timestamp, text

RULES:
1. Extract channel names (e.g., #alerts), user handles (e.g., @alice), and message text
2. If channel is not specified, use "general"
3. If prompt asks for DM, choose send_dm; otherwise choose send_message
4. Return ONLY valid JSON

OUTPUT FORMAT:
{{
  "operations": [
    {{
      "operation": "send_message",
      "arguments": {{ "channel": "alerts", "text": "Build succeeded" }},
      "description": "Post status update"
    }}
  ],
  "extracted_params": {{
    "channel": "alerts"
  }},
  "summary": "Brief description"
}}"""

        context_str = ""
        if context:
            context_str = f"\nContext from previous steps: {context}"

        response = await self.gemini.generate_json(
            system_prompt,
            {"user_request": prompt + context_str},
            strict_json=True,
        )

        operations = [
            SlackOperation(
                operation=op_data.get("operation", ""),
                arguments=op_data.get("arguments", {}),
                description=op_data.get("description", ""),
                depends_on=op_data.get("depends_on", []),
            )
            for op_data in response.get("operations", [])
        ]

        return SlackWorkflowPlan(
            operations=operations,
            extracted_params=response.get("extracted_params", {}),
            summary=response.get("summary", ""),
        )

    def _heuristic_plan(
        self,
        prompt: str,
        tools: Dict[str, Any],
        context: Optional[Dict[str, Any]],
    ) -> SlackWorkflowPlan:
        """Generate a Slack plan using deterministic heuristics."""

        normalized = prompt.lower()
        operations: List[SlackOperation] = []
        extracted_params: Dict[str, str] = {}

        channel_match = re.search(r"#([a-zA-Z0-9_-]+)", prompt)
        if channel_match:
            extracted_params["channel"] = channel_match.group(1)

        user_match = re.search(r"@([a-zA-Z0-9._-]+)", prompt)
        if user_match:
            extracted_params["user"] = user_match.group(1)

        if context:
            for key in ("channel", "user"):
                if key in context and key not in extracted_params and isinstance(context[key], str):
                    extracted_params[key] = context[key]

        message_text = self._extract_message_text(prompt)
        if message_text:
            extracted_params["text"] = message_text

        create_channel_requested = any(
            token in normalized for token in ["create channel", "new channel", "open channel"]
        )
        update_message_requested = any(
            token in normalized for token in ["update message", "edit message", "modify message"]
        )
        dm_requested = any(
            token in normalized for token in ["direct message", "send dm", "dm", "private message"]
        )
        send_requested = any(
            token in normalized for token in ["send", "post", "notify", "message", "announce"]
        )

        if create_channel_requested:
            tool_name = self._find_tool("create_channel", tools)
            if tool_name:
                channel_name = extracted_params.get("channel") or self._extract_channel_name(prompt)
                channel_name = channel_name or "workflow-updates"
                operations.append(
                    SlackOperation(
                        operation="create_channel",
                        arguments={"name": channel_name},
                        description=f"Create Slack channel {channel_name}",
                    )
                )
                extracted_params.setdefault("channel", channel_name)

        if update_message_requested:
            tool_name = self._find_tool("update_message", tools)
            if tool_name:
                operations.append(
                    SlackOperation(
                        operation="update_message",
                        arguments={
                            "channel": extracted_params.get("channel", "general"),
                            "timestamp": extracted_params.get("timestamp", ""),
                            "text": extracted_params.get("text", "Update from NexusMCP workflow"),
                        },
                        description="Update Slack message",
                    )
                )

        if dm_requested:
            tool_name = self._find_tool("send_dm", tools)
            if tool_name:
                operations.append(
                    SlackOperation(
                        operation="send_dm",
                        arguments={
                            "user": extracted_params.get("user", ""),
                            "text": extracted_params.get("text", "Workflow update"),
                        },
                        description="Send Slack direct message",
                        depends_on=["create_channel"] if create_channel_requested else [],
                    )
                )

        if send_requested or (not operations and "slack" in normalized):
            tool_name = self._find_tool("send_message", tools)
            if tool_name:
                operations.append(
                    SlackOperation(
                        operation="send_message",
                        arguments={
                            "channel": extracted_params.get("channel", "general"),
                            "text": extracted_params.get("text", "Workflow update"),
                        },
                        description="Send Slack channel message",
                        depends_on=["create_channel"] if create_channel_requested else [],
                    )
                )

        if not operations:
            fallback_tool = self._find_tool("send_message", tools)
            if fallback_tool:
                operations.append(
                    SlackOperation(
                        operation="send_message",
                        arguments={"channel": "general", "text": "Workflow update"},
                        description="Send default Slack message",
                    )
                )

        return SlackWorkflowPlan(
            operations=operations,
            extracted_params=extracted_params,
            summary=f"Slack workflow with {len(operations)} operations",
        )

    def _extract_channel_name(self, prompt: str) -> str:
        match = re.search(r"channel\s+([a-zA-Z0-9_-]+)", prompt, re.IGNORECASE)
        if match:
            return match.group(1)
        return ""

    def _extract_message_text(self, prompt: str) -> str:
        quoted = re.findall(r'"([^"]+)"', prompt)
        if quoted:
            return quoted[-1].strip()

        lowered = prompt.lower()
        for splitter in ("message", "say", "saying", "that"):
            if splitter in lowered:
                parts = re.split(splitter, prompt, flags=re.IGNORECASE, maxsplit=1)
                if len(parts) == 2:
                    candidate = parts[1].strip(" :.-")
                    if candidate:
                        return candidate

        return ""

    def _find_tool(self, operation: str, tools: Dict[str, Any]) -> Optional[str]:
        candidates = self.TOOL_MAPPINGS.get(operation, [])
        for candidate in candidates:
            if candidate in tools:
                return candidate

        normalized_operation = operation.replace("_", "")
        for tool_name in tools:
            normalized_tool = tool_name.lower().replace("_", "").replace(".", "")
            if normalized_operation in normalized_tool:
                return tool_name

        return None

    def _format_tools(self, tools: Dict[str, Any]) -> str:
        import json

        formatted: Dict[str, Any] = {}
        for name, definition in tools.items():
            if hasattr(definition, "description"):
                formatted[name] = {
                    "description": definition.description,
                    "inputs": getattr(definition, "inputs", {}),
                }
            elif isinstance(definition, dict):
                formatted[name] = definition
        return json.dumps(formatted, indent=2)

    def get_tool_name(self, operation: str, available_tools: Dict[str, Any]) -> Optional[str]:
        return self._find_tool(operation, available_tools)
