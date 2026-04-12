import { randomUUID } from "node:crypto";

import { dataStore } from "../data/store.js";
import { processMCPRequest } from "./mcp.js";
import {
  isPostgresReady,
  saveStepRun,
  saveWorkflowDefinition,
  saveWorkflowExecution,
} from "./postgres-store.js";
import type { MCPResponse, Workflow } from "../types/index.js";
import type {
  NormalizedWebhookEvent,
  RoutedWorkflow,
} from "../types/webhook.js";

type StepStatus = Workflow["nodes"][number]["status"];
type NodeService = Workflow["nodes"][number]["service"];

type WorkflowStepPlan = {
  id: string;
  nodeId: string;
  label: string;
  method: string;
  service: NodeService;
  buildInput: (context: GithubExecutionContext) => Record<string, unknown>;
};

type WebhookStepResult = {
  id: string;
  nodeId: string;
  method: string;
  status: "success" | "failed";
  output?: unknown;
  error?: string;
};

type GithubExecutionContext = {
  event: string;
  repository: string;
  ref: string;
  sender: string;
  pusher: string;
  before: string;
  after: string;
  issueKey: string;
};

type ExecutionResult = {
  workflowId: string;
  executionId: string;
  status: "completed" | "failed";
  steps: WebhookStepResult[];
};

const GITHUB_DEFAULT_WORKFLOW_ID = "wf-webhook-github-default";
const GITHUB_DEFAULT_WORKFLOW_NAME = "GitHub Default Webhook Workflow";
const GITHUB_DEFAULT_WORKFLOW_OWNER =
  (process.env.WEBHOOK_WORKFLOW_OWNER_USER_ID ?? "").trim() || undefined;

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function toAuditService(
  service: NodeService,
):
  | "jira"
  | "slack"
  | "github"
  | "postgres"
  | "google_sheets"
  | "gmail"
  | "system" {
  if (service === "jira") return "jira";
  if (service === "slack") return "slack";
  if (service === "github") return "github";
  if (service === "gmail") return "gmail";
  if (service === "google_sheets") return "google_sheets";
  if (service === "postgres") return "postgres";
  return "system";
}

function buildGithubExecutionContext(
  event: NormalizedWebhookEvent,
): GithubExecutionContext {
  const payload = asRecord(event.data);

  return {
    event: event.event,
    repository: asString(payload.repository) || "unknown-repo",
    ref: asString(payload.ref),
    sender: asString(payload.sender) || "unknown-user",
    pusher: asString(payload.pusher) || "unknown-pusher",
    before: asString(payload.before),
    after: asString(payload.after),
    issueKey: "",
  };
}

function buildGithubWorkflowDescription(
  context: GithubExecutionContext,
): string {
  const triggerLine = `Triggered by ${context.event}`;
  const repoLine = `Repository: ${context.repository}`;
  const refLine = context.ref ? `Ref: ${context.ref}` : "Ref: n/a";
  const actorLine = `Actor: ${context.sender}`;

  return `${triggerLine} | ${repoLine} | ${refLine} | ${actorLine}`;
}

function buildGithubWorkflowGraph(context: GithubExecutionContext): {
  nodes: Workflow["nodes"];
  edges: Workflow["edges"];
} {
  const nodes: Workflow["nodes"] = [
    {
      id: "trigger-github",
      type: "trigger",
      service: "github",
      operation: context.event,
      label: "GitHub Webhook Trigger",
      config: {
        event: context.event,
        repository: context.repository,
        ref: context.ref,
      },
      position: { x: 120, y: 80 },
      status: "completed",
    },
    {
      id: "step-jira",
      type: "action",
      service: "jira",
      operation: "create-issue",
      label: "Create Jira Ticket",
      config: {},
      position: { x: 420, y: 80 },
      status: "pending",
    },
    {
      id: "step-slack",
      type: "action",
      service: "slack",
      operation: "send-message",
      label: "Post to Slack",
      config: {},
      position: { x: 720, y: 80 },
      status: "pending",
    },
    {
      id: "step-sheets",
      type: "action",
      service: "google_sheets",
      operation: "add-row",
      label: "Update Spreadsheet",
      config: {},
      position: { x: 1020, y: 80 },
      status: "pending",
    },
    {
      id: "step-gmail",
      type: "action",
      service: "gmail",
      operation: "send-email",
      label: "Send Email",
      config: {},
      position: { x: 1320, y: 80 },
      status: "pending",
    },
  ];

  const edges: Workflow["edges"] = [
    { id: "edge-github-jira", source: "trigger-github", target: "step-jira" },
    { id: "edge-jira-slack", source: "step-jira", target: "step-slack" },
    { id: "edge-slack-sheets", source: "step-slack", target: "step-sheets" },
    { id: "edge-sheets-gmail", source: "step-sheets", target: "step-gmail" },
  ];

  return {
    nodes,
    edges,
  };
}

