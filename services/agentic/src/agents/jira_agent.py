"""Jira Agent - Handles all Jira-related operations."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from .base_agent import BaseAgent
from ..gemini_client import GeminiClient

logger = logging.getLogger(__name__)


class JiraIssue(BaseModel):
    """Jira issue data structure."""
    issue_key: str
    title: str = ""
    status: str = ""
    priority: str = ""
    description: str = ""
    assignee: Optional[str] = None
    reporter: Optional[str] = None
    project: str = ""
    issue_type: str = ""
    labels: List[str] = Field(default_factory=list)


class JiraOperation(BaseModel):
    """A Jira operation to execute."""
    operation: str  # get_issue, search_issues, create_issue, update_issue
    arguments: Dict[str, Any] = Field(default_factory=dict)
    description: str = ""
    depends_on: List[str] = Field(default_factory=list)


class JiraWorkflowPlan(BaseModel):
    """Plan for Jira operations."""
    operations: List[JiraOperation] = Field(default_factory=list)
    extracted_params: Dict[str, str] = Field(default_factory=dict)
    summary: str = ""


class JiraAgent(BaseAgent):
    """
    Jira Agent - Specialized for Jira operations.
    
    Supported Operations:
    1. Get Issue (main trigger)
       → fetch issue_key, title, status, priority
       → used to start workflow
    
    2. Search Issues (optional trigger)
       → e.g. "priority = High AND status = Open"
       → batch workflows
    
    3. Create Issue (optional)
       → for auto-logging bugs/tasks from system
    
    4. Update Issue (important)
       → change status → In Progress / Done after GitHub steps
    """

    name = "jira-agent"

    # Tool mappings for Jira operations
    TOOL_MAPPINGS = {
        "get_issue": ["jira.get_issue", "jira_get_issue", "get_issue"],
        "search_issues": [
            "jira.search_issues",
            "jira_search_issues",
            "search_issues",
            "jira.jql_search",
            "jira_search",
        ],
        "create_issue": ["jira.create_issue", "jira_create_issue", "create_issue"],
        "update_issue": ["jira.update_issue", "jira_update_issue", "update_issue", "jira.transition_issue"],
    }

    def __init__(self, gemini: GeminiClient):
        self.gemini = gemini

    async def run(
        self,
        prompt: str,
        available_tools: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
    ) -> JiraWorkflowPlan:
        """
        Analyze prompt and generate Jira operations.
        
        Args:
            prompt: User's request
            available_tools: Available Jira tools
            context: Optional context from previous steps
            
        Returns:
            JiraWorkflowPlan with operations to execute
        """
        logger.info(f"JiraAgent analyzing: {prompt[:100]}...")

        # Filter to only Jira tools
        jira_tools = self._filter_jira_tools(available_tools)
        
        if not jira_tools:
            logger.warning("No Jira tools available")
            return JiraWorkflowPlan(summary="No Jira tools available")

        # Try LLM-based planning
        if self.gemini.enabled:
            try:
                plan = await self._llm_plan(prompt, jira_tools, context)
                logger.info(f"LLM generated {len(plan.operations)} Jira operations")
                return plan
            except Exception as e:
                logger.warning(f"LLM planning failed: {e}, using heuristic")

        # Fallback to heuristic planning
        return self._heuristic_plan(prompt, jira_tools, context)

    def _filter_jira_tools(self, tools: Dict[str, Any]) -> Dict[str, Any]:
        """Filter to only include Jira-related tools."""
        jira_tools = {}
        for name, definition in tools.items():
            if "jira" in name.lower():
                jira_tools[name] = definition
        return jira_tools

    async def _llm_plan(
        self,
        prompt: str,
        tools: Dict[str, Any],
        context: Optional[Dict[str, Any]],
    ) -> JiraWorkflowPlan:
        """Use LLM to generate Jira operation plan."""
        
        system_prompt = f"""You are a Jira operations planner.

Available Jira Tools:
{self._format_tools(tools)}

JIRA OPERATIONS:
1. GET ISSUE (trigger operation)
   - Use to fetch issue details: key, title, status, priority
   - Always start with this when an issue key is mentioned
   - Arguments: issue_key (required)

2. SEARCH ISSUES (batch trigger)
   - Use JQL queries to find multiple issues
   - Example: "priority = High AND status = Open"
   - Arguments: jql (required), max_results (optional)

3. CREATE ISSUE (optional)
   - Create new issues for bugs/tasks
   - Arguments: project, summary, issue_type, description (optional), priority (optional)

4. UPDATE ISSUE (important for workflow completion)
   - Update issue status after work is done
   - Transition to: "In Progress", "Done", "Closed"
   - Arguments: issue_key, status (or transition_id), comment (optional)

RULES:
1. Extract issue keys from prompt (format: ABC-123, PROJ-456)
2. If issue key found → start with get_issue
3. If searching → use search_issues with JQL
4. If creating → use create_issue
5. If updating status → use update_issue
6. Return ONLY valid JSON

