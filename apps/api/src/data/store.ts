import { v4 as uuidv4 } from "uuid";
import type {
  Workflow,
  Integration,
  AuditLog,
  User,
  Settings,
  Session,
  WorkflowExecution,
} from "../types/index.js";
import {
  saveEventLog,
  saveServiceConnection,
  saveWorkflowDefinition,
  saveWorkflowExecution,
} from "../services/postgres-store.js";

// In-memory data store (simulating a database)
class DataStore {
  private workflows: Map<string, Workflow> = new Map();
  private integrations: Map<string, Integration> = new Map();
  private logs: AuditLog[] = [];
  private users: Map<string, User> = new Map();
  private sessions: Map<string, Session> = new Map();
  private settings: Settings;
  private executions: Map<string, WorkflowExecution> = new Map();

  constructor() {
    this.settings = this.getDefaultSettings();
    this.initializeMockData();
  }

  private getDefaultSettings(): Settings {
    return {
      llm: {
        provider: "openai",
        model: "gpt-4",
        temperature: 0.7,
        maxTokens: 4096,
      },
      execution: {
        maxConcurrentWorkflows: 5,
        defaultTimeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000,
        autoApprove: false,
        sandboxMode: true,
      },
      notifications: {
        email: true,
        slack: false,
        onSuccess: true,
        onFailure: true,
        onApprovalNeeded: true,
      },
    };
  }

