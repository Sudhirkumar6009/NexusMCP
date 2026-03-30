"""Data models shared across the agentic planner service."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


ConnectionStatus = Literal["connected", "disconnected", "error", "pending"]
AgentPhase = Literal[
    "start",
    "context-analysis",
    "required-api",
    "planning",
    "connector-agent",
    "execution",
    "orchestrator",
    "end",
]
StepStatus = Literal["pending", "running", "done", "failed", "skipped"]


class IntegrationInput(BaseModel):
    id: str
    name: str
    status: ConnectionStatus = "disconnected"
    enabled: bool = False
    tools: List[str] = Field(default_factory=list)


class ToolDefinition(BaseModel):
    description: str = ""
    inputs: Dict[str, str] = Field(default_factory=dict)


class ToolPlanStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    tool: str
    arguments: Dict[str, Any] = Field(default_factory=dict)


class ToolExecutionPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    steps: List[ToolPlanStep] = Field(default_factory=list)


class ToolSelectionResult(BaseModel):
    available_tools: Dict[str, ToolDefinition] = Field(default_factory=dict)
    selected_tools: List[str] = Field(default_factory=list)


class AgentFlowRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    integrations: List[IntegrationInput] = Field(default_factory=list)
    available_tools: Dict[str, ToolDefinition] = Field(
        default_factory=dict,
        alias="availableTools",
    )


class ContextAnalysisResult(BaseModel):
    intent: str
    summary: str
    risk: Literal["low", "medium", "high"] = "low"
    target_service_ids: List[str] = Field(default_factory=list)
    connector_reasoning: Dict[str, str] = Field(default_factory=dict)


class PlannerConnectorStep(BaseModel):
    service_id: str
    label: str
    description: str


class PlannerResult(BaseModel):
    context_summary: str
    connector_steps: List[PlannerConnectorStep] = Field(default_factory=list)
    orchestration_notes: str = ""


class AgentFlowStep(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    label: str
    description: str
    phase: AgentPhase
    level: int
    service_id: Optional[str] = Field(default=None, alias="serviceId")
    service_name: Optional[str] = Field(default=None, alias="serviceName")
    status: StepStatus = "pending"
    tool: Optional[str] = None
    arguments: Optional[Dict[str, Any]] = None


class AgentFlowEdge(BaseModel):
    id: str
    source: str
    target: str


class AgentFlowResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    prompt: str
    created_at: str = Field(alias="createdAt")
    steps: List[AgentFlowStep]
    edges: List[AgentFlowEdge]
    metadata: Dict[str, Any] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    status: str
    model: str
    llm_enabled: bool


# New models for Required API Agent
class RequiredService(BaseModel):
    """A service required to fulfill the user's request."""
    service_id: str
    service_name: str
    reason: str
    actions: List[str] = Field(default_factory=list)
    priority: int = 1
    is_connected: bool = False
    is_available: bool = True


class RequiredAPIResult(BaseModel):
    """Result of analyzing which APIs are required for a prompt."""
    model_config = ConfigDict(populate_by_name=True)
    
    required_services: List[RequiredService] = Field(default_factory=list)
    extracted_params: Dict[str, str] = Field(default_factory=dict)
    workflow_summary: str = ""
    all_services_ready: bool = False
    missing_services: List[str] = Field(default_factory=list)
    disconnected_services: List[str] = Field(default_factory=list)


class StreamlinedFlowRequest(BaseModel):
    """Request for the new streamlined flow generation."""
    prompt: str = Field(min_length=1, max_length=4000)
    integrations: List[IntegrationInput] = Field(default_factory=list)
    available_tools: Dict[str, ToolDefinition] = Field(
        default_factory=dict,
        alias="availableTools",
    )
    skip_connectivity_check: bool = False


class StreamlinedFlowResponse(BaseModel):
    """Response with required API check and generated flow."""
    model_config = ConfigDict(populate_by_name=True)
    
    id: str
    prompt: str
    created_at: str = Field(alias="createdAt")
    
    # Required API analysis
    required_api: RequiredAPIResult
    
    # Flow data (only if all services ready or skip_connectivity_check)
    steps: List[AgentFlowStep] = Field(default_factory=list)
    edges: List[AgentFlowEdge] = Field(default_factory=list)
    
    # Execution plan
    tool_plan: Optional[ToolExecutionPlan] = Field(default=None, alias="toolPlan")
    
    # Status
    ready_to_execute: bool = False
    blocked_reason: Optional[str] = None
    
    metadata: Dict[str, Any] = Field(default_factory=dict)


# ============================================================================
# Smart Execution Models - For LLM-powered dynamic workflow execution
# ============================================================================

class ExecutionLog(BaseModel):
    """A log entry for debugging."""
    timestamp: str
    level: Literal["debug", "info", "warn", "error"]
    stage: Literal["planning", "execution", "completion"]
    step_id: Optional[str] = None
    message: str
    details: Optional[Dict[str, Any]] = None


class SmartExecutionStep(BaseModel):
    """A step in the smart execution plan."""
    model_config = ConfigDict(populate_by_name=True)
    
    id: str
    tool: str
    arguments: Dict[str, Any] = Field(default_factory=dict)
    depends_on: List[str] = Field(default_factory=list)
    description: str = ""
    status: StepStatus = "pending"
    result: Optional[Any] = None
    error: Optional[str] = None
    started_at: Optional[str] = Field(default=None, alias="startedAt")
    completed_at: Optional[str] = Field(default=None, alias="completedAt")


class SmartExecutionPlan(BaseModel):
    """Complete execution plan generated by LLM."""
    steps: List[SmartExecutionStep] = Field(default_factory=list)
    workflow_type: Literal["sequential", "parallel", "mixed"] = "sequential"
    summary: str = ""
    extracted_params: Dict[str, str] = Field(default_factory=dict)


class SmartExecutionRequest(BaseModel):
    """Request for smart execution."""
    prompt: str = Field(min_length=1, max_length=4000)
    integrations: List[IntegrationInput] = Field(default_factory=list)
    available_tools: Dict[str, ToolDefinition] = Field(
        default_factory=dict,
        alias="availableTools",
    )
    execute: bool = False  # If True, also execute the plan


class SmartExecutionResponse(BaseModel):
    """Response from smart execution."""
    model_config = ConfigDict(populate_by_name=True)
    
    id: str
    prompt: str
    created_at: str = Field(alias="createdAt")
    
    # The generated plan
    plan: SmartExecutionPlan
    
    # Execution logs
    logs: List[ExecutionLog] = Field(default_factory=list)
    
    # Overall status
    overall_status: Literal["planned", "running", "completed", "partial", "failed"] = "planned"
    
    # Flow visualization data
    flow_steps: List[AgentFlowStep] = Field(default_factory=list, alias="flowSteps")
    flow_edges: List[AgentFlowEdge] = Field(default_factory=list, alias="flowEdges")
    
    # Execution results (if executed)
    results: Dict[str, Any] = Field(default_factory=dict)
    
    # Timing
    started_at: Optional[str] = Field(default=None, alias="startedAt")
    completed_at: Optional[str] = Field(default=None, alias="completedAt")