OUTPUT FORMAT:
{{
  "operations": [
    {{
      "operation": "get_issue",
      "arguments": {{ "issue_key": "ABC-123" }},
      "description": "Fetch issue details"
    }}
  ],
  "extracted_params": {{
    "issue_key": "ABC-123"
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

        operations = []
        for op_data in response.get("operations", []):
            operations.append(JiraOperation(
                operation=op_data.get("operation", ""),
                arguments=op_data.get("arguments", {}),
                description=op_data.get("description", ""),
                depends_on=op_data.get("depends_on", []),
            ))

        return JiraWorkflowPlan(
            operations=operations,
            extracted_params=response.get("extracted_params", {}),
            summary=response.get("summary", ""),
        )

    def _heuristic_plan(
        self,
        prompt: str,
        tools: Dict[str, Any],
        context: Optional[Dict[str, Any]],
    ) -> JiraWorkflowPlan:
        """Generate plan using heuristics."""
        import re
        
        normalized = prompt.lower()
        operations: List[JiraOperation] = []
        extracted_params: Dict[str, str] = {}

        # Extract issue key
        issue_match = re.search(r"\b([A-Z][A-Z0-9]+-\d+)\b", prompt)
        if issue_match:
            extracted_params["issue_key"] = issue_match.group(1)

        # Extract project key
        project_match = re.search(r"\bproject\s+([A-Z]+)\b", prompt, re.IGNORECASE)
        if project_match:
            extracted_params["project"] = project_match.group(1)

        # Determine operations based on keywords
        
        # 1. Get Issue - if issue key mentioned and need to fetch
        if extracted_params.get("issue_key") and any(kw in normalized for kw in ["get", "fetch", "details", "info", "branch", "pr", "pull request"]):
            tool_name = self._find_tool("get_issue", tools)
            if tool_name:
                operations.append(JiraOperation(
                    operation="get_issue",
                    arguments={"issue_key": extracted_params["issue_key"]},
                    description=f"Fetch details for {extracted_params['issue_key']}",
                ))

        # 2. Search Issues - if searching with criteria
        if any(kw in normalized for kw in ["search", "find", "all", "list", "high priority", "open issues"]):
            tool_name = self._find_tool("search_issues", tools)
            if tool_name:
                jql = self._build_jql(normalized, extracted_params)
                operations.append(JiraOperation(
                    operation="search_issues",
                    arguments={"jql": jql, "max_results": 50},
                    description=f"Search issues with: {jql}",
                ))

        # 3. Create Issue - if creating new
        if any(kw in normalized for kw in ["create issue", "new issue", "add issue", "log bug", "create task"]):
            tool_name = self._find_tool("create_issue", tools)
            if tool_name:
                operations.append(JiraOperation(
                    operation="create_issue",
                    arguments={
                        "project": extracted_params.get("project", ""),
                        "summary": self._extract_summary(prompt),
                        "issue_type": "Task",
                    },
                    description="Create new Jira issue",
                ))

        # 4. Update Issue - if updating status
        if any(kw in normalized for kw in ["update", "change status", "move to", "transition", "mark as", "set to", "in progress", "done", "close"]):
            tool_name = self._find_tool("update_issue", tools)
            if tool_name and extracted_params.get("issue_key"):
                new_status = self._extract_status(normalized)
                operations.append(JiraOperation(
                    operation="update_issue",
                    arguments={
                        "issue_key": extracted_params["issue_key"],
                        "status": new_status,
                    },
                    description=f"Update {extracted_params['issue_key']} to {new_status}",
                ))

        # If no specific operation but issue key exists, default to get_issue
        if not operations and extracted_params.get("issue_key"):
            tool_name = self._find_tool("get_issue", tools)
            if tool_name:
                operations.append(JiraOperation(
                    operation="get_issue",
                    arguments={"issue_key": extracted_params["issue_key"]},
                    description=f"Fetch details for {extracted_params['issue_key']}",
                ))

        return JiraWorkflowPlan(
            operations=operations,
            extracted_params=extracted_params,
            summary=f"Jira workflow with {len(operations)} operations",
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

    def _build_jql(self, prompt: str, params: Dict[str, str]) -> str:
        """Build JQL query from prompt."""
        conditions = []
        
        if "high priority" in prompt:
            conditions.append("priority = High")
        if "open" in prompt:
            conditions.append('status = "Open"')
        if "in progress" in prompt:
            conditions.append('status = "In Progress"')
        if params.get("project"):
            conditions.append(f"project = {params['project']}")
            
        return " AND ".join(conditions) if conditions else "ORDER BY created DESC"

    def _extract_summary(self, prompt: str) -> str:
        """Extract issue summary from prompt."""
        import re
        # Look for quoted text
        quoted = re.search(r'"([^"]+)"', prompt)
        if quoted:
            return quoted.group(1)
        # Look for "titled" or "named"
        titled = re.search(r'(?:titled|named|called)\s+(.+?)(?:\s+in|\s+for|$)', prompt, re.IGNORECASE)
        if titled:
            return titled.group(1).strip()
        return "New Issue"

    def _extract_status(self, prompt: str) -> str:
        """Extract target status from prompt."""
        if "done" in prompt or "complete" in prompt:
            return "Done"
        if "in progress" in prompt or "start" in prompt:
            return "In Progress"
        if "close" in prompt:
            return "Closed"
        if "reopen" in prompt:
            return "Open"
        return "In Progress"

    def get_tool_name(self, operation: str, available_tools: Dict[str, Any]) -> Optional[str]:
        """Get the actual tool name for an operation from available tools."""
        return self._find_tool(operation, available_tools)
