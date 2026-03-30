"""GitHub Agent - Handles all GitHub-related operations."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from .base_agent import BaseAgent
from ..gemini_client import GeminiClient

logger = logging.getLogger(__name__)


class GitHubRepo(BaseModel):
    """GitHub repository data structure."""
    name: str
    owner: str = ""
    full_name: str = ""
    default_branch: str = "main"
    description: str = ""
    url: str = ""


class GitHubOperation(BaseModel):
    """A GitHub operation to execute."""
    operation: str  # get_repo, create_branch, create_file, update_file, create_pull_request
    arguments: Dict[str, Any] = Field(default_factory=dict)
    description: str = ""
    depends_on: List[str] = Field(default_factory=list)


class GitHubWorkflowPlan(BaseModel):
    """Plan for GitHub operations."""
    operations: List[GitHubOperation] = Field(default_factory=list)
    extracted_params: Dict[str, str] = Field(default_factory=dict)
    summary: str = ""


class GitHubAgent(BaseAgent):
    """
    GitHub Agent - Specialized for GitHub operations.
    
    Supported Operations:
    1. Get Repo (optional validation)
       → validate repo exists before actions
       → fetch default branch, permissions
    
    2. Create Branch (core)
       → create feature/{issue_key} from main
       → Arguments: repo, branch_name, base_branch
    
    3. Create/Update File (commit)
       → optional, add fix/code change
       → Arguments: repo, path, content, message, branch
    
    4. Create Pull Request (important)
       → link branch → PR with title from Jira
       → Arguments: repo, title, head, base, body
    """

    name = "github-agent"

    # Tool mappings for GitHub operations
    TOOL_MAPPINGS = {
        "get_repo": ["github.get_repo", "github_get_repo", "get_repo", "github.repo_info"],
        "create_branch": ["github.create_branch", "github_create_branch", "create_branch"],
        "create_file": ["github.create_file", "github_create_file", "create_file", "github.commit_file"],
        "update_file": ["github.update_file", "github_update_file", "update_file"],
        "create_pull_request": [
            "github.create_pull_request",
            "github_create_pull_request",
            "create_pull_request",
            "github.create_pr",
            "github_create_pr",
            "create_pr",
        ],
        "get_pull_request": ["github.get_pull_request", "github_get_pull_request", "get_pr"],
        "merge_pull_request": ["github.merge_pull_request", "github_merge_pull_request", "merge_pr"],
    }

    def __init__(self, gemini: GeminiClient):
        self.gemini = gemini

    async def run(
        self,
        prompt: str,
        available_tools: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
    ) -> GitHubWorkflowPlan:
        """
        Analyze prompt and generate GitHub operations.
        
        Args:
            prompt: User's request
            available_tools: Available GitHub tools
            context: Optional context from previous steps (e.g., Jira issue data)
            
        Returns:
            GitHubWorkflowPlan with operations to execute
        """
        logger.info(f"GitHubAgent analyzing: {prompt[:100]}...")

        # Filter to only GitHub tools
        github_tools = self._filter_github_tools(available_tools)
        
        if not github_tools:
            logger.warning("No GitHub tools available")
            return GitHubWorkflowPlan(summary="No GitHub tools available")

        # Try LLM-based planning
        if self.gemini.enabled:
            try:
                plan = await self._llm_plan(prompt, github_tools, context)
                logger.info(f"LLM generated {len(plan.operations)} GitHub operations")
                return plan
            except Exception as e:
                logger.warning(f"LLM planning failed: {e}, using heuristic")

        # Fallback to heuristic planning
        return self._heuristic_plan(prompt, github_tools, context)

    def _filter_github_tools(self, tools: Dict[str, Any]) -> Dict[str, Any]:
        """Filter to only include GitHub-related tools."""
        github_tools = {}
        for name, definition in tools.items():
            if "github" in name.lower():
                github_tools[name] = definition
        return github_tools

    async def _llm_plan(
        self,
        prompt: str,
        tools: Dict[str, Any],
        context: Optional[Dict[str, Any]],
    ) -> GitHubWorkflowPlan:
        """Use LLM to generate GitHub operation plan."""
        
        system_prompt = f"""You are a GitHub operations planner.

