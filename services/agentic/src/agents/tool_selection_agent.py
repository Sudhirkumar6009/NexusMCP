"""Select and normalize tool catalog for execution planning."""

from __future__ import annotations

import re
from typing import Dict, List

from .base_agent import BaseAgent
from ..models import IntegrationInput, ToolDefinition, ToolSelectionResult

ALL_CONNECTORS_REGEX = re.compile(
    r"all\s+(the\s+)?(connectors|integrations|services)|every\s+connector"
)


class ToolSelectionAgent(BaseAgent):
    name = "tool-selection-agent"

    def run(
        self,
        prompt: str,
        integrations: List[IntegrationInput],
        target_service_ids: List[str],
        available_tools: Dict[str, ToolDefinition],
    ) -> ToolSelectionResult:
        catalog = self._build_catalog(integrations, available_tools)

        if not catalog:
            return ToolSelectionResult()

        selected_tools = self._select_tools(
            prompt=prompt,
            integrations=integrations,
            target_service_ids=target_service_ids,
            catalog=catalog,
        )

        return ToolSelectionResult(
            available_tools=catalog,
            selected_tools=selected_tools,
        )

    def _build_catalog(
        self,
        integrations: List[IntegrationInput],
        available_tools: Dict[str, ToolDefinition],
    ) -> Dict[str, ToolDefinition]:
        catalog: Dict[str, ToolDefinition] = {}

        for tool_name, definition in available_tools.items():
            normalized_name = tool_name.strip()
            if not normalized_name:
                continue

            normalized_inputs = {
                str(key).strip(): str(value).strip()
                for key, value in definition.inputs.items()
                if str(key).strip()
            }

            catalog[normalized_name] = ToolDefinition(
                description=definition.description.strip(),
                inputs=normalized_inputs,
            )

        integration_by_id = {integration.id: integration for integration in integrations}
        for integration in integration_by_id.values():
            for raw_tool_name in integration.tools:
                tool_name = raw_tool_name.strip()
                if not tool_name:
                    continue

                qualified_name = (
                    tool_name if "." in tool_name else f"{integration.id}.{tool_name}"
                )
                if qualified_name in catalog:
                    continue

                catalog[qualified_name] = ToolDefinition(
                    description=f"Tool from {integration.name}",
                    inputs={},
                )

        return catalog

    def _select_tools(
        self,
        prompt: str,
        integrations: List[IntegrationInput],
        target_service_ids: List[str],
        catalog: Dict[str, ToolDefinition],
    ) -> List[str]:
        normalized_prompt = prompt.lower().strip()
        include_all = bool(ALL_CONNECTORS_REGEX.search(normalized_prompt))

        integration_ids = [integration.id for integration in integrations]
        allowed_service_ids = (
            set(target_service_ids)
            if target_service_ids
            else set(integration_ids)
        )

        candidate_tools = [
            tool_name
            for tool_name in catalog
            if self._tool_service_id(tool_name) in allowed_service_ids
        ]

        if not candidate_tools:
            return []

        scores = {
            tool_name: self._score_tool(normalized_prompt, tool_name, catalog[tool_name])
            for tool_name in candidate_tools
        }

        scored_tools = [
            tool_name for tool_name in candidate_tools if scores[tool_name] > 0
        ]
        if scored_tools and not include_all:
            return self._sort_by_score(scored_tools, scores)

        selected: List[str] = []
        for integration in integrations:
            if integration.id not in allowed_service_ids:
                continue

            service_tools = [
                tool_name
                for tool_name in candidate_tools
                if self._tool_service_id(tool_name) == integration.id
            ]
            if not service_tools:
                continue

            if scored_tools:
                service_scored = [
                    tool_name for tool_name in service_tools if scores[tool_name] > 0
                ]
                if service_scored:
                    selected.append(self._sort_by_score(service_scored, scores)[0])
                    continue

            selected.append(service_tools[0])

        if selected:
            return selected

        # Keep deterministic ordering when no scoring signal is present.
        return candidate_tools

    def _tool_service_id(self, tool_name: str) -> str:
        if "." in tool_name:
            return tool_name.split(".", 1)[0]

        # Fallback for non-qualified names.
        return tool_name.split("_", 1)[0]

    def _score_tool(
        self,
        normalized_prompt: str,
        tool_name: str,
        definition: ToolDefinition,
    ) -> int:
        prompt_tokens = [
            token
            for token in re.findall(r"[a-z0-9_/-]+", normalized_prompt)
            if len(token) > 2
        ]
        corpus = " ".join(
            [
                tool_name.lower(),
                definition.description.lower(),
                " ".join(definition.inputs.keys()).lower(),
            ]
        )

        score = 0
        for token in prompt_tokens:
            if token in corpus:
                score += 1

        return score

    def _sort_by_score(self, tools: List[str], scores: Dict[str, int]) -> List[str]:
        return sorted(
            tools,
            key=lambda tool_name: (-scores[tool_name], tool_name),
        )