  private initializeMockData(): void {
    // Initialize integrations
    const integrations: Integration[] = [
      {
        id: "int-jira",
        service: "jira",
        name: "Jira",
        description: "Project management and issue tracking",
        status: "disconnected",
        capabilities: [
          {
            id: "jira-create-issue",
            name: "Create Issue",
            type: "action",
            description: "Create a new Jira issue",
            inputSchema: {
              project: "string",
              summary: "string",
              description: "string",
              type: "string",
            },
            outputSchema: { issueKey: "string", issueId: "string" },
          },
          {
            id: "jira-get-issues",
            name: "Get Issues",
            type: "query",
            description: "Query issues with JQL",
            inputSchema: { jql: "string", maxResults: "number" },
            outputSchema: { issues: "array" },
          },
          {
            id: "jira-update-issue",
            name: "Update Issue",
            type: "action",
            description: "Update an existing issue",
            inputSchema: {
              issueKey: "string",
              fields: "object",
              status: "string",
              transition_id: "string",
              comment: "string",
            },
            outputSchema: { success: "boolean" },
          },
        ],
      },
      {
        id: "int-slack",
        service: "slack",
        name: "Slack",
        description: "Team or group communication and notifications",
        status: "disconnected",
        capabilities: [
          {
            id: "slack-send-message",
            name: "Send Message",
            type: "action",
            description: "Send a message to a channel",
            inputSchema: { channel: "string", text: "string", blocks: "array" },
            outputSchema: { ts: "string", channel: "string" },
          },
          {
            id: "slack-on-message",
            name: "On Message",
            type: "trigger",
            description: "Trigger when a message is received",
            inputSchema: { channel: "string", pattern: "string" },
            outputSchema: {
              message: "object",
              user: "string",
              channel: "string",
            },
          },
        ],
      },
      {
        id: "int-github",
        service: "github",
        name: "GitHub",
        description: "Code repository and DevOps",
        status: "disconnected",
        capabilities: [
          {
            id: "github-create-issue",
            name: "Create Issue",
            type: "action",
            description: "Create a GitHub issue",
            inputSchema: {
              repo: "string",
              title: "string",
              body: "string",
              labels: "array",
            },
            outputSchema: { number: "number", url: "string" },
          },
          {
            id: "github-create-pr",
            name: "Create Pull Request",
            type: "action",
            description: "Create a pull request",
            inputSchema: {
              repo: "string",
              title: "string",
              head: "string",
              base: "string",
            },
            outputSchema: { number: "number", url: "string" },
          },
          {
            id: "github-create-or-update-file",
            name: "Create or Update File",
            type: "action",
            description:
              "Create or update a file in a branch (creates a commit)",
            inputSchema: {
              repo: "string",
              branch: "string",
              path: "string",
              content: "string",
              message: "string",
            },
            outputSchema: {
              path: "string",
              commitSha: "string",
              url: "string",
            },
          },
          {
            id: "github-on-push",
            name: "On Push",
            type: "trigger",
            description: "Trigger on push to repository",
            inputSchema: { repo: "string", branch: "string" },
            outputSchema: { commits: "array", pusher: "object" },
          },
        ],
      },
      {
        id: "int-google-sheets",
        service: "google_sheets",
        name: "Google Sheets",
        description: "Spreadsheet automation and reporting",
        status: "disconnected",
        capabilities: [
          {
            id: "sheets-read",
            name: "Read Sheet",
            type: "query",
            description: "Read values from a spreadsheet",
            inputSchema: { spreadsheetId: "string", range: "string" },
            outputSchema: { values: "array" },
          },
          {
            id: "sheets-append",
            name: "Append Row",
            type: "action",
            description: "Append a row to a spreadsheet",
            inputSchema: { spreadsheetId: "string", values: "array" },
            outputSchema: { updatedRange: "string" },
          },
        ],
      },
      {
        id: "int-gmail",
        service: "gmail",
        name: "Gmail",
        description: "Email automation and notifications",
        status: "disconnected",
        capabilities: [
          {
            id: "gmail-send",
            name: "Send Email",
            type: "action",
            description: "Send an email",
            inputSchema: { to: "string", subject: "string", body: "string" },
            outputSchema: { id: "string" },
          },
          {
            id: "gmail-list",
            name: "List Messages",
            type: "query",
            description: "List mailbox messages",
            inputSchema: { query: "string" },
            outputSchema: { messages: "array" },
          },
        ],
      },
      {
        id: "int-aws",
        service: "aws",
        name: "AWS",
        description: "Cloud infrastructure and serverless operations",
        status: "disconnected",
        capabilities: [
          {
            id: "aws-invoke-lambda",
            name: "Invoke Lambda",
            type: "action",
            description: "Invoke an AWS Lambda function",
            inputSchema: { functionName: "string", payload: "object" },
            outputSchema: { statusCode: "number" },
          },
          {
            id: "aws-list-buckets",
            name: "List S3 Buckets",
            type: "query",
            description: "List S3 buckets",
            inputSchema: {},
            outputSchema: { buckets: "array" },
          },
        ],
      },
    ];

    integrations.forEach((int) => this.integrations.set(int.id, int));

    // Initialize sample workflow
    const sampleWorkflow: Workflow = {
      id: "wf-sample-1",
      name: "Bug Report Pipeline",
      description: "Automatically process bug reports from Slack to Jira",
      status: "ready",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        {
          id: "node-1",
          type: "trigger",
          service: "slack",
          operation: "on-message",
          label: "Monitor #bugs channel",
          config: { channel: "#bugs", pattern: ".*bug.*" },
          position: { x: 250, y: 50 },
        },
        {
          id: "node-2",
          type: "action",
          service: "jira",
          operation: "create-issue",
          label: "Create Jira Issue",
          config: { project: "BUG", type: "Bug" },
          position: { x: 250, y: 150 },
        },
        {
          id: "node-3",
          type: "action",
          service: "slack",
          operation: "send-message",
          label: "Notify team",
          config: { channel: "#engineering" },
          position: { x: 250, y: 250 },
        },
      ],
      edges: [
        { id: "edge-1", source: "node-1", target: "node-2" },
        { id: "edge-2", source: "node-2", target: "node-3" },
      ],
      executionHistory: [],
    };

    this.workflows.set(sampleWorkflow.id, sampleWorkflow);

    // Initialize sample user
    const adminUser: User = {
      id: "user-admin",
      email: "admin@nexusmcp.dev",
      name: "Admin User",
      role: "admin",
      permissions: [
        {
          resource: "workflows",
          actions: ["create", "read", "update", "delete", "execute"],
        },
        {
          resource: "integrations",
          actions: ["create", "read", "update", "delete"],
        },
        { resource: "logs", actions: ["read"] },
        { resource: "settings", actions: ["read", "update"] },
        { resource: "users", actions: ["create", "read", "update", "delete"] },
      ],
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
      lastLogin: new Date().toISOString(),
    };

