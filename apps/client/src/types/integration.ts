// Integration Types
export type ServiceCategory =
  | "project_management"
  | "communication"
  | "data_analytics"
  | "devops";

export type ServiceId =
  | "jira"
  | "slack"
  | "github"
  | "google_sheets"
  | "gmail"
  | "aws";

export type ConnectionStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "pending";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface Integration {
  id: ServiceId;
  name: string;
  description: string;
  category: ServiceCategory;
  icon: string; // Icon name from lucide-react
  status: ConnectionStatus;
  enabled: boolean;
  lastSynced?: Date;
  credentials?: IntegrationCredentials;
  tools: MCPTool[];
  config?: IntegrationConfig;
}

export interface IntegrationCredentials {
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  username?: string;
  baseUrl?: string;
  spreadsheetId?: string;
  googleServiceAccountJson?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
  scopes: string[];
  expiresAt?: Date;
}

export interface IntegrationConfig {
  baseUrl?: string;
  projectId?: string;
  channelId?: string;
  databaseName?: string;
  orgName?: string;
  repoName?: string;
  webhookEnabled?: boolean;
  customHeaders?: Record<string, string>;
}

export interface IntegrationStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  avgResponseTime: number;
  lastError?: string;
  lastErrorAt?: Date;
}
