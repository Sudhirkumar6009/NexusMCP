"""
Context Manager Service

Handles workflow execution context:
- State persistence between steps
- Payload transformation and routing
- Memory/history for agent reasoning
- Variable resolution ({{step.field}} syntax)
"""

from .context import ExecutionContext, ContextStore
from .payload import PayloadTransformer

__all__ = ["ExecutionContext", "ContextStore", "PayloadTransformer"]
