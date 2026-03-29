/**
 * API Client for NexusMCP Backend
 */

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

  generate: (prompt: string) =>
    fetchApi<Workflow>("/workflows/generate", {
      method: "POST",
      body: JSON.stringify({ prompt }),
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
interface DAGNode {
  id: string;
  type: "trigger" | "action" | "condition" | "output";
  service: "jira" | "slack" | "github" | "postgres";
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
  service: "jira" | "slack" | "github" | "postgres";
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
  service: "jira" | "slack" | "github" | "postgres" | "system";
  action: string;
  message: string;
  details?: Record<string, unknown>;
  workflowId?: string;
  nodeId?: string;
  userId?: string;
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
  User,
  Permission,
  Session,
  Settings,
  LLMSettings,
  ExecutionSettings,
  NotificationSettings,
  MCPResponse,
};