function setNodeStatus(
  nodes: Workflow["nodes"],
  nodeId: string,
  status: StepStatus,
  details?: { result?: unknown; error?: string },
): Workflow["nodes"] {
  return nodes.map((node) => {
    if (node.id !== nodeId) {
      return node;
    }

    return {
      ...node,
      status,
      ...(details?.result !== undefined ? { result: details.result } : {}),
      ...(details?.error !== undefined ? { error: details.error } : {}),
    };
  });
}

async function persistWorkflowSnapshot(args: {
  usePostgres: boolean;
  workflowId: string;
  ownerUserId?: string;
  name: string;
  description: string;
  nodes: Workflow["nodes"];
  edges: Workflow["edges"];
  status: Workflow["status"];
  createdAt: string;
  updatedAt: string;
  triggerEvent: string;
}): Promise<void> {
  if (args.usePostgres) {
    await saveWorkflowDefinition({
      id: args.workflowId,
      ownerUserId: args.ownerUserId,
      name: args.name,
      description: args.description,
      nodes: args.nodes,
      edges: args.edges,
      status: args.status,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
      generatedJson: {
        source: "webhook-github-default",
        trigger: args.triggerEvent,
      },
    });

    return;
  }

  dataStore.updateWorkflow(args.workflowId, {
    name: args.name,
    description: args.description,
    nodes: args.nodes,
    edges: args.edges,
    status: args.status,
  });
}

function toResponseOutput(response: MCPResponse): Record<string, unknown> {
  if (response.error) {
    return {
      error: response.error,
    };
  }

  return asRecord(response.result);
}

function buildGithubStepPlan(): WorkflowStepPlan[] {
  const jiraProject = (process.env.JIRA_PROJECT_KEY ?? "").trim();
  const slackChannel = (process.env.SLACK_DEFAULT_CHANNEL ?? "#general").trim();
  const sheetName = (
    process.env.GOOGLE_SHEETS_SHEET_NAME ??
    process.env.GOOGLE_SHEETS_WORKSHEET ??
    "Sheet1"
  ).trim();
  const spreadsheetId = (
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID ??
    process.env.SPREADSHEET_ID ??
    ""
  ).trim();
  const notifyEmail = (
    process.env.WEBHOOK_NOTIFY_EMAIL ??
    process.env.GMAIL_DEFAULT_TO ??
    process.env.GMAIL_TO ??
    ""
  ).trim();

  return [
    {
      id: "jira-create",
      nodeId: "step-jira",
      label: "Create Jira Ticket",
      method: "jira.create_issue",
      service: "jira",
      buildInput: (context) => {
        const payload: Record<string, unknown> = {
          summary: `[Webhook] ${context.repository} ${context.ref || context.event}`,
          description: [
            `Event: ${context.event}`,
            `Repository: ${context.repository}`,
            `Ref: ${context.ref || "n/a"}`,
            `Sender: ${context.sender}`,
            `Pusher: ${context.pusher}`,
            `Before: ${context.before || "n/a"}`,
            `After: ${context.after || "n/a"}`,
          ].join("\n"),
          issue_type: "Task",
        };

        if (jiraProject) {
          payload.project = jiraProject;
        }

        return payload;
      },
    },
    {
      id: "slack-post",
      nodeId: "step-slack",
      label: "Post to Slack",
      method: "slack.send_message",
      service: "slack",
      buildInput: (context) => ({
        channel: slackChannel,
        text: context.issueKey
          ? `GitHub webhook processed for ${context.repository}. Jira ticket ${context.issueKey} created.`
          : `GitHub webhook processed for ${context.repository}. Jira ticket creation attempted.`,
      }),
    },
    {
      id: "sheets-add-row",
      nodeId: "step-sheets",
      label: "Update Spreadsheet",
      method: "sheets.add_row",
      service: "google_sheets",
      buildInput: (context) => {
        const payload: Record<string, unknown> = {
          sheet_name: sheetName,
          row: {
            timestamp: nowIso(),
            repository: context.repository,
            ref: context.ref,
            sender: context.sender,
            pusher: context.pusher,
            issue_key: context.issueKey,
            before: context.before,
            after: context.after,
            event: context.event,
          },
          unique_by: ["repository", "after", "event"],
        };

        if (spreadsheetId) {
          payload.sheet_id = spreadsheetId;
        }

        return payload;
      },
    },
    {
      id: "gmail-send",
      nodeId: "step-gmail",
      label: "Send Email",
      method: "gmail.send_email",
      service: "gmail",
      buildInput: (context) => ({
        to: notifyEmail,
        subject: `GitHub webhook workflow result: ${context.repository}`,
        body: [
          `Repository: ${context.repository}`,
          `Ref: ${context.ref || "n/a"}`,
          `Sender: ${context.sender}`,
          `Issue: ${context.issueKey || "not-created"}`,
          `Event: ${context.event}`,
        ].join("\n"),
      }),
    },
  ];
}

