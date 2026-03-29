"""
Jira MCP Connector
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
import logging
import os

import requests
from requests.auth import HTTPBasicAuth

from .base import MCPConnector, ToolDefinition, ToolResult

logger = logging.getLogger(__name__)


class JiraConnector(MCPConnector):
    """
    MCP connector for Jira.
    
    Provides tools for:
    - Getting issue details
    - Creating issues
    - Updating issues
    - Transitioning issues
    - Searching issues (JQL)
    """

    @property
    def service_name(self) -> str:
        return "jira"

    def get_tools(self) -> List[ToolDefinition]:
        return [
            ToolDefinition(
                name="jira_get_issue",
                description="Get details of a Jira issue by ID",
                input_schema={
                    "type": "object",
                    "properties": {
                        "issue_id": {"type": "string", "description": "Jira issue ID (e.g., BUG-123)"},
                    },
                    "required": ["issue_id"],
                },
            ),
            ToolDefinition(
                name="jira.create_issue",
                description="Create a Jira issue",
                input_schema={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "project": {"type": "string", "description": "Project key (optional)"},
                        "issue_type": {"type": "string", "description": "Issue type (default: Task)"},
                    },
                    "required": ["title"],
                },
            ),
            ToolDefinition(
                name="jira_update_issue",
                description="Update an existing Jira issue",
                input_schema={
                    "type": "object",
                    "properties": {
                        "issue_id": {"type": "string", "description": "Jira issue ID"},
                        "status": {"type": "string", "description": "New status"},
                        "assignee": {"type": "string", "description": "Assignee username"},
                        "priority": {"type": "string", "description": "New priority"},
                    },
                    "required": ["issue_id"],
                },
            ),
            ToolDefinition(
                name="jira_search",
                description="Search Jira issues using JQL",
                input_schema={
                    "type": "object",
                    "properties": {
                        "jql": {"type": "string", "description": "JQL query string"},
                        "max_results": {"type": "integer", "description": "Maximum results to return"},
                    },
                    "required": ["jql"],
                },
            ),
        ]

    async def initialize(self) -> None:
        """Initialize Jira client"""
        logger.info("Initializing Jira connector")
        self._base_url = (self.config.get("base_url") or os.getenv("JIRA_BASE_URL") or os.getenv("JIRA_URL") or "").rstrip("/")
        self._email = self.config.get("email") or os.getenv("JIRA_EMAIL")
        self._api_token = self.config.get("api_token") or os.getenv("JIRA_API_TOKEN") or os.getenv("JIRA_TOKEN")

        if not self._base_url or not self._email or not self._api_token:
            logger.warning(
                "Jira credentials are incomplete. Expected JIRA_BASE_URL/JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN/JIRA_TOKEN."
            )

        self._client = None

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> ToolResult:
        """Execute a Jira tool call"""
        await self.ensure_initialized()

        try:
            if tool_name == "jira_get_issue":
                return await self._get_issue(arguments["issue_id"])
            elif tool_name in ("jira_create_issue", "jira.create_issue"):
                return await self._create_issue(arguments)
            elif tool_name == "jira_update_issue":
                return await self._update_issue(arguments)
            elif tool_name == "jira_search":
                return await self._search(arguments)
            else:
                return self._make_error(f"Unknown tool: {tool_name}")
        except Exception as e:
            logger.exception(f"Error executing {tool_name}")
            return self._make_error(str(e))

    async def _get_issue(self, issue_id: str) -> ToolResult:
        """Get issue details"""
        # Mock implementation
        return self._make_success({
            "id": issue_id,
            "title": f"Sample issue {issue_id}",
            "priority": "P1",
            "status": "Open",
            "reporter": "user@example.com",
            "created": "2024-01-15T10:00:00Z",
        })

    async def _create_issue(self, args: Dict[str, Any]) -> ToolResult:
        """Create a new Jira issue through Jira REST API."""
        if not self._base_url or not self._email or not self._api_token:
            return self._make_error(
                "Jira credentials are not configured. Set JIRA_BASE_URL/JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN/JIRA_TOKEN."
            )

        title = args.get("title")
        if not title:
            return self._make_error("Missing required field: title")

        description_text = str(args.get("description", ""))
        project_key = str(args.get("project", "")).strip()
        if not project_key:
            project_key = self._resolve_default_project_key() or ""
        if not project_key:
            return self._make_error("Could not resolve Jira project key. Provide input.project explicitly.")

        issue_type = str(args.get("issue_type") or args.get("type") or "Task")

        payload = {
            "fields": {
                "project": {"key": project_key},
                "summary": title,
                "description": {
                    "type": "doc",
                    "version": 1,
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": description_text}],
                        }
                    ],
                },
                "issuetype": {"name": issue_type},
            }
        }

        url = f"{self._base_url}/rest/api/3/issue"
        response = requests.post(
            url,
            json=payload,
            auth=HTTPBasicAuth(self._email, self._api_token),
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=20,
        )

        if response.status_code >= 400:
            return self._make_error(
                f"Jira create issue failed ({response.status_code}): {response.text}"
            )

        data = response.json()
        return self._make_success(
            {
                "issue_id": data.get("id"),
                "issue_key": data.get("key"),
                "url": data.get("self"),
            }
        )

    def _resolve_default_project_key(self) -> Optional[str]:
        """Return the first accessible Jira project key for the current credentials."""
        if not self._base_url or not self._email or not self._api_token:
            return None

        response = requests.get(
            f"{self._base_url}/rest/api/3/project/search?maxResults=1",
            auth=HTTPBasicAuth(self._email, self._api_token),
            headers={"Accept": "application/json"},
            timeout=20,
        )

        if response.status_code >= 400:
            logger.warning("Failed to resolve default Jira project key: %s", response.text)
            return None

        payload = response.json()
        values = payload.get("values")
        if not isinstance(values, list) or not values:
            return None

        first = values[0]
        if not isinstance(first, dict):
            return None

        key = first.get("key")
        return key if isinstance(key, str) else None

    async def _update_issue(self, args: Dict[str, Any]) -> ToolResult:
        """Update an issue"""
        from datetime import datetime
        return self._make_success({
            "issue_id": args["issue_id"],
            "updated_at": datetime.utcnow().isoformat(),
            "changelog": args,
        })

    async def _search(self, args: Dict[str, Any]) -> ToolResult:
        """Search issues"""
        return self._make_success({
            "total": 0,
            "issues": [],
        })
