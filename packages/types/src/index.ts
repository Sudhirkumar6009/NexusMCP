/**
 * NexusMCP Shared Types
 * 
 * Core type definitions shared between frontend and backend
 */

// ============================================================================
// Workflow Types
// ============================================================================

export type NodeType = 'trigger' | 'action' | 'condition' | 'parallel' | 'approval' | 'end';

export type NodeStatus = 
  | 'pending' 
  | 'running' 
  | 'success' 
  | 'failed' 
  | 'retrying' 
  | 'waiting_approval' 
  | 'skipped';

export type WorkflowStatus = 
  | 'draft' 
  | 'ready' 
  | 'running' 
  | 'completed' 
  | 'failed' 
  | 'paused' 
  | 'cancelled';

export interface Position {
  x: number;
  y: number;
}

export interface DAGNode {
  id: string;
  type: NodeType;
  label: string;
  service?: string;
  tool?: string;
  position: Position;
  status: NodeStatus;
  config?: Record<string, unknown>;
  retryCount?: number;
  maxRetries?: number;
  error?: string;
  output?: unknown;
}

export interface DAGEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: 'default' | 'success' | 'failure';
}

export interface DAGWorkflow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  nodes: DAGNode[];
  edges: DAGEdge[];
  createdAt: Date;
  updatedAt: Date;
  status: WorkflowStatus;
}

// ============================================================================
// Execution Types
// ============================================================================

export interface ExecutionStep {
  nodeId: string;
  nodeName: string;
  service: string;
  tool: string;
  status: NodeStatus;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  retryAttempt: number;
  maxRetries: number;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
  steps: ExecutionStep[];
  currentStepIndex: number;
  progress: number;
  approvalRequired?: boolean;
  approvalMessage?: string;
}

// ============================================================================
// MCP Types
// ============================================================================

export interface MCPToolDefinition {
  name: string;
  service: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface MCPToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  id: string;
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError: boolean;
}

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ============================================================================
// Integration Types
// ============================================================================

export type IntegrationType = 'jira' | 'slack' | 'github' | 'sheets' | 'postgresql' | 'custom';

export type IntegrationStatus = 'connected' | 'disconnected' | 'error' | 'pending';

export interface Integration {
  id: string;
  name: string;
  type: IntegrationType;
  status: IntegrationStatus;
  config: Record<string, unknown>;
  lastSyncAt?: Date;
  errorMessage?: string;
}

// ============================================================================
// User Types
// ============================================================================

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: 'admin' | 'user' | 'viewer';
  createdAt: Date;
}

export interface Session {
  user: User;
  accessToken: string;
  expiresAt: Date;
}

// ============================================================================
// API Types
// ============================================================================

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
