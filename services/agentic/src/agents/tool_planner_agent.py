"""Generate executable per-tool step plans with strict JSON validation."""

from __future__ import annotations

import json
import re
from typing import Dict, List

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

        if self.gemini.enabled:
            try:
                response_json = await self.gemini.generate_json(
                    self._build_system_prompt(scoped_tools),
                    {"input": prompt},
                    strict_json=True,
                )
                parsed = ToolExecutionPlan.model_validate(response_json)
                return self._sanitize_plan(parsed, scoped_tools)
            except Exception:
                # Fall back to deterministic planner when strict JSON output is invalid.
                pass

        heuristic_plan = self._heuristic_plan(prompt, scoped_tools)
        return self._sanitize_plan(heuristic_plan, scoped_tools)

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
   - Issue keys like "ABC-123", "PROJ-456"
   - Repository names like "backend", "frontend"
   - Branch names, channel names, etc.
4. Follow logical workflow order:
   - For Jira+GitHub: Always start with jira.get_issue, then create_branch, then create_pull_request
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

EXAMPLE - For "Create branch and PR for Jira issue ABC-123 in repo backend":
{{
  "steps": [
    {{ "id": "1", "tool": "jira.get_issue", "arguments": {{ "issue_key": "ABC-123" }} }},
    {{ "id": "2", "tool": "github.create_branch", "arguments": {{ "repo": "backend", "branch_name": "feature/ABC-123", "base_branch": "main" }} }},
    {{ "id": "3", "tool": "github.create_pull_request", "arguments": {{ "repo": "backend", "title": "Fix ABC-123", "head": "feature/ABC-123", "base": "main" }} }}
  ]
}}"""

    def _sanitize_plan(
        self,
        plan: ToolExecutionPlan,
        allowed_tools: Dict[str, ToolDefinition],
    ) -> ToolExecutionPlan:
        normalized_steps: List[ToolPlanStep] = []

        for index, step in enumerate(plan.steps, start=1):
            if step.tool not in allowed_tools:
                raise ValueError(f"Unknown tool in plan: {step.tool}")

            allowed_inputs = set(allowed_tools[step.tool].inputs.keys())
            argument_keys = set(step.arguments.keys())
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
                        for key, value in step.arguments.items()
                        if key in allowed_inputs
                    },
                )
            )

        return ToolExecutionPlan(steps=normalized_steps)

    def _heuristic_plan(
        self,
        prompt: str,
        tools: Dict[str, ToolDefinition],
    ) -> ToolExecutionPlan:
        normalized = prompt.lower()
        issue_key_match = re.search(r"\b([A-Z][A-Z0-9]+-\d+)\b", prompt)
        issue_key = issue_key_match.group(1) if issue_key_match else ""

        repo_match = re.search(r"\brepo\s+([a-zA-Z0-9._/-]+)\b", prompt)
        repo_name = repo_match.group(1) if repo_match else ""

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
