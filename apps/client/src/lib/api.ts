/**
 * API Client for NexusMCP Backend
 */

import type {
  AgentFlowPlan,
  AgentFlowRequestPayload,
} from "@/types/agentic-flow";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

interface GmailOAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  error?: string;
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const url = `${API_BASE_URL}${endpoint}`;
  const token =
    typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = (await response.json()) as ApiResponse<T>;
      return data;
    }

    const text = await response.text();
    if (!response.ok) {
      return {
        success: false,
        error: text || `Request failed with status ${response.status}`,
      };
    }

    return {
      success: true,
      data: undefined,
      message: text || undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

// Workflows API
export const workflowsApi = {
  list: () => fetchApi<Workflow[]>("/workflows"),

  get: (id: string) => fetchApi<Workflow>(`/workflows/${id}`),

  create: (workflow: CreateWorkflowRequest) =>
    fetchApi<Workflow>("/workflows", {
      method: "POST",
      body: JSON.stringify(workflow),
    }),

  update: (id: string, updates: Partial<Workflow>) =>
    fetchApi<Workflow>(`/workflows/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),

  delete: (id: string) =>
    fetchApi<void>(`/workflows/${id}`, { method: "DELETE" }),

  execute: (id: string) =>
    fetchApi<WorkflowExecution>(`/workflows/${id}/execute`, { method: "POST" }),

  pause: (id: string) =>
    fetchApi<Workflow>(`/workflows/${id}/pause`, { method: "POST" }),

  resume: (id: string) =>
    fetchApi<Workflow>(`/workflows/${id}/resume`, { method: "POST" }),

  stop: (id: string) =>
    fetchApi<Workflow>(`/workflows/${id}/stop`, { method: "POST" }),

  audits: (id: string, options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    const query = params.toString();

    return fetchApi<WorkflowAuditsPayload>(`/workflows/${id}/audits${query ? `?${query}` : ""}`);
  },

  generate: (prompt: string) =>
    fetchApi<Workflow>("/workflows/generate", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),

  generateAgenticFlow: (
    payload: AgentFlowRequestPayload,
    signal?: AbortSignal,
  ) =>
    fetchApi<AgentFlowPlan>("/workflows/agentic-flow", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    }),

  smartExecute: (payload: SmartExecutionPayload, signal?: AbortSignal) =>
    fetchApi<SmartExecutionResult>("/workflows/smart-execute", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    }),
};

// Integrations API
export const integrationsApi = {
  list: () => fetchApi<Integration[]>("/integrations"),

  get: (id: string) => fetchApi<Integration>(`/integrations/${id}`),

  connect: (id: string, credentials: Record<string, unknown>) =>
    fetchApi<Integration>(`/integrations/${id}/connect`, {
      method: "POST",
      body: JSON.stringify({ credentials }),
    }),

  disconnect: (id: string) =>
    fetchApi<Integration>(`/integrations/${id}/disconnect`, { method: "POST" }),

  test: (id: string) =>
    fetchApi<{ latency: number; version: string }>(`/integrations/${id}/test`, {
      method: "POST",
    }),

  getCapabilities: (id: string) =>
    fetchApi<IntegrationCapability[]>(`/integrations/${id}/capabilities`),
};

// Logs API
export const logsApi = {
  list: (filters?: LogFilters) => {
    const params = new URLSearchParams();
    if (filters?.level) params.set("level", filters.level);
    if (filters?.service) params.set("service", filters.service);
    if (filters?.search) params.set("search", filters.search);
    if (filters?.limit) params.set("limit", String(filters.limit));
    if (filters?.offset) params.set("offset", String(filters.offset));

    const query = params.toString();
    return fetchApi<AuditLog[]>(`/logs${query ? `?${query}` : ""}`);
  },

  getStats: () => fetchApi<LogStats>("/logs/stats"),
};

// Settings API
export const settingsApi = {
  get: () => fetchApi<Settings>("/settings"),

  update: (updates: Partial<Settings>) =>
    fetchApi<Settings>("/settings", {
      method: "PUT",
      body: JSON.stringify(updates),
    }),

  updateLLM: (updates: Partial<LLMSettings>) =>
    fetchApi<LLMSettings>("/settings/llm", {
      method: "PUT",
      body: JSON.stringify(updates),
    }),

  updateExecution: (updates: Partial<ExecutionSettings>) =>
    fetchApi<ExecutionSettings>("/settings/execution", {
      method: "PUT",
      body: JSON.stringify(updates),
    }),

  updateNotifications: (updates: Partial<NotificationSettings>) =>
    fetchApi<NotificationSettings>("/settings/notifications", {
      method: "PUT",
      body: JSON.stringify(updates),
    }),
};

// Auth API
export const authApi = {
  me: () => fetchApi<User>("/auth/me"),

  updateProfile: (updates: Partial<User>) =>
    fetchApi<User>("/auth/me", {
      method: "PUT",
      body: JSON.stringify(updates),
    }),

  getSessions: () => fetchApi<Session[]>("/auth/sessions"),

  revokeSession: (id: string) =>
    fetchApi<void>(`/auth/sessions/${id}`, { method: "DELETE" }),

  login: (email: string, password: string) =>
    fetchApi<{ user: User; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  fetchGmailOAuthToken: async (): Promise<GmailOAuthTokenResponse> => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

    const response = await fetch(`${API_BASE_URL}/auth/gmail/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      body: JSON.stringify({}),
    });

    const responseText = await response.text();
    let payload: Partial<GmailOAuthTokenResponse> = {};

    try {
      payload = responseText
        ? (JSON.parse(responseText) as Partial<GmailOAuthTokenResponse>)
        : {};
    } catch {
      throw new Error(
        responseText || `Failed to fetch Gmail token (${response.status})`,
      );
    }

    if (!response.ok) {
      throw new Error(
        payload.error ||
          `Failed to fetch Gmail token (${response.status} ${response.statusText})`,
      );
    }

    const accessToken =
      typeof payload.access_token === "string" ? payload.access_token : "";
    if (!accessToken) {
      throw new Error("Gmail token response did not include access_token");
    }

    return {
      access_token: accessToken,
      refresh_token:
        typeof payload.refresh_token === "string" ? payload.refresh_token : "",
      expires_in:
        typeof payload.expires_in === "number" &&
        Number.isFinite(payload.expires_in)
          ? payload.expires_in
          : 3600,
    };
  },

  logout: () => fetchApi<void>("/auth/logout", { method: "POST" }),
};

