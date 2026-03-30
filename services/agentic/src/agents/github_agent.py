"""GitHub Agent - Handles all GitHub-related operations."""

from __future__ import annotations

import json
import logging
import re
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
         → required before PR, add fix/code change
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
        "create_file": [
            "github.create_or_update_file",
            "github_create_or_update_file",
            "create_or_update_file",
            "github.create_file",
            "github_create_file",
            "create_file",
            "github.commit_file",
        ],
        "create_or_update_file": [
            "github.create_or_update_file",
            "github_create_or_update_file",
            "create_or_update_file",
            "github.create_file",
            "github_create_file",
            "create_file",
            "github.update_file",
            "github_update_file",
            "update_file",
            "github.commit_file",
        ],
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
                plan = self._enforce_prompt_params(plan, prompt, github_tools)
                logger.info(f"LLM generated {len(plan.operations)} GitHub operations")
                return plan
            except Exception as e:
                logger.warning(f"LLM planning failed: {e}, using heuristic")

        # Fallback to heuristic planning
        heuristic_plan = self._heuristic_plan(prompt, github_tools, context)
        return self._enforce_prompt_params(heuristic_plan, prompt, github_tools)

    @staticmethod
    def _is_valid_branch_candidate(candidate: str) -> bool:
        invalid_tokens = {
            "and",
            "or",
            "for",
            "with",
            "from",
            "to",
            "pr",
            "pull",
            "request",
            "in",
            "on",
        }
        return bool(candidate and candidate.lower() not in invalid_tokens)

    def _extract_prompt_params(self, prompt: str) -> Dict[str, str]:
        extracted: Dict[str, str] = {}

        issue_match = re.search(r"\b([A-Z][A-Z0-9]+-\d+)\b", prompt)
        if issue_match:
            extracted["issue_key"] = issue_match.group(1)

        repo_patterns = [
            r"\brepo(?:sitory)?\s+([a-zA-Z0-9._/-]+)",
            r"\bin\s+repo(?:sitory)?\s+([a-zA-Z0-9._/-]+)",
            r"\bin\s+([a-zA-Z0-9._/-]+)\s+repo(?:sitory)?",
        ]
        for pattern in repo_patterns:
            repo_match = re.search(pattern, prompt, re.IGNORECASE)
            if repo_match:
                extracted["repo"] = repo_match.group(1)
                break

        branch_match = re.search(
            r"\b(?:branch(?:\s+name)?|head)\s+([a-zA-Z0-9._/-]+)\b",
            prompt,
            re.IGNORECASE,
        )
        if branch_match:
            branch_candidate = branch_match.group(1)
            if self._is_valid_branch_candidate(branch_candidate):
                extracted["branch_name"] = branch_candidate

        if extracted.get("issue_key") and "branch_name" not in extracted:
            extracted["branch_name"] = f"feature/{extracted['issue_key']}"

        return extracted

    def _enforce_prompt_params(
        self,
        plan: GitHubWorkflowPlan,
        prompt: str,
        tools: Optional[Dict[str, Any]] = None,
    ) -> GitHubWorkflowPlan:
        prompt_params = self._extract_prompt_params(prompt)
        if not prompt_params:
            if tools:
                return self._ensure_commit_step_before_pr(plan, tools)
            return plan

        for key, value in prompt_params.items():
            if value:
                plan.extracted_params[key] = value

        prompt_repo = prompt_params.get("repo")
        prompt_issue_key = prompt_params.get("issue_key")
        prompt_branch = prompt_params.get("branch_name")

        for operation in plan.operations:
            normalized_operation = operation.operation.strip().lower().replace("-", "_")

            if prompt_repo:
                repo_keys = [
                    key
                    for key in operation.arguments
                    if key.lower() in {"repo", "repository", "repo_name", "repository_name"}
                ]
                for key in repo_keys:
                    operation.arguments[key] = prompt_repo

                if not repo_keys and normalized_operation in {
                    "get_repo",
                    "create_branch",
                    "create_file",
                    "create_or_update_file",
                    "update_file",
                    "create_pull_request",
                    "create_pr",
                    "get_pull_request",
                    "merge_pull_request",
                }:
                    operation.arguments["repo"] = prompt_repo

            if prompt_branch and normalized_operation in {
                "create_branch",
                "create_file",
                "create_or_update_file",
                "update_file",
                "create_pull_request",
                "create_pr",
            }:
                branch_keys = [
                    key
                    for key in operation.arguments
                    if key.lower() in {"branch", "branch_name", "head"}
                ]
                for key in branch_keys:
                    operation.arguments[key] = prompt_branch

                if normalized_operation == "create_branch" and not any(
                    key.lower() in {"branch", "branch_name"}
                    for key in operation.arguments
                ):
                    operation.arguments["branch_name"] = prompt_branch

                if normalized_operation in {"create_pull_request", "create_pr"} and "head" not in {
                    key.lower() for key in operation.arguments
                }:
                    operation.arguments["head"] = prompt_branch

                if normalized_operation in {
                    "create_file",
                    "create_or_update_file",
                    "update_file",
                } and "branch" not in {key.lower() for key in operation.arguments}:
                    operation.arguments["branch"] = prompt_branch

            if prompt_issue_key and normalized_operation in {"create_pull_request", "create_pr"}:
                title_key = next(
                    (key for key in operation.arguments if key.lower() == "title"),
                    None,
                )
                if title_key:
                    current_title = str(operation.arguments.get(title_key) or "")
                    if prompt_issue_key not in current_title:
                        operation.arguments[title_key] = f"Fix {prompt_issue_key}"
                else:
                    operation.arguments["title"] = f"Fix {prompt_issue_key}"

                body_key = next(
                    (key for key in operation.arguments if key.lower() == "body"),
                    None,
                )
                if body_key:
                    current_body = str(operation.arguments.get(body_key) or "")
                    if not current_body.strip():
                        operation.arguments[body_key] = f"Fixes {prompt_issue_key}"

        if tools:
            return self._ensure_commit_step_before_pr(plan, tools)

        return plan

    def _select_commit_operation(self, tools: Dict[str, Any]) -> Optional[str]:
        if self._find_tool("create_or_update_file", tools):
            return "create_or_update_file"
        if self._find_tool("create_file", tools):
            return "create_file"
        if self._find_tool("update_file", tools):
            return "update_file"
        return None

    def _ensure_commit_step_before_pr(
        self,
        plan: GitHubWorkflowPlan,
        tools: Dict[str, Any],
    ) -> GitHubWorkflowPlan:
        pr_index = next(
            (
                index
                for index, operation in enumerate(plan.operations)
                if operation.operation.strip().lower().replace("-", "_")
                in {"create_pull_request", "create_pr"}
            ),
            None,
        )

        if pr_index is None:
            return plan

        commit_operation_name = self._select_commit_operation(tools)
        if not commit_operation_name:
            return plan

        extracted_repo = plan.extracted_params.get("repo") or ""
        extracted_issue = plan.extracted_params.get("issue_key") or ""
        extracted_branch = plan.extracted_params.get("branch_name") or ""

        pr_operation = plan.operations[pr_index]
        pr_arguments = pr_operation.arguments
        repo = (
            str(pr_arguments.get("repo") or "")
            or extracted_repo
            or next(
                (
                    str(operation.arguments.get("repo") or "")
                    for operation in plan.operations
                    if operation.arguments.get("repo")
                ),
                "",
            )
        )

        branch_name = (
            str(pr_arguments.get("head") or "")
            or extracted_branch
            or (
                f"feature/{extracted_issue}" if extracted_issue else "feature/automation"
            )
        )

        if not extracted_branch and branch_name:
            plan.extracted_params["branch_name"] = branch_name

        if not extracted_repo and repo:
            plan.extracted_params["repo"] = repo

        branch_index = next(
            (
                index
                for index, operation in enumerate(plan.operations)
                if operation.operation.strip().lower().replace("-", "_") == "create_branch"
            ),
            None,
        )

        if branch_index is None and self._find_tool("create_branch", tools):
            plan.operations.insert(
                pr_index,
                GitHubOperation(
                    operation="create_branch",
                    arguments={
                        "repo": repo,
                        "branch_name": branch_name,
                        "base_branch": "main",
                    },
                    description="Create feature branch before committing changes",
                ),
            )
            pr_index += 1

        commit_ops = {"create_file", "create_or_update_file", "update_file"}
        commit_index = next(
            (
                index
                for index, operation in enumerate(plan.operations)
                if operation.operation.strip().lower().replace("-", "_") in commit_ops
            ),
            None,
        )

        if commit_index is None:
            commit_depends_on: List[str] = []
            has_branch_step = any(
                operation.operation.strip().lower().replace("-", "_") == "create_branch"
                for operation in plan.operations[:pr_index]
            )
            if has_branch_step:
                commit_depends_on.append("create_branch")

            commit_arguments: Dict[str, Any] = {
                "repo": repo,
                "branch": branch_name,
                "path": f"{extracted_issue}.txt" if extracted_issue else "AUTOMATION_CHANGE.txt",
                "content": f"Fix for {extracted_issue}" if extracted_issue else "Automated change from NexusMCP",
                "message": f"Fix {extracted_issue}" if extracted_issue else "Automated update",
            }

            plan.operations.insert(
                pr_index,
                GitHubOperation(
                    operation=commit_operation_name,
                    arguments=commit_arguments,
                    description="Create or update file to ensure a commit exists before PR",
                    depends_on=commit_depends_on,
                ),
            )

            pr_operation = plan.operations[pr_index + 1]
            pr_depends = list(pr_operation.depends_on or [])
            if commit_operation_name not in pr_depends:
                pr_depends.append(commit_operation_name)
                pr_operation.depends_on = pr_depends
            return plan

        commit_operation = plan.operations[commit_index]
        commit_arguments = commit_operation.arguments
        if repo and not commit_arguments.get("repo"):
            commit_arguments["repo"] = repo
        if branch_name and not commit_arguments.get("branch"):
            commit_arguments["branch"] = branch_name
        if extracted_issue and not commit_arguments.get("path"):
            commit_arguments["path"] = f"{extracted_issue}.txt"
        if extracted_issue and not commit_arguments.get("content"):
            commit_arguments["content"] = f"Fix for {extracted_issue}"
        if extracted_issue and not commit_arguments.get("message"):
            commit_arguments["message"] = f"Fix {extracted_issue}"

        if commit_index > pr_index:
            moved_commit = plan.operations.pop(commit_index)
            plan.operations.insert(pr_index, moved_commit)

        pr_index = next(
            (
                index
                for index, operation in enumerate(plan.operations)
                if operation.operation.strip().lower().replace("-", "_")
                in {"create_pull_request", "create_pr"}
            ),
            pr_index,
        )
        pr_operation = plan.operations[pr_index]
        pr_depends = list(pr_operation.depends_on or [])
        normalized_commit_name = commit_operation.operation.strip().lower().replace("-", "_")
        if normalized_commit_name not in pr_depends:
            pr_depends.append(normalized_commit_name)
            pr_operation.depends_on = pr_depends

        return plan

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
3. create_or_update_file/create_file/update_file (required) → add changes and create commit
4. create_pull_request → create PR

