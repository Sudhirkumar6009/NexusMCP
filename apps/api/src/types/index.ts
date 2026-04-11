// Workflow Types
export interface DAGNode {
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

export interface DAGEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
}

export interface Workflow {
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

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: "running" | "completed" | "failed" | "paused";
  startedAt: string;
  completedAt?: string;
  currentNodeId?: string;
  nodeResults: Record<string, NodeExecutionResult>;
}

export interface NodeExecutionResult {
  nodeId: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

// Integration Types
export interface Integration {
  id: string;
  service:
    | "jira"
    | "slack"
    | "github"
    | "google_sheets"
    | "gmail"
    | "aws"
    | "postgres";
  name: string;
  description: string;
  status: "connected" | "disconnected" | "error";
  credentials?: IntegrationCredentials;
  lastSync?: string;
  capabilities: IntegrationCapability[];
}

export interface IntegrationCredentials {
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  baseUrl?: string;
  username?: string;
  spreadsheetId?: string;
  googleServiceAccountJson?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
  password?: string;
  database?: string;
  host?: string;
  port?: number;
}

export interface IntegrationCapability {
  id: string;
  name: string;
  type: "trigger" | "action" | "query";
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

// Audit Log Types
export interface AuditLog {
  id: string;
  timestamp: string;
  level: "info" | "warning" | "error" | "debug";
  service:
    | "jira"
    | "slack"
    | "github"
    | "google_sheets"
    | "gmail"
    | "aws"
    | "postgres"
    | "system";
  action: string;
  message: string;
  executionId?: string;
  details?: Record<string, unknown>;
  workflowId?: string;
  nodeId?: string;
  userId?: string;
}

// User Types
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: "admin" | "operator" | "viewer";
  permissions: Permission[];
  createdAt: string;
  lastLogin?: string;
}

export interface Permission {
  resource: "workflows" | "integrations" | "logs" | "settings" | "users";
  actions: ("create" | "read" | "update" | "delete" | "execute")[];
}

export interface Session {
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

// Settings Types
export interface Settings {
  llm: LLMSettings;
  execution: ExecutionSettings;
  notifications: NotificationSettings;
}

export interface LLMSettings {
  provider: "openai" | "anthropic" | "azure";
  model: string;
  temperature: number;
  maxTokens: number;
  apiKey?: string;
}

export interface ExecutionSettings {
  maxConcurrentWorkflows: number;
  defaultTimeout: number;
  retryAttempts: number;
  retryDelay: number;
  autoApprove: boolean;
  sandboxMode: boolean;
}

export interface NotificationSettings {
  email: boolean;
  slack: boolean;
  onSuccess: boolean;
  onFailure: boolean;
  onApprovalNeeded: boolean;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// MCP Protocol Types
export interface MCPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}
