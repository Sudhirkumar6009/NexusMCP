"""Strict JSON plan validator to enforce schema and tool argument contracts."""

from __future__ import annotations

from typing import Dict, List

from .base_agent import BaseAgent
from ..models import ToolDefinition, ToolExecutionPlan, ToolPlanStep


class JsonGuardAgent(BaseAgent):
    name = "json-guard-agent"

    def run(
        self,
        plan: ToolExecutionPlan,
        allowed_tools: Dict[str, ToolDefinition],
    ) -> ToolExecutionPlan:
        validated_steps: List[ToolPlanStep] = []

        for index, step in enumerate(plan.steps, start=1):
            if step.tool not in allowed_tools:
                raise ValueError(f"Rejected invalid plan: unknown tool '{step.tool}'")

            allowed_arguments = set(allowed_tools[step.tool].inputs.keys())
            provided_arguments = set(step.arguments.keys())
            extra_arguments = provided_arguments - allowed_arguments
            if extra_arguments:
                raise ValueError(
                    "Rejected invalid plan: extra arguments for "
                    f"'{step.tool}': {sorted(extra_arguments)}"
                )

            validated_steps.append(
                ToolPlanStep(
                    id=str(index),
                    tool=step.tool,
                    arguments={
                        key: value
                        for key, value in step.arguments.items()
                        if key in allowed_arguments
                    },
                )
            )

        return ToolExecutionPlan(steps=validated_steps)
