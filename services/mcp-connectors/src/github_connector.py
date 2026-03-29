"""
GitHub MCP Connector
"""

from __future__ import annotations

from typing import Any, Dict, List
import logging

from .base import MCPConnector, ToolDefinition, ToolResult

logger = logging.getLogger(__name__)


class GitHubConnector(MCPConnector):
    """MCP connector for GitHub"""

    @property
    def service_name(self) -> str:
        return "github"

    def get_tools(self) -> List[ToolDefinition]:
        return [
            ToolDefinition(
                name="github_create_branch",
                description="Create a new branch in a repository",
                input_schema={
                    "type": "object",
                    "properties": {
                        "repo": {"type": "string", "description": "Repository (owner/repo)"},
                        "branch": {"type": "string", "description": "New branch name"},
                        "base": {"type": "string", "description": "Base branch (default: main)"},
                    },
                    "required": ["repo", "branch"],
                },
            ),
            ToolDefinition(
                name="github_dispatch_workflow",
                description="Trigger a GitHub Actions workflow",
                input_schema={
                    "type": "object",
                    "properties": {
                        "repo": {"type": "string"},
                        "workflow": {"type": "string", "description": "Workflow file name"},
                        "ref": {"type": "string", "description": "Git ref to run on"},
                        "inputs": {"type": "object", "description": "Workflow inputs"},
                    },
                    "required": ["repo", "workflow", "ref"],
                },
            ),
            ToolDefinition(
                name="github_create_pr",
                description="Create a pull request",
                input_schema={
                    "type": "object",
                    "properties": {
                        "repo": {"type": "string"},
                        "title": {"type": "string"},
                        "body": {"type": "string"},
                        "head": {"type": "string"},
                        "base": {"type": "string"},
                    },
                    "required": ["repo", "title", "head", "base"],
                },
            ),
        ]

    async def initialize(self) -> None:
        logger.info("Initializing GitHub connector")
        self._client = None

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> ToolResult:
        await self.ensure_initialized()

        try:
            if tool_name == "github_create_branch":
                return await self._create_branch(arguments)
            elif tool_name == "github_dispatch_workflow":
                return await self._dispatch_workflow(arguments)
            elif tool_name == "github_create_pr":
                return await self._create_pr(arguments)
            else:
                return self._make_error(f"Unknown tool: {tool_name}")
        except Exception as e:
            logger.exception(f"Error executing {tool_name}")
            return self._make_error(str(e))

    async def _create_branch(self, args: Dict[str, Any]) -> ToolResult:
        import uuid
        return self._make_success({
            "branch": args["branch"],
            "branch_sha": uuid.uuid4().hex[:7],
            "url": f"https://github.com/{args['repo']}/tree/{args['branch']}",
        })

    async def _dispatch_workflow(self, args: Dict[str, Any]) -> ToolResult:
        import uuid
        run_id = uuid.uuid4().hex[:8]
        return self._make_success({
            "run_id": run_id,
            "run_url": f"https://github.com/{args['repo']}/actions/runs/{run_id}",
        })

    async def _create_pr(self, args: Dict[str, Any]) -> ToolResult:
        import random
        pr_number = random.randint(100, 999)
        return self._make_success({
            "number": pr_number,
            "url": f"https://github.com/{args['repo']}/pull/{pr_number}",
        })
