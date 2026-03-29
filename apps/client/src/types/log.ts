// Audit Log Types
export type LogLevel = 'info' | 'warning' | 'error' | 'debug';

export type LogStatus = 'success' | 'failed' | 'pending' | 'cancelled';

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  workflowId: string;
  workflowName: string;
  executionId: string;
  nodeId?: string;
  nodeName?: string;
  service?: string;
  tool?: string;
  status: LogStatus;
  message: string;
  userId: string;
  userName: string;
  userRole: string;
  approvalInfo?: {
    required: boolean;
    approvedBy?: string;
    approvedAt?: Date;
    rejected?: boolean;
    rejectedBy?: string;
    rejectedAt?: Date;
    reason?: string;
  };
  metadata?: Record<string, unknown>;
  request?: MCPRequest;
  response?: MCPResponse;
  duration?: number;
  retryAttempt?: number;
}

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string;
  result?: {
    content: Array<{
      type: string;
      text: string;
    }>;
    isError: boolean;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface LogFilters {
  status?: LogStatus[];
  level?: LogLevel[];
  service?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  searchQuery?: string;
  workflowId?: string;
  userId?: string;
}

export interface LogPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
