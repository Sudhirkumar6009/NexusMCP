"""FastAPI service for Gemini-backed agentic workflow planning."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import uuid4
from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .config import get_settings
from .flow_manager import FlowManager
from .gemini_client import GeminiClient
from .agents.smart_orchestrator import SmartOrchestrator
from .agents.default_flow_orchestrator import DefaultFlowOrchestrator, DefaultFlowResponse
from .agents.event_workflow_orchestrator import EventWorkflowOrchestrator
from .models import (
    AgentFlowRequest,
    AgentFlowResponse,
    AgentFlowStep,
    AgentFlowEdge,
    HealthResponse,
    StreamlinedFlowRequest,
    StreamlinedFlowResponse,
    SmartExecutionRequest,
    SmartExecutionResponse,
    SmartExecutionPlan,
    SmartExecutionStep,
    IntegrationInput,
    ToolDefinition,
    EventWorkflowRequest,
    EventWorkflowPlan,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

settings = get_settings()
flow_manager = FlowManager(settings)
gemini_client = GeminiClient(
    api_key=settings.gemini_api_key,
    model=settings.gemini_model,
    timeout_seconds=settings.request_timeout_seconds,
)

# Initialize default flow orchestrator
default_flow_orchestrator = DefaultFlowOrchestrator(gemini_client)
event_workflow_orchestrator = EventWorkflowOrchestrator()

app = FastAPI(title="NexusMCP Agentic Service", version="0.3.0")


# =============================================================================
# Request/Response Models for Default Flow
# =============================================================================

class DefaultFlowRequest(BaseModel):
    """Request for default flow execution."""
    prompt: str = Field(min_length=1, max_length=4000)
    integrations: list[IntegrationInput] = Field(default_factory=list)
    available_tools: Dict[str, ToolDefinition] = Field(
        default_factory=dict,
        alias="availableTools",
    )


# =============================================================================
# Endpoints
# =============================================================================

@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", model=settings.gemini_model, llm_enabled=bool(settings.gemini_api_key))


@app.post("/agentic/default-flow")
async def default_flow(request: DefaultFlowRequest) -> DefaultFlowResponse:
    """
    DEFAULT FLOW ENDPOINT - Standard 5-step flow for ALL queries.
    
    Flow Structure:
    ┌─────────────────────────────────────────────────────────────┐
    │  1. PROMPT INGEST                                           │
    │     └─ Receive and validate user query                      │
    ├─────────────────────────────────────────────────────────────┤
    │  2. CONTEXT ANALYSIS                                        │
    │     └─ Understand intent, extract parameters                │
    │     └─ Detect required services (jira, github, slack, etc.) │
    ├─────────────────────────────────────────────────────────────┤
    │  3. CONNECTOR CHECK                                         │
    │     └─ Check if required API keys are available             │
    │     └─ If missing → return BLOCKED status                   │
    ├─────────────────────────────────────────────────────────────┤
    │  4. EXECUTION FLOW                                          │
    │     └─ Generate resolution steps using connector agents      │
    │     └─ Jira, GitHub, Slack, Google Sheets, Gmail workflows   │
    ├─────────────────────────────────────────────────────────────┤
    │  5. FINAL RESPONSE                                          │
    │     └─ Compile results and return to user                   │
    └─────────────────────────────────────────────────────────────┘
    
    Example Query: "Create branch and pull request for Jira issue KAN-3 in repo backend"
    
    Response includes:
    - Step-by-step status (pending → running → done/failed)
    - Flow visualization data for UI
    - Execution logs for debugging
    - Blocked status if connectors missing
    """
    try:
        logger.info(f"Default flow request: {request.prompt[:100]}...")
        
        result = await default_flow_orchestrator.run(
            prompt=request.prompt,
            integrations=request.integrations,
            available_tools=request.available_tools,
        )
        
        logger.info(f"Default flow completed: status={result.overall_status}")
        return result
        
    except Exception as exc:
        logger.exception(f"Default flow failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Default flow failed: {exc}") from exc


@app.post("/agentic/event-workflow", response_model=EventWorkflowPlan)
async def event_workflow(request: EventWorkflowRequest) -> EventWorkflowPlan:
    """Generate a deterministic DAG from an incoming event source."""
    try:
        return event_workflow_orchestrator.build_plan(request.event)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(f"Event workflow planning failed: {exc}")
        raise HTTPException(
            status_code=500,
            detail=f"Event workflow planning failed: {exc}",
        ) from exc


@app.post("/agentic/flow", response_model=AgentFlowResponse)
async def create_agentic_flow(request: AgentFlowRequest) -> AgentFlowResponse:
    """Original flow endpoint for backward compatibility."""
    try:
        return await flow_manager.create_flow(request)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create flow: {exc}") from exc


@app.post("/agentic/streamlined-flow", response_model=StreamlinedFlowResponse)
async def create_streamlined_flow(request: StreamlinedFlowRequest) -> StreamlinedFlowResponse:
    """
    Streamlined flow endpoint.
    
    Flow: PROMPT → CONTEXT → REQUIRED API → FLOWS → RESPONSE
    """
    try:
        return await flow_manager.create_streamlined_flow(request)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create streamlined flow: {exc}") from exc


@app.post("/agentic/smart-execute", response_model=SmartExecutionResponse)
async def smart_execute(request: SmartExecutionRequest) -> SmartExecutionResponse:
    """
    Smart execution endpoint - LLM-powered dynamic workflow.
    """
    plan_id = str(uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    
    try:
        logger.info(f"Smart execution request: {request.prompt[:100]}...")
        
        # Create orchestrator
        orchestrator = SmartOrchestrator(gemini_client)
        
        # Generate plan using LLM
        plan = await orchestrator.analyze_and_plan(
            prompt=request.prompt,
            available_tools=request.available_tools,
            integrations=request.integrations,
        )
        
        # Convert to response model
        execution_steps = [
            SmartExecutionStep(
                id=step.id,
                tool=step.tool,
                arguments=step.arguments,
                depends_on=step.depends_on,
                description=step.description,
                status="pending",
            )
            for step in plan.steps
        ]
        
        # Create flow visualization
        flow_steps, flow_edges = _create_flow_visualization(plan_id, request.prompt, execution_steps)
        
        # Get logs
        logs = orchestrator.get_logs()
        
        logger.info(f"Generated plan with {len(execution_steps)} steps")
        
        # Cast workflow_type to the literal type
        workflow_type: str = plan.workflow_type
        if workflow_type not in ("sequential", "parallel", "mixed"):
            workflow_type = "sequential"
        
        # Convert logs to ExecutionLog objects
        from .models import ExecutionLog
        execution_logs = [
            ExecutionLog(
                timestamp=log.timestamp,
                level=log.level,  # type: ignore
                stage=log.stage,  # type: ignore
                step_id=log.step_id,
                message=log.message,
                details=log.details,
            )
            for log in logs
        ]
        
        return SmartExecutionResponse(
            id=plan_id,
            prompt=request.prompt,
            createdAt=created_at,
            plan=SmartExecutionPlan(
                steps=execution_steps,
                workflow_type=workflow_type,  # type: ignore
                summary=plan.summary,
                extracted_params=plan.extracted_params,
            ),
            logs=execution_logs,
            overall_status="planned",
            flowSteps=flow_steps,
            flowEdges=flow_edges,
            results={},
            startedAt=None,
            completedAt=None,
        )
        
    except Exception as exc:
        logger.exception(f"Smart execution failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Smart execution failed: {exc}") from exc


def _create_flow_visualization(
    plan_id: str,
    prompt: str,
    steps: list[SmartExecutionStep],
) -> tuple[list[AgentFlowStep], list[AgentFlowEdge]]:
    """Create flow visualization data from execution steps."""
    
    flow_steps: list[AgentFlowStep] = []
    flow_edges: list[AgentFlowEdge] = []
    
    # Start node
    start_id = f"{plan_id}-start"
    flow_steps.append(AgentFlowStep(
        id=start_id,
        label="Start",
        description=f"Query: {prompt[:50]}...",
        phase="start",
        level=0,
        status="pending",
    ))
    
    # Planning node
    planning_id = f"{plan_id}-planning"
    flow_steps.append(AgentFlowStep(
        id=planning_id,
        label="LLM Planning",
        description="Analyzing query and generating steps",
        phase="planning",
        level=1,
        status="pending",
    ))
    flow_edges.append(AgentFlowEdge(
        id=f"edge-{start_id}-{planning_id}",
        source=start_id,
        target=planning_id,
    ))
    
    # Execution steps
    prev_id = planning_id
    for idx, step in enumerate(steps):
        step_id = f"{plan_id}-step-{step.id}"
        
        # Determine service from tool name
        service_id = None
        service_name = None
        tool_lower = step.tool.lower()
        if "jira" in tool_lower:
            service_id = "jira"
            service_name = "Jira"
        elif "github" in tool_lower:
            service_id = "github"
            service_name = "GitHub"
        elif "slack" in tool_lower:
            service_id = "slack"
            service_name = "Slack"
        elif "sheet" in tool_lower:
            service_id = "sheets"
            service_name = "Google Sheets"
        
        flow_steps.append(AgentFlowStep(
            id=step_id,
            label=f"Step {step.id}: {step.tool}",
            description=step.description or f"Execute {step.tool}",
            phase="execution",
            level=2 + idx,
            serviceId=service_id,
            serviceName=service_name,
            status="pending",
            tool=step.tool,
            arguments=step.arguments,
        ))
        
        # Connect to previous
        flow_edges.append(AgentFlowEdge(
            id=f"edge-{prev_id}-{step_id}",
            source=prev_id,
            target=step_id,
        ))
        prev_id = step_id
    
    # End node
    end_id = f"{plan_id}-end"
    flow_steps.append(AgentFlowStep(
        id=end_id,
        label="Complete",
        description="Workflow completed",
        phase="end",
        level=2 + len(steps),
        status="pending",
    ))
    flow_edges.append(AgentFlowEdge(
        id=f"edge-{prev_id}-{end_id}",
        source=prev_id,
        target=end_id,
    ))
    
    return flow_steps, flow_edges
