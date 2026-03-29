"""
Base MCP Connector interface and common utilities
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class ToolResultType(str, Enum):
    SUCCESS = "success"
    ERROR = "error"


@dataclass
class ToolResult:
    """Standard result format for MCP tool calls"""
    type: ToolResultType
    content: Any
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.utcnow)

    def to_mcp_response(self) -> Dict[str, Any]:
        """Convert to MCP JSON-RPC response format"""
        return {
            "content": [
                {
                    "type": "text",
                    "text": str(self.content) if self.type == ToolResultType.SUCCESS else self.error,
                }
            ],
            "isError": self.type == ToolResultType.ERROR,
        }


@dataclass
class ToolDefinition:
    """MCP tool definition"""
    name: str
    description: str
    input_schema: Dict[str, Any]


class MCPConnector(ABC):
    """
    Base class for MCP tool connectors.
    
    Each connector provides tools for a specific external service
    and handles authentication, rate limiting, and error handling.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self._initialized = False

    @property
    @abstractmethod
    def service_name(self) -> str:
        """Name of the service (e.g., 'jira', 'slack')"""
        pass

    @abstractmethod
    def get_tools(self) -> List[ToolDefinition]:
        """Return list of available tools"""
        pass

    @abstractmethod
    async def initialize(self) -> None:
        """Initialize connection to the service"""
        pass

    @abstractmethod
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> ToolResult:
        """Execute a tool call"""
        pass

    async def ensure_initialized(self) -> None:
        """Ensure connector is initialized before use"""
        if not self._initialized:
            await self.initialize()
            self._initialized = True

    def _make_success(self, content: Any, **metadata: Any) -> ToolResult:
        """Create a success result"""
        return ToolResult(
            type=ToolResultType.SUCCESS,
            content=content,
            metadata=metadata,
        )

    def _make_error(self, error: str, **metadata: Any) -> ToolResult:
        """Create an error result"""
        return ToolResult(
            type=ToolResultType.ERROR,
            content=None,
            error=error,
            metadata=metadata,
        )
