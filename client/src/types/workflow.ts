// Workflow Types
export type NodeType = 'trigger' | 'action' | 'condition' | 'parallel' | 'approval' | 'end';

export type NodeStatus = 'pending' | 'running' | 'success' | 'failed' | 'retrying' | 'waiting_approval' | 'skipped';

export interface Position {
  x: number;
  y: number;
}

export interface DAGNode {
  id: string;
  type: NodeType;
  label: string;
  service?: string; // e.g., 'jira', 'slack', 'github', 'postgresql'
  tool?: string; // e.g., 'create_issue', 'send_message'
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
  label?: string; // e.g., 'yes', 'no' for conditions
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
  status: 'draft' | 'ready' | 'running' | 'completed' | 'failed' | 'paused';
}

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
  progress: number; // 0-100
  approvalRequired?: boolean;
  approvalMessage?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  category: string;
}
