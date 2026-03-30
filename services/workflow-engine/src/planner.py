"""
Workflow Planner - LLM-based workflow decomposition
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class ToolDefinition:
    """Definition of an available MCP tool"""
    name: str
    service: str
    description: str
    parameters: Dict[str, Any]
    returns: Dict[str, Any]


@dataclass
class PlanStep:
    """A single step in the generated plan"""
    id: str
    tool: str
    service: str
    description: str
    inputs: Dict[str, str]  # Maps to outputs of previous steps
    outputs: List[str]
    requires_approval: bool = False


@dataclass
class WorkflowPlan:
    """Complete workflow plan generated from prompt"""
    prompt: str
    steps: List[PlanStep]
    parallel_groups: List[List[str]]  # Steps that can run in parallel


SYSTEM_PROMPT = """You are an expert workflow planner for an agentic system. 
Your job is to decompose user requests into executable workflow steps using available MCP tools.

Available tools and their capabilities:
{tools_description}

Given a user request, generate a workflow plan as JSON with this structure:
{{
  "steps": [
    {{
      "id": "step_1",
      "tool": "tool_name",
      "service": "service_name",
      "description": "What this step does",
      "inputs": {{"param": "{{step_0.output_field}}"}},
      "outputs": ["output_field1", "output_field2"],
      "requires_approval": false
    }}
  ],
  "parallel_groups": [["step_1"], ["step_2", "step_3"], ["step_4"]]
}}

