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
        execution_id = f"execution-{plan_id}"
        end_id = f"end-{plan_id}"

        normalized_connector_steps = [
            step.model_copy(update={"level": 3}) for step in connector_steps
        ]

        api_check_steps: List[AgentFlowStep] = []
        for index, service in enumerate(required_api.required_services):
            safe_service_id = "".join(
                ch if ch.isalnum() or ch in "-_" else "-"
                for ch in service.service_id
            )
            api_check_steps.append(
                AgentFlowStep(
                    id=f"api-check-{plan_id}-{safe_service_id}-{index}",
                    label=f"{service.service_name} API KEY CHECK",
                    description=(
                        f"{service.reason} "
                        f"({'connected' if service.is_connected else 'not connected'})"
                    ),
                    phase="required-api",
                    level=2,
                    serviceId=service.service_id,
                    serviceName=service.service_name,
                    status="done" if service.is_connected else "failed",
                )
            )

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
            *api_check_steps,
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
            )
        ]

        api_check_ids = [step.id for step in api_check_steps]
        api_check_by_service = {
            step.service_id: step.id
            for step in api_check_steps
            if step.service_id
        }

        if api_check_steps:
            for api_check_id in api_check_ids:
                edges.append(
                    AgentFlowEdge(
                        id=f"edge-{context_id}-{api_check_id}",
                        source=context_id,
                        target=api_check_id,
                    )
                )

        if normalized_connector_steps:
            for step in normalized_connector_steps:
                source_ids: List[str]
                if step.service_id and step.service_id in api_check_by_service:
                    source_ids = [api_check_by_service[step.service_id]]
                elif api_check_ids:
                    source_ids = api_check_ids
                else:
                    source_ids = [context_id]

                for source_id in source_ids:
                    edges.append(
                        AgentFlowEdge(
                            id=f"edge-{source_id}-{step.id}",
                            source=source_id,
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
