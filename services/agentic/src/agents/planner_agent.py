"""Planner agent that proposes connector-level execution steps."""

from __future__ import annotations

from typing import Dict, List

from .base_agent import BaseAgent
from ..gemini_client import GeminiClient
from ..models import ContextAnalysisResult, IntegrationInput, PlannerConnectorStep, PlannerResult


PLANNER_SYSTEM_PROMPT = """
You are the Planner Agent in a multi-agent workflow system.
Given user prompt, context summary, and available integrations, produce JSON:
{
  "context_summary": "string",
  "connector_steps": [
    {
      "service_id": "integration id",
      "label": "<Service> Agent",
      "description": "short action summary"
    }
  ],
  "orchestration_notes": "string"
}
Rules:
- Use only listed integrations.
- Never include a service that context.target_service_ids excludes.
- connector_steps should be suitable for parallel level-2 execution.
- Keep descriptions concise and action-oriented.
""".strip()


class PlannerAgent(BaseAgent):
    name = "planner-agent"

    def __init__(self, gemini: GeminiClient):
        self.gemini = gemini

    async def run(
        self,
        prompt: str,
        integrations: List[IntegrationInput],
        context: ContextAnalysisResult,
    ) -> PlannerResult:
        if self.gemini.enabled:
            try:
                response_json = await self.gemini.generate_json(
                    PLANNER_SYSTEM_PROMPT,
                    {
                        "prompt": prompt,
                        "context": context.model_dump(),
                        "integrations": [
                            {
                                "id": integration.id,
                                "name": integration.name,
                                "status": integration.status,
                                "enabled": integration.enabled,
                                "tools": integration.tools,
                            }
                            for integration in integrations
                        ],
                    },
                )
                llm_result = PlannerResult.model_validate(response_json)
                return self._sanitize_result(llm_result, integrations, context)
            except Exception:
                pass

        return self._heuristic(integrations, context)

    def _sanitize_result(
        self,
        result: PlannerResult,
        integrations: List[IntegrationInput],
        context: ContextAnalysisResult,
    ) -> PlannerResult:
        integration_map: Dict[str, IntegrationInput] = {
            integration.id: integration for integration in integrations
        }
        allowed_ids = set(context.target_service_ids)

        connector_steps: List[PlannerConnectorStep] = []
        seen_ids: set[str] = set()

        for step in result.connector_steps:
            if step.service_id in seen_ids or step.service_id not in allowed_ids:
                continue
            integration = integration_map.get(step.service_id)
            if not integration:
                continue

            connector_steps.append(
                PlannerConnectorStep(
                    service_id=step.service_id,
                    label=step.label or f"{integration.name} Agent",
                    description=(
                        step.description
                        or f"Run {integration.name} connector tasks for the request"
                    ),
                )
            )
            seen_ids.add(step.service_id)

        if not connector_steps:
            return self._heuristic(integrations, context)

        return PlannerResult(
            context_summary=result.context_summary or context.summary,
            connector_steps=connector_steps,
            orchestration_notes=result.orchestration_notes or "Merge branch outputs and validate consistency",
        )

    def _heuristic(
        self,
        integrations: List[IntegrationInput],
        context: ContextAnalysisResult,
    ) -> PlannerResult:
        integration_map: Dict[str, IntegrationInput] = {
            integration.id: integration for integration in integrations
        }

        connector_steps: List[PlannerConnectorStep] = []
        for service_id in context.target_service_ids:
            integration = integration_map.get(service_id)
            if not integration:
                continue

            connector_steps.append(
                PlannerConnectorStep(
                    service_id=service_id,
                    label=f"{integration.name} Agent",
                    description=f"Execute {integration.name} connector operations",
                )
            )

        return PlannerResult(
            context_summary=context.summary,
            connector_steps=connector_steps,
            orchestration_notes="Merge connector outputs and halt on any branch failure",
        )
