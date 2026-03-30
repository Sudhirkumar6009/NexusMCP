"""High-level flow orchestration across agent roles."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4
from typing import Any, Dict, List, Optional
import logging

from .agents.connector_agent import ConnectorAgent
from .agents.context_agent import ContextAnalysisAgent
from .agents.json_guard_agent import JsonGuardAgent
from .agents.orchestrator_agent import OrchestratorAgent
from .agents.planner_agent import PlannerAgent
from .agents.required_api_agent import RequiredAPIAgent
from .agents.tool_planner_agent import ToolPlannerAgent
from .agents.tool_selection_agent import ToolSelectionAgent
from .agents.jira_agent import JiraAgent
from .agents.github_agent import GitHubAgent
from .agents.slack_agent import SlackAgent
from .agents.sheets_agent import GoogleSheetsAgent
from .agents.gmail_agent import GmailAgent
from .config import Settings
from .gemini_client import GeminiClient
from .models import (
    AgentFlowRequest,
    AgentFlowResponse,
    AgentFlowStep,
    AgentFlowEdge,
    StreamlinedFlowRequest,
    StreamlinedFlowResponse,
    RequiredAPIResult,
    ContextAnalysisResult,
    ToolDefinition,
    ToolExecutionPlan,
    ToolPlanStep,
)

logger = logging.getLogger(__name__)


class FlowManager:
    SERVICE_ALIASES: Dict[str, List[str]] = {
        "jira": ["jira", "ticket", "issue"],
        "github": ["github", "gh", "repo", "repository"],
        "slack": ["slack", "chat"],
        "google_sheets": [
            "google_sheets",
            "google-sheets",
            "google sheets",
            "sheets",
            "sheet",
        ],
        "gmail": ["gmail", "google mail", "google_mail", "mail", "email"],
        "aws": ["aws", "amazon web services", "amazon_web_services"],
    }

    def __init__(self, settings: Settings):
        self.settings = settings
        self.gemini = GeminiClient(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            timeout_seconds=settings.request_timeout_seconds,
        )

        self.context_agent = ContextAnalysisAgent(self.gemini)
        self.planner_agent = PlannerAgent(self.gemini)
        self.tool_selection_agent = ToolSelectionAgent()
        self.tool_planner_agent = ToolPlannerAgent(self.gemini)
        self.json_guard_agent = JsonGuardAgent()
        self.connector_agent = ConnectorAgent()
        self.orchestrator_agent = OrchestratorAgent()
        self.required_api_agent = RequiredAPIAgent(self.gemini)
        self.jira_agent = JiraAgent(self.gemini)
        self.github_agent = GitHubAgent(self.gemini)
        self.slack_agent = SlackAgent(self.gemini)
        self.sheets_agent = GoogleSheetsAgent(self.gemini)
        self.gmail_agent = GmailAgent(self.gemini)

    @staticmethod
    def _normalize_service_id(service_id: str) -> str:
        normalized = service_id.strip().lower().replace("-", "_").replace(" ", "_")
        if normalized.startswith("int_"):
            normalized = normalized[4:]
        return normalized

    def _canonical_service_id(self, service_id: str) -> str:
        normalized = self._normalize_service_id(service_id)
        for canonical, aliases in self.SERVICE_ALIASES.items():
            alias_keys = {self._normalize_service_id(canonical)}
            alias_keys.update(self._normalize_service_id(alias) for alias in aliases)
            if normalized in alias_keys:
                return canonical
        return normalized

    def _service_alias_keys(self, service_id: str) -> List[str]:
        canonical = self._canonical_service_id(service_id)
        keys = {self._normalize_service_id(canonical)}
        keys.update(self._normalize_service_id(alias) for alias in self.SERVICE_ALIASES.get(canonical, []))
        return sorted(keys)

    def _tool_matches_service(self, tool_name: str, service_id: str) -> bool:
        normalized_tool = tool_name.strip().lower().replace("-", "_")
        for alias in self._service_alias_keys(service_id):
            if normalized_tool.startswith(f"{alias}.") or normalized_tool.startswith(f"{alias}_"):
                return True
        return False

    def _find_tool_for_operation(
        self,
        service_id: str,
        operation: str,
        available_tools: Dict[str, ToolDefinition],
    ) -> str | None:
        normalized_operation = operation.strip().lower().replace("-", "_")

        for alias in self._service_alias_keys(service_id):
            direct_candidates = [
                f"{alias}.{normalized_operation}",
                f"{alias}_{normalized_operation}",
            ]
            for candidate in direct_candidates:
                if candidate in available_tools:
                    return candidate

        operation_key = normalized_operation.replace("_", "")
        for tool_name in available_tools:
            if not self._tool_matches_service(tool_name, service_id):
                continue

            normalized_tool = tool_name.strip().lower().replace("-", "_")
            compact_tool = normalized_tool.replace("_", "").replace(".", "")
            if operation_key in compact_tool:
                return tool_name

        return None

    def _sanitize_tool_arguments(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        available_tools: Dict[str, ToolDefinition],
    ) -> Dict[str, Any]:
        definition = available_tools.get(tool_name)
        if not definition:
            return dict(arguments or {})

        allowed_inputs = set(definition.inputs.keys())
        if not allowed_inputs:
            return {}

        return {
            key: value
            for key, value in (arguments or {}).items()
            if key in allowed_inputs
        }

    def _resolve_dependencies(
        self,
        dependencies: List[str],
        local_index_to_step_id: Dict[str, str],
        operation_to_step_id: Dict[str, str],
    ) -> List[str]:
        resolved: List[str] = []

        for dependency in dependencies or []:
            dependency_key = str(dependency).strip()
            if not dependency_key:
                continue

            target = (
                local_index_to_step_id.get(dependency_key)
                or operation_to_step_id.get(dependency_key)
                or operation_to_step_id.get(dependency_key.lower())
            )

            if target is None and dependency_key.isdigit():
                target = dependency_key

            if target and target not in resolved:
                resolved.append(target)

        return resolved

    def _append_specialized_operations(
        self,
        target_steps: List[ToolPlanStep],
        next_step_id: int,
        service_id: str,
        workflow_plan: Any,
        get_tool_name: Any,
        available_tools: Dict[str, ToolDefinition],
    ) -> int:
        local_index_to_step_id: Dict[str, str] = {}
        operation_to_step_id: Dict[str, str] = {}

        for local_index, operation in enumerate(workflow_plan.operations, start=1):
            step_id = str(next_step_id)
            depends_on = self._resolve_dependencies(
                operation.depends_on,
                local_index_to_step_id,
                operation_to_step_id,
            )

            tool_name: str | None = None
            if callable(get_tool_name):
                tool_name = get_tool_name(operation.operation, available_tools)

            if not tool_name or tool_name not in available_tools:
                tool_name = self._find_tool_for_operation(
                    service_id,
                    operation.operation,
                    available_tools,
                )

            if not tool_name:
                continue

            target_steps.append(
                ToolPlanStep(
                    id=step_id,
                    tool=tool_name,
                    arguments=self._sanitize_tool_arguments(
                        tool_name,
                        operation.arguments,
                        available_tools,
                    ),
                )
            )

            local_index_to_step_id[str(local_index)] = step_id
            operation_to_step_id[operation.operation] = step_id
            operation_to_step_id[operation.operation.lower()] = step_id
            next_step_id += 1

        return next_step_id

    async def _build_specialized_execution_plan(
        self,
        prompt: str,
        target_service_ids: List[str],
        available_tools: Dict[str, ToolDefinition],
        context: ContextAnalysisResult,
        required_api: RequiredAPIResult,
    ) -> ToolExecutionPlan:
        if not target_service_ids:
            return ToolExecutionPlan(steps=[])

        ordered_services: List[str] = []
        seen_services: set[str] = set()
        for service_id in target_service_ids:
            canonical = self._canonical_service_id(service_id)
            if canonical in seen_services:
                continue
            seen_services.add(canonical)
            ordered_services.append(canonical)

        shared_context: Dict[str, Any] = {
            "intent": context.intent,
            "summary": context.summary,
            **required_api.extracted_params,
        }

        plan_steps: List[ToolPlanStep] = []
        next_step_id = 1

        for canonical_service in ordered_services:
            if canonical_service == "jira":
                jira_plan = await self.jira_agent.run(
                    prompt,
                    available_tools,
                    context=shared_context,
                )
                next_step_id = self._append_specialized_operations(
                    plan_steps,
                    next_step_id,
                    canonical_service,
                    jira_plan,
                    self.jira_agent.get_tool_name,
                    available_tools,
                )
                shared_context.update(jira_plan.extracted_params)
                continue

            if canonical_service == "github":
                github_plan = await self.github_agent.run(
                    prompt,
                    available_tools,
                    context=shared_context,
                )
                next_step_id = self._append_specialized_operations(
                    plan_steps,
                    next_step_id,
                    canonical_service,
                    github_plan,
                    self.github_agent.get_tool_name,
                    available_tools,
                )
                shared_context.update(github_plan.extracted_params)
                continue

            if canonical_service == "slack":
                slack_plan = await self.slack_agent.run(
                    prompt,
                    available_tools,
                    context=shared_context,
                )
                next_step_id = self._append_specialized_operations(
                    plan_steps,
                    next_step_id,
                    canonical_service,
                    slack_plan,
                    self.slack_agent.get_tool_name,
                    available_tools,
                )
                shared_context.update(slack_plan.extracted_params)
                continue

            if canonical_service == "google_sheets":
                sheets_plan = await self.sheets_agent.run(
                    prompt,
                    available_tools,
                    context=shared_context,
                )
                next_step_id = self._append_specialized_operations(
                    plan_steps,
                    next_step_id,
                    canonical_service,
                    sheets_plan,
                    self.sheets_agent.get_tool_name,
                    available_tools,
                )
                shared_context.update(sheets_plan.extracted_params)
                continue

            if canonical_service == "gmail":
                gmail_plan = await self.gmail_agent.run(
                    prompt,
                    available_tools,
                    context=shared_context,
                )
                next_step_id = self._append_specialized_operations(
                    plan_steps,
                    next_step_id,
                    canonical_service,
                    gmail_plan,
                    self.gmail_agent.get_tool_name,
                    available_tools,
                )
                shared_context.update(gmail_plan.extracted_params)

        return ToolExecutionPlan(steps=plan_steps)

    async def create_streamlined_flow(
        self,
        request: StreamlinedFlowRequest,
    ) -> StreamlinedFlowResponse:
        """
        New streamlined flow: PROMPT → CONTEXT → REQUIRED API → FLOWS → RESPONSE
        
        This flow:
        1. Analyzes the prompt to understand intent
        2. Identifies which APIs/services are required
        3. Checks if required services are connected
        4. If all ready, generates the execution flow
        5. Returns comprehensive response with status
        """
        plan_id = str(uuid4())
        created_at = datetime.now(timezone.utc).isoformat()

        try:
            # Step 1: Analyze context
            context = await self.context_agent.run(request.prompt, request.integrations)
            logger.info(f"Context analysis complete: {context.intent}")

            # Step 2: Identify required APIs
            required_api = await self.required_api_agent.run(
                request.prompt,
                request.integrations,
            )
            logger.info(
                f"Required API analysis: {len(required_api.required_services)} services needed, "
                f"ready={required_api.all_services_ready}"
            )

            # Step 3: Check if we can proceed
            if not required_api.all_services_ready and not request.skip_connectivity_check:
                # Return early with connection requirements
                minimal_steps, minimal_edges = self._create_minimal_flow(
                    plan_id,
                    required_api,
                )
                return StreamlinedFlowResponse(
                    id=plan_id,
                    prompt=request.prompt,
                    createdAt=created_at,
                    required_api=required_api,
                    steps=minimal_steps,
                    edges=minimal_edges,
                    ready_to_execute=False,
                    blocked_reason=self._create_blocked_reason(required_api),
                    metadata={
                        "llm_used": self.gemini.enabled,
                        "llm_model": self.settings.gemini_model,
                        "context": {
                            "intent": context.intent,
                            "summary": context.summary,
                            "risk": context.risk,
                        },
                    },
                )

            # Step 4: Generate full flow (all services ready)
            # Filter integrations to only include required ones
            required_ids = {
                self._normalize_service_id(s.service_id)
                for s in required_api.required_services
            }
            filtered_integrations = [
                i for i in request.integrations 
                if self._normalize_service_id(i.id) in required_ids
            ]

            # Fallback to context-selected services only (never arbitrary connected services).
            if not filtered_integrations and context.target_service_ids:
                context_target_ids = {
                    self._normalize_service_id(service_id)
                    for service_id in context.target_service_ids
                }
                filtered_integrations = [
                    i
                    for i in request.integrations
                    if self._normalize_service_id(i.id) in context_target_ids
                ]

            planner = await self.planner_agent.run(
                request.prompt,
                filtered_integrations,
                context,
            )

            target_service_ids: List[str] = []
            seen_target_ids: set[str] = set()
            for raw_service_id in [*list(required_ids), *context.target_service_ids]:
                canonical_service_id = self._canonical_service_id(raw_service_id)
                if canonical_service_id in seen_target_ids:
                    continue
                seen_target_ids.add(canonical_service_id)
                target_service_ids.append(canonical_service_id)

            tool_selection = self.tool_selection_agent.run(
                prompt=request.prompt,
                integrations=filtered_integrations,
                target_service_ids=target_service_ids,
                available_tools=request.available_tools,
            )

            execution_plan = await self._build_specialized_execution_plan(
                prompt=request.prompt,
                target_service_ids=target_service_ids,
                available_tools=tool_selection.available_tools,
                context=context,
                required_api=required_api,
            )

            if not execution_plan.steps:
                execution_plan = await self.tool_planner_agent.run(
                    prompt=request.prompt,
                    available_tools=tool_selection.available_tools,
                    selected_tools=tool_selection.selected_tools,
                )

            validated_plan = self.json_guard_agent.run(
                execution_plan,
                tool_selection.available_tools,
            )

            connector_steps = await self.connector_agent.run(
                planner=planner,
                integrations=filtered_integrations,
                plan_id=plan_id,
                tool_plan=validated_plan,
            )

            # Step 5: Build final response
            flow_response = self.orchestrator_agent.run(
                plan_id=plan_id,
                prompt=request.prompt,
                context=context,
                required_api=required_api,
                planner=planner,
                connector_steps=connector_steps,
                tool_plan=validated_plan,
                llm_used=self.gemini.enabled,
                llm_model=self.settings.gemini_model,
            )

            return StreamlinedFlowResponse(
                id=flow_response.id,
                prompt=flow_response.prompt,
                createdAt=flow_response.created_at,
                required_api=required_api,
                steps=flow_response.steps,
                edges=flow_response.edges,
                toolPlan=validated_plan,
                ready_to_execute=True,
                blocked_reason=None,
                metadata={
                    **flow_response.metadata,
                    "context": {
                        "intent": context.intent,
                        "summary": context.summary,
                        "risk": context.risk,
                    },
                },
            )

        except Exception as e:
            logger.exception("Error in streamlined flow creation")
            # Return error response
            return StreamlinedFlowResponse(
                id=plan_id,
                prompt=request.prompt,
                createdAt=created_at,
                required_api=RequiredAPIResult(
                    required_services=[],
                    workflow_summary="Error analyzing request",
                ),
                steps=[],
                edges=[],
                ready_to_execute=False,
                blocked_reason=f"Error: {str(e)}",
                metadata={"error": str(e)},
            )

    def _create_minimal_flow(
        self,
        plan_id: str,
        required_api: RequiredAPIResult,
    ) -> tuple[list[AgentFlowStep], list[AgentFlowEdge]]:
        """Create the default 5-step flow while blocked on required connector APIs."""
        start_id = f"{plan_id}-start"
        context_id = f"{plan_id}-context"
        execution_id = f"{plan_id}-execution"
        end_id = f"{plan_id}-end"

        steps = [
            AgentFlowStep(
                id=start_id,
                label="PROMPT INGEST",
                description="Prompt received and validated",
                phase="start",
                level=0,
            ),
            AgentFlowStep(
                id=context_id,
                label="CONTEXT ANALYSIS",
                description="Analyze user intent and required connector APIs",
                phase="context-analysis",
                level=1,
            ),
        ]

        edges: list[AgentFlowEdge] = [
            AgentFlowEdge(
                id=f"edge-{start_id}-{context_id}",
                source=start_id,
                target=context_id,
            )
        ]

        api_check_ids: list[str] = []

        # Add per-service API key check steps.
        for service in required_api.required_services:
            status = "connected" if service.is_connected else "not connected"
            safe_service_id = "".join(
                ch if ch.isalnum() or ch in "-_" else "-"
                for ch in service.service_id
            )
            api_check_id = f"{plan_id}-api-{safe_service_id}"
            steps.append(
                AgentFlowStep(
                    id=api_check_id,
                    label=f"{service.service_name} API KEY CHECK",
                    description=f"{service.reason} ({status})",
                    phase="required-api",
                    level=2,
                    serviceId=service.service_id,
                    serviceName=service.service_name,
                    status="done" if service.is_connected else "failed",
                )
            )
            api_check_ids.append(api_check_id)
            edges.append(
                AgentFlowEdge(
                    id=f"edge-{context_id}-{api_check_id}",
                    source=context_id,
                    target=api_check_id,
                )
            )

        steps.append(
            AgentFlowStep(
                id=execution_id,
                label="EXECUTION FLOW AGENT",
                description="Blocked until required connector APIs are available",
                phase="orchestrator",
                level=4,
                status="skipped",
            )
        )

        if api_check_ids:
            for api_check_id in api_check_ids:
                edges.append(
                    AgentFlowEdge(
                        id=f"edge-{api_check_id}-{execution_id}",
                        source=api_check_id,
                        target=execution_id,
                    )
                )
        else:
            edges.append(
                AgentFlowEdge(
                    id=f"edge-{context_id}-{execution_id}",
                    source=context_id,
                    target=execution_id,
                )
            )

        steps.append(
            AgentFlowStep(
                id=end_id,
                label="FINAL RESPONSE AGENT",
                description="Return readiness summary and required API key actions",
                phase="end",
                level=5,
                status="skipped",
            )
        )

        edges.append(
            AgentFlowEdge(
                id=f"edge-{execution_id}-{end_id}",
                source=execution_id,
                target=end_id,
            )
        )

        return steps, edges

    def _create_blocked_reason(self, required_api: RequiredAPIResult) -> str:
        """Create a descriptive blocked reason."""
        reasons = []
        
        if required_api.missing_services:
            reasons.append(
                f"Missing services: {', '.join(required_api.missing_services)}"
            )
        
        if required_api.disconnected_services:
            reasons.append(
                f"Not connected: {', '.join(required_api.disconnected_services)}. "
                "Please connect these integrations first."
            )
        
        return " | ".join(reasons) if reasons else "Unknown blocking reason"

    async def create_flow(self, request: AgentFlowRequest) -> AgentFlowResponse:
        """Original flow creation for backward compatibility."""
        plan_id = str(uuid4())

        context = await self.context_agent.run(request.prompt, request.integrations)
        required_api = await self.required_api_agent.run(
            request.prompt,
            request.integrations,
        )
        planner = await self.planner_agent.run(request.prompt, request.integrations, context)
        tool_selection = self.tool_selection_agent.run(
            prompt=request.prompt,
            integrations=request.integrations,
            target_service_ids=context.target_service_ids,
            available_tools=request.available_tools,
        )
        execution_plan = await self.tool_planner_agent.run(
            prompt=request.prompt,
            available_tools=tool_selection.available_tools,
            selected_tools=tool_selection.selected_tools,
        )
        validated_execution_plan = self.json_guard_agent.run(
            execution_plan,
            tool_selection.available_tools,
        )

        connector_steps = await self.connector_agent.run(
            planner=planner,
            integrations=request.integrations,
            plan_id=plan_id,
            tool_plan=validated_execution_plan,
        )

        return self.orchestrator_agent.run(
            plan_id=plan_id,
            prompt=request.prompt,
            context=context,
            required_api=required_api,
            planner=planner,
            connector_steps=connector_steps,
            tool_plan=validated_execution_plan,
            llm_used=self.gemini.enabled,
            llm_model=self.settings.gemini_model,
        )
