"""
DAG Builder - Convert workflow plans to executable DAG structures
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import uuid

from .planner import WorkflowPlan, PlanStep


@dataclass
class DAGNode:
    """Node in the executable DAG"""
    id: str
    type: str  # trigger, action, condition, parallel, approval, end
    label: str
    service: Optional[str] = None
    tool: Optional[str] = None
    config: Dict[str, Any] = field(default_factory=dict)
    position: Dict[str, float] = field(default_factory=lambda: {"x": 0, "y": 0})


@dataclass
class DAGEdge:
    """Edge connecting DAG nodes"""
    id: str
    source: str
    target: str
    label: Optional[str] = None
    type: str = "default"


@dataclass
class DAG:
    """Complete executable DAG"""
    id: str
    name: str
    description: str
    nodes: List[DAGNode]
    edges: List[DAGEdge]


class DAGBuilder:
    """
    Builds executable DAG structures from workflow plans.
    Handles layout, edge creation, and validation.
    """

    def __init__(
        self,
        node_width: int = 180,
        node_height: int = 60,
        horizontal_gap: int = 50,
        vertical_gap: int = 120,
    ):
        self.node_width = node_width
        self.node_height = node_height
        self.horizontal_gap = horizontal_gap
        self.vertical_gap = vertical_gap

    def build(self, plan: WorkflowPlan) -> DAG:
        """
        Convert a workflow plan into an executable DAG.
        
        Args:
            plan: WorkflowPlan from the planner
            
        Returns:
            DAG with nodes and edges
        """
        dag_id = str(uuid.uuid4())[:8]
        nodes: List[DAGNode] = []
        edges: List[DAGEdge] = []
        
        # Track node positions by layer
        layer_positions: Dict[int, List[str]] = {}
        step_to_layer: Dict[str, int] = {}
        
        # Map steps to layers based on parallel groups
        for layer_idx, group in enumerate(plan.parallel_groups):
            layer_positions[layer_idx] = group
            for step_id in group:
                step_to_layer[step_id] = layer_idx
        
        # Create nodes
        for step in plan.steps:
            layer = step_to_layer.get(step.id, 0)
            position_in_layer = layer_positions[layer].index(step.id)
            total_in_layer = len(layer_positions[layer])
            
            # Calculate position
            x = self._calculate_x_position(position_in_layer, total_in_layer)
            y = self._calculate_y_position(layer)
            
            # Determine node type
            node_type = "trigger" if layer == 0 else "action"
            if step.requires_approval:
                node_type = "approval"
            
            node = DAGNode(
                id=step.id,
                type=node_type,
                label=step.description,
                service=step.service,
                tool=step.tool,
                config={"inputs": step.inputs, "outputs": step.outputs},
                position={"x": x, "y": y},
            )
            nodes.append(node)
        
        # Create edges based on parallel groups
        for layer_idx in range(len(plan.parallel_groups) - 1):
            current_group = plan.parallel_groups[layer_idx]
            next_group = plan.parallel_groups[layer_idx + 1]
            
            for source_id in current_group:
                for target_id in next_group:
                    source_step = next((s for s in plan.steps if s.id == source_id), None)
                    target_step = next((s for s in plan.steps if s.id == target_id), None)
                    
                    # Check if target depends on source
                    if self._has_dependency(source_step, target_step):
                        edge_label = self._get_edge_label(source_step, target_step)
                        edge = DAGEdge(
                            id=f"e_{source_id}_{target_id}",
                            source=source_id,
                            target=target_id,
                            label=edge_label,
                        )
                        edges.append(edge)
        
        # Add end node
        last_layer = max(layer_positions.keys())
        end_node = DAGNode(
            id="end",
            type="end",
            label="Complete",
            position={
                "x": self._calculate_x_position(0, 1),
                "y": self._calculate_y_position(last_layer + 1),
            },
        )
        nodes.append(end_node)
        
        # Connect last layer to end
        for step_id in layer_positions[last_layer]:
            edge = DAGEdge(
                id=f"e_{step_id}_end",
                source=step_id,
                target="end",
            )
            edges.append(edge)
        
        return DAG(
            id=dag_id,
            name=f"Workflow {dag_id}",
            description=plan.prompt,
            nodes=nodes,
            edges=edges,
        )

    def _calculate_x_position(self, position_in_layer: int, total_in_layer: int) -> float:
        """Calculate X position for a node in a layer"""
        total_width = total_in_layer * self.node_width + (total_in_layer - 1) * self.horizontal_gap
        start_x = 400 - total_width / 2
        return start_x + position_in_layer * (self.node_width + self.horizontal_gap) + self.node_width / 2

    def _calculate_y_position(self, layer: int) -> float:
        """Calculate Y position for a node in a layer"""
        return 60 + layer * self.vertical_gap

    def _has_dependency(self, source: Optional[PlanStep], target: Optional[PlanStep]) -> bool:
        """Check if target step depends on source step outputs"""
        if not source or not target:
            return True  # Default to connected if unknown
        
        # Check if any target input references source outputs
        for input_val in target.inputs.values():
            if isinstance(input_val, str) and f"{{{{{source.id}." in input_val:
                return True
        
        return True  # Default to connected for sequential execution

    def _get_edge_label(self, source: Optional[PlanStep], target: Optional[PlanStep]) -> Optional[str]:
        """Get label for edge based on data flow"""
        if not source or not target:
            return None
        
        # Find which output is used
        for input_val in target.inputs.values():
            if isinstance(input_val, str) and f"{{{{{source.id}." in input_val:
                # Extract field name
                start = input_val.find(f"{source.id}.") + len(source.id) + 1
                end = input_val.find("}}", start)
                if end > start:
                    return input_val[start:end]
        
        return None

    def to_dict(self, dag: DAG) -> Dict[str, Any]:
        """Convert DAG to dictionary for JSON serialization"""
        return {
            "id": dag.id,
            "name": dag.name,
            "description": dag.description,
            "nodes": [
                {
                    "id": n.id,
                    "type": n.type,
                    "label": n.label,
                    "service": n.service,
                    "tool": n.tool,
                    "config": n.config,
                    "position": n.position,
                }
                for n in dag.nodes
            ],
            "edges": [
                {
                    "id": e.id,
                    "source": e.source,
                    "target": e.target,
                    "label": e.label,
                    "type": e.type,
                }
                for e in dag.edges
            ],
        }
