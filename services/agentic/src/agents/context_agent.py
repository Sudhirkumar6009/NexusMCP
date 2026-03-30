"""Context analysis agent backed by Gemini with deterministic fallback."""

from __future__ import annotations

import re
from typing import Dict, List

from .base_agent import BaseAgent
from ..gemini_client import GeminiClient
from ..models import ContextAnalysisResult, IntegrationInput


CONNECTOR_KEYWORDS: Dict[str, List[str]] = {
    "jira": ["jira", "ticket", "issue"],
    "slack": ["slack", "channel", "message", "notify"],
    "github": ["github", "pull request", "pr", "repository", "branch"],
    "google_sheets": ["sheet", "sheets", "spreadsheet", "row", "cell"],
    "gmail": ["gmail", "email", "mail", "inbox"],
    "aws": ["aws", "cloud", "lambda", "stack", "infrastructure"],
}

CONNECTOR_ALIASES: Dict[str, List[str]] = {
    "jira": ["jira"],
    "slack": ["slack"],
    "github": ["github"],
    "google_sheets": ["google sheets", "google_sheets", "sheets"],
    "gmail": ["gmail", "google mail"],
    "aws": ["aws", "amazon web services"],
}

EXCLUSION_TERMS = ("skip", "exclude", "except", "without", "omit", "ignore")
ALL_CONNECTORS_REGEX = re.compile(
    r"all\s+(the\s+)?(connectors|integrations|services)|every\s+connector"
)


CONTEXT_SYSTEM_PROMPT = """
You are the Context Analysis Agent in a multi-agent workflow system.
Return JSON with this exact schema:
{
  "intent": "string",
  "summary": "string",
  "risk": "low|medium|high",
  "target_service_ids": ["service_id"],
  "connector_reasoning": {
    "service_id": "short reason"
  }
}
Rules:
- target_service_ids must only include integrations listed in input.
- If prompt asks for all connectors/integrations/services, include every available integration except explicit exclusions.
- If prompt says skip/exclude/without a service, never include that service.
- Keep summary under 180 chars.
- Select services that are relevant to user intent.
- Use risk=high if prompt requests destructive actions.
""".strip()


