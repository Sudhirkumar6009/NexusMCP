"""
DAG Executor - Core execution engine for workflow DAGs
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional
import logging

logger = logging.getLogger(__name__)


class NodeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    RETRYING = "retrying"
    WAITING_APPROVAL = "waiting_approval"
    SKIPPED = "skipped"


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


class DAGExecutor:
    """
    Executes DAG workflows with parallel node execution,
    retry logic, and approval gates.
    """

    def __init__(
        self,
        max_retries: int = 3,
        retry_delay: float = 1.0,
        node_timeout: float = 30.0,
    ):
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.node_timeout = node_timeout
        self._tool_handlers: Dict[str, Callable] = {}
        self._approval_callback: Optional[Callable] = None

    def register_tool(self, tool_name: str, handler: Callable) -> None:
        """Register a tool handler for execution"""
        self._tool_handlers[tool_name] = handler

    def set_approval_callback(self, callback: Callable) -> None:
        """Set callback for approval gate handling"""
        self._approval_callback = callback

    async def execute_dag(
        self,
        workflow_id: str,
        nodes: List[Dict[str, Any]],
        edges: List[Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None,
    ) -> ExecutionState:
        """
        Execute a DAG workflow.
        
        Args:
            workflow_id: Unique workflow identifier
            nodes: List of node definitions
            edges: List of edge definitions (source -> target)
            context: Initial context/payload data
            
        Returns:
            ExecutionState with results of all nodes
        """
        import uuid
        
        execution_id = str(uuid.uuid4())
        state = ExecutionState(
            execution_id=execution_id,
            workflow_id=workflow_id,
        )
        
        # Build execution layers (topological sort)
        layers = self._build_execution_layers(nodes, edges)
        
        # Execute layer by layer
        for layer_idx, layer_nodes in enumerate(layers):
            state.current_layer = layer_idx
            
            # Execute all nodes in layer in parallel
            tasks = [
                self._execute_node(node, state, context or {})
                for node in layer_nodes
            ]
            
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Process results
            for node, result in zip(layer_nodes, results):
                if isinstance(result, BaseException):
                    state.node_results[node["id"]] = NodeResult(
                        node_id=node["id"],
                        status=NodeStatus.FAILED,
                        error=str(result),
                    )
                    state.status = "failed"
                    break
                elif isinstance(result, NodeResult):
                    state.node_results[node["id"]] = result
                    
                    # Check for approval gate
                    if result.status == NodeStatus.WAITING_APPROVAL:
                        state.status = "paused"
                        return state
            
            if state.status == "failed":
                break
        
        state.completed_at = datetime.utcnow()
        if state.status == "running":
            state.status = "completed"
            
        return state

    async def _execute_node(
        self,
        node: Dict[str, Any],
        state: ExecutionState,
        context: Dict[str, Any],
    ) -> NodeResult:
        """Execute a single node with retry logic"""
        node_id = node["id"]
        node_type = node.get("type", "action")
        tool_name = node.get("tool")
        
        result = NodeResult(
            node_id=node_id,
            status=NodeStatus.RUNNING,
            started_at=datetime.utcnow(),
        )
        
        # Handle approval gate
        if node_type == "approval":
            result.status = NodeStatus.WAITING_APPROVAL
            return result
        
        # Execute tool
        for attempt in range(self.max_retries):
            try:
                result.retry_count = attempt
                
                if tool_name and tool_name in self._tool_handlers:
                    handler = self._tool_handlers[tool_name]
                    output = await asyncio.wait_for(
                        handler(node, context),
                        timeout=self.node_timeout,
                    )
                    result.output = output
                    result.status = NodeStatus.SUCCESS
                    break
                else:
                    # Mock execution for nodes without handlers
                    await asyncio.sleep(0.5)
                    result.output = {"mock": True}
                    result.status = NodeStatus.SUCCESS
                    break
                    
            except asyncio.TimeoutError:
                result.error = "Node execution timed out"
                result.status = NodeStatus.RETRYING
                await asyncio.sleep(self.retry_delay)
            except Exception as e:
                logger.exception(f"Error executing node {node_id}")
                result.error = str(e)
                result.status = NodeStatus.RETRYING
                await asyncio.sleep(self.retry_delay)
        
        if result.status == NodeStatus.RETRYING:
            result.status = NodeStatus.FAILED
            
        result.completed_at = datetime.utcnow()
        return result

    def _build_execution_layers(
        self,
        nodes: List[Dict[str, Any]],
        edges: List[Dict[str, Any]],
    ) -> List[List[Dict[str, Any]]]:
        """
        Build execution layers using topological sort.
        Nodes in the same layer can be executed in parallel.
        """
        # Build adjacency list and in-degree count
        node_map = {n["id"]: n for n in nodes}
        in_degree = {n["id"]: 0 for n in nodes}
        adjacency: Dict[str, List[str]] = {n["id"]: [] for n in nodes}
        
        for edge in edges:
            source = edge["source"]
            target = edge["target"]
            adjacency[source].append(target)
            in_degree[target] += 1
        
        # Kahn's algorithm for topological sort with layer grouping
        layers: List[List[Dict[str, Any]]] = []
        current_layer = [
            node_map[nid] for nid, deg in in_degree.items() if deg == 0
        ]
        
        while current_layer:
            layers.append(current_layer)
            next_layer_ids = []
            
            for node in current_layer:
                for neighbor_id in adjacency[node["id"]]:
                    in_degree[neighbor_id] -= 1
                    if in_degree[neighbor_id] == 0:
                        next_layer_ids.append(neighbor_id)
            
            current_layer = [node_map[nid] for nid in next_layer_ids]
        
        return layers