RULES:
1. Extract repo name from prompt
2. Extract or generate branch name (feature/ISSUE-KEY format)
3. Use "main" as default base branch unless specified
4. Always include a commit step before create_pull_request
5. PR title should reference the issue
6. Return ONLY valid JSON

OUTPUT FORMAT:
{{
  "operations": [
    {{
      "operation": "create_branch",
            "arguments": {{ "repo": "repo-from-request", "branch_name": "feature/PROJ-123", "base_branch": "main" }},
      "description": "Create feature branch"
    }},
    {{
            "operation": "create_or_update_file",
                        "arguments": {{ "repo": "repo-from-request", "branch": "feature/PROJ-123", "path": "PROJ-123.txt", "content": "Fix for PROJ-123", "message": "Fix PROJ-123" }},
            "description": "Create commit file for the issue",
            "depends_on": ["1"]
        }},
        {{
      "operation": "create_pull_request",
            "arguments": {{ "repo": "repo-from-request", "title": "Fix PROJ-123", "head": "feature/PROJ-123", "base": "main" }},
      "description": "Create pull request",
            "depends_on": ["create_or_update_file"]
    }}
  ],
  "extracted_params": {{
        "repo": "repo-from-request",
        "branch_name": "feature/PROJ-123"
  }},
    "summary": "Create branch, commit, and PR for the requested issue"
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
