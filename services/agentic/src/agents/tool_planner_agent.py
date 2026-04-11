"""Generate executable per-tool step plans with strict JSON validation."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from .base_agent import BaseAgent
from ..gemini_client import GeminiClient
from ..models import ToolDefinition, ToolExecutionPlan, ToolPlanStep


class ToolPlannerAgent(BaseAgent):
    name = "tool-planner-agent"

    def __init__(self, gemini: GeminiClient):
        self.gemini = gemini

    async def run(
        self,
        prompt: str,
        available_tools: Dict[str, ToolDefinition],
        selected_tools: List[str],
    ) -> ToolExecutionPlan:
        scoped_tools = {
            tool_name: available_tools[tool_name]
            for tool_name in selected_tools
            if tool_name in available_tools
        }

        if not scoped_tools:
            return ToolExecutionPlan(steps=[])

        prompt_params = self._extract_prompt_params(prompt)

        if self.gemini.enabled:
            try:
                response_json = await self.gemini.generate_json(
                    self._build_system_prompt(scoped_tools),
                    {"input": prompt},
                    strict_json=True,
                )
                parsed = ToolExecutionPlan.model_validate(
                    self._coerce_plan_payload(response_json)
                )
                return self._sanitize_plan(parsed, scoped_tools, prompt_params)
            except Exception:
                # Fall back to deterministic planner when strict JSON output is invalid.
                pass

        heuristic_plan = self._heuristic_plan(prompt, scoped_tools)
        return self._sanitize_plan(heuristic_plan, scoped_tools, prompt_params)

    @staticmethod
    def _coerce_plan_payload(payload: Any) -> Dict[str, Any]:
        """
        Normalize LLM output into the canonical {"steps": [...]} structure.

        Some model responses still emit a single tool call object. We wrap that
        shape into a one-item steps array so downstream execution always receives
        a consistent plan format.
        """
        if isinstance(payload, dict):
            raw_steps = payload.get("steps")
            if isinstance(raw_steps, list):
                return {"steps": raw_steps}

            single_tool = payload.get("tool")
            if isinstance(single_tool, str) and single_tool.strip():
                arguments = payload.get("arguments")
                return {
                    "steps": [
                        {
                            "id": "1",
                            "tool": single_tool.strip(),
                            "arguments": arguments if isinstance(arguments, dict) else {},
                        }
                    ]
                }

            raw_calls = payload.get("calls")
            if isinstance(raw_calls, list):
                normalized_steps: List[Dict[str, Any]] = []
                for index, call in enumerate(raw_calls, start=1):
                    if not isinstance(call, dict):
                        continue

                    tool = call.get("tool")
                    if not isinstance(tool, str) or not tool.strip():
                        continue

                    arguments = call.get("arguments")
                    normalized_steps.append(
                        {
                            "id": str(index),
                            "tool": tool.strip(),
                            "arguments": arguments if isinstance(arguments, dict) else {},
                        }
                    )

                return {"steps": normalized_steps}

        return {"steps": []}

    def _build_system_prompt(self, tools: Dict[str, ToolDefinition]) -> str:
        tools_payload = {
            tool_name: {
                "description": definition.description,
                "inputs": definition.inputs,
            }
            for tool_name, definition in tools.items()
        }

        return f"""You are an API orchestration engine.

Available tools:
{json.dumps(tools_payload, indent=2, ensure_ascii=True)}

RULES:
1. Analyze the user's request and break it into sequential steps
2. Each step MUST use exactly ONE tool from the available tools
3. Extract ACTUAL values from the user's request:
   - Issue keys like "KAN-3", "PROJ-456"
   - Repository names like "backend", "frontend"
   - Branch names, channel names, etc.
4. Follow logical workflow order:
    - For Jira+GitHub: Always start with jira.get_issue, then create_branch, then create_or_update_file (commit), then create_pull_request
   - For notifications: First get data, then send notification
