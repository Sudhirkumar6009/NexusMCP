"""
MCP Connectors Service

Provides MCP-compliant tool implementations for:
- Jira (issues, projects, transitions)
- Slack (messages, channels, reactions)
- GitHub (repos, branches, PRs, actions)
- Google Sheets (read, write, append)
- PostgreSQL (queries, transactions)
"""

from .base import MCPConnector, ToolResult
from .jira_connector import JiraConnector
from .slack_connector import SlackConnector
from .github_connector import GitHubConnector
from .sheets_connector import SheetsConnector

__all__ = [
    "MCPConnector",
    "ToolResult",
    "JiraConnector",
    "SlackConnector",
    "GitHubConnector",
    "SheetsConnector",
]
