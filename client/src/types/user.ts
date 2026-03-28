// User Types
export type UserRole = 'admin' | 'operator' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: UserRole;
  permissions: UserPermissions;
  createdAt: Date;
  lastLoginAt?: Date;
}

export interface UserPermissions {
  canExecuteWorkflows: boolean;
  canApproveOperations: boolean;
  canModifyIntegrations: boolean;
  canViewAuditLogs: boolean;
  canModifySettings: boolean;
  canManageUsers: boolean;
  allowedServices: string[]; // Empty = all allowed
  allowedTools: string[]; // Empty = all allowed
}

export interface Session {
  id: string;
  userId: string;
  device: string;
  browser: string;
  ip: string;
  location?: string;
  createdAt: Date;
  lastActiveAt: Date;
  isCurrent: boolean;
}

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'azure' | 'custom';
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
}

export interface ExecutionPolicy {
  maxRetries: number;
  retryDelayMs: number;
  timeoutMs: number;
  parallelExecutionEnabled: boolean;
  requireApprovalForSensitive: boolean;
  autoApproveForAdmins: boolean;
}

export interface GlobalSettings {
  llmConfig: LLMConfig;
  executionPolicy: ExecutionPolicy;
  notifications: {
    emailEnabled: boolean;
    slackEnabled: boolean;
    onSuccess: boolean;
    onFailure: boolean;
    onApprovalRequired: boolean;
  };
}