5. Use correct argument names from the tool schema
6. For branch operations:
   - branch_name: Use format "feature/{{issue_key}}" where issue_key is from user request
   - base_branch: Use "main" unless user specifies otherwise
7. For PR operations:
   - head: The feature branch name
   - base: "main" unless specified
   - title: Reference the issue key
8. Do NOT skip steps - follow the complete workflow
9. Do NOT invent fields not in the tool inputs
10. Do NOT use placeholder formats like "<field_name>" - use actual values or empty strings
11. Return ONLY valid JSON

OUTPUT FORMAT:
{{
  "steps": [
    {{
      "id": "1",
      "tool": "tool_name",
      "arguments": {{ "param": "actual_value" }}
    }}
  ]
}}

EXAMPLE - For "Create branch and PR for Jira issue KAN-3 in repo backend":
{{
  "steps": [
    {{ "id": "1", "tool": "jira.get_issue", "arguments": {{ "issue_key": "KAN-3" }} }},
    {{ "id": "2", "tool": "github.create_branch", "arguments": {{ "repo": "backend", "branch_name": "feature/KAN-3", "base_branch": "main" }} }},
        {{ "id": "3", "tool": "github.create_or_update_file", "arguments": {{ "repo": "backend", "branch": "feature/KAN-3", "path": "KAN-3.txt", "content": "Fix for KAN-3", "message": "Fix KAN-3" }} }},
        {{ "id": "4", "tool": "github.create_pull_request", "arguments": {{ "repo": "backend", "title": "Fix KAN-3", "head": "feature/KAN-3", "base": "main" }} }}
  ]
}}"""

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

        issue_key_match = re.search(r"\b([A-Z][A-Z0-9]+-\d+)\b", prompt)
        if issue_key_match:
            extracted["issue_key"] = issue_key_match.group(1)

        repo_patterns = [
            r"\brepo(?:sitory)?(?:\s+(?:is|as|named|name))?\s+([a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+|[a-zA-Z0-9._-]+)\b",
            r"\bin\s+repo(?:sitory)?(?:\s+(?:is|as|named|name))?\s+([a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+|[a-zA-Z0-9._-]+)\b",
            r"\bin\s+([a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+|[a-zA-Z0-9._-]+)\s+repo(?:sitory)?\b",
        ]
        invalid_repo_tokens = {"as", "is", "name", "named", "repo", "repository"}
        for pattern in repo_patterns:
            repo_match = re.search(pattern, prompt, re.IGNORECASE)
            if repo_match:
                repo_candidate = repo_match.group(1).strip()
                if repo_candidate.lower() not in invalid_repo_tokens:
                    extracted["repo"] = repo_candidate
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

    def _apply_prompt_overrides(
        self,
        tool_name: str,
        arguments: Dict[str, object],
        prompt_params: Dict[str, str],
    ) -> Dict[str, object]:
        if not prompt_params:
            return dict(arguments)

        overridden = dict(arguments)
        normalized_tool_name = tool_name.lower()

        prompt_issue_key = prompt_params.get("issue_key")
        prompt_repo = prompt_params.get("repo")
        prompt_branch = prompt_params.get("branch_name")

        if prompt_issue_key:
            for key in list(overridden.keys()):
                if "issue" in key.lower():
                    overridden[key] = prompt_issue_key

        if prompt_repo:
            repo_keys = [
                key
                for key in overridden
                if key.lower() in {"repo", "repository", "repo_name", "repository_name"}
            ]
            for key in repo_keys:
                overridden[key] = prompt_repo

            if "github" in normalized_tool_name and not repo_keys:
                overridden["repo"] = prompt_repo

        if prompt_branch and "github" in normalized_tool_name:
            branch_keys = [
                key
                for key in overridden
                if key.lower() in {"branch", "branch_name", "head"}
            ]
            for key in branch_keys:
                overridden[key] = prompt_branch

            if "create_branch" in normalized_tool_name and not any(
                key.lower() in {"branch", "branch_name"}
                for key in overridden
            ):
                overridden["branch_name"] = prompt_branch

            if (
                ("create_pull_request" in normalized_tool_name or "create_pr" in normalized_tool_name)
                and "head" not in {key.lower() for key in overridden}
            ):
                overridden["head"] = prompt_branch

            if (
                any(
                    token in normalized_tool_name
                    for token in {"create_file", "update_file", "create_or_update_file"}
                )
                and "branch" not in {key.lower() for key in overridden}
            ):
                overridden["branch"] = prompt_branch

        if prompt_issue_key and "github" in normalized_tool_name:
            title_key = next((key for key in overridden if key.lower() == "title"), None)
            if title_key:
                current_title = str(overridden.get(title_key) or "")
                if prompt_issue_key not in current_title:
                    overridden[title_key] = f"Fix {prompt_issue_key}"

        return overridden

    def _sanitize_plan(
        self,
        plan: ToolExecutionPlan,
        allowed_tools: Dict[str, ToolDefinition],
        prompt_params: Dict[str, str],
    ) -> ToolExecutionPlan:
        normalized_steps: List[ToolPlanStep] = []

        for index, step in enumerate(plan.steps, start=1):
            if step.tool not in allowed_tools:
                raise ValueError(f"Unknown tool in plan: {step.tool}")

            prompt_overridden_arguments = self._apply_prompt_overrides(
                tool_name=step.tool,
                arguments=step.arguments,
                prompt_params=prompt_params,
            )

            allowed_inputs = set(allowed_tools[step.tool].inputs.keys())
            argument_keys = set(prompt_overridden_arguments.keys())
            extra_keys = argument_keys - allowed_inputs
            if extra_keys:
                raise ValueError(
                    f"Tool '{step.tool}' contains unsupported arguments: {sorted(extra_keys)}"
                )

            normalized_steps.append(
                ToolPlanStep(
                    id=str(index),
                    tool=step.tool,
                    arguments={
                        key: value
                        for key, value in prompt_overridden_arguments.items()
                        if key in allowed_inputs
                    },
                )
            )

            current_step = normalized_steps[-1]
            if self._is_jira_update_tool(current_step.tool) and not self._has_valid_jira_update_args(
                current_step.arguments
            ):
                normalized_steps.pop()

        normalized_steps = self._ensure_github_commit_before_pr(
            normalized_steps,
            allowed_tools,
            prompt_params,
        )

        return ToolExecutionPlan(
            steps=[
                ToolPlanStep(
                    id=str(index),
                    tool=step.tool,
                    arguments=step.arguments,
                )
                for index, step in enumerate(normalized_steps, start=1)
            ]
        )

    @staticmethod
    def _tool_signature(tool_name: str) -> str:
        return tool_name.lower().replace("_", "").replace(".", "")

    def _is_pr_tool(self, tool_name: str) -> bool:
        signature = self._tool_signature(tool_name)
        return "createpullrequest" in signature or signature.endswith("createpr")

    def _is_branch_tool(self, tool_name: str) -> bool:
        return "createbranch" in self._tool_signature(tool_name)

    def _is_commit_tool(self, tool_name: str) -> bool:
        signature = self._tool_signature(tool_name)
        return (
            "createorupdatefile" in signature
            or signature.endswith("createfile")
            or signature.endswith("updatefile")
            or "commitfile" in signature
        )

    def _is_jira_update_tool(self, tool_name: str) -> bool:
        signature = self._tool_signature(tool_name)
        return "jiraupdateissue" in signature or "jiratransitionissue" in signature

    def _has_valid_jira_update_args(self, arguments: Dict[str, object]) -> bool:
        issue_value = ""
        for key, value in arguments.items():
            if "issue" in key.lower() and isinstance(value, str) and value.strip():
                issue_value = value.strip()
                break

        if not issue_value:
            return False

        fields_value = arguments.get("fields")
        has_fields = isinstance(fields_value, dict) and len(fields_value) > 0
        if has_fields:
            return True

        for key, value in arguments.items():
            lowered = key.lower()
            if lowered in {"status", "state", "transition_id", "transitionid"}:
                if isinstance(value, str) and value.strip():
                    return True

        return False

    def _find_commit_tool_name(self, tools: Dict[str, ToolDefinition]) -> str | None:
        preferred = [
            "github.create_or_update_file",
            "github_create_or_update_file",
            "github.createOrUpdateFile",
            "github.create_file",
            "github_create_file",
            "github.update_file",
            "github_update_file",
        ]
        for tool_name in preferred:
            if tool_name in tools:
                return tool_name

        for tool_name in tools:
            if self._is_commit_tool(tool_name):
                return tool_name
        return None

    def _find_branch_tool_name(self, tools: Dict[str, ToolDefinition]) -> str | None:
        preferred = [
            "github.create_branch",
            "github_create_branch",
            "github.createBranch",
        ]
        for tool_name in preferred:
            if tool_name in tools:
                return tool_name

        for tool_name in tools:
            if self._is_branch_tool(tool_name):
                return tool_name
        return None

    def _build_branch_args(
        self,
        definition: ToolDefinition,
        repo: str,
        branch_name: str,
    ) -> Dict[str, object]:
        args: Dict[str, object] = {}
        for input_name in definition.inputs:
            lowered = input_name.lower()
            if lowered in {"repo", "repository", "repo_name", "repository_name"} and repo:
                args[input_name] = repo
            elif lowered in {"branch", "branch_name", "head"}:
                args[input_name] = branch_name
            elif lowered in {"base", "base_branch", "target_branch"}:
                args[input_name] = "main"
        return args

    def _build_commit_args(
        self,
        definition: ToolDefinition,
        repo: str,
        branch_name: str,
        issue_key: str,
    ) -> Dict[str, object]:
        file_path = f"{issue_key}.txt" if issue_key else "AUTOMATION_CHANGE.txt"
        content = f"Fix for {issue_key}" if issue_key else "Automated change from NexusMCP"
        message = f"Fix {issue_key}" if issue_key else "Automated update"

        args: Dict[str, object] = {}
        for input_name in definition.inputs:
            lowered = input_name.lower()
            if lowered in {"repo", "repository", "repo_name", "repository_name"} and repo:
                args[input_name] = repo
            elif lowered in {"branch", "branch_name", "head"}:
                args[input_name] = branch_name
            elif lowered in {"path", "file", "file_path", "filename"}:
                args[input_name] = file_path
            elif lowered in {"content", "text", "file_content", "body"}:
                args[input_name] = content
            elif lowered in {"message", "commit_message", "commitmessage", "title"}:
                args[input_name] = message
        return args

    def _ensure_github_commit_before_pr(
        self,
        steps: List[ToolPlanStep],
        tools: Dict[str, ToolDefinition],
        prompt_params: Dict[str, str],
    ) -> List[ToolPlanStep]:
        pr_index = next(
            (index for index, step in enumerate(steps) if self._is_pr_tool(step.tool)),
            None,
        )
        if pr_index is None:
            return steps

        commit_tool_name = self._find_commit_tool_name(tools)
        if not commit_tool_name:
            return steps

        issue_key = prompt_params.get("issue_key", "")
        repo = prompt_params.get("repo", "")
        branch_name = prompt_params.get("branch_name", "")

        pr_arguments = steps[pr_index].arguments
        if not repo:
            repo = str(
                pr_arguments.get("repo")
                or pr_arguments.get("repository")
                or pr_arguments.get("repo_name")
                or ""
            )

        if not branch_name:
            branch_name = str(
                pr_arguments.get("head")
                or pr_arguments.get("branch")
                or pr_arguments.get("branch_name")
                or ""
            )

        if not branch_name and issue_key:
            branch_name = f"feature/{issue_key}"
        if not branch_name:
            branch_name = "feature/automation"

        branch_index = next(
            (index for index, step in enumerate(steps) if self._is_branch_tool(step.tool)),
            None,
        )

        if branch_index is None:
            branch_tool_name = self._find_branch_tool_name(tools)
            if branch_tool_name:
                branch_arguments = self._build_branch_args(
                    tools[branch_tool_name],
                    repo,
                    branch_name,
                )
                steps.insert(
                    pr_index,
                    ToolPlanStep(
                        id="",
                        tool=branch_tool_name,
                        arguments=branch_arguments,
                    ),
                )
                pr_index += 1

        commit_index = next(
            (index for index, step in enumerate(steps) if self._is_commit_tool(step.tool)),
            None,
        )

        if commit_index is None:
            commit_arguments = self._build_commit_args(
                tools[commit_tool_name],
                repo,
                branch_name,
                issue_key,
            )
            steps.insert(
                pr_index,
                ToolPlanStep(
                    id="",
                    tool=commit_tool_name,
                    arguments=commit_arguments,
                ),
            )
            return steps

        if commit_index > pr_index:
            moved = steps.pop(commit_index)
            steps.insert(pr_index, moved)

        return steps

    def _heuristic_plan(
        self,
        prompt: str,
        tools: Dict[str, ToolDefinition],
    ) -> ToolExecutionPlan:
        normalized = prompt.lower()
        issue_key_match = re.search(r"\b([A-Z][A-Z0-9]+-\d+)\b", prompt)
        issue_key = issue_key_match.group(1) if issue_key_match else ""

        repo_patterns = [
            r"\brepo(?:sitory)?(?:\s+(?:is|as|named|name))?\s+([a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+|[a-zA-Z0-9._-]+)\b",
            r"\bin\s+repo(?:sitory)?(?:\s+(?:is|as|named|name))?\s+([a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+|[a-zA-Z0-9._-]+)\b",
            r"\bin\s+([a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+|[a-zA-Z0-9._-]+)\s+repo(?:sitory)?\b",
        ]
        invalid_repo_tokens = {"as", "is", "name", "named", "repo", "repository"}
        repo_name = ""
        for pattern in repo_patterns:
            repo_match = re.search(pattern, prompt, re.IGNORECASE)
            if not repo_match:
                continue

            repo_candidate = repo_match.group(1).strip()
            if repo_candidate.lower() in invalid_repo_tokens:
                continue

            repo_name = repo_candidate
            break

        branch_name = f"feature/{issue_key}" if issue_key else "feature/task"

        steps: List[ToolPlanStep] = []

        # Dynamically match tools based on query context
        # Build a list of matched tools based on keywords and available tools
        matched_tools = self._match_tools_to_query(normalized, tools)

        # Process matched tools in priority order
        for tool_name in matched_tools:
            tool_def = tools.get(tool_name)
            if not tool_def:
                continue

            arguments = self._generic_arguments(
                tool_name=tool_name,
                definition=tool_def,
                repo_name=repo_name,
                issue_key=issue_key,
                branch_name=branch_name,
            )
            steps.append(
                ToolPlanStep(
                    id=str(len(steps) + 1),
                    tool=tool_name,
                    arguments=arguments,
                )
            )

        if steps:
            return ToolExecutionPlan(steps=steps)

        # Generic fallback: use all available tools with placeholder-safe args.
        for tool_name, definition in tools.items():
            fallback_arguments = self._generic_arguments(
                tool_name=tool_name,
                definition=definition,
                repo_name=repo_name,
                issue_key=issue_key,
                branch_name=branch_name,
            )
            steps.append(
                ToolPlanStep(
                    id=str(len(steps) + 1),
                    tool=tool_name,
                    arguments=fallback_arguments,
                )
            )

        return ToolExecutionPlan(steps=steps)

    def _match_tools_to_query(
        self,
        normalized_prompt: str,
        tools: Dict[str, ToolDefinition],
    ) -> List[str]:
        """Match available tools to the query based on keywords and tool descriptions."""
        # Define keyword mappings for different services/actions
        keyword_mappings = {
            # Jira keywords
            "jira": ["jira", "issue", "ticket", "bug", "task", "story", "epic"],
            # GitHub keywords
            "github": ["github", "repo", "repository", "branch", "pr", "pull request", "commit", "workflow", "action"],
            # Slack keywords
            "slack": ["slack", "message", "channel", "notify", "notification", "post", "chat"],
            # Sheets keywords
            "sheets": ["sheet", "spreadsheet", "google sheet", "row", "cell", "append", "log", "record"],
        }

        matched_tools: List[str] = []
        matched_services: set = set()

        # First, identify which services are relevant based on keywords
        for service, keywords in keyword_mappings.items():
            if any(kw in normalized_prompt for kw in keywords):
                matched_services.add(service)

        # If "connect" or "readiness" or "all" is mentioned, include all services
        if any(kw in normalized_prompt for kw in ["connect", "readiness", "ready", "all connector", "all service"]):
            matched_services = set(keyword_mappings.keys())

        # Match tools from identified services
        for tool_name, tool_def in tools.items():
            tool_lower = tool_name.lower()
            desc_lower = tool_def.description.lower() if tool_def.description else ""

            # Check if tool belongs to a matched service
            for service in matched_services:
                if service in tool_lower or service in desc_lower:
                    if tool_name not in matched_tools:
                        matched_tools.append(tool_name)
                    break

            # Also check for action-specific matches
            action_keywords = {
                "create": ["create", "new", "add", "make"],
                "get": ["get", "fetch", "retrieve", "read", "find"],
                "update": ["update", "modify", "change", "edit"],
                "delete": ["delete", "remove"],
                "post": ["post", "send", "notify", "message"],
                "append": ["append", "add", "log", "record"],
            }

            for action, keywords in action_keywords.items():
                if any(kw in normalized_prompt for kw in keywords):
                    if action in tool_lower:
                        if tool_name not in matched_tools:
                            matched_tools.append(tool_name)

        return matched_tools

    def _with_allowed_args(
        self,
        tool_name: str,
        args: Dict[str, object],
        tools: Dict[str, ToolDefinition],
    ) -> Dict[str, object]:
        allowed = set(tools[tool_name].inputs.keys())
        return {key: value for key, value in args.items() if key in allowed}

    def _generic_arguments(
        self,
        tool_name: str,
        definition: ToolDefinition,
        repo_name: str,
        issue_key: str,
        branch_name: str,
    ) -> Dict[str, object]:
        arguments: Dict[str, object] = {}
        for input_name in definition.inputs:
            lowered = input_name.lower()

            if "repo" in lowered and repo_name:
                arguments[input_name] = repo_name
            elif "issue" in lowered and issue_key:
                arguments[input_name] = issue_key
            elif "branch" in lowered and "base" in lowered:
                arguments[input_name] = "main"
            elif "branch" in lowered:
                arguments[input_name] = branch_name
            elif "title" in lowered and issue_key:
                arguments[input_name] = f"Fix {issue_key}"
            elif "head" in lowered:
                arguments[input_name] = branch_name
            elif "base" == lowered:
                arguments[input_name] = "main"
            else:
                # Don't generate placeholder values - leave empty or skip
                # This prevents the "<field_name>" pattern that was causing failures
                arguments[input_name] = ""

        return arguments

    def _find_tool_name(
        self,
        tools: Dict[str, ToolDefinition],
        candidates: List[str],
    ) -> str | None:
        for candidate in candidates:
            if candidate in tools:
                return candidate
        return None
