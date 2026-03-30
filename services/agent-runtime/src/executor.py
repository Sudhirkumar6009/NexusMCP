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
import re

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
    resolved_arguments: Dict[str, Any] = field(default_factory=dict)
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
        fail_fast: bool = False,
    ):
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.node_timeout = node_timeout
        self.fail_fast = fail_fast
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
        shared_context = self._initialize_context(context)
        
        # Build execution layers (topological sort)
        layers = self._build_execution_layers(nodes, edges)
        
        # Execute layer by layer
        had_failures = False
        for layer_idx, layer_nodes in enumerate(layers):
            state.current_layer = layer_idx
            
            # Execute all nodes in layer in parallel
            tasks = [
                self._execute_node(node, state, shared_context)
                for node in layer_nodes
            ]
            
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Process results
            layer_failed = False
            for node, result in zip(layer_nodes, results):
                if isinstance(result, BaseException):
                    state.node_results[node["id"]] = NodeResult(
                        node_id=node["id"],
                        status=NodeStatus.FAILED,
                        error=str(result),
                    )
                    layer_failed = True
                    had_failures = True
                    if self.fail_fast:
                        break
                elif isinstance(result, NodeResult):
                    state.node_results[node["id"]] = result

                    if result.status == NodeStatus.FAILED:
                        layer_failed = True
                        had_failures = True
                        if self.fail_fast:
                            break

                    if result.status == NodeStatus.SUCCESS:
                        self._persist_step_output(
                            context=shared_context,
                            node=node,
                            result=result,
                        )
                    
                    # Check for approval gate
                    if result.status == NodeStatus.WAITING_APPROVAL:
                        state.status = "paused"
                        return state
            
            if layer_failed:
                state.status = "failed"

            if self.fail_fast and layer_failed:
                break
        
        state.completed_at = datetime.utcnow()
        if state.status == "running" and not had_failures:
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
        resolved_node = self._resolve_node_templates(node, context)
        resolved_arguments = resolved_node.get("arguments")
        
        result = NodeResult(
            node_id=node_id,
            status=NodeStatus.RUNNING,
            resolved_arguments=resolved_arguments
            if isinstance(resolved_arguments, dict)
            else {},
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
                        handler(resolved_node, context),
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

    def _initialize_context(self, context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        base_context = dict(context or {})
        existing_nested_context = base_context.get("context")
        nested_context = (
            dict(existing_nested_context)
            if isinstance(existing_nested_context, dict)
            else {}
        )

        timestamp_value = base_context.get("timestamp")
        if timestamp_value is None:
            timestamp_value = int(datetime.utcnow().timestamp())

        shared_context: Dict[str, Any] = {
            **base_context,
            "input": {k: v for k, v in base_context.items() if k != "context"},
            "context": nested_context,
            "timestamp": timestamp_value,
        }
        return shared_context

    def _resolve_node_templates(
        self,
        node: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        resolved_node = dict(node)

        if isinstance(node.get("arguments"), dict):
            resolved_node["arguments"] = self._resolve_templates(
                node["arguments"],
                context,
            )

        config = node.get("config")
        if isinstance(config, dict):
            resolved_config = dict(config)
            if isinstance(config.get("inputs"), dict):
                resolved_config["inputs"] = self._resolve_templates(
                    config["inputs"],
                    context,
                )
            else:
                resolved_config = self._resolve_templates(config, context)
            resolved_node["config"] = resolved_config

        return resolved_node

    def _resolve_templates(self, value: Any, context: Dict[str, Any]) -> Any:
        if isinstance(value, str):
            return self._resolve_template_string(value, context)
        if isinstance(value, dict):
            return {k: self._resolve_templates(v, context) for k, v in value.items()}
        if isinstance(value, list):
            return [self._resolve_templates(item, context) for item in value]
        return value

    def _resolve_template_string(self, value: str, context: Dict[str, Any]) -> Any:
        pattern = r"\{\{\s*([^{}]+?)\s*\}\}"

        full_match = re.fullmatch(pattern, value)
        if full_match:
            looked_up = self._lookup_context_value(full_match.group(1), context)
            return looked_up if looked_up is not None else value

        def _replace(match: re.Match[str]) -> str:
            expression = match.group(1)
            looked_up = self._lookup_context_value(expression, context)
            if looked_up is None:
                return match.group(0)
            return str(looked_up)

        return re.sub(pattern, _replace, value)

    def _lookup_context_value(self, expression: str, context: Dict[str, Any]) -> Any:
        tokens = [token for token in expression.strip().split(".") if token]
        if not tokens:
            return None

        current: Any = context
        for token in tokens:
            if isinstance(current, dict) and token in current:
                current = current[token]
                continue
            return None

        return current

    def _persist_step_output(
        self,
        context: Dict[str, Any],
        node: Dict[str, Any],
        result: NodeResult,
    ) -> None:
        node_output = self._normalize_output_payload(
            result.output,
            result.resolved_arguments,
        )

        output_key = None
        if isinstance(node.get("output_key"), str) and node["output_key"].strip():
            output_key = node["output_key"].strip()
        elif isinstance(node.get("config"), dict):
            config_output_key = node["config"].get("output_key")
            if isinstance(config_output_key, str) and config_output_key.strip():
                output_key = config_output_key.strip()

        step_id = str(node.get("id", ""))
        context_bucket = context.setdefault("context", {})
        if isinstance(context_bucket, dict):
            if output_key:
                context_bucket[output_key] = node_output
                context[output_key] = node_output
            if step_id:
                context_bucket[step_id] = node_output
                context[step_id] = node_output

    def _normalize_output_payload(
        self,
        output: Any,
        resolved_arguments: Dict[str, Any],
    ) -> Dict[str, Any]:
        normalized: Dict[str, Any]
        if isinstance(output, dict):
            normalized = dict(output)
        else:
            normalized = {"value": output}

        if "branch" in normalized and "branch_name" not in normalized:
            normalized["branch_name"] = normalized["branch"]

        resolved_branch_name = resolved_arguments.get("branch_name")
        if (
            isinstance(resolved_branch_name, str)
            and resolved_branch_name
            and "branch_name" not in normalized
        ):
            normalized["branch_name"] = resolved_branch_name

        return normalized

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