class ContextAnalysisAgent(BaseAgent):
    name = "context-analysis-agent"

    def __init__(self, gemini: GeminiClient):
        self.gemini = gemini

    async def run(self, prompt: str, integrations: List[IntegrationInput]) -> ContextAnalysisResult:
        if self.gemini.enabled:
            try:
                response_json = await self.gemini.generate_json(
                    CONTEXT_SYSTEM_PROMPT,
                    {
                        "prompt": prompt,
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
                llm_result = ContextAnalysisResult.model_validate(response_json)
                return self._sanitize_result(llm_result, integrations, prompt)
            except Exception:
                pass

        return self._heuristic(prompt, integrations)

    def _sanitize_result(
        self,
        result: ContextAnalysisResult,
        integrations: List[IntegrationInput],
        prompt: str,
    ) -> ContextAnalysisResult:
        available_ids = {integration.id for integration in integrations}
        excluded_ids = self._extract_excluded_services(prompt, integrations)
        include_all = self._has_all_connectors_directive(prompt)
        explicit_ids = self._extract_explicit_services(
            prompt,
            integrations,
            excluded_ids,
        )
        keyword_ids = self._extract_keyword_services(
            prompt,
            integrations,
            excluded_ids,
        )

        if include_all:
            filtered_ids = [
                integration.id
                for integration in integrations
                if integration.id in available_ids and integration.id not in excluded_ids
            ]
        else:
            filtered_ids = [
                service_id
                for service_id in result.target_service_ids
                if service_id in available_ids and service_id not in excluded_ids
            ]
            if explicit_ids:
                for service_id in explicit_ids:
                    if service_id not in filtered_ids and service_id not in excluded_ids:
                        filtered_ids.append(service_id)
            elif keyword_ids:
                keyword_id_set = set(keyword_ids)
                filtered_ids = [
                    service_id for service_id in filtered_ids if service_id in keyword_id_set
                ]
            else:
                available_non_excluded = [
                    integration.id
                    for integration in integrations
                    if integration.id in available_ids and integration.id not in excluded_ids
                ]
                if len(filtered_ids) == len(available_non_excluded):
                    filtered_ids = []

        if not filtered_ids:
            if include_all:
                filtered_ids = [
                    integration.id
                    for integration in integrations
                    if integration.id in available_ids and integration.id not in excluded_ids
                ]
            elif explicit_ids:
                filtered_ids = explicit_ids
            elif keyword_ids:
                filtered_ids = keyword_ids

        if filtered_ids and not include_all and not explicit_ids and keyword_ids:
            keyword_set = set(keyword_ids)
            for integration in integrations:
                if integration.id in excluded_ids:
                    continue
                if integration.id in keyword_set and integration.id not in filtered_ids:
                    filtered_ids.append(integration.id)

        connector_reasoning: Dict[str, str] = {}
        for service_id in filtered_ids:
            llm_reason = result.connector_reasoning.get(service_id)
            if llm_reason:
                connector_reasoning[service_id] = llm_reason
                continue

            if include_all:
                connector_reasoning[service_id] = "Included by all-connectors directive"
            else:
                connector_reasoning[service_id] = "Selected by prompt and availability"

        return ContextAnalysisResult(
            intent=result.intent,
            summary=result.summary[:180],
            risk=result.risk,
            target_service_ids=filtered_ids,
            connector_reasoning=connector_reasoning,
        )

    def _heuristic(self, prompt: str, integrations: List[IntegrationInput]) -> ContextAnalysisResult:
        normalized = prompt.lower().strip()
        excluded_ids = self._extract_excluded_services(prompt, integrations)
        include_all = self._has_all_connectors_directive(prompt)
        explicit_ids = self._extract_explicit_services(
            prompt,
            integrations,
            excluded_ids,
        )

        target_service_ids: List[str] = []
        if include_all:
            target_service_ids = [
                integration.id
                for integration in integrations
                if integration.id not in excluded_ids
            ]
        elif explicit_ids:
            target_service_ids = explicit_ids
        else:
            target_service_ids = self._extract_keyword_services(
                prompt,
                integrations,
                excluded_ids,
            )

        risk = "low"
        if any(term in normalized for term in ["delete", "remove", "destroy", "production"]):
            risk = "high"
        elif any(term in normalized for term in ["update", "modify", "change", "merge"]):
            risk = "medium"

        connector_reasoning = {
            service_id: (
                "Included by all-connectors directive"
                if include_all
                else "Selected by prompt and availability"
            )
            for service_id in target_service_ids
        }

        return ContextAnalysisResult(
            intent="integration_orchestration",
            summary=prompt.strip()[:180],
            risk=risk,
            target_service_ids=target_service_ids,
            connector_reasoning=connector_reasoning,
        )

    def _extract_excluded_services(
        self,
        prompt: str,
        integrations: List[IntegrationInput],
    ) -> set[str]:
        normalized = prompt.lower().strip()
        if not any(term in normalized for term in EXCLUSION_TERMS):
            return set()

        exclusion_pattern = "|".join(EXCLUSION_TERMS)
        excluded: set[str] = set()

        for integration in integrations:
            aliases = {
                integration.id,
                integration.id.replace("_", " "),
                integration.name.lower(),
                *CONNECTOR_ALIASES.get(integration.id, []),
                *CONNECTOR_KEYWORDS.get(integration.id, []),
            }

            for alias in aliases:
                escaped_alias = re.escape(alias)
                exclude_then_alias = re.search(
                    rf"\b(?:{exclusion_pattern})\b[^.\n,;:]*\b{escaped_alias}\b",
                    normalized,
                )
                alias_then_exclude = re.search(
                    rf"\b{escaped_alias}\b[^.\n,;:]*\b(?:{exclusion_pattern})\b",
                    normalized,
                )

                if exclude_then_alias or alias_then_exclude:
                    excluded.add(integration.id)
                    break

        return excluded

    def _extract_explicit_services(
        self,
        prompt: str,
        integrations: List[IntegrationInput],
        excluded_ids: set[str],
    ) -> List[str]:
        normalized = prompt.lower().strip()
        explicit: set[str] = set()

        for integration in integrations:
            if integration.id in excluded_ids:
                continue

            aliases = {
                integration.id,
                integration.id.replace("_", " "),
                integration.name.lower(),
                *CONNECTOR_ALIASES.get(integration.id, []),
            }

            for alias in aliases:
                if re.search(rf"\b{re.escape(alias)}\b", normalized):
                    explicit.add(integration.id)
                    break

        return [
            integration.id
            for integration in integrations
            if integration.id in explicit and integration.id not in excluded_ids
        ]

    def _has_all_connectors_directive(self, prompt: str) -> bool:
        return bool(ALL_CONNECTORS_REGEX.search(prompt.lower().strip()))

    def _extract_keyword_services(
        self,
        prompt: str,
        integrations: List[IntegrationInput],
        excluded_ids: set[str],
    ) -> List[str]:
        normalized = prompt.lower().strip()
        available_ids = {integration.id for integration in integrations}
        matched: List[str] = []

        for service_id, keywords in CONNECTOR_KEYWORDS.items():
            if service_id not in available_ids or service_id in excluded_ids:
                continue
            if any(keyword in normalized for keyword in keywords):
                matched.append(service_id)

        return matched
