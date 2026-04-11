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

    operation: str  # send_email, read_email, search_emails, parse_email, add_label, get_thread, reply_email, get_attachments, listen_email_events
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
    2. read_email
    3. search_emails
    4. parse_email
    5. add_label
    6. get_thread
    7. reply_email
    8. get_attachments
    9. listen_email_events
    10. create_draft
    """

    name = "gmail-agent"

    TOOL_MAPPINGS = {
        "send_email": [
            "gmail.send_message",
            "gmail_send_message",
            "gmail.send_email",
            "gmail_send_email",
            "gmail.sendMessage",
            "gmail.send_mail",
            "gmail_send_mail",
        ],
        "read_email": [
            "gmail.read_email",
            "gmail_read_email",
            "gmail.readEmail",
            "gmail.get_email",
            "gmail_get_email",
        ],
        "search_emails": [
            "gmail.search_emails",
            "gmail_search_emails",
            "gmail.searchEmails",
            "gmail.list_messages",
            "gmail_list_messages",
            "gmail.search_messages",
            "gmail_search_messages",
            "gmail.read_messages",
            "gmail_read_messages",
        ],
        "read_emails": [
            "gmail.search_emails",
            "gmail_search_emails",
            "gmail.searchEmails",
            "gmail.list_messages",
            "gmail_list_messages",
        ],
        "parse_email": [
            "gmail.parse_email",
            "gmail_parse_email",
            "gmail.parseEmail",
        ],
        "add_label": [
            "gmail.add_label",
            "gmail_add_label",
            "gmail.addLabel",
        ],
        "get_thread": [
            "gmail.get_thread",
            "gmail_get_thread",
            "gmail.getThread",
        ],
        "reply_email": [
            "gmail.reply_email",
            "gmail_reply_email",
            "gmail.replyEmail",
        ],
        "get_attachments": [
            "gmail.get_attachments",
            "gmail_get_attachments",
            "gmail.getAttachments",
        ],
        "listen_email_events": [
            "gmail.listen_email_events",
            "gmail_listen_email_events",
            "gmail.listenEmailEvents",
        ],
        "create_draft": [
            "gmail.create_draft",
            "gmail_create_draft",
            "gmail.createDraft",
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

2. read_email
    - Read one email by ID
    - Arguments: messageId

3. search_emails
    - Search/list emails
   - Arguments: query (optional), max_results (optional)

4. parse_email
    - Parse raw email/message to structured fields
    - Arguments: messageId or message

5. add_label
    - Add/remove labels on message
    - Arguments: messageId, addLabelIds/removeLabelIds

6. get_thread
    - Retrieve thread messages
    - Arguments: threadId or messageId

7. reply_email
    - Reply in existing thread
    - Arguments: threadId or messageId, body

8. get_attachments
    - List or download attachments
    - Arguments: messageId, attachmentId (optional), download (optional)

9. listen_email_events
    - Poll mailbox changes
    - Arguments: startHistoryId (optional)

10. create_draft
   - Create a draft email
   - Arguments: to, subject, body

RULES:
1. Extract recipient email addresses, subject, body, and query terms
2. If prompt says draft/prepare, prefer create_draft
3. If prompt says send email, use send_email
4. If prompt says read email by id, use read_email
5. If prompt says list/search/inbox, use search_emails
6. If prompt says parse email, use parse_email
7. Return ONLY valid JSON

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

        message_id = self._extract_message_id(prompt)
        if message_id:
            extracted_params["messageId"] = message_id

        thread_id = self._extract_thread_id(prompt)
        if thread_id:
            extracted_params["threadId"] = thread_id

        if context:
            for key in ("to", "subject", "body", "query", "messageId", "threadId"):
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
        parse_requested = "parse" in normalized and "email" in normalized
        label_requested = "label" in normalized or "processed" in normalized
        thread_requested = "thread" in normalized or "conversation" in normalized
        reply_requested = "reply" in normalized
        attachment_requested = "attachment" in normalized
        listen_requested = any(
            token in normalized for token in ["listen", "watch", "webhook", "new email event"]
        )

        read_by_id_requested = read_requested and "messageId" in extracted_params

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

        if read_by_id_requested:
            tool_name = self._find_tool("read_email", tools)
            if tool_name:
                operations.append(
                    GmailOperation(
                        operation="read_email",
                        arguments={
                            "messageId": extracted_params.get("messageId", ""),
                        },
                        description="Read Gmail message by ID",
                    )
                )

        if (read_requested and not read_by_id_requested) or (not operations and "gmail" in normalized):
            tool_name = self._find_tool("search_emails", tools)
            if tool_name:
                operations.append(
                    GmailOperation(
                        operation="search_emails",
                        arguments={
                            "query": extracted_params.get("query", "in:inbox newer_than:7d"),
                            "max_results": 20,
                        },
                        description="Search/list Gmail messages",
                    )
                )

        if parse_requested:
            tool_name = self._find_tool("parse_email", tools)
            if tool_name:
                operations.append(
                    GmailOperation(
                        operation="parse_email",
                        arguments={
                            "messageId": extracted_params.get("messageId", ""),
                        },
                        description="Parse Gmail message content",
                    )
                )

        if label_requested:
            tool_name = self._find_tool("add_label", tools)
            if tool_name:
                operations.append(
                    GmailOperation(
                        operation="add_label",
                        arguments={
                            "messageId": extracted_params.get("messageId", ""),
                            "addLabelIds": ["processed"],
                        },
                        description="Add Gmail label",
                    )
                )

        if thread_requested:
            tool_name = self._find_tool("get_thread", tools)
            if tool_name:
                operations.append(
                    GmailOperation(
                        operation="get_thread",
                        arguments={
                            "threadId": extracted_params.get("threadId", ""),
                            "messageId": extracted_params.get("messageId", ""),
                        },
                        description="Get Gmail thread",
                    )
                )

        if reply_requested:
            tool_name = self._find_tool("reply_email", tools)
            if tool_name:
                operations.append(
                    GmailOperation(
                        operation="reply_email",
                        arguments={
                            "threadId": extracted_params.get("threadId", ""),
                            "messageId": extracted_params.get("messageId", ""),
                            "body": extracted_params.get("body", ""),
                        },
                        description="Reply in Gmail thread",
                    )
                )

        if attachment_requested:
            tool_name = self._find_tool("get_attachments", tools)
            if tool_name:
                operations.append(
                    GmailOperation(
                        operation="get_attachments",
                        arguments={
                            "messageId": extracted_params.get("messageId", ""),
                            "download": "download" in normalized,
                        },
                        description="Get Gmail attachments",
                    )
                )

        if listen_requested:
            tool_name = self._find_tool("listen_email_events", tools)
            if tool_name:
                operations.append(
                    GmailOperation(
                        operation="listen_email_events",
                        arguments={},
                        description="Listen for Gmail mailbox changes",
                    )
                )

        if not operations:
            fallback_tool = self._find_tool("search_emails", tools)
            if fallback_tool:
                operations.append(
                    GmailOperation(
                        operation="search_emails",
                        arguments={"query": "in:inbox", "max_results": 20},
                        description="Search Gmail messages",
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

    def _extract_message_id(self, prompt: str) -> str:
        match = re.search(r"(?:message[_\s-]?id|email[_\s-]?id)\s*[:=]\s*([A-Za-z0-9_-]+)", prompt, re.IGNORECASE)
        if match:
            return match.group(1).strip()
        return ""

    def _extract_thread_id(self, prompt: str) -> str:
        match = re.search(r"thread[_\s-]?id\s*[:=]\s*([A-Za-z0-9_-]+)", prompt, re.IGNORECASE)
        if match:
            return match.group(1).strip()
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
