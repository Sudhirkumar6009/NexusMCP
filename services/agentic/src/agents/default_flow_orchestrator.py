"""
Default Flow Orchestrator - Standard 5-step flow for all queries.

Flow Structure:
1. PROMPT INGEST       → Receive and validate user query
2. CONTEXT ANALYSIS    → Understand intent, extract parameters
3. CONNECTOR CHECK     → Verify required API keys/connections
4. EXECUTION FLOW      → Generate and run resolution steps
5. FINAL RESPONSE      → Compile and return results
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

from ..gemini_client import GeminiClient
from ..models import (
    ToolDefinition,
    IntegrationInput,
    AgentFlowStep,
    AgentFlowEdge,
)
from .jira_agent import JiraAgent, JiraWorkflowPlan
from .github_agent import GitHubAgent, GitHubWorkflowPlan

logger = logging.getLogger(__name__)


# =============================================================================
# Flow Models
# =============================================================================

class FlowStepStatus(BaseModel):
    """Status of a flow step."""
    step_id: str
    step_name: str
    status: Literal["pending", "running", "done", "failed", "skipped"]
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    detail: str = ""
    result: Optional[Any] = None
    error: Optional[str] = None


class PromptIngestResult(BaseModel):
    """Result of Step 1: Prompt Ingest."""
    raw_prompt: str
    sanitized_prompt: str
    is_valid: bool
    validation_error: Optional[str] = None
    timestamp: str


class ContextAnalysisResult(BaseModel):
    """Result of Step 2: Context Analysis."""
    intent: str  # What user wants to do
    summary: str  # Brief summary
    detected_services: List[str] = Field(default_factory=list)  # jira, github, slack, etc.
    extracted_params: Dict[str, str] = Field(default_factory=dict)  # issue_key, repo, etc.
    confidence: float = 1.0
    risk_level: Literal["low", "medium", "high"] = "low"


class ConnectorCheckResult(BaseModel):
    """Result of Step 3: Connector Check."""
    required_connectors: List[str] = Field(default_factory=list)
    available_connectors: List[str] = Field(default_factory=list)
    missing_connectors: List[str] = Field(default_factory=list)
    all_available: bool = True
    connector_status: Dict[str, Dict[str, Any]] = Field(default_factory=dict)


class ExecutionStep(BaseModel):
    """A single execution step."""
    id: str
    tool: str
    service: str  # jira, github, slack, etc.
    operation: str  # get_issue, create_branch, etc.
    arguments: Dict[str, Any] = Field(default_factory=dict)
    description: str = ""
    depends_on: List[str] = Field(default_factory=list)
    status: Literal["pending", "running", "done", "failed", "skipped"] = "pending"
    result: Optional[Any] = None
    error: Optional[str] = None


class ExecutionFlowResult(BaseModel):
    """Result of Step 4: Execution Flow."""
    steps: List[ExecutionStep] = Field(default_factory=list)
    workflow_type: str = "sequential"
    total_steps: int = 0
    completed_steps: int = 0
    failed_steps: int = 0


class FinalResponseResult(BaseModel):
    """Result of Step 5: Final Response."""
    success: bool
    message: str
    data: Dict[str, Any] = Field(default_factory=dict)
    execution_summary: str = ""
    next_actions: List[str] = Field(default_factory=list)


class DefaultFlowResponse(BaseModel):
    """Complete response from Default Flow Orchestrator."""
    id: str
    prompt: str
    created_at: str
    
    # Step results
    prompt_ingest: PromptIngestResult
    context_analysis: ContextAnalysisResult
    connector_check: ConnectorCheckResult
    execution_flow: ExecutionFlowResult
    final_response: FinalResponseResult
    
    # Flow visualization
    flow_steps: List[AgentFlowStep] = Field(default_factory=list)
    flow_edges: List[AgentFlowEdge] = Field(default_factory=list)
    
    # Status tracking
    step_statuses: List[FlowStepStatus] = Field(default_factory=list)
    overall_status: Literal["pending", "running", "completed", "blocked", "failed"] = "pending"
    
    # Metadata
    execution_time_ms: Optional[int] = None
    logs: List[Dict[str, Any]] = Field(default_factory=list)


# =============================================================================
# Default Flow Orchestrator
# =============================================================================

class DefaultFlowOrchestrator:
    """
    Default Flow Orchestrator - Handles all queries with a standard 5-step flow.
    
    Flow:
    1. PROMPT INGEST       → Receive and validate user query
    2. CONTEXT ANALYSIS    → Understand intent, extract parameters  
    3. CONNECTOR CHECK     → Verify required API keys/connections
    4. EXECUTION FLOW      → Generate and run resolution steps
    5. FINAL RESPONSE      → Compile and return results
    """

    name = "default-flow-orchestrator"

    # Service detection keywords
    SERVICE_KEYWORDS = {
        "jira": ["jira", "issue", "ticket", "bug", "task", "story", "epic", "sprint"],
        "github": ["github", "repo", "repository", "branch", "pr", "pull request", "commit", "merge"],
        "slack": ["slack", "message", "channel", "notify", "notification", "post", "dm"],
        "sheets": ["sheet", "sheets", "spreadsheet", "google sheet", "row", "cell", "append"],
        "gmail": ["gmail", "email", "mail", "send email"],
        "aws": ["aws", "lambda", "s3", "ec2", "cloud"],
    }

    def __init__(self, gemini: GeminiClient):
        self.gemini = gemini
        self.jira_agent = JiraAgent(gemini)
        self.github_agent = GitHubAgent(gemini)
        self.logs: List[Dict[str, Any]] = []

    def _log(self, level: str, step: str, message: str, details: Optional[Dict] = None):
        """Add a log entry."""
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "step": step,
            "message": message,
            "details": details,
        }
        self.logs.append(entry)
        logger.log(getattr(logging, level.upper(), logging.INFO), f"[{step}] {message}")

    async def run(
        self,
        prompt: str,
        integrations: List[IntegrationInput],
        available_tools: Dict[str, ToolDefinition],
    ) -> DefaultFlowResponse:
        """
        Execute the default 5-step flow.
        """
        flow_id = str(uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        start_time = datetime.now(timezone.utc)
        
        self.logs = []  # Reset logs
        step_statuses: List[FlowStepStatus] = []
        
        self._log("info", "orchestrator", f"Starting default flow for: {prompt[:100]}...")

        # Initialize step statuses
        step_names = [
            ("prompt-ingest", "Prompt Ingest"),
            ("context-analysis", "Context Analysis"),
            ("connector-check", "Connector Check"),
            ("execution-flow", "Execution Flow"),
            ("final-response", "Final Response"),
        ]
        
        for step_id, step_name in step_names:
            step_statuses.append(FlowStepStatus(
                step_id=step_id,
                step_name=step_name,
                status="pending",
            ))

        try:
            # =================================================================
            # STEP 1: PROMPT INGEST
            # =================================================================
            step_statuses[0].status = "running"
            step_statuses[0].started_at = datetime.now(timezone.utc).isoformat()
            
            prompt_result = self._step1_prompt_ingest(prompt)
            
            step_statuses[0].status = "done" if prompt_result.is_valid else "failed"
            step_statuses[0].completed_at = datetime.now(timezone.utc).isoformat()
            step_statuses[0].detail = "Prompt validated" if prompt_result.is_valid else prompt_result.validation_error or "Invalid"
            
            if not prompt_result.is_valid:
                return self._build_error_response(
                    flow_id, prompt, created_at, prompt_result, step_statuses,
                    "Prompt validation failed"
                )

            # =================================================================
            # STEP 2: CONTEXT ANALYSIS
            # =================================================================
            step_statuses[1].status = "running"
            step_statuses[1].started_at = datetime.now(timezone.utc).isoformat()
            
            context_result = await self._step2_context_analysis(prompt_result.sanitized_prompt)
            
            step_statuses[1].status = "done"
            step_statuses[1].completed_at = datetime.now(timezone.utc).isoformat()
            step_statuses[1].detail = f"Detected: {', '.join(context_result.detected_services) or 'general query'}"

            # =================================================================
            # STEP 3: CONNECTOR CHECK
            # =================================================================
            step_statuses[2].status = "running"
            step_statuses[2].started_at = datetime.now(timezone.utc).isoformat()
            
            connector_result = self._step3_connector_check(
                context_result.detected_services,
                integrations,
            )
            
            step_statuses[2].status = "done" if connector_result.all_available else "failed"
            step_statuses[2].completed_at = datetime.now(timezone.utc).isoformat()
            
            if connector_result.all_available:
                step_statuses[2].detail = f"All connectors available ({len(connector_result.available_connectors)})"
            else:
                step_statuses[2].detail = f"Missing: {', '.join(connector_result.missing_connectors)}"
                step_statuses[2].error = "Please connect required integrations"

            # If connectors missing, return blocked response
            if not connector_result.all_available:
                return self._build_blocked_response(
                    flow_id, prompt, created_at,
                    prompt_result, context_result, connector_result,
                    step_statuses,
                )

            # =================================================================
            # STEP 4: EXECUTION FLOW
            # =================================================================
            step_statuses[3].status = "running"
            step_statuses[3].started_at = datetime.now(timezone.utc).isoformat()
            
            execution_result = await self._step4_execution_flow(
                prompt_result.sanitized_prompt,
                context_result,
                available_tools,
            )
            
            step_statuses[3].status = "done"
            step_statuses[3].completed_at = datetime.now(timezone.utc).isoformat()
            step_statuses[3].detail = f"Generated {execution_result.total_steps} steps"

            # =================================================================
            # STEP 5: FINAL RESPONSE
            # =================================================================
            step_statuses[4].status = "running"
            step_statuses[4].started_at = datetime.now(timezone.utc).isoformat()
            
            final_result = self._step5_final_response(
                prompt_result,
                context_result,
                connector_result,
                execution_result,
            )
            
            step_statuses[4].status = "done"
            step_statuses[4].completed_at = datetime.now(timezone.utc).isoformat()
            step_statuses[4].detail = "Response compiled"

            # =================================================================
            # BUILD FLOW VISUALIZATION
            # =================================================================
            flow_steps, flow_edges = self._build_flow_visualization(
                flow_id,
                prompt,
                context_result,
                connector_result,
                execution_result,
                step_statuses,
            )

            # Calculate execution time
            end_time = datetime.now(timezone.utc)
            execution_time_ms = int((end_time - start_time).total_seconds() * 1000)

            return DefaultFlowResponse(
                id=flow_id,
                prompt=prompt,
                created_at=created_at,
                prompt_ingest=prompt_result,
                context_analysis=context_result,
                connector_check=connector_result,
                execution_flow=execution_result,
                final_response=final_result,
                flow_steps=flow_steps,
                flow_edges=flow_edges,
                step_statuses=step_statuses,
                overall_status="completed",
                execution_time_ms=execution_time_ms,
                logs=self.logs,
            )

        except Exception as e:
            self._log("error", "orchestrator", f"Flow failed: {str(e)}")
            return self._build_error_response(
                flow_id, prompt, created_at,
                PromptIngestResult(
                    raw_prompt=prompt,
                    sanitized_prompt=prompt,
                    is_valid=True,
                    timestamp=created_at,
                ),
                step_statuses,
                str(e),
            )

    # =========================================================================
    # STEP 1: PROMPT INGEST
    # =========================================================================
    def _step1_prompt_ingest(self, prompt: str) -> PromptIngestResult:
        """
        Step 1: Receive and validate user query.
        """
        self._log("info", "prompt-ingest", "Processing prompt...")
        
        raw_prompt = prompt
        sanitized = prompt.strip()
        
        # Validation checks
        if not sanitized:
            return PromptIngestResult(
                raw_prompt=raw_prompt,
                sanitized_prompt="",
                is_valid=False,
                validation_error="Prompt cannot be empty",
                timestamp=datetime.now(timezone.utc).isoformat(),
            )
        
        if len(sanitized) < 3:
            return PromptIngestResult(
                raw_prompt=raw_prompt,
                sanitized_prompt=sanitized,
                is_valid=False,
                validation_error="Prompt too short (minimum 3 characters)",
                timestamp=datetime.now(timezone.utc).isoformat(),
            )
        
        if len(sanitized) > 4000:
            return PromptIngestResult(
                raw_prompt=raw_prompt,
                sanitized_prompt=sanitized[:4000],
                is_valid=False,
                validation_error="Prompt too long (maximum 4000 characters)",
                timestamp=datetime.now(timezone.utc).isoformat(),
            )
        
        self._log("info", "prompt-ingest", f"Prompt validated: {len(sanitized)} chars")
        
        return PromptIngestResult(
            raw_prompt=raw_prompt,
            sanitized_prompt=sanitized,
            is_valid=True,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    # =========================================================================
    # STEP 2: CONTEXT ANALYSIS
    # =========================================================================
    async def _step2_context_analysis(self, prompt: str) -> ContextAnalysisResult:
        """
        Step 2: Understand intent and extract parameters.
        """
        self._log("info", "context-analysis", "Analyzing context...")
        
        normalized = prompt.lower()
        
        # Detect services
        detected_services = []
        for service, keywords in self.SERVICE_KEYWORDS.items():
            if any(kw in normalized for kw in keywords):
                detected_services.append(service)
        
        # Extract parameters
        import re
        extracted_params: Dict[str, str] = {}
        
        # Issue key (JIRA-123 format)
        issue_match = re.search(r"\b([A-Z][A-Z0-9]+-\d+)\b", prompt)
        if issue_match:
            extracted_params["issue_key"] = issue_match.group(1)
        
        # Repository name
        repo_match = re.search(r"\brepo(?:sitory)?\s+([a-zA-Z0-9._/-]+)", prompt, re.IGNORECASE)
        if repo_match:
            extracted_params["repo"] = repo_match.group(1)
        else:
            # "in <repo>" pattern
            in_repo = re.search(r"\bin\s+([a-zA-Z0-9._-]+)(?:\s+repo)?", prompt, re.IGNORECASE)
            if in_repo:
                extracted_params["repo"] = in_repo.group(1)
        
        # Branch name
        branch_match = re.search(r"\bbranch\s+([a-zA-Z0-9._/-]+)", prompt, re.IGNORECASE)
        if branch_match:
            extracted_params["branch"] = branch_match.group(1)
        elif extracted_params.get("issue_key"):
            extracted_params["branch"] = f"feature/{extracted_params['issue_key']}"
        
        # Channel name (Slack)
        channel_match = re.search(r"#([a-zA-Z0-9_-]+)", prompt)
        if channel_match:
            extracted_params["channel"] = channel_match.group(1)
        
        # Determine intent using LLM if available
        intent = "general query"
        summary = prompt[:100]
        
        if self.gemini.enabled:
            try:
                llm_result = await self.gemini.generate_json(
                    """Analyze this user query and return:
{
  "intent": "brief description of what user wants (5-10 words)",
  "summary": "one sentence summary",
  "risk": "low|medium|high"
}""",
                    {"query": prompt},
                    strict_json=True,
                )
                intent = llm_result.get("intent", intent)
                summary = llm_result.get("summary", summary)
            except Exception as e:
                self._log("warn", "context-analysis", f"LLM analysis failed: {e}")
        else:
            # Heuristic intent detection
            if any(kw in normalized for kw in ["create", "add", "new"]):
                intent = "create new resource"
            elif any(kw in normalized for kw in ["update", "change", "modify", "edit"]):
                intent = "update existing resource"
            elif any(kw in normalized for kw in ["get", "fetch", "show", "list", "find"]):
                intent = "retrieve information"
            elif any(kw in normalized for kw in ["delete", "remove"]):
                intent = "delete resource"
            elif any(kw in normalized for kw in ["connect", "status", "check"]):
                intent = "check connection status"
        
        self._log("info", "context-analysis", 
                  f"Detected services: {detected_services}, params: {extracted_params}")
        
        return ContextAnalysisResult(
            intent=intent,
            summary=summary,
            detected_services=detected_services,
            extracted_params=extracted_params,
            confidence=0.9 if detected_services else 0.7,
            risk_level="low",
        )

    # =========================================================================
    # STEP 3: CONNECTOR CHECK
    # =========================================================================
    def _step3_connector_check(
        self,
        required_services: List[str],
        integrations: List[IntegrationInput],
    ) -> ConnectorCheckResult:
        """
        Step 3: Verify required API keys/connections are available.
        """
        self._log("info", "connector-check", f"Checking connectors for: {required_services}")
        
        # Build integration lookup
        integration_map: Dict[str, IntegrationInput] = {}
        for integration in integrations:
            # Map by ID and common aliases
            integration_map[integration.id] = integration
            integration_map[integration.id.replace("int-", "")] = integration
            integration_map[integration.name.lower()] = integration
        
        available = []
        missing = []
        connector_status: Dict[str, Dict[str, Any]] = {}
        
        for service in required_services:
            # Try to find integration
            integration = (
                integration_map.get(service) or
                integration_map.get(f"int-{service}") or
                integration_map.get(service.lower())
            )
            
            if integration and integration.status == "connected":
                available.append(service)
                connector_status[service] = {
                    "id": integration.id,
                    "name": integration.name,
                    "status": "connected",
                    "available": True,
                    "tools": integration.tools,
                }
            else:
                missing.append(service)
                connector_status[service] = {
                    "id": f"int-{service}",
                    "name": service.title(),
                    "status": integration.status if integration else "not_configured",
                    "available": False,
                    "tools": [],
                    "error": "API key not configured" if not integration else "Not connected",
                }
        
        all_available = len(missing) == 0 or len(required_services) == 0
        
        self._log(
            "info" if all_available else "warn",
            "connector-check",
            f"Available: {available}, Missing: {missing}",
        )
        
        return ConnectorCheckResult(
            required_connectors=required_services,
            available_connectors=available,
            missing_connectors=missing,
            all_available=all_available,
            connector_status=connector_status,
        )

    # =========================================================================
    # STEP 4: EXECUTION FLOW
    # =========================================================================
    async def _step4_execution_flow(
        self,
        prompt: str,
        context: ContextAnalysisResult,
        available_tools: Dict[str, ToolDefinition],
    ) -> ExecutionFlowResult:
        """
        Step 4: Generate execution steps based on detected services.
        """
        self._log("info", "execution-flow", "Generating execution steps...")
        
        steps: List[ExecutionStep] = []
        step_id = 1
        
        # Generate steps for each detected service
        for service in context.detected_services:
            if service == "jira":
                jira_plan = await self.jira_agent.run(
                    prompt, 
                    available_tools,
                    context.extracted_params,
                )
                for op in jira_plan.operations:
                    tool_name = self.jira_agent.get_tool_name(op.operation, available_tools)
                    steps.append(ExecutionStep(
                        id=str(step_id),
                        tool=tool_name or f"jira.{op.operation}",
                        service="jira",
                        operation=op.operation,
                        arguments=op.arguments,
                        description=op.description,
                        depends_on=[str(int(d)) for d in op.depends_on] if op.depends_on else [],
                    ))
                    step_id += 1
                    
            elif service == "github":
                github_plan = await self.github_agent.run(
                    prompt,
                    available_tools,
                    context.extracted_params,
                )
                for op in github_plan.operations:
                    tool_name = self.github_agent.get_tool_name(op.operation, available_tools)
                    steps.append(ExecutionStep(
                        id=str(step_id),
                        tool=tool_name or f"github.{op.operation}",
                        service="github",
                        operation=op.operation,
                        arguments=op.arguments,
                        description=op.description,
                        depends_on=[str(int(d) + step_id - len(github_plan.operations)) for d in op.depends_on] if op.depends_on else [],
                    ))
                    step_id += 1
                    
            elif service == "slack":
                # Basic Slack operations
                steps.append(ExecutionStep(
                    id=str(step_id),
                    tool="slack.post_message",
                    service="slack",
                    operation="post_message",
                    arguments={
                        "channel": context.extracted_params.get("channel", "general"),
                        "message": context.extracted_params.get("message", ""),
                    },
                    description="Send Slack notification",
                ))
                step_id += 1
                
            elif service == "sheets":
                # Basic Sheets operations
                steps.append(ExecutionStep(
                    id=str(step_id),
                    tool="sheets.append_row",
                    service="sheets",
                    operation="append_row",
                    arguments={
                        "spreadsheet_id": context.extracted_params.get("spreadsheet_id", ""),
                        "data": context.extracted_params.get("data", []),
                    },
                    description="Append to Google Sheet",
                ))
                step_id += 1
        
        self._log("info", "execution-flow", f"Generated {len(steps)} execution steps")
        
        return ExecutionFlowResult(
            steps=steps,
            workflow_type="sequential",
            total_steps=len(steps),
            completed_steps=0,
            failed_steps=0,
        )

    # =========================================================================
    # STEP 5: FINAL RESPONSE
    # =========================================================================
    def _step5_final_response(
        self,
        prompt_result: PromptIngestResult,
        context_result: ContextAnalysisResult,
        connector_result: ConnectorCheckResult,
        execution_result: ExecutionFlowResult,
    ) -> FinalResponseResult:
        """
        Step 5: Compile and return final response.
        """
        self._log("info", "final-response", "Compiling final response...")
        
        # Build execution summary
        service_list = ", ".join(context_result.detected_services) or "general"
        step_list = [f"{s.service}.{s.operation}" for s in execution_result.steps]
        
        execution_summary = (
            f"Workflow for {service_list} with {execution_result.total_steps} steps: "
            f"{' → '.join(step_list) if step_list else 'No execution required'}"
        )
        
        # Suggest next actions
        next_actions = []
        if execution_result.steps:
            next_actions.append("Execute the generated workflow")
        if context_result.detected_services:
            next_actions.append(f"Verify {', '.join(context_result.detected_services)} connection")
        
        return FinalResponseResult(
            success=True,
            message=f"Flow generated successfully for: {context_result.intent}",
            data={
                "intent": context_result.intent,
                "services": context_result.detected_services,
                "params": context_result.extracted_params,
                "steps": len(execution_result.steps),
            },
            execution_summary=execution_summary,
            next_actions=next_actions,
        )

    # =========================================================================
    # HELPER METHODS
    # =========================================================================
    def _build_flow_visualization(
        self,
        flow_id: str,
        prompt: str,
        context: ContextAnalysisResult,
        connectors: ConnectorCheckResult,
        execution: ExecutionFlowResult,
        statuses: List[FlowStepStatus],
    ) -> tuple[List[AgentFlowStep], List[AgentFlowEdge]]:
        """Build flow visualization data."""
        
        steps: List[AgentFlowStep] = []
        edges: List[AgentFlowEdge] = []
        
        # Step 1: Prompt Ingest
        steps.append(AgentFlowStep(
            id=f"{flow_id}-prompt-ingest",
            label="1. Prompt Ingest",
            description=f"Query: {prompt[:50]}...",
            phase="start",
            level=0,
            status=statuses[0].status,
        ))
        
        # Step 2: Context Analysis
        steps.append(AgentFlowStep(
            id=f"{flow_id}-context-analysis",
            label="2. Context Analysis",
            description=f"Intent: {context.intent}",
            phase="context-analysis",
            level=1,
            status=statuses[1].status,
        ))
        edges.append(AgentFlowEdge(
            id=f"edge-1-2",
            source=f"{flow_id}-prompt-ingest",
            target=f"{flow_id}-context-analysis",
        ))
        
        # Step 3: Connector Check
        connector_desc = (
            f"Checking: {', '.join(connectors.required_connectors)}"
            if connectors.required_connectors
            else "No connectors required"
        )
        steps.append(AgentFlowStep(
            id=f"{flow_id}-connector-check",
            label="3. Connector Check",
            description=connector_desc,
            phase="required-api",
            level=2,
            status=statuses[2].status,
        ))
        edges.append(AgentFlowEdge(
            id=f"edge-2-3",
            source=f"{flow_id}-context-analysis",
            target=f"{flow_id}-connector-check",
        ))
        
        # Add individual connector nodes
        prev_id = f"{flow_id}-connector-check"
        for idx, service in enumerate(connectors.required_connectors):
            status_info = connectors.connector_status.get(service, {})
            conn_status = "done" if status_info.get("available") else "failed"
            
            step_id = f"{flow_id}-connector-{service}"
            steps.append(AgentFlowStep(
                id=step_id,
                label=f"↳ {service.title()}",
                description=f"API Key: {'Available' if status_info.get('available') else 'Missing'}",
                phase="connector-agent",
                level=3,
                serviceId=service,
                serviceName=service.title(),
                status=conn_status,
            ))
            edges.append(AgentFlowEdge(
                id=f"edge-3-conn-{idx}",
                source=prev_id,
                target=step_id,
            ))
        
        # Step 4: Execution Flow
        exec_node_id = f"{flow_id}-execution-flow"
        steps.append(AgentFlowStep(
            id=exec_node_id,
            label="4. Execution Flow",
            description=f"{execution.total_steps} steps to execute",
            phase="planning",
            level=4,
            status=statuses[3].status,
        ))
        
        # Connect from connectors or connector-check
        if connectors.required_connectors:
            for service in connectors.required_connectors:
                edges.append(AgentFlowEdge(
                    id=f"edge-conn-{service}-exec",
                    source=f"{flow_id}-connector-{service}",
                    target=exec_node_id,
                ))
        else:
            edges.append(AgentFlowEdge(
                id=f"edge-3-4",
                source=f"{flow_id}-connector-check",
                target=exec_node_id,
            ))
        
        # Add execution steps
        prev_exec_id = exec_node_id
        for exec_step in execution.steps:
            step_id = f"{flow_id}-exec-{exec_step.id}"
            steps.append(AgentFlowStep(
                id=step_id,
                label=f"↳ {exec_step.operation}",
                description=exec_step.description or f"{exec_step.service}.{exec_step.operation}",
                phase="execution",
                level=5,
                serviceId=exec_step.service,
                serviceName=exec_step.service.title(),
                status=exec_step.status,
                tool=exec_step.tool,
                arguments=exec_step.arguments,
            ))
            edges.append(AgentFlowEdge(
                id=f"edge-exec-{exec_step.id}",
                source=prev_exec_id,
                target=step_id,
            ))
            prev_exec_id = step_id
        
        # Step 5: Final Response
        final_id = f"{flow_id}-final-response"
        steps.append(AgentFlowStep(
            id=final_id,
            label="5. Final Response",
            description="Compile and return results",
            phase="end",
            level=6,
            status=statuses[4].status,
        ))
        edges.append(AgentFlowEdge(
            id=f"edge-exec-final",
            source=prev_exec_id,
            target=final_id,
        ))
        
        return steps, edges

    def _build_blocked_response(
        self,
        flow_id: str,
        prompt: str,
        created_at: str,
        prompt_result: PromptIngestResult,
        context_result: ContextAnalysisResult,
        connector_result: ConnectorCheckResult,
        step_statuses: List[FlowStepStatus],
    ) -> DefaultFlowResponse:
        """Build response when connectors are missing."""
        
        # Mark remaining steps as skipped
        for status in step_statuses[3:]:
            status.status = "skipped"
            status.detail = "Blocked - missing connectors"
        
        flow_steps, flow_edges = self._build_flow_visualization(
            flow_id, prompt, context_result, connector_result,
            ExecutionFlowResult(), step_statuses,
        )
        
        return DefaultFlowResponse(
            id=flow_id,
            prompt=prompt,
            created_at=created_at,
            prompt_ingest=prompt_result,
            context_analysis=context_result,
            connector_check=connector_result,
            execution_flow=ExecutionFlowResult(),
            final_response=FinalResponseResult(
                success=False,
                message=f"Missing connectors: {', '.join(connector_result.missing_connectors)}",
                data={"missing": connector_result.missing_connectors},
                execution_summary="Flow blocked - please connect required integrations",
                next_actions=[
                    f"Connect {svc} integration" for svc in connector_result.missing_connectors
                ],
            ),
            flow_steps=flow_steps,
            flow_edges=flow_edges,
            step_statuses=step_statuses,
            overall_status="blocked",
            logs=self.logs,
        )

    def _build_error_response(
        self,
        flow_id: str,
        prompt: str,
        created_at: str,
        prompt_result: PromptIngestResult,
        step_statuses: List[FlowStepStatus],
        error: str,
    ) -> DefaultFlowResponse:
        """Build error response."""
        
        return DefaultFlowResponse(
            id=flow_id,
            prompt=prompt,
            created_at=created_at,
            prompt_ingest=prompt_result,
            context_analysis=ContextAnalysisResult(intent="error", summary=error),
            connector_check=ConnectorCheckResult(),
            execution_flow=ExecutionFlowResult(),
            final_response=FinalResponseResult(
                success=False,
                message=f"Flow failed: {error}",
                data={"error": error},
            ),
            flow_steps=[],
            flow_edges=[],
            step_statuses=step_statuses,
            overall_status="failed",
            logs=self.logs,
        )