// MCP API
export const mcpApi = {
  execute: (method: string, params?: Record<string, unknown>) =>
    fetchApi<MCPResponse>("/mcp/execute", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
    }),

  executeNode: (node: DAGNode) =>
    fetchApi<{ result: unknown; error?: string }>("/mcp/execute-node", {
      method: "POST",
      body: JSON.stringify(node),
    }),

  getMethods: () =>
    fetchApi<{ method: string; description: string }[]>("/mcp/methods"),

  streamWorkflow: (workflowId: string) =>
    fetchApi<{
      execution: WorkflowExecution;
      results: Record<string, unknown>;
    }>("/mcp/stream", {
      method: "POST",
      body: JSON.stringify({ workflowId }),
    }),
};

// Type definitions (shared with server)
type ServiceType =
  | "jira"
  | "slack"
  | "github"
  | "postgres"
  | "sheets"
  | "google_sheets"
  | "gmail"
  | "aws";

interface DAGNode {
  id: string;
  type: "trigger" | "action" | "condition" | "output";
  service: ServiceType;
  operation: string;
  label: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
  status?: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: unknown;
  error?: string;
}

interface DAGEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: DAGNode[];
  edges: DAGEdge[];
  status: "draft" | "ready" | "running" | "completed" | "failed" | "paused";
  createdAt: string;
  updatedAt: string;
  executionHistory: WorkflowExecution[];
}

interface CreateWorkflowRequest {
  name: string;
  description?: string;
  nodes?: DAGNode[];
  edges?: DAGEdge[];
  status?: Workflow["status"];
}

interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: "running" | "completed" | "failed" | "paused";
  startedAt: string;
  completedAt?: string;
  currentNodeId?: string;
  nodeResults: Record<string, NodeExecutionResult>;
}