Available GitHub Tools:
{self._format_tools(tools)}

GITHUB OPERATIONS:
1. GET REPO (validation, optional)
   - Validate repository exists before operations
   - Fetch default branch and permissions
   - Arguments: repo (required), owner (optional)

2. CREATE BRANCH (core operation)
   - Create feature branch from base
   - Branch naming: feature/{{issue_key}} or feature/{{description}}
   - Arguments: repo (required), branch_name (required), base_branch (default: "main")

3. CREATE/UPDATE FILE (commit changes)
   - Add or modify files in repository
   - Arguments: repo, path, content, message, branch

4. CREATE PULL REQUEST (important)
   - Create PR to merge feature branch
   - Link to Jira issue in title/body
   - Arguments: repo (required), title (required), head (required), base (default: "main"), body (optional)

WORKFLOW ORDER:
1. get_repo (optional) → validate repo exists
2. create_branch → create feature branch
3. create_file/update_file (optional) → add changes
4. create_pull_request → create PR

RULES:
1. Extract repo name from prompt
2. Extract or generate branch name (feature/ISSUE-KEY format)
3. Use "main" as default base branch unless specified
4. PR title should reference the issue
5. Return ONLY valid JSON

OUTPUT FORMAT:
{{
  "operations": [
    {{
      "operation": "create_branch",
      "arguments": {{ "repo": "backend", "branch_name": "feature/ABC-123", "base_branch": "main" }},
      "description": "Create feature branch"
    }},
    {{
      "operation": "create_pull_request",
      "arguments": {{ "repo": "backend", "title": "Fix ABC-123", "head": "feature/ABC-123", "base": "main" }},
      "description": "Create pull request",
      "depends_on": ["1"]
    }}
  ],
  "extracted_params": {{
    "repo": "backend",
    "branch_name": "feature/ABC-123"
  }},
  "summary": "Create branch and PR for ABC-123"
}}"""

        context_str = ""
        if context:
            context_str = f"\nContext from Jira: {context}"

        response = await self.gemini.generate_json(
            system_prompt,
            {"user_request": prompt + context_str},
            strict_json=True,
        )

        operations = []
        for op_data in response.get("operations", []):
            operations.append(GitHubOperation(
                operation=op_data.get("operation", ""),
                arguments=op_data.get("arguments", {}),
                description=op_data.get("description", ""),
                depends_on=op_data.get("depends_on", []),
            ))

        return GitHubWorkflowPlan(
            operations=operations,
            extracted_params=response.get("extracted_params", {}),
            summary=response.get("summary", ""),
        )

    def _heuristic_plan(
        self,
        prompt: str,
        tools: Dict[str, Any],
        context: Optional[Dict[str, Any]],
    ) -> GitHubWorkflowPlan:
        """Generate plan using heuristics."""
        import re
        
        normalized = prompt.lower()
        operations: List[GitHubOperation] = []
        extracted_params: Dict[str, str] = {}

        # Extract repository name
        repo_match = re.search(r"\brepo(?:sitory)?\s+([a-zA-Z0-9._/-]+)", prompt, re.IGNORECASE)
        if repo_match:
            extracted_params["repo"] = repo_match.group(1)
        
        # Also check for "in <repo>" pattern
        in_repo_match = re.search(r"\bin\s+([a-zA-Z0-9._-]+)\s*(?:repo|repository)?", prompt, re.IGNORECASE)
        if in_repo_match and "repo" not in extracted_params:
            extracted_params["repo"] = in_repo_match.group(1)

        # Extract issue key for branch naming
        issue_match = re.search(r"\b([A-Z][A-Z0-9]+-\d+)\b", prompt)
        if issue_match:
            extracted_params["issue_key"] = issue_match.group(1)
            extracted_params["branch_name"] = f"feature/{issue_match.group(1)}"

        # Get from context if available
        if context:
            if context.get("issue_key") and "issue_key" not in extracted_params:
                extracted_params["issue_key"] = context["issue_key"]
                extracted_params["branch_name"] = f"feature/{context['issue_key']}"
            if context.get("repo") and "repo" not in extracted_params:
                extracted_params["repo"] = context["repo"]
            if context.get("title"):
                extracted_params["pr_title"] = f"Fix {context.get('issue_key', '')}: {context['title']}"

        # Default branch name if not set
        if "branch_name" not in extracted_params:
            extracted_params["branch_name"] = "feature/new-feature"

        repo = extracted_params.get("repo", "")
        branch_name = extracted_params.get("branch_name", "")
        issue_key = extracted_params.get("issue_key", "")

        # 1. Get Repo - if validating or checking repo
        if any(kw in normalized for kw in ["validate", "check repo", "repo info", "get repo"]):
            tool_name = self._find_tool("get_repo", tools)
            if tool_name and repo:
                operations.append(GitHubOperation(
                    operation="get_repo",
                    arguments={"repo": repo},
                    description=f"Validate repository {repo}",
                ))

        # 2. Create Branch - core operation
        if any(kw in normalized for kw in ["branch", "create branch", "new branch", "feature branch"]):
            tool_name = self._find_tool("create_branch", tools)
            if tool_name and repo:
                operations.append(GitHubOperation(
                    operation="create_branch",
                    arguments={
                        "repo": repo,
                        "branch_name": branch_name,
                        "base_branch": "main",
                    },
                    description=f"Create branch {branch_name}",
                ))

        # 3. Create/Update File - if committing changes
        if any(kw in normalized for kw in ["commit", "add file", "create file", "update file", "change"]):
            tool_name = self._find_tool("create_file", tools) or self._find_tool("update_file", tools)
            if tool_name and repo:
                operations.append(GitHubOperation(
                    operation="create_file",
                    arguments={
                        "repo": repo,
                        "path": "",
                        "content": "",
                        "message": f"Fix {issue_key}" if issue_key else "Update",
                        "branch": branch_name,
                    },
                    description="Commit file changes",
                ))

        # 4. Create Pull Request - important operation
        if any(kw in normalized for kw in ["pr", "pull request", "pull-request", "merge request"]):
            tool_name = self._find_tool("create_pull_request", tools)
            if tool_name and repo:
                pr_title = extracted_params.get("pr_title", f"Fix {issue_key}" if issue_key else "New PR")
                operations.append(GitHubOperation(
                    operation="create_pull_request",
                    arguments={
                        "repo": repo,
                        "title": pr_title,
                        "head": branch_name,
                        "base": "main",
                        "body": f"Fixes {issue_key}" if issue_key else "",
                    },
                    description=f"Create PR: {pr_title}",
                    depends_on=["create_branch"] if any(op.operation == "create_branch" for op in operations) else [],
                ))

        # If creating branch and PR together (common workflow)
        if not operations and ("branch" in normalized and "pr" in normalized or "pull request" in normalized):
            # Add both operations
            tool_branch = self._find_tool("create_branch", tools)
            tool_pr = self._find_tool("create_pull_request", tools)
            
            if tool_branch and repo:
                operations.append(GitHubOperation(
                    operation="create_branch",
                    arguments={
                        "repo": repo,
                        "branch_name": branch_name,
                        "base_branch": "main",
                    },
                    description=f"Create branch {branch_name}",
                ))
            
            if tool_pr and repo:
                operations.append(GitHubOperation(
                    operation="create_pull_request",
                    arguments={
                        "repo": repo,
                        "title": f"Fix {issue_key}" if issue_key else "New PR",
                        "head": branch_name,
                        "base": "main",
                    },
                    description="Create pull request",
                    depends_on=["1"],
                ))

        return GitHubWorkflowPlan(
            operations=operations,
            extracted_params=extracted_params,
            summary=f"GitHub workflow with {len(operations)} operations",
        )

    def _find_tool(self, operation: str, tools: Dict[str, Any]) -> Optional[str]:
        """Find the actual tool name for an operation."""
        candidates = self.TOOL_MAPPINGS.get(operation, [])
        for candidate in candidates:
            if candidate in tools:
                return candidate
        # Try partial match
        for tool_name in tools:
            if operation.replace("_", "") in tool_name.lower().replace("_", "").replace(".", ""):
                return tool_name
        return None

    def _format_tools(self, tools: Dict[str, Any]) -> str:
        """Format tools for LLM prompt."""
        import json
        formatted = {}
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
        """Get the actual tool name for an operation from available tools."""
        return self._find_tool(operation, available_tools)
