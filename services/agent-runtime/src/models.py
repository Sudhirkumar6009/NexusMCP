"""
Data models for agent-runtime service
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional


class NodeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    RETRYING = "retrying"
    WAITING_APPROVAL = "waiting_approval"
    SKIPPED = "skipped"


class WorkflowStatus(str, Enum):
    DRAFT = "draft"
    READY = "ready"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class NodeResult:
    """Result of executing a single node"""
    node_id: str
    status: NodeStatus
    output: Any = None
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    retry_count: int = 0


@dataclass
class ExecutionState:
    """Current state of DAG execution"""
    execution_id: str
    workflow_id: str
    status: str = "running"
    current_layer: int = 0
    node_results: Dict[str, NodeResult] = field(default_factory=dict)
    started_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None


@dataclass
class DAGNode:
    """Node definition in a DAG"""
    id: str
    type: str  # trigger, action, condition, parallel, approval, end
    label: str
    service: Optional[str] = None
    tool: Optional[str] = None
    config: Dict[str, Any] = field(default_factory=dict)
    position: Dict[str, float] = field(default_factory=lambda: {"x": 0, "y": 0})
    

@dataclass
class DAGEdge:
    """Edge definition in a DAG"""
    id: str
    source: str
    target: str
    label: Optional[str] = None
    type: str = "default"  # default, success, failure


@dataclass
class DAGWorkflow:
    """Complete DAG workflow definition"""
    id: str
    name: str
    description: str
    nodes: List[DAGNode]
    edges: List[DAGEdge]
    status: WorkflowStatus = WorkflowStatus.DRAFT
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