    this.users.set(adminUser.id, adminUser);

    // Initialize sample session
    const currentSession: Session = {
      id: "session-1",
      userId: adminUser.id,
      device: "Windows PC",
      browser: "Chrome 120",
      ipAddress: "192.168.1.1",
      location: "San Francisco, CA",
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      isCurrent: true,
    };

    this.sessions.set(currentSession.id, currentSession);

    // Initialize sample logs
    this.addLog({
      level: "info",
      service: "system",
      action: "server_start",
      message: "NexusMCP server started successfully",
    });
  }

  // Workflow methods
  getWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  getWorkflow(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  createWorkflow(
    workflow: Omit<
      Workflow,
      "id" | "createdAt" | "updatedAt" | "executionHistory"
    >,
  ): Workflow {
    const newWorkflow: Workflow = {
      ...workflow,
      id: `wf-${uuidv4()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executionHistory: [],
    };
    this.workflows.set(newWorkflow.id, newWorkflow);
    void saveWorkflowDefinition(newWorkflow).catch((error) => {
      console.error("PostgreSQL workflow save failed:", error);
    });
    this.addLog({
      level: "info",
      service: "system",
      action: "workflow_created",
      message: `Workflow "${newWorkflow.name}" created`,
      workflowId: newWorkflow.id,
    });
    return newWorkflow;
  }

  updateWorkflow(id: string, updates: Partial<Workflow>): Workflow | undefined {
    const workflow = this.workflows.get(id);
    if (!workflow) return undefined;

    const updated: Workflow = {
      ...workflow,
      ...updates,
      id: workflow.id,
      createdAt: workflow.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.workflows.set(id, updated);
    void saveWorkflowDefinition(updated).catch((error) => {
      console.error("PostgreSQL workflow update save failed:", error);
    });
    this.addLog({
      level: "info",
      service: "system",
      action: "workflow_updated",
      message: `Workflow "${updated.name}" updated`,
      workflowId: id,
    });
    return updated;
  }

  deleteWorkflow(id: string): boolean {
    const workflow = this.workflows.get(id);
    if (!workflow) return false;

    this.workflows.delete(id);
    this.addLog({
      level: "info",
      service: "system",
      action: "workflow_deleted",
      message: `Workflow "${workflow.name}" deleted`,
      workflowId: id,
    });
    return true;
  }

  // Integration methods
  getIntegrations(): Integration[] {
    return Array.from(this.integrations.values());
  }

  getIntegration(id: string): Integration | undefined {
    return this.integrations.get(id);
  }

  updateIntegration(
    id: string,
    updates: Partial<Integration>,
  ): Integration | undefined {
    const integration = this.integrations.get(id);
    if (!integration) return undefined;

    const updated: Integration = {
      ...integration,
      ...updates,
      id: integration.id,
    };
    this.integrations.set(id, updated);
    this.addLog({
      level: "info",
      service: updated.service,
      action: "integration_updated",
      message: `Integration "${updated.name}" updated`,
    });
    return updated;
  }

  connectIntegration(
    id: string,
    credentials: Integration["credentials"],
  ): Integration | undefined {
    const integration = this.integrations.get(id);
    if (!integration) return undefined;

    const updated: Integration = {
      ...integration,
      credentials,
      status: "connected",
      lastSync: new Date().toISOString(),
    };
    this.integrations.set(id, updated);
    void saveServiceConnection({
      connectionId: id,
      serviceName: updated.service,
      apiKey:
        credentials?.apiKey ||
        credentials?.accessKeyId ||
        credentials?.username,
      token:
        credentials?.accessToken ||
        credentials?.refreshToken ||
        credentials?.apiSecret ||
        credentials?.password,
      scopes: [],
    }).catch((error) => {
      console.error("PostgreSQL connection save failed:", error);
    });
    this.addLog({
      level: "info",
      service: updated.service,
      action: "integration_connected",
      message: `Integration "${updated.name}" connected successfully`,
    });
    return updated;
  }

  disconnectIntegration(id: string): Integration | undefined {
    const integration = this.integrations.get(id);
    if (!integration) return undefined;

    const updated: Integration = {
      ...integration,
      credentials: undefined,
      status: "disconnected",
      lastSync: undefined,
    };
    this.integrations.set(id, updated);
    void saveServiceConnection({
      connectionId: id,
      serviceName: updated.service,
      scopes: [],
    }).catch((error) => {
      console.error("PostgreSQL connection clear failed:", error);
    });
    this.addLog({
      level: "info",
      service: updated.service,
      action: "integration_disconnected",
      message: `Integration "${updated.name}" disconnected`,
    });
    return updated;
  }

  // Audit log methods
  getLogs(filters?: {
    level?: AuditLog["level"];
    service?: AuditLog["service"];
    search?: string;
    limit?: number;
    offset?: number;
  }): { logs: AuditLog[]; total: number } {
    let filtered = [...this.logs];

    if (filters?.level) {
      filtered = filtered.filter((log) => log.level === filters.level);
    }
    if (filters?.service) {
      filtered = filtered.filter((log) => log.service === filters.service);
    }
    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(
        (log) =>
          log.message.toLowerCase().includes(searchLower) ||
          log.action.toLowerCase().includes(searchLower),
      );
    }

    const total = filtered.length;
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 50;

    filtered = filtered.slice(offset, offset + limit);

    return { logs: filtered, total };
  }

  addLog(log: Omit<AuditLog, "id" | "timestamp">): AuditLog {
    const newLog: AuditLog = {
      ...log,
      id: `log-${uuidv4()}`,
      timestamp: new Date().toISOString(),
    };
    this.logs.unshift(newLog);

    // Keep only last 1000 logs
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(0, 1000);
    }

    void saveEventLog(newLog).catch((error) => {
      console.error("PostgreSQL event log save failed:", error);
    });

    return newLog;
  }

  // User methods
  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  getUserByEmail(email: string): User | undefined {
    return Array.from(this.users.values()).find((u) => u.email === email);
  }

  updateUser(id: string, updates: Partial<User>): User | undefined {
    const user = this.users.get(id);
    if (!user) return undefined;

    const updated: User = {
      ...user,
      ...updates,
      id: user.id,
      createdAt: user.createdAt,
    };
    this.users.set(id, updated);
    return updated;
  }

  // Session methods
  getSessions(userId: string): Session[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.userId === userId,
    );
  }

  deleteSession(id: string): boolean {
    return this.sessions.delete(id);
  }

  // Settings methods
  getSettings(): Settings {
    return this.settings;
  }

  updateSettings(updates: Partial<Settings>): Settings {
    this.settings = {
      ...this.settings,
      ...updates,
    };
    this.addLog({
      level: "info",
      service: "system",
      action: "settings_updated",
      message: "System settings updated",
    });
    return this.settings;
  }

  // Execution methods
  createExecution(workflowId: string): WorkflowExecution | undefined {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return undefined;

    const execution: WorkflowExecution = {
      id: `exec-${uuidv4()}`,
      workflowId,
      status: "running",
      startedAt: new Date().toISOString(),
      nodeResults: {},
    };

    this.executions.set(execution.id, execution);
    void saveWorkflowExecution(execution).catch((error) => {
      console.error("PostgreSQL execution save failed:", error);
    });

    // Update workflow status
    workflow.status = "running";
    workflow.executionHistory.unshift(execution);
    this.workflows.set(workflowId, workflow);

    this.addLog({
      level: "info",
      service: "system",
      action: "workflow_started",
      message: `Workflow "${workflow.name}" execution started`,
      workflowId,
    });

    return execution;
  }

  getExecution(id: string): WorkflowExecution | undefined {
    return this.executions.get(id);
  }

  updateExecution(
    id: string,
    updates: Partial<WorkflowExecution>,
  ): WorkflowExecution | undefined {
    const execution = this.executions.get(id);
    if (!execution) return undefined;

    const updated: WorkflowExecution = {
      ...execution,
      ...updates,
    };
    this.executions.set(id, updated);
    void saveWorkflowExecution(updated).catch((error) => {
      console.error("PostgreSQL execution update save failed:", error);
    });
    return updated;
  }
}

// Export singleton instance
export const dataStore = new DataStore();