Rules:
1. Use only available tools
2. Reference outputs from previous steps using {{step_id.field}} syntax
3. Group independent steps in parallel_groups
4. Add requires_approval: true for destructive or sensitive operations
5. Include a trigger step as the first step
"""


class WorkflowPlanner:
    """
    Uses LLM to convert natural language prompts into structured workflow plans.
    """

    def __init__(
        self,
        llm_client: Any = None,
        model: str = "gpt-4",
        available_tools: Optional[List[ToolDefinition]] = None,
    ):
        self.llm_client = llm_client
        self.model = model
        self.available_tools = available_tools or self._get_default_tools()

    def _get_default_tools(self) -> List[ToolDefinition]:
        """Return default MCP tool definitions"""
        return [
            ToolDefinition(
                name="jira_get_issue",
                service="jira",
                description="Get details of a Jira issue",
                parameters={"issue_id": "string"},
                returns={"title": "string", "priority": "string", "reporter": "string"},
            ),
            ToolDefinition(
                name="jira_create_issue",
                service="jira",
                description="Create a new Jira issue",
                parameters={"project": "string", "title": "string", "type": "string"},
                returns={"issue_id": "string", "url": "string"},
            ),
            ToolDefinition(
                name="jira_update_issue",
                service="jira",
                description="Update an existing Jira issue",
                parameters={"issue_id": "string", "status": "string", "assignee": "string"},
                returns={"updated_at": "string"},
            ),
            ToolDefinition(
                name="github_create_branch",
                service="github",
                description="Create a new branch in a repository",
                parameters={"repo": "string", "branch": "string", "base": "string"},
                returns={"branch_sha": "string", "url": "string"},
            ),
            ToolDefinition(
                name="github_dispatch_workflow",
                service="github",
                description="Trigger a GitHub Actions workflow",
                parameters={"repo": "string", "workflow": "string", "ref": "string"},
                returns={"run_id": "string", "run_url": "string"},
            ),
            ToolDefinition(
                name="slack_post_message",
                service="slack",
                description="Post a message to a Slack channel",
                parameters={"channel": "string", "text": "string"},
                returns={"msg_ts": "string", "thread_ts": "string"},
            ),
            ToolDefinition(
                name="sheets_append_row",
                service="sheets",
                description="Append a row to a Google Sheet",
                parameters={"sheet_id": "string", "row_data": "object"},
                returns={"row_index": "number", "range": "string"},
            ),
        ]

    def _format_tools_description(self) -> str:
        """Format tools for LLM context"""
        lines = []
        for tool in self.available_tools:
            params = ", ".join(f"{k}: {v}" for k, v in tool.parameters.items())
            returns = ", ".join(f"{k}: {v}" for k, v in tool.returns.items())
            lines.append(
                f"- {tool.service}.{tool.name}: {tool.description}\n"
                f"  Parameters: {params}\n"
                f"  Returns: {returns}"
            )
        return "\n".join(lines)

    async def plan(self, prompt: str) -> WorkflowPlan:
        """
        Generate a workflow plan from a natural language prompt.
        
        Args:
            prompt: Natural language description of desired workflow
            
        Returns:
            WorkflowPlan with steps and parallel groups
        """
        if self.llm_client is None:
            # Return mock plan for development
            return self._generate_mock_plan(prompt)

        system_prompt = SYSTEM_PROMPT.format(
            tools_description=self._format_tools_description()
        )

        response = await self.llm_client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
        )

        plan_json = json.loads(response.choices[0].message.content)
        
        steps = [
            PlanStep(
                id=s["id"],
                tool=s["tool"],
                service=s["service"],
                description=s["description"],
                inputs=s.get("inputs", {}),
                outputs=s.get("outputs", []),
                requires_approval=s.get("requires_approval", False),
            )
            for s in plan_json["steps"]
        ]

        return WorkflowPlan(
            prompt=prompt,
            steps=steps,
            parallel_groups=plan_json.get("parallel_groups", [[s.id] for s in steps]),
        )

    def _generate_mock_plan(self, prompt: str) -> WorkflowPlan:
        """Generate a mock plan for testing without LLM - adapts based on query context."""
        prompt_lower = prompt.lower()
        
        # Identify which services are relevant based on the prompt
        steps: List[PlanStep] = []
        parallel_steps: List[str] = []
        
        # Service detection keywords
        service_keywords = {
            "jira": ["jira", "issue", "ticket", "bug", "task", "story"],
            "github": ["github", "repo", "branch", "pr", "pull request", "workflow", "action"],
            "slack": ["slack", "message", "notify", "channel", "post"],
            "sheets": ["sheet", "spreadsheet", "log", "record", "append", "row"],
        }
        
        detected_services = set()
        
        # Check for "connect all" or "readiness" queries - include all services
        if any(kw in prompt_lower for kw in ["connect all", "all connector", "readiness", "all service"]):
            detected_services = {"jira", "github", "slack", "sheets"}
        else:
            # Detect specific services mentioned
            for service, keywords in service_keywords.items():
                if any(kw in prompt_lower for kw in keywords):
                    detected_services.add(service)
        
        # If no specific service detected, use all available services
        if not detected_services:
            detected_services = {"jira", "github", "slack", "sheets"}
        
        step_id = 0
        
        # Add steps for each detected service
        if "jira" in detected_services:
            step_id += 1
            step_name = f"step_{step_id}"
            steps.append(
                PlanStep(
                    id=step_name,
                    tool="jira_get_issue" if "get" in prompt_lower or "fetch" in prompt_lower else "jira_create_issue",
                    service="jira",
                    description="Jira operation",
                    inputs={"issue_id": "{{trigger.issue_id}}"} if "get" in prompt_lower else {},
                    outputs=["title", "priority", "reporter"] if "get" in prompt_lower else ["issue_id", "url"],
                )
            )
            parallel_steps.append(step_name)
        
        if "github" in detected_services:
            step_id += 1
            step_name = f"step_{step_id}"
            steps.append(
                PlanStep(
                    id=step_name,
                    tool="github_create_branch",
                    service="github",
                    description="GitHub operation",
                    inputs={"branch": "feature/{{trigger.issue_id}}"},
                    outputs=["branch_sha", "url"],
                )
            )
            parallel_steps.append(step_name)
        
        if "slack" in detected_services:
            step_id += 1
            step_name = f"step_{step_id}"
            steps.append(
                PlanStep(
                    id=step_name,
                    tool="slack_post_message",
                    service="slack",
                    description="Slack notification",
                    inputs={"text": "Workflow triggered"},
                    outputs=["msg_ts"],
                )
            )
            parallel_steps.append(step_name)
        
        if "sheets" in detected_services:
            step_id += 1
            step_name = f"step_{step_id}"
            steps.append(
                PlanStep(
                    id=step_name,
                    tool="sheets_append_row",
                    service="sheets",
                    description="Log to spreadsheet",
                    inputs={"row_data": "{{trigger}}"},
                    outputs=["row_index"],
                )
            )
            parallel_steps.append(step_name)
        
        return WorkflowPlan(
            prompt=prompt,
            steps=steps,
            parallel_groups=[parallel_steps] if parallel_steps else [],
        )
