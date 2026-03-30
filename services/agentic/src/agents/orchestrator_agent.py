"""Orchestrator agent that assembles the final directed flow graph."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from .base_agent import BaseAgent
from ..models import (
    AgentFlowEdge,
    AgentFlowResponse,
    AgentFlowStep,
    ContextAnalysisResult,
    PlannerResult,
    RequiredAPIResult,
    ToolExecutionPlan,
)


class OrchestratorAgent(BaseAgent):
    name = "orchestrator-agent"

    def run(
        self,
        plan_id: str,
        prompt: str,
        context: ContextAnalysisResult,
        required_api: RequiredAPIResult,
        planner: PlannerResult,
        connector_steps: List[AgentFlowStep],
        tool_plan: ToolExecutionPlan,
        llm_used: bool,
        llm_model: str,
    ) -> AgentFlowResponse:
        start_id = f"start-{plan_id}"
        context_id = f"context-{plan_id}"
        required_api_id = f"required-api-{plan_id}"
        execution_id = f"execution-{plan_id}"
        end_id = f"end-{plan_id}"

        required_names = [service.service_name for service in required_api.required_services]
        if required_names:
            if required_api.all_services_ready:
                required_api_description = (
                    f"Required connector APIs available: {', '.join(required_names)}"
                )
            else:
                required_api_description = (
                    f"Missing connector APIs: {', '.join(required_api.disconnected_services)}"
                )
        else:
            required_api_description = "No connector API key required for this query"

        normalized_connector_steps = [
            step.model_copy(update={"level": 3}) for step in connector_steps
        ]

        steps: List[AgentFlowStep] = [
            AgentFlowStep(
                id=start_id,
                label="PROMPT INGEST",
                description="Capture user query and initialize agent pipeline",
                phase="start",
                level=0,
            ),
            AgentFlowStep(
                id=context_id,
                label="CONTEXT ANALYSIS",
                description="Analyze intent, dependencies, and required connector agents",
                phase="context-analysis",
                level=1,
            ),
            AgentFlowStep(
                id=required_api_id,
                label="CONNECTOR API KEY CHECK",
                description=required_api_description,
                phase="required-api",
                level=2,
            ),
            *normalized_connector_steps,
            AgentFlowStep(
                id=execution_id,
                label="EXECUTION FLOW AGENT",
                description="Generate and orchestrate the resolution flow for the user request",
                phase="orchestrator",
                level=4,
            ),
            AgentFlowStep(
                id=end_id,
                label="FINAL RESPONSE AGENT",
                description="Return execution summary and completion signal",
                phase="end",
                level=5,
            ),
        ]

        edges: List[AgentFlowEdge] = [
            AgentFlowEdge(
                id=f"edge-{start_id}-{context_id}",
                source=start_id,
                target=context_id,
            ),
            AgentFlowEdge(
                id=f"edge-{context_id}-{required_api_id}",
                source=context_id,
                target=required_api_id,
            )
        ]

        if normalized_connector_steps:
            for step in normalized_connector_steps:
                edges.append(
                    AgentFlowEdge(
                        id=f"edge-{required_api_id}-{step.id}",
                        source=required_api_id,
                        target=step.id,
                    )
                )
                edges.append(
                    AgentFlowEdge(
                        id=f"edge-{step.id}-{execution_id}",
                        source=step.id,
                        target=execution_id,
                    )
                )
        else:
            edges.append(
                AgentFlowEdge(
                    id=f"edge-{required_api_id}-{execution_id}",
                    source=required_api_id,
                    target=execution_id,
                )
            )

        edges.append(
            AgentFlowEdge(
                id=f"edge-{execution_id}-{end_id}",
                source=execution_id,
                target=end_id,
            )
        )

        return AgentFlowResponse(
            id=plan_id,
            prompt=prompt,
            createdAt=datetime.now(timezone.utc).isoformat(),
            steps=steps,
            edges=edges,
            metadata={
                "intent": context.intent,
                "risk": context.risk,
                "contextSummary": planner.context_summary,
                "requiredApi": required_api.model_dump(),
                "orchestrationNotes": planner.orchestration_notes,
                "executionPlan": tool_plan.model_dump(),
                "llmUsed": llm_used,
                "llmModel": llm_model,
            },
        )
