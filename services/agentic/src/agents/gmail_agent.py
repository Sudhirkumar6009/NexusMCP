"""Gmail Agent - Handles Gmail-related operations."""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from .base_agent import BaseAgent
from ..gemini_client import GeminiClient

logger = logging.getLogger(__name__)


class GmailOperation(BaseModel):
    """A Gmail operation to execute."""

    operation: str  # send_email, read_emails, create_draft
    arguments: Dict[str, Any] = Field(default_factory=dict)
    description: str = ""
    depends_on: List[str] = Field(default_factory=list)


class GmailWorkflowPlan(BaseModel):
    """Plan for Gmail operations."""

    operations: List[GmailOperation] = Field(default_factory=list)
    extracted_params: Dict[str, str] = Field(default_factory=dict)
    summary: str = ""


class GmailAgent(BaseAgent):
    """
    Gmail Agent - Specialized for email operations.

    Supported Operations:
    1. send_email
    2. read_emails
    3. create_draft
    """

    name = "gmail-agent"

    TOOL_MAPPINGS = {
        "send_email": [
            "gmail.send_message",
            "gmail_send_message",
            "gmail.send_email",
            "gmail_send_email",
            "gmail.send_mail",
            "gmail_send_mail",
        ],
        "read_emails": [
            "gmail.list_messages",
            "gmail_list_messages",
            "gmail.search_messages",
            "gmail_search_messages",
            "gmail.read_messages",
            "gmail_read_messages",
        ],
        "create_draft": [
            "gmail.create_draft",
            "gmail_create_draft",
            "gmail.draft_message",
            "gmail_draft_message",
        ],
    }

    def __init__(self, gemini: GeminiClient):
        self.gemini = gemini

    async def run(
        self,
        prompt: str,
        available_tools: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
    ) -> GmailWorkflowPlan:
        """Analyze prompt and generate Gmail operations."""

        logger.info("GmailAgent analyzing: %s...", prompt[:100])

        gmail_tools = self._filter_gmail_tools(available_tools)
        if not gmail_tools:
            logger.warning("No Gmail tools available")
            return GmailWorkflowPlan(summary="No Gmail tools available")

        if self.gemini.enabled:
            try:
                plan = await self._llm_plan(prompt, gmail_tools, context)
                logger.info("LLM generated %s Gmail operations", len(plan.operations))
                return plan
            except Exception as exc:
                logger.warning("LLM planning failed: %s, using heuristic", exc)

        return self._heuristic_plan(prompt, gmail_tools, context)

    def _filter_gmail_tools(self, tools: Dict[str, Any]) -> Dict[str, Any]:
        """Filter to only include Gmail-related tools."""

        gmail_tools: Dict[str, Any] = {}
        for name, definition in tools.items():
            lowered = name.lower()
            if "gmail" in lowered or lowered.startswith("mail"):
                gmail_tools[name] = definition
        return gmail_tools

    async def _llm_plan(
        self,
        prompt: str,
        tools: Dict[str, Any],
        context: Optional[Dict[str, Any]],
    ) -> GmailWorkflowPlan:
        """Use LLM to generate Gmail operation plan."""

        system_prompt = f"""You are a Gmail operations planner.

Available Gmail Tools:
{self._format_tools(tools)}

GMAIL OPERATIONS:
1. send_email
   - Send an email
   - Arguments: to, subject, body

2. read_emails
   - Read/search/list emails
   - Arguments: query (optional), max_results (optional)

3. create_draft
   - Create a draft email
   - Arguments: to, subject, body

RULES:
1. Extract recipient email addresses, subject, body, and query terms
2. If prompt says draft/prepare, prefer create_draft
3. If prompt says send email, use send_email
4. If prompt says read/list/search/inbox, use read_emails
5. Return ONLY valid JSON

OUTPUT FORMAT:
{{
  "operations": [
    {{
      "operation": "send_email",
      "arguments": {{ "to": "user@example.com", "subject": "Update", "body": "Done" }},
      "description": "Send update email"
    }}
  ],
  "extracted_params": {{
    "to": "user@example.com"
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
            GmailOperation(
                operation=op_data.get("operation", ""),
                arguments=op_data.get("arguments", {}),
                description=op_data.get("description", ""),
                depends_on=op_data.get("depends_on", []),
            )
            for op_data in response.get("operations", [])
        ]

        return GmailWorkflowPlan(
            operations=operations,
            extracted_params=response.get("extracted_params", {}),
            summary=response.get("summary", ""),
        )

    def _heuristic_plan(
        self,
        prompt: str,
        tools: Dict[str, Any],
        context: Optional[Dict[str, Any]],
    ) -> GmailWorkflowPlan:
        """Generate a Gmail plan using deterministic heuristics."""

        normalized = prompt.lower()
        operations: List[GmailOperation] = []
        extracted_params: Dict[str, str] = {}

        email_match = re.search(
            r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
            prompt,
        )
        if email_match:
            extracted_params["to"] = email_match.group(0)

        subject = self._extract_subject(prompt)
        if subject:
            extracted_params["subject"] = subject

        body = self._extract_body(prompt)
        if body:
            extracted_params["body"] = body

        query = self._extract_query(prompt)
        if query:
            extracted_params["query"] = query

        if context:
            for key in ("to", "subject", "body", "query"):
                if key in context and key not in extracted_params and isinstance(context[key], str):
                    extracted_params[key] = context[key]

        draft_requested = any(
            token in normalized for token in ["draft", "prepare email", "compose"]
        )
        send_requested = any(
            token in normalized for token in ["send email", "send mail", "email", "gmail send"]
        )
        read_requested = any(
            token in normalized
            for token in ["read", "list", "search", "inbox", "recent emails", "messages"]
        )

        if draft_requested:
            tool_name = self._find_tool("create_draft", tools)
            if tool_name:
                operations.append(
                    GmailOperation(
                        operation="create_draft",
                        arguments={
                            "to": extracted_params.get("to", ""),
                            "subject": extracted_params.get("subject", "Draft from NexusMCP"),
                            "body": extracted_params.get("body", ""),
                        },
                        description="Create Gmail draft",
                    )
                )

        if send_requested:
            tool_name = self._find_tool("send_email", tools)
            if tool_name:
                operations.append(
                    GmailOperation(
                        operation="send_email",
                        arguments={
                            "to": extracted_params.get("to", ""),
                            "subject": extracted_params.get("subject", "NexusMCP Update"),
                            "body": extracted_params.get("body", ""),
                        },
                        description="Send Gmail message",
                        depends_on=["create_draft"] if draft_requested else [],
                    )
                )

        if read_requested or (not operations and "gmail" in normalized):
            tool_name = self._find_tool("read_emails", tools)
            if tool_name:
                operations.append(
                    GmailOperation(
                        operation="read_emails",
                        arguments={
                            "query": extracted_params.get("query", "in:inbox newer_than:7d"),
                            "max_results": 20,
                        },
                        description="Read/search Gmail messages",
                    )
                )

        if not operations:
            fallback_tool = self._find_tool("read_emails", tools)
            if fallback_tool:
                operations.append(
                    GmailOperation(
                        operation="read_emails",
                        arguments={"query": "in:inbox", "max_results": 20},
                        description="Read Gmail messages",
                    )
                )

        return GmailWorkflowPlan(
            operations=operations,
            extracted_params=extracted_params,
            summary=f"Gmail workflow with {len(operations)} operations",
        )

    def _extract_subject(self, prompt: str) -> str:
        subject_match = re.search(r"subject\s*[\":]\s*\"([^\"]+)\"", prompt, re.IGNORECASE)
        if subject_match:
            return subject_match.group(1).strip()

        subject_match = re.search(r"subject\s+([^\n,]+)", prompt, re.IGNORECASE)
        if subject_match:
            return subject_match.group(1).strip()

        quoted = re.findall(r'"([^"]+)"', prompt)
        if quoted:
            return quoted[0].strip()

        return ""

    def _extract_body(self, prompt: str) -> str:
        body_match = re.search(r"body\s*[\":]\s*\"([^\"]+)\"", prompt, re.IGNORECASE)
        if body_match:
            return body_match.group(1).strip()

        quoted = re.findall(r'"([^"]+)"', prompt)
        if len(quoted) >= 2:
            return quoted[1].strip()

        return ""

    def _extract_query(self, prompt: str) -> str:
        query_match = re.search(r"(?:query|search)\s*[\":]\s*\"([^\"]+)\"", prompt, re.IGNORECASE)
        if query_match:
            return query_match.group(1).strip()

        if "unread" in prompt.lower():
            return "is:unread"

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