async function executeGithubDefaultWorkflow(
  event: NormalizedWebhookEvent,
): Promise<ExecutionResult> {
  const context = buildGithubExecutionContext(event);
  const { nodes: initialNodes, edges } = buildGithubWorkflowGraph(context);
  let nodes = initialNodes;
  const description = buildGithubWorkflowDescription(context);

  const usePostgres = isPostgresReady();
  const startedAt = nowIso();

  let workflowId = GITHUB_DEFAULT_WORKFLOW_ID;
  let workflowCreatedAt = startedAt;

  if (usePostgres) {
    await saveWorkflowDefinition({
      id: workflowId,
      ownerUserId: GITHUB_DEFAULT_WORKFLOW_OWNER,
      name: GITHUB_DEFAULT_WORKFLOW_NAME,
      description,
      nodes,
      edges,
      status: "running",
      createdAt: workflowCreatedAt,
      updatedAt: startedAt,
      generatedJson: {
        source: "webhook-github-default",
        trigger: event.event,
      },
    });
  } else {
    const workflow = dataStore.createWorkflow({
      name: GITHUB_DEFAULT_WORKFLOW_NAME,
      description,
      nodes,
      edges,
      status: "running",
      ownerUserId: GITHUB_DEFAULT_WORKFLOW_OWNER,
      generatedJson: {
        source: "webhook-github-default",
        trigger: event.event,
      },
    });

    workflowId = workflow.id;
    workflowCreatedAt = workflow.createdAt;
  }

  let executionId = `exec-${randomUUID()}`;
  if (usePostgres) {
    await saveWorkflowExecution({
      id: executionId,
      workflowId,
      status: "running",
      startedAt,
    });

    dataStore.addLog({
      level: "info",
      service: "system",
      action: "workflow_started",
      message: `Workflow "${GITHUB_DEFAULT_WORKFLOW_NAME}" execution started`,
      workflowId,
      executionId,
      details: {
        source: "webhook",
        trigger: event.event,
        repository: context.repository,
      },
    });
  } else {
    const execution = dataStore.createExecution(workflowId);
    if (execution) {
      executionId = execution.id;
    }
  }

  const stepResults: WebhookStepResult[] = [];
  let hasFailures = false;

  for (const step of buildGithubStepPlan()) {
    const stepId = `${executionId}:${step.id}`;
    const inputPayload = {
      ...step.buildInput(context),
      workflowId,
      executionId,
      stepId,
      trigger: event.event,
    };

    nodes = setNodeStatus(nodes, step.nodeId, "running");
    await persistWorkflowSnapshot({
      usePostgres,
      workflowId,
      ownerUserId: GITHUB_DEFAULT_WORKFLOW_OWNER,
      name: GITHUB_DEFAULT_WORKFLOW_NAME,
      description,
      nodes,
      edges,
      status: "running",
      createdAt: workflowCreatedAt,
      updatedAt: nowIso(),
      triggerEvent: event.event,
    });

    if (usePostgres) {
      await saveStepRun({
        stepId,
        executionId,
        toolName: step.method,
        inputPayload,
        status: "running",
        retryCount: 0,
      });
    }

    const response = await processMCPRequest({
      jsonrpc: "2.0",
      id: `${executionId}-${step.id}`,
      method: step.method,
      params: inputPayload,
    });

    const outputPayload = toResponseOutput(response);
    const success = !response.error;

    if (success && step.id === "jira-create") {
      const issueKey =
        asString(outputPayload.issueKey) ||
        asString(outputPayload.issue_key) ||
        asString(outputPayload.key);

      if (issueKey) {
        context.issueKey = issueKey;
      }
    }

    if (usePostgres) {
      await saveStepRun({
        stepId,
        executionId,
        toolName: step.method,
        inputPayload,
        outputPayload,
        status: success ? "success" : "failed",
        retryCount: 0,
      });
    }

    dataStore.addLog({
      level: success ? "info" : "error",
      service: toAuditService(step.service),
      action: "mcp_execute_node",
      message: success ? `${step.label} completed` : `${step.label} failed`,
      workflowId,
      executionId,
      nodeId: step.nodeId,
      details: {
        method: step.method,
        input: inputPayload,
        output: outputPayload,
        hasError: !success,
      },
    });

    stepResults.push({
      id: step.id,
      nodeId: step.nodeId,
      method: step.method,
      status: success ? "success" : "failed",
      output: response.result,
      error: response.error?.message,
    });

    if (!success) {
      hasFailures = true;
      nodes = setNodeStatus(nodes, step.nodeId, "failed", {
        error: response.error?.message || "Step failed",
      });
    } else {
      nodes = setNodeStatus(nodes, step.nodeId, "completed", {
        result: response.result,
      });
    }

    await persistWorkflowSnapshot({
      usePostgres,
      workflowId,
      ownerUserId: GITHUB_DEFAULT_WORKFLOW_OWNER,
      name: GITHUB_DEFAULT_WORKFLOW_NAME,
      description,
      nodes,
      edges,
      status: "running",
      createdAt: workflowCreatedAt,
      updatedAt: nowIso(),
      triggerEvent: event.event,
    });
  }

  const finalStatus: "completed" | "failed" = hasFailures
    ? "failed"
    : "completed";
  const completedAt = nowIso();

  await persistWorkflowSnapshot({
    usePostgres,
    workflowId,
    ownerUserId: GITHUB_DEFAULT_WORKFLOW_OWNER,
    name: GITHUB_DEFAULT_WORKFLOW_NAME,
    description,
    nodes,
    edges,
    status: finalStatus,
    createdAt: workflowCreatedAt,
    updatedAt: completedAt,
    triggerEvent: event.event,
  });

  if (usePostgres) {
    await saveWorkflowExecution({
      id: executionId,
      workflowId,
      status: finalStatus,
      startedAt,
      completedAt,
    });
  } else {
    dataStore.updateExecution(executionId, {
      status: finalStatus,
      completedAt,
    });
    dataStore.updateWorkflow(workflowId, {
      status: finalStatus,
    });
  }

  dataStore.addLog({
    level: finalStatus === "completed" ? "info" : "error",
    service: "system",
    action:
      finalStatus === "completed" ? "workflow_completed" : "workflow_failed",
    message:
      finalStatus === "completed"
        ? `Workflow "${GITHUB_DEFAULT_WORKFLOW_NAME}" execution completed`
        : `Workflow "${GITHUB_DEFAULT_WORKFLOW_NAME}" execution failed`,
    workflowId,
    executionId,
    details: {
      trigger: event.event,
      repository: context.repository,
      stepResults,
    },
  });

  return {
    workflowId,
    executionId,
    status: finalStatus,
    steps: stepResults,
  };
}

export async function executeWebhookWorkflow(args: {
  workflow: RoutedWorkflow;
  event: NormalizedWebhookEvent;
}): Promise<ExecutionResult | null> {
  if (args.workflow !== "GITHUB_START_WORKFLOW") {
    return null;
  }

  return executeGithubDefaultWorkflow(args.event);
}
