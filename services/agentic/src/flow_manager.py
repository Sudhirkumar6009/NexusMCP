"""High-level flow orchestration across agent roles."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4
from typing import Optional
import logging

from .agents.connector_agent import ConnectorAgent
from .agents.context_agent import ContextAnalysisAgent
from .agents.json_guard_agent import JsonGuardAgent
from .agents.orchestrator_agent import OrchestratorAgent
from .agents.planner_agent import PlannerAgent
from .agents.required_api_agent import RequiredAPIAgent
from .agents.tool_planner_agent import ToolPlannerAgent
from .agents.tool_selection_agent import ToolSelectionAgent
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
    ToolExecutionPlan,
)

logger = logging.getLogger(__name__)


class FlowManager:
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

    @staticmethod
    def _normalize_service_id(service_id: str) -> str:
        return service_id.replace("int-", "").strip().lower()

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

            tool_selection = self.tool_selection_agent.run(
                prompt=request.prompt,
                integrations=filtered_integrations,
                target_service_ids=context.target_service_ids or list(required_ids),
                available_tools=request.available_tools,
            )

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
