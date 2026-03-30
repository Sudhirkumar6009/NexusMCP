export type AgentFlowStatus = "waiting" | "working" | "done" | "failed";

export type AgentFlowPhase =
  | "start"
  | "context-analysis"
  | "required-api"
  | "planning"
  | "connector-agent"
  | "execution"
  | "orchestrator"
  | "end";

export interface AgentFlowStep {
  id: string;
  label: string;
  description: string;
  phase: AgentFlowPhase;
  level: number;
  serviceId?: string;
  serviceName?: string;
  status?: "pending" | "running" | "done" | "failed" | "skipped";
  tool?: string;
  arguments?: Record<string, unknown>;
}

export interface AgentFlowEdge {
  id: string;
  source: string;
  target: string;
}

// New: Required service info
export interface RequiredService {
  service_id: string;
  service_name: string;
  reason: string;
  actions: string[];
  priority: number;
  is_connected: boolean;
  is_available: boolean;
}

// New: Required API analysis result
export interface RequiredAPIResult {
  required_services: RequiredService[];
  extracted_params: Record<string, string>;
  workflow_summary: string;
  all_services_ready: boolean;
  missing_services: string[];
  disconnected_services: string[];
}

// New: Tool execution step
export interface ToolPlanStep {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
}

// New: Tool execution plan
export interface ToolExecutionPlan {
  steps: ToolPlanStep[];
}

export interface AgentFlowPlan {
  id: string;
  prompt: string;
  createdAt: string;
  steps: AgentFlowStep[];
  edges: AgentFlowEdge[];
  metadata?: Record<string, unknown>;
  // New streamlined flow fields
  requiredApi?: RequiredAPIResult;
  toolPlan?: ToolExecutionPlan;
  readyToExecute?: boolean;
  blockedReason?: string | null;
}

export interface AgenticIntegrationInput {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "error" | "pending";
  enabled: boolean;
  tools: string[];
}

export interface AgenticToolDefinition {
  description: string;
  inputs: Record<string, string>;
}

export interface AgentFlowRequestPayload {
  prompt: string;
  integrations: AgenticIntegrationInput[];
  availableTools?: Record<string, AgenticToolDefinition>;
  skipConnectivityCheck?: boolean;
}

export interface AgentStepRuntime {
  status: AgentFlowStatus;
  detail?: string;
}

export interface AgentFlowNodeData {
  label: string;
  description: string;
  phase: AgentFlowPhase;
  level: number;
  status: AgentFlowStatus;
  detail?: string;
}

export type AgentRunState =
  | "idle"
  | "planning"
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "blocked"; // New: when services need to be connected

export interface AgentStatusUpdate {
  nodeId: string;
  status: AgentFlowStatus;
  detail?: string;
}

export type AgentToolAuditStage = "request" | "response" | "error";

export interface AgentToolAuditUpdate {
  id: string;
  timestamp: string;
  nodeId: string;
  serviceId: string;
  tool: string;
  stage: AgentToolAuditStage;
  request?: Record<string, unknown>;
  response?: unknown;
  error?: string;
}