interface NodeExecutionResult {
  nodeId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

interface Integration {
  id: string;
  service: ServiceType;
  name: string;
  description: string;
  status: "connected" | "disconnected" | "error";
  credentials?: { configured: boolean };
  lastSync?: string;
  capabilities: IntegrationCapability[];
}

interface IntegrationCapability {
  id: string;
  name: string;
  type: "trigger" | "action" | "query";
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

interface AuditLog {
  id: string;
  timestamp: string;
  level: "info" | "warning" | "error" | "debug";
  service: ServiceType | "system";
  action: string;
  message: string;
  details?: Record<string, unknown>;
  workflowId?: string;
  nodeId?: string;
  userId?: string;
  runNumber?: number;
}

interface WorkflowAuditRun {
  runNumber: number;
  executionId: string;
  startedAt: string;
  endedAt: string;
  totalLogs: number;
  errorCount: number;
}

interface WorkflowAuditsPayload {
  logs: AuditLog[];
  runs: WorkflowAuditRun[];
}

interface LogFilters {
  level?: AuditLog["level"];
  service?: AuditLog["service"];
  search?: string;
  limit?: number;
  offset?: number;
}

interface LogStats {
  total: number;
  byLevel: Record<AuditLog["level"], number>;
  byService: Record<AuditLog["service"], number>;
  last24Hours: number;
}

interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: "admin" | "operator" | "viewer";
  permissions: Permission[];
  createdAt: string;
  lastLogin?: string;
}

interface Permission {
  resource: "workflows" | "integrations" | "logs" | "settings" | "users";
  actions: ("create" | "read" | "update" | "delete" | "execute")[];
}

interface Session {
  id: string;
  userId: string;
  device: string;
  browser: string;
  ipAddress: string;
  location: string;
  createdAt: string;
  lastActive: string;
  isCurrent: boolean;
}

interface Settings {
  llm: LLMSettings;
  execution: ExecutionSettings;
  notifications: NotificationSettings;
}

interface LLMSettings {
  provider: "openai" | "anthropic" | "azure";
  model: string;
  temperature: number;
  maxTokens: number;
  apiKey?: string;
}

interface ExecutionSettings {
  maxConcurrentWorkflows: number;
  defaultTimeout: number;
  retryAttempts: number;
  retryDelay: number;
  autoApprove: boolean;
  sandboxMode: boolean;
}

interface NotificationSettings {
  email: boolean;
  slack: boolean;
  onSuccess: boolean;
  onFailure: boolean;
  onApprovalNeeded: boolean;
}

interface MCPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Export types
export type {
  ApiResponse,
  PaginatedResponse,
  Workflow,
  CreateWorkflowRequest,
  WorkflowExecution,
  NodeExecutionResult,
  DAGNode,
  DAGEdge,
  Integration,
  IntegrationCapability,
  AuditLog,
  LogFilters,
  LogStats,
  WorkflowAuditRun,
  WorkflowAuditsPayload,
  User,
  Permission,
  Session,
  Settings,
  LLMSettings,
  ExecutionSettings,
  NotificationSettings,
  MCPResponse,
  ServiceType,
  SmartExecutionPayload,
  SmartExecutionResult,
  SmartExecutionStep,
  SmartExecutionLog,
};

// ============================================================================
// Smart Execution Types
// ============================================================================

interface SmartExecutionPayload {
  prompt: string;
  integrations?: Array<{
    id: string;
    name: string;
    status: "connected" | "disconnected" | "error" | "pending";
    enabled: boolean;
    tools: string[];
  }>;
  availableTools?: Record<
    string,
    {
      description: string;
      inputs: Record<string, string>;
    }
  >;
  execute?: boolean;
}

interface SmartExecutionStep {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
  dependsOn: string[];
  description: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

interface SmartExecutionLog {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  stage: "planning" | "execution" | "completion";
  stepId?: string;
  message: string;
  details?: Record<string, unknown>;
}

interface SmartExecutionResult {
  id: string;
  prompt: string;
  createdAt: string;
  plan: {
    steps: SmartExecutionStep[];
    workflowType: "sequential" | "parallel" | "mixed";
    summary: string;
    extractedParams: Record<string, string>;
  };
  logs: SmartExecutionLog[];
  overallStatus: "planned" | "running" | "completed" | "partial" | "failed";
  flowSteps: Array<{
    id: string;
    label: string;
    description: string;
    phase: string;
    level: number;
    serviceId?: string;
    serviceName?: string;
    status: string;
    tool?: string;
    arguments?: Record<string, unknown>;
  }>;
  flowEdges: Array<{
    id: string;
    source: string;
    target: string;
  }>;
  results: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
}
