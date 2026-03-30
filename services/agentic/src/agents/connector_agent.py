"""Connector agent that transforms planner output into level-2 flow steps."""

from __future__ import annotations

from typing import Dict, List

from .base_agent import BaseAgent
from ..models import AgentFlowStep, IntegrationInput, PlannerResult, ToolExecutionPlan


class ConnectorAgent(BaseAgent):
    name = "connector-agent"

    async def run(
        self,
        planner: PlannerResult,
        integrations: List[IntegrationInput],
        plan_id: str,
        tool_plan: ToolExecutionPlan | None = None,
    ) -> List[AgentFlowStep]:
        integration_map: Dict[str, IntegrationInput] = {
            integration.id: integration for integration in integrations
        }

        if tool_plan and tool_plan.steps:
            service_to_tools: Dict[str, List[str]] = {}
            for step in tool_plan.steps:
                if "." not in step.tool:
                    continue

                service_id, _ = step.tool.split(".", 1)
                if service_id not in integration_map:
                    continue

                service_to_tools.setdefault(service_id, []).append(step.tool)

            if service_to_tools:
                tool_driven_steps: List[AgentFlowStep] = []
                for index, integration in enumerate(integrations):
                    service_tools = service_to_tools.get(integration.id)
                    if not service_tools:
                        continue

                    tool_list = ", ".join(service_tools)
                    tool_driven_steps.append(
                        AgentFlowStep(
                            id=f"connector-{integration.id}-{index}-{plan_id}",
                            label=f"{integration.name} Agent",
                            description=f"Execute selected tools: {tool_list}",
                            phase="connector-agent",
                            level=2,
                            serviceId=integration.id,
                            serviceName=integration.name,
                        )
                    )

                if tool_driven_steps:
                    return tool_driven_steps

        connector_steps: List[AgentFlowStep] = []
        for index, planner_step in enumerate(planner.connector_steps):
            integration = integration_map.get(planner_step.service_id)
            if not integration:
                continue

            connector_steps.append(
                AgentFlowStep(
                    id=f"connector-{integration.id}-{index}-{plan_id}",
                    label=planner_step.label or f"{integration.name} Agent",
                    description=(
                        planner_step.description
                        or f"Execute {integration.name} connector operations in parallel"
                    ),
                    phase="connector-agent",
                    level=2,
                    serviceId=integration.id,
                    serviceName=integration.name,
                )
            )

        if connector_steps:
            return connector_steps

        fallback_integrations = [
            integration for integration in integrations if integration.status == "connected"
        ]
        if not fallback_integrations:
            fallback_integrations = integrations[:3]

        for index, integration in enumerate(fallback_integrations):
            connector_steps.append(
                AgentFlowStep(
                    id=f"connector-{integration.id}-{index}-{plan_id}",
                    label=f"{integration.name} Agent",
                    description=f"Execute {integration.name} connector operations in parallel",
                    phase="connector-agent",
                    level=2,
                    serviceId=integration.id,
                    serviceName=integration.name,
                )
            )

        return connector_steps
