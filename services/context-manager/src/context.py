"""
Execution Context - State management for workflow execution
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional
import json
import logging
import re

logger = logging.getLogger(__name__)


@dataclass
class StepOutput:
    """Output from a workflow step"""
    step_id: str
    data: Dict[str, Any]
    timestamp: datetime = field(default_factory=datetime.utcnow)


@dataclass
class ExecutionContext:
    """
    Maintains state throughout workflow execution.
    Supports variable resolution and output chaining.
    """
    execution_id: str
    workflow_id: str
    trigger_data: Dict[str, Any] = field(default_factory=dict)
    step_outputs: Dict[str, StepOutput] = field(default_factory=dict)
    variables: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)

    def set_trigger_data(self, data: Dict[str, Any]) -> None:
        """Set the initial trigger payload"""
        self.trigger_data = data
        self.step_outputs["trigger"] = StepOutput(
            step_id="trigger",
            data=data,
        )

    def set_step_output(self, step_id: str, data: Dict[str, Any]) -> None:
        """Record output from a step"""
        self.step_outputs[step_id] = StepOutput(
            step_id=step_id,
            data=data,
        )

    def get_step_output(self, step_id: str) -> Optional[Dict[str, Any]]:
        """Get output from a specific step"""
        output = self.step_outputs.get(step_id)
        return output.data if output else None

    def resolve_value(self, value: Any) -> Any:
        """
        Resolve a value, replacing {{step.field}} references.
        
        Examples:
            "{{trigger.issue_id}}" -> "BUG-123"
            "Fix for {{trigger.title}}" -> "Fix for Login broken"
            {"key": "{{step1.result}}"} -> {"key": "actual_result"}
        """
        if isinstance(value, str):
            return self._resolve_string(value)
        elif isinstance(value, dict):
            return {k: self.resolve_value(v) for k, v in value.items()}
        elif isinstance(value, list):
            return [self.resolve_value(item) for item in value]
        return value

    def _resolve_string(self, s: str) -> Any:
        """Resolve template variables in a string"""
        # Pattern: {{step_id.field.nested_field}}
        pattern = r'\{\{(\w+)\.([^}]+)\}\}'
        
        # Check if entire string is a single variable reference
        match = re.fullmatch(pattern, s.strip())
        if match:
            step_id, field_path = match.groups()
            return self._get_nested_value(step_id, field_path)
        
        # Replace all variable references in string
        def replace_var(m: re.Match) -> str:
            step_id, field_path = m.groups()
            value = self._get_nested_value(step_id, field_path)
            return str(value) if value is not None else m.group(0)
        
        return re.sub(pattern, replace_var, s)

    def _get_nested_value(self, step_id: str, field_path: str) -> Any:
        """Get a nested value from step output"""
        output = self.step_outputs.get(step_id)
        if not output:
            return None
        
        data = output.data
        for key in field_path.split('.'):
            if isinstance(data, dict) and key in data:
                data = data[key]
            else:
                return None
        return data

    def to_dict(self) -> Dict[str, Any]:
        """Serialize context to dictionary"""
        return {
            "execution_id": self.execution_id,
            "workflow_id": self.workflow_id,
            "trigger_data": self.trigger_data,
            "step_outputs": {
                k: {"step_id": v.step_id, "data": v.data, "timestamp": v.timestamp.isoformat()}
                for k, v in self.step_outputs.items()
            },
            "variables": self.variables,
            "created_at": self.created_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ExecutionContext:
        """Deserialize context from dictionary"""
        ctx = cls(
            execution_id=data["execution_id"],
            workflow_id=data["workflow_id"],
            trigger_data=data.get("trigger_data", {}),
            variables=data.get("variables", {}),
        )
        for k, v in data.get("step_outputs", {}).items():
            ctx.step_outputs[k] = StepOutput(
                step_id=v["step_id"],
                data=v["data"],
                timestamp=datetime.fromisoformat(v["timestamp"]),
            )
        return ctx


class ContextStore:
    """
    Persistent storage for execution contexts.
    Uses Redis for distributed state management.
    """

    def __init__(self, redis_url: Optional[str] = None):
        self.redis_url = redis_url
        self._client = None
        self._local_store: Dict[str, ExecutionContext] = {}  # Fallback

    async def initialize(self) -> None:
        """Initialize Redis connection"""
        if self.redis_url:
            # Would initialize redis.asyncio.Redis here
            pass
        logger.info("Context store initialized")

    async def save(self, context: ExecutionContext) -> None:
        """Save execution context"""
        if self._client:
            await self._client.set(
                f"context:{context.execution_id}",
                json.dumps(context.to_dict()),
                ex=86400,  # 24 hour TTL
            )
        else:
            self._local_store[context.execution_id] = context

    async def load(self, execution_id: str) -> Optional[ExecutionContext]:
        """Load execution context"""
        if self._client:
            data = await self._client.get(f"context:{execution_id}")
            if data:
                return ExecutionContext.from_dict(json.loads(data))
            return None
        return self._local_store.get(execution_id)

    async def delete(self, execution_id: str) -> None:
        """Delete execution context"""
        if self._client:
            await self._client.delete(f"context:{execution_id}")
        else:
            self._local_store.pop(execution_id, None)
