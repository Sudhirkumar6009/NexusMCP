import { randomUUID } from "node:crypto";

import { dataStore } from "../data/store.js";
import { processMCPRequest } from "./mcp.js";
import {
  isPostgresReady,
  listMissingDetailMemory,
  saveStepRun,
  saveWorkflowDefinition,
  saveWorkflowExecution,
} from "./postgres-store.js";
import {
  buildJiraIssueLoopSignal,
  buildSlackLoopSignals,
  rememberGithubRefLoopSignal,
  rememberOutboundWebhookSignals,
} from "./webhook-loop-guard.js";
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

type RetryPlanStep = {
  id: string;
  method: string;
};

type LinearExecutionContext = Record<string, string>;

type LinearWorkflowStepPlan = {
  id: string;
  nodeId: string;
  label: string;
  method: string;
  service: NodeService;
  buildInput: (context: LinearExecutionContext) => Record<string, unknown>;
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
  deliveryId: string;
  repository: string;
  ref: string;
  baseRef: string;
  defaultBranch: string;
  sender: string;
  pusher: string;
  before: string;
  after: string;
  pullRequestMerged: boolean;
  mergedToDefault: boolean;
  commitCount: string;
  changedFiles: string;
  compareUrl: string;
  headCommitMessage: string;
  issueKey: string;
};

type ExecutionResult = {
  workflowId: string;
  executionId: string;
  status: "completed" | "failed";
  steps: WebhookStepResult[];
};

type MissingDetailsPayload = Record<string, string>;

type RetryStepRunSnapshot = {
  stepId?: string;
  toolName?: string;
  status?: string;
  outputPayload?: unknown;
};

type RetryReuseState = {
  completedStepIds: Set<string>;
  outputByStepId: Map<string, Record<string, unknown>>;
};

type GithubWorkflowExecutionOptions = {
  missingDetails?: Record<string, unknown>;
  retryOfExecutionId?: string;
  previousStepRuns?: RetryStepRunSnapshot[];
};

const GITHUB_DEFAULT_WORKFLOW_ID = "wf-webhook-github-default";
const GITHUB_DEFAULT_WORKFLOW_NAME = "GitHub Default Webhook Workflow";
const JIRA_DEFAULT_WORKFLOW_ID = "wf-webhook-jira-default";
const JIRA_DEFAULT_WORKFLOW_NAME = "Jira Default Webhook Workflow";
const SLACK_DEFAULT_WORKFLOW_ID = "wf-webhook-slack-default";
const SLACK_DEFAULT_WORKFLOW_NAME = "Slack Default Webhook Workflow";
const GITHUB_DEFAULT_WORKFLOW_OWNER =
  (process.env.WEBHOOK_WORKFLOW_OWNER_USER_ID ?? "").trim() || undefined;
const WEBHOOK_MISSING_DETAIL_MEMORY_SCOPE = "missing-details";
const WEBHOOK_MISSING_DETAIL_OWNER_USER_ID =
  (process.env.WEBHOOK_MISSING_DETAIL_OWNER_USER_ID ?? "").trim() || undefined;
const JIRA_EXISTING_ISSUE_STATUS = (
  process.env.JIRA_EXISTING_ISSUE_STATUS ??
  process.env.JIRA_NEW_ISSUE_DEFAULT_STATUS ??
  "In Progress"
).trim();
const JIRA_MERGED_BRANCH_DONE_STATUS = (
  process.env.JIRA_MERGED_BRANCH_DONE_STATUS ?? "Done"
).trim();
const GITHUB_CREATE_JIRA_WHEN_NO_ISSUE_KEY =
  (process.env.GITHUB_CREATE_JIRA_WHEN_NO_ISSUE_KEY ?? "false")
    .trim()
    .toLowerCase() === "true";
const ISSUE_KEY_REGEX = /\b([a-z][a-z0-9]+-\d+)\b/i;

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

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return (
      normalized === "true" ||
      normalized === "1" ||
      normalized === "yes" ||
      normalized === "y"
    );
  }

  return false;
}

function extractIssueKeyFromText(value: unknown): string {
  const text = asString(value);
  if (!text) {
    return "";
  }

  const matched = text.match(ISSUE_KEY_REGEX);
  return matched?.[1] ? matched[1].toUpperCase() : "";
}

function resolveFirstIssueKey(candidates: unknown[]): string {
  for (const candidate of candidates) {
    const issueKey = extractIssueKeyFromText(candidate);
    if (issueKey) {
      return issueKey;
    }
  }

  return "";
}

function normalizeGitBranchName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "");
}

function shouldMarkDoneForGitHubEvent(
  context: GithubExecutionContext,
): boolean {
  if (!context.pullRequestMerged) {
    return false;
  }

  if (context.mergedToDefault) {
    return true;
  }

  const normalizedBase = normalizeGitBranchName(context.baseRef || context.ref);
  const normalizedDefault = normalizeGitBranchName(context.defaultBranch);

  if (!normalizedBase) {
    return false;
  }

  return (
    normalizedBase === normalizedDefault ||
    normalizedBase === "main" ||
    normalizedBase === "master"
  );
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asString(entry))
    .filter((entry) => entry.length > 0);
}

function truncateForEmail(value: string, max = 500): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, max - 3)}...`;
}

function formatEventTimestamp(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "n/a";
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    return normalized;
  }

  // Slack timestamps are typically seconds with fractional component.
  if (normalized.includes(".")) {
    return new Date(Math.floor(numeric * 1000)).toISOString();
  }

  // Heuristic: 13 digits -> ms, 10 digits -> s.
  const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  return new Date(Math.floor(millis)).toISOString();
}

async function resolveExecutionMissingDetails(
  payload?: Record<string, unknown>,
): Promise<MissingDetailsPayload> {
  const explicit = normalizeMissingDetails(payload);

  if (!isPostgresReady()) {
    return explicit;
  }

  try {
    const memoryRows = await listMissingDetailMemory({
      ownerUserId: WEBHOOK_MISSING_DETAIL_OWNER_USER_ID,
      scope: WEBHOOK_MISSING_DETAIL_MEMORY_SCOPE,
      limit: 500,
      offset: 0,
    });

    if (memoryRows.length === 0) {
      return explicit;
    }

    const fromMemory: MissingDetailsPayload = {};
    for (const row of memoryRows) {
      const key = normalizeMissingDetailKey(row.detailKey);
      const value = asString(row.detailValue);

      if (!key || !value || fromMemory[key]) {
        continue;
      }

      fromMemory[key] = value;
    }

    // Explicit values (manual retry payload) should always win.
    return {
      ...fromMemory,
      ...explicit,
    };
  } catch (error) {
    console.warn(
      `[WebhookExecutor] missing-detail memory lookup failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );

    return explicit;
  }
}

function isSuccessfulStepStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === "success" || normalized === "completed";
}

function resolveStepPlanIdFromRun(args: {
  stepPlan: RetryPlanStep[];
  run: RetryStepRunSnapshot;
}): string | null {
  const knownStepIds = new Set(args.stepPlan.map((step) => step.id));

  const rawStepId = asString(args.run.stepId);
  if (rawStepId) {
    const suffix = rawStepId.includes(":")
      ? rawStepId.slice(rawStepId.lastIndexOf(":") + 1)
      : rawStepId;

    if (knownStepIds.has(suffix)) {
      return suffix;
    }
  }

  const method = asString(args.run.toolName).toLowerCase();
  if (!method) {
    return null;
  }

  const matchedStep = args.stepPlan.find(
    (step) => step.method.toLowerCase() === method,
  );

  return matchedStep?.id ?? null;
}

function buildRetryReuseState(args: {
  stepPlan: RetryPlanStep[];
  previousStepRuns?: RetryStepRunSnapshot[];
}): RetryReuseState {
  const completedStepIds = new Set<string>();
  const outputByStepId = new Map<string, Record<string, unknown>>();

  const latestByStepId = new Map<
    string,
    { status: string; output: Record<string, unknown> }
  >();

  for (const run of args.previousStepRuns || []) {
    const stepId = resolveStepPlanIdFromRun({ stepPlan: args.stepPlan, run });
    if (!stepId || latestByStepId.has(stepId)) {
      continue;
    }

    latestByStepId.set(stepId, {
      status: asString(run.status),
      output: asRecord(run.outputPayload),
    });
  }

  for (const [stepId, row] of latestByStepId.entries()) {
    if (!isSuccessfulStepStatus(row.status)) {
      continue;
    }

    completedStepIds.add(stepId);
    outputByStepId.set(stepId, row.output);
  }

  return {
    completedStepIds,
    outputByStepId,
  };
}

function normalizeMissingDetailKey(rawKey: string): string {
  const normalized = rawKey
    .trim()
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[\s-]+/g, "_");

  if (!normalized) {
    return "";
  }

  if (
    normalized === "recipient" ||
    normalized === "recipient_email" ||
    normalized === "to_email" ||
    normalized === "email_to" ||
    normalized === "email_address" ||
    normalized === "receiver" ||
    normalized === "receiver_email"
  ) {
    return "to";
  }

  if (normalized === "spreadsheetid" || normalized === "sheetid") {
    return "sheet_id";
  }

  return normalized;
}

function normalizeMissingDetails(
  payload?: Record<string, unknown>,
): MissingDetailsPayload {
  if (!payload) {
    return {};
  }

  const normalized: MissingDetailsPayload = {};

  for (const [rawKey, rawValue] of Object.entries(payload)) {
    const key = rawKey.trim().toLowerCase();
    const value = asString(rawValue);

    if (!key || !value) {
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

function applyMissingDetailsToPayload(args: {
  method: string;
  payload: Record<string, unknown>;
  missingDetails: MissingDetailsPayload;
}): Record<string, unknown> {
  const missingKeys = Object.keys(args.missingDetails);
  if (missingKeys.length === 0) {
    return args.payload;
  }

  const methodName = args.method.trim().toLowerCase();
  const serviceName = methodName.split(".")[0] || "";
  const nextPayload: Record<string, unknown> = { ...args.payload };

  for (const [rawScopedKey, value] of Object.entries(args.missingDetails)) {
    const scopedKey = rawScopedKey.trim().toLowerCase();
    if (!scopedKey) {
      continue;
    }

    let scope = "";
    let targetKeyRaw = scopedKey;

    const scopeIndex = scopedKey.indexOf(".");
    if (scopeIndex > 0) {
      scope = scopedKey.slice(0, scopeIndex);
      targetKeyRaw = scopedKey.slice(scopeIndex + 1);
    }

    if (
      scope &&
      scope !== "any" &&
      scope !== "global" &&
      scope !== serviceName &&
      scope !== methodName
    ) {
      continue;
    }

    const targetKey = normalizeMissingDetailKey(targetKeyRaw);
    if (!targetKey) {
      continue;
    }

    const existing = nextPayload[targetKey];
    const isEmpty =
      existing === undefined ||
      existing === null ||
      (typeof existing === "string" && existing.trim().length === 0);

    if (isEmpty) {
      nextPayload[targetKey] = value;
    }
  }

  return nextPayload;
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
  const ref = asString(payload.ref);
  const baseRef = asString(payload.base_ref);
  const defaultBranch = asString(payload.default_branch) || "main";
  const issueKey = resolveFirstIssueKey([
    payload.issue_key,
    payload.head_ref,
    payload.ref,
    payload.pull_request_title,
    payload.head_commit_message,
  ]);
  const changedFiles = asStringArray(payload.changed_files)
    .slice(0, 30)
    .join(", ");

  return {
    event: event.event,
    deliveryId: asString(payload.delivery_id),
    repository: asString(payload.repository) || "unknown-repo",
    ref,
    baseRef,
    defaultBranch,
    sender: asString(payload.sender) || "unknown-user",
    pusher: asString(payload.pusher) || "unknown-pusher",
    before: asString(payload.before),
    after: asString(payload.after),
    pullRequestMerged: asBoolean(payload.pull_request_merged),
    mergedToDefault: asBoolean(payload.merged_to_default),
    commitCount: asString(payload.commit_count),
    changedFiles,
    compareUrl: asString(payload.compare_url),
    headCommitMessage: asString(payload.head_commit_message),
    issueKey,
  };
}

function captureLoopSignalsForSuccessfulStep(args: {
  stepId: string;
  executionId: string;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  issueKey: string;
}): void {
  if (args.stepId === "jira-create" || args.stepId === "jira-update") {
    const issueKey =
      args.issueKey ||
      asString(args.outputPayload.issueKey) ||
      asString(args.outputPayload.issue_key) ||
      asString(args.outputPayload.key) ||
      asString(args.inputPayload.issueKey) ||
      asString(args.inputPayload.issue_key);

    const issueSignal = buildJiraIssueLoopSignal(issueKey);
    if (issueSignal) {
      rememberOutboundWebhookSignals({
        source: "jira",
        signals: [issueSignal],
        executionId: args.executionId,
        stepId: args.stepId,
      });
    }

    return;
  }

  if (args.stepId === "slack-post") {
    const signals = buildSlackLoopSignals({
      channel: asString(args.inputPayload.channel),
      text: asString(args.inputPayload.text),
    });

    if (signals.length > 0) {
      rememberOutboundWebhookSignals({
        source: "slack",
        signals,
        executionId: args.executionId,
        stepId: args.stepId,
      });
    }

    return;
  }

  if (args.stepId === "github-create-branch") {
    const repository =
      asString(args.outputPayload.repo) ||
      asString(args.inputPayload.repo) ||
      asString(args.inputPayload.repository);

    const ref =
      asString(args.outputPayload.ref) ||
      asString(args.inputPayload.ref) ||
      (asString(args.outputPayload.branch_name) ||
      asString(args.inputPayload.branch_name)
        ? `refs/heads/${
            asString(args.outputPayload.branch_name) ||
            asString(args.inputPayload.branch_name)
          }`
        : "");

    rememberGithubRefLoopSignal({
      repository,
      ref,
      executionId: args.executionId,
      stepId: args.stepId,
    });
  }
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

function shortCommitHash(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  return normalized.slice(0, 7);
}

function buildWebhookEmailDetails(args: {
  context: GithubExecutionContext;
  workflowId: string;
  executionId: string;
  startedAt: string;
  retryOfExecutionId?: string;
  stepResults: WebhookStepResult[];
}): string {
  const commitBefore = shortCommitHash(args.context.before);
  const commitAfter = shortCommitHash(args.context.after);
  const commitRange =
    commitBefore && commitAfter
      ? `${commitBefore} -> ${commitAfter}`
      : commitAfter || commitBefore || "n/a";

  const completedSteps =
    args.stepResults.length > 0
      ? args.stepResults
          .map((step, index) => {
            const error = asString(step.error);
            return error
              ? `${index + 1}. ${step.method} | ${step.status.toUpperCase()} | ${error}`
              : `${index + 1}. ${step.method} | ${step.status.toUpperCase()}`;
          })
          .join("\n")
      : "No prior steps completed before email notification.";

  const lines = [
    "Workflow Execution Summary",
    `Workflow: ${GITHUB_DEFAULT_WORKFLOW_NAME}`,
    `Workflow ID: ${args.workflowId}`,
    `Execution ID: ${args.executionId}`,
    `Started At: ${args.startedAt}`,
    `Generated At: ${nowIso()}`,
    `Trigger Event: ${args.context.event}`,
    `Delivery ID: ${args.context.deliveryId || "n/a"}`,
    `Repository: ${args.context.repository}`,
    `Ref: ${args.context.ref || "n/a"}`,
    `Sender: ${args.context.sender}`,
    `Pusher: ${args.context.pusher}`,
    `Commit Range: ${commitRange}`,
    `Commit Count: ${args.context.commitCount || "n/a"}`,
    `Changed Files: ${args.context.changedFiles || "n/a"}`,
    `Head Commit Message: ${truncateForEmail(args.context.headCommitMessage, 300) || "n/a"}`,
    `Compare URL: ${args.context.compareUrl || "n/a"}`,
    `Jira Issue: ${args.context.issueKey || "not-created"}`,
  ];

  if (args.retryOfExecutionId) {
    lines.push(`Retry Of Execution: ${args.retryOfExecutionId}`);
  }

  lines.push("", "Completed Steps:", completedSteps);

  return lines.join("\n");
}

function extractIssueKeyFromOutput(
  outputPayload: Record<string, unknown>,
): string {
  return (
    asString(outputPayload.issueKey) ||
    asString(outputPayload.issue_key) ||
    asString(outputPayload.key)
  );
}

function buildGithubWorkflowGraph(context: GithubExecutionContext): {
  nodes: Workflow["nodes"];
  edges: Workflow["edges"];
} {
  const hasExistingIssue = Boolean(context.issueKey);
  const includeJiraStep =
    hasExistingIssue || GITHUB_CREATE_JIRA_WHEN_NO_ISSUE_KEY;

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
    ...(includeJiraStep
      ? [
          {
            id: "step-jira",
            type: "action" as const,
            service: "jira" as const,
            operation: hasExistingIssue ? "update-issue" : "create-issue",
            label: hasExistingIssue
              ? "Update Jira Ticket"
              : "Create Jira Ticket",
            config: {},
            position: { x: 420, y: 80 },
            status: "pending" as const,
          },
        ]
      : []),
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

  const edges: Workflow["edges"] = includeJiraStep
    ? [
        {
          id: "edge-github-jira",
          source: "trigger-github",
          target: "step-jira",
        },
        { id: "edge-jira-slack", source: "step-jira", target: "step-slack" },
        {
          id: "edge-slack-sheets",
          source: "step-slack",
          target: "step-sheets",
        },
        {
          id: "edge-sheets-gmail",
          source: "step-sheets",
          target: "step-gmail",
        },
      ]
    : [
        {
          id: "edge-github-slack",
          source: "trigger-github",
          target: "step-slack",
        },
        {
          id: "edge-slack-sheets",
          source: "step-slack",
          target: "step-sheets",
        },
        {
          id: "edge-sheets-gmail",
          source: "step-sheets",
          target: "step-gmail",
        },
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
  generatedSource: string;
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
        source: args.generatedSource,
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

function buildGithubStepPlan(
  context: GithubExecutionContext,
): WorkflowStepPlan[] {
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

  const hasExistingIssue = Boolean(context.issueKey);
  const shouldCreateNewIssue =
    !hasExistingIssue && GITHUB_CREATE_JIRA_WHEN_NO_ISSUE_KEY;
  const jiraUpdateStatus = shouldMarkDoneForGitHubEvent(context)
    ? JIRA_MERGED_BRANCH_DONE_STATUS
    : JIRA_EXISTING_ISSUE_STATUS;

  const jiraStep: WorkflowStepPlan | null = hasExistingIssue
    ? {
        id: "jira-update",
        nodeId: "step-jira",
        label: "Update Jira Ticket",
        method: "jira.update_issue",
        service: "jira",
        buildInput: () => ({
          issue_key: context.issueKey,
          status: jiraUpdateStatus,
          comment: shouldMarkDoneForGitHubEvent(context)
            ? `GitHub merge to mainline detected. Marking ${context.issueKey} as ${jiraUpdateStatus}.`
            : `GitHub webhook event ${context.event} detected. Updating ${context.issueKey} to ${jiraUpdateStatus}.`,
        }),
      }
    : shouldCreateNewIssue
      ? {
          id: "jira-create",
          nodeId: "step-jira",
          label: "Create Jira Ticket",
          method: "jira.create_issue",
          service: "jira",
          buildInput: (stepContext) => {
            const payload: Record<string, unknown> = {
              summary: `[Webhook] ${stepContext.repository} ${stepContext.ref || stepContext.event}`,
              description: [
                `Event: ${stepContext.event}`,
                `Repository: ${stepContext.repository}`,
                `Ref: ${stepContext.ref || "n/a"}`,
                `Sender: ${stepContext.sender}`,
                `Pusher: ${stepContext.pusher}`,
                `Before: ${stepContext.before || "n/a"}`,
                `After: ${stepContext.after || "n/a"}`,
              ].join("\n"),
              issue_type: "Task",
            };

            if (jiraProject) {
              payload.project = jiraProject;
            }

            return payload;
          },
        }
      : null;

  return [
    ...(jiraStep ? [jiraStep] : []),
    {
      id: "slack-post",
      nodeId: "step-slack",
      label: "Post to Slack",
      method: "slack.send_message",
      service: "slack",
      buildInput: (stepContext) => ({
        channel: slackChannel,
        text: stepContext.issueKey
          ? `GitHub webhook processed for ${stepContext.repository}. Jira ticket ${stepContext.issueKey} synced.`
          : GITHUB_CREATE_JIRA_WHEN_NO_ISSUE_KEY
            ? `GitHub webhook processed for ${stepContext.repository}. Jira ticket creation attempted.`
            : `GitHub webhook processed for ${stepContext.repository}. Jira ticket creation skipped (no Jira key found).`,
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
            delivery_id: context.deliveryId,
            repository: context.repository,
            ref: context.ref,
            sender: context.sender,
            pusher: context.pusher,
            issue_key: context.issueKey,
            before: context.before,
            after: context.after,
            event: context.event,
          },
          unique_by: ["delivery_id", "execution_id"],
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
  options?: GithubWorkflowExecutionOptions,
): Promise<ExecutionResult> {
  const missingDetails = await resolveExecutionMissingDetails(
    options?.missingDetails,
  );
  const missingDetailKeys = Object.keys(missingDetails);
  const context = buildGithubExecutionContext(event);
  const { nodes: initialNodes, edges } = buildGithubWorkflowGraph(context);
  let nodes = initialNodes;
  const description = buildGithubWorkflowDescription(context);
  const stepPlan = buildGithubStepPlan(context);
  const retryReuseState = buildRetryReuseState({
    stepPlan,
    previousStepRuns: options?.previousStepRuns,
  });

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
        eventPayload: {
          source: event.source,
          event: event.event,
          data: event.data,
        },
        retryOfExecutionId: options?.retryOfExecutionId,
        missingDetailKeys,
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

  for (const step of stepPlan) {
    const stepId = `${executionId}:${step.id}`;
    const baseInputPayload = {
      ...step.buildInput(context),
      workflowId,
      executionId,
      stepId,
      trigger: event.event,
    };

    const shouldReuseCompletedStep =
      Boolean(options?.retryOfExecutionId) &&
      retryReuseState.completedStepIds.has(step.id);

    if (shouldReuseCompletedStep) {
      const reusedOutput = {
        ...asRecord(retryReuseState.outputByStepId.get(step.id)),
        _reusedFromExecutionId: options?.retryOfExecutionId,
        _skippedOnRetry: true,
      };

      if (step.id === "jira-create" || step.id === "jira-update") {
        const issueKey = extractIssueKeyFromOutput(reusedOutput);
        if (issueKey) {
          context.issueKey = issueKey;
        }
      }

      if (usePostgres) {
        await saveStepRun({
          stepId,
          executionId,
          toolName: step.method,
          inputPayload: baseInputPayload,
          outputPayload: reusedOutput,
          status: "success",
          retryCount: 1,
        });
      }

      nodes = setNodeStatus(nodes, step.nodeId, "completed", {
        result: reusedOutput,
      });

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
        generatedSource: "webhook-github-default",
        triggerEvent: event.event,
      });

      dataStore.addLog({
        level: "info",
        service: toAuditService(step.service),
        action: "mcp_execute_node_reused",
        message: `${step.label} reused from previous execution`,
        workflowId,
        executionId,
        nodeId: step.nodeId,
        details: {
          method: step.method,
          reusedFromExecutionId: options?.retryOfExecutionId,
          output: reusedOutput,
          missingDetailKeys,
        },
      });

      stepResults.push({
        id: step.id,
        nodeId: step.nodeId,
        method: step.method,
        status: "success",
        output: reusedOutput,
      });

      continue;
    }

    const inputPayload = applyMissingDetailsToPayload({
      method: step.method,
      payload: baseInputPayload,
      missingDetails,
    });

    if (step.id === "gmail-send") {
      const existingSubject = asString(inputPayload.subject);
      const existingBody = asString(inputPayload.body);
      const detailedBody = buildWebhookEmailDetails({
        context,
        workflowId,
        executionId,
        startedAt,
        retryOfExecutionId: options?.retryOfExecutionId,
        stepResults,
      });

      inputPayload.subject = context.issueKey
        ? `[${context.issueKey}] ${existingSubject || `GitHub webhook workflow result: ${context.repository}`}`
        : existingSubject ||
          `GitHub webhook workflow result: ${context.repository}`;

      inputPayload.body = existingBody
        ? `${existingBody}\n\n---\n${detailedBody}`
        : detailedBody;
    }

    if (step.id === "sheets-add-row") {
      const row = asRecord(inputPayload.row);
      inputPayload.row = {
        ...row,
        execution_id: executionId,
        workflow_id: workflowId,
      };
    }

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
      generatedSource: "webhook-github-default",
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

    if (success && (step.id === "jira-create" || step.id === "jira-update")) {
      const issueKey = extractIssueKeyFromOutput(outputPayload);

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
        missingDetailKeys,
      },
    });

    if (success) {
      captureLoopSignalsForSuccessfulStep({
        stepId: step.id,
        executionId,
        inputPayload,
        outputPayload,
        issueKey: context.issueKey,
      });
    }

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
      generatedSource: "webhook-github-default",
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
    generatedSource: "webhook-github-default",
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
      eventPayload: {
        source: event.source,
        event: event.event,
        data: event.data,
      },
      stepResults,
      retryOfExecutionId: options?.retryOfExecutionId,
      missingDetailKeys,
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
  missingDetails?: Record<string, unknown>;
  retryOfExecutionId?: string;
  previousStepRuns?: RetryStepRunSnapshot[];
}): Promise<ExecutionResult | null> {
  if (args.workflow === "GITHUB_START_WORKFLOW") {
    return executeGithubDefaultWorkflow(args.event, {
      missingDetails: args.missingDetails,
      retryOfExecutionId: args.retryOfExecutionId,
      previousStepRuns: args.previousStepRuns,
    });
  }

  if (args.workflow === "JIRA_START_WORKFLOW") {
    const context = buildJiraExecutionContext(args.event);
    const { nodes, edges } = buildJiraWorkflowGraph(context);

    return executeLinearWebhookWorkflow({
      workflowId: JIRA_DEFAULT_WORKFLOW_ID,
      workflowName: JIRA_DEFAULT_WORKFLOW_NAME,
      generatedSource: "webhook-jira-default",
      event: args.event,
      context,
      description: buildJiraWorkflowDescription(context),
      nodes,
      edges,
      stepPlan: buildJiraStepPlan(),
      options: {
        missingDetails: args.missingDetails,
        retryOfExecutionId: args.retryOfExecutionId,
        previousStepRuns: args.previousStepRuns,
      },
    });
  }

  if (args.workflow === "SLACK_START_WORKFLOW") {
    const context = buildSlackExecutionContext(args.event);
    const { nodes, edges } = buildSlackWorkflowGraph(context);

    return executeLinearWebhookWorkflow({
      workflowId: SLACK_DEFAULT_WORKFLOW_ID,
      workflowName: SLACK_DEFAULT_WORKFLOW_NAME,
      generatedSource: "webhook-slack-default",
      event: args.event,
      context,
      description: buildSlackWorkflowDescription(context),
      nodes,
      edges,
      stepPlan: buildSlackStepPlan(context),
      options: {
        missingDetails: args.missingDetails,
        retryOfExecutionId: args.retryOfExecutionId,
        previousStepRuns: args.previousStepRuns,
      },
    });
  }

  return null;
}

function normalizeBranchSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

function getWebhookStepDefaults(): {
  jiraProject: string;
  slackChannel: string;
  sheetName: string;
  spreadsheetId: string;
  notifyEmail: string;
} {
  return {
    jiraProject: (process.env.JIRA_PROJECT_KEY ?? "").trim(),
    slackChannel: (process.env.SLACK_DEFAULT_CHANNEL ?? "#general").trim(),
    sheetName: (
      process.env.GOOGLE_SHEETS_SHEET_NAME ??
      process.env.GOOGLE_SHEETS_WORKSHEET ??
      "Sheet1"
    ).trim(),
    spreadsheetId: (
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID ??
      process.env.SPREADSHEET_ID ??
      ""
    ).trim(),
    notifyEmail: (
      process.env.WEBHOOK_NOTIFY_EMAIL ??
      process.env.GMAIL_DEFAULT_TO ??
      process.env.GMAIL_TO ??
      ""
    ).trim(),
  };
}

function buildJiraExecutionContext(
  event: NormalizedWebhookEvent,
): LinearExecutionContext {
  const payload = asRecord(event.data);

  return {
    source: event.source,
    event: event.event,
    timestamp: asString(payload.timestamp),
    issue_id: asString(payload.issue_id),
    issue_key: asString(payload.issue_key),
    issue_title: asString(payload.issue_title),
    issue_status: asString(payload.issue_status),
    issue_description: asString(payload.issue_description),
    project_key: asString(payload.project_key),
    user: asString(payload.user) || "unknown-user",
    branch_name: "",
  };
}

function buildSlackExecutionContext(
  event: NormalizedWebhookEvent,
): LinearExecutionContext {
  const payload = asRecord(event.data);
  const text = asString(payload.text);
  const channel =
    asString(payload.channel_name) ||
    asString(payload.channel) ||
    asString(payload.channel_id) ||
    "unknown-channel";
  const issueKey =
    resolveFirstIssueKey([
      payload.issue_key,
      payload.issueKey,
      payload.branch_name,
      payload.branch,
      payload.ref,
      text,
    ]) || asString(payload.issue_key).toUpperCase();

  return {
    source: event.source,
    event: event.event,
    text,
    user: asString(payload.user) || "unknown-user",
    channel,
    ts: asString(payload.ts),
    issue_id: asString(payload.issue_id) || asString(payload.issueId),
    issue_key: issueKey,
    issue_title: "",
    issue_status: asString(payload.issue_status),
    issue_description: "",
    branch_name: asString(payload.branch_name) || asString(payload.branch),
  };
}

function buildJiraWorkflowDescription(context: LinearExecutionContext): string {
  return [
    `Triggered by ${context.event}`,
    `Issue: ${context.issue_key || context.issue_id || "unknown"}`,
    `Status: ${context.issue_status || "unknown"}`,
    `User: ${context.user || "unknown-user"}`,
  ].join(" | ");
}

function buildSlackWorkflowDescription(
  context: LinearExecutionContext,
): string {
  const preview = context.text
    ? `${context.text.slice(0, 120)}${context.text.length > 120 ? "..." : ""}`
    : "(no text)";

  return [
    `Triggered by ${context.event}`,
    `Channel: ${context.channel || "unknown-channel"}`,
    `User: ${context.user || "unknown-user"}`,
    `Issue: ${context.issue_key || "new-ticket"}`,
    `Text: ${preview}`,
  ].join(" | ");
}

function buildJiraWorkflowGraph(context: LinearExecutionContext): {
  nodes: Workflow["nodes"];
  edges: Workflow["edges"];
} {
  return {
    nodes: [
      {
        id: "trigger-jira",
        type: "trigger",
        service: "jira",
        operation: context.event,
        label: "Jira Webhook Trigger",
        config: {
          event: context.event,
          issue_key: context.issue_key,
          project_key: context.project_key,
        },
        position: { x: 120, y: 80 },
        status: "completed",
      },
      {
        id: "step-jira-fetch",
        type: "action",
        service: "jira",
        operation: "get-issue",
        label: "Fetch Jira Issue",
        config: {},
        position: { x: 420, y: 80 },
        status: "pending",
      },
      {
        id: "step-github",
        type: "action",
        service: "github",
        operation: "create-branch",
        label: "Create GitHub Branch",
        config: {},
        position: { x: 720, y: 80 },
        status: "pending",
      },
      {
        id: "step-slack",
        type: "action",
        service: "slack",
        operation: "send-message",
        label: "Post to Slack",
        config: {},
        position: { x: 1020, y: 80 },
        status: "pending",
      },
      {
        id: "step-sheets",
        type: "action",
        service: "google_sheets",
        operation: "add-row",
        label: "Update Spreadsheet",
        config: {},
        position: { x: 1320, y: 80 },
        status: "pending",
      },
      {
        id: "step-gmail",
        type: "action",
        service: "gmail",
        operation: "send-email",
        label: "Send Email",
        config: {},
        position: { x: 1620, y: 80 },
        status: "pending",
      },
    ],
    edges: [
      {
        id: "edge-jira-fetch",
        source: "trigger-jira",
        target: "step-jira-fetch",
      },
      {
        id: "edge-jira-github",
        source: "step-jira-fetch",
        target: "step-github",
      },
      { id: "edge-github-slack", source: "step-github", target: "step-slack" },
      { id: "edge-slack-sheets", source: "step-slack", target: "step-sheets" },
      { id: "edge-sheets-gmail", source: "step-sheets", target: "step-gmail" },
    ],
  };
}

function buildSlackWorkflowGraph(context: LinearExecutionContext): {
  nodes: Workflow["nodes"];
  edges: Workflow["edges"];
} {
  const hasExistingIssue = Boolean(context.issue_key);

  return {
    nodes: [
      {
        id: "trigger-slack",
        type: "trigger",
        service: "slack",
        operation: context.event,
        label: "Slack Webhook Trigger",
        config: {
          event: context.event,
          channel: context.channel,
          user: context.user,
        },
        position: { x: 120, y: 80 },
        status: "completed",
      },
      {
        id: "step-jira",
        type: "action",
        service: "jira",
        operation: hasExistingIssue ? "update-issue" : "create-issue",
        label: hasExistingIssue ? "Update Jira Ticket" : "Create Jira Ticket",
        config: {},
        position: { x: 420, y: 80 },
        status: "pending",
      },
      {
        id: "step-github",
        type: "action",
        service: "github",
        operation: "create-branch",
        label: "Create GitHub Branch",
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
    ],
    edges: [
      { id: "edge-slack-jira", source: "trigger-slack", target: "step-jira" },
      { id: "edge-jira-github", source: "step-jira", target: "step-github" },
      {
        id: "edge-github-sheets",
        source: "step-github",
        target: "step-sheets",
      },
      { id: "edge-sheets-gmail", source: "step-sheets", target: "step-gmail" },
    ],
  };
}

function buildJiraStepPlan(): LinearWorkflowStepPlan[] {
  const defaults = getWebhookStepDefaults();

  return [
    {
      id: "jira-get-issue",
      nodeId: "step-jira-fetch",
      label: "Fetch Jira Issue",
      method: "jira.get_issue",
      service: "jira",
      buildInput: (context) => ({
        issue_id: context.issue_id || context.issue_key,
      }),
    },
    {
      id: "github-create-branch",
      nodeId: "step-github",
      label: "Create GitHub Branch",
      method: "github.create_branch",
      service: "github",
      buildInput: (context) => {
        const issueRef =
          context.issue_key ||
          context.issue_id ||
          context.project_key ||
          "jira";

        return {
          branch_name: `${normalizeBranchSegment(issueRef, "jira")}-branch`,
        };
      },
    },
    {
      id: "slack-post",
      nodeId: "step-slack",
      label: "Post to Slack",
      method: "slack.send_message",
      service: "slack",
      buildInput: (context) => ({
        channel: defaults.slackChannel,
        text: `Jira webhook processed for ${context.issue_key || context.issue_id || "unknown issue"}. Branch ${context.branch_name || "creation attempted"}.`,
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
          sheet_name: defaults.sheetName,
          row: {
            timestamp: nowIso(),
            event: context.event,
            issue_id: context.issue_id,
            issue_key: context.issue_key,
            issue_title: context.issue_title,
            issue_status: context.issue_status,
            project_key: context.project_key,
            branch_name: context.branch_name,
            user: context.user,
          },
          unique_by: ["issue_key", "execution_id"],
        };

        if (defaults.spreadsheetId) {
          payload.sheet_id = defaults.spreadsheetId;
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
        to: defaults.notifyEmail,
        subject: `Jira webhook workflow result: ${context.issue_key || context.issue_id || "unknown issue"}`,
        body: [
          `Issue: ${context.issue_key || context.issue_id || "unknown"}`,
          `Title: ${context.issue_title || "n/a"}`,
          `Status: ${context.issue_status || "n/a"}`,
          `Branch: ${context.branch_name || "n/a"}`,
          `Triggered By: ${context.user || "unknown-user"}`,
          `Event: ${context.event}`,
        ].join("\n"),
      }),
    },
  ];
}

function buildSlackStepPlan(
  context: LinearExecutionContext,
): LinearWorkflowStepPlan[] {
  const defaults = getWebhookStepDefaults();
  const hasExistingIssue = Boolean(context.issue_key);

  const jiraStep: LinearWorkflowStepPlan = hasExistingIssue
    ? {
        id: "jira-update",
        nodeId: "step-jira",
        label: "Update Jira Ticket",
        method: "jira.update_issue",
        service: "jira",
        buildInput: (stepContext) => ({
          issue_key: stepContext.issue_key || context.issue_key,
          status: JIRA_EXISTING_ISSUE_STATUS,
          comment: `Existing Jira issue detected from Slack event. Status updated to ${JIRA_EXISTING_ISSUE_STATUS}.`,
        }),
      }
    : {
        id: "jira-create",
        nodeId: "step-jira",
        label: "Create Jira Ticket",
        method: "jira.create_issue",
        service: "jira",
        buildInput: (stepContext) => {
          const textPreview = stepContext.text
            ? `${stepContext.text.slice(0, 100)}${stepContext.text.length > 100 ? "..." : ""}`
            : "No Slack message text";

          const payload: Record<string, unknown> = {
            summary: `[Slack] ${textPreview}`,
            description: [
              `Event: ${stepContext.event}`,
              `Channel: ${stepContext.channel || "unknown-channel"}`,
              `User: ${stepContext.user || "unknown-user"}`,
              `Text: ${stepContext.text || "(none)"}`,
            ].join("\n"),
            issue_type: "Task",
          };

          if (defaults.jiraProject) {
            payload.project = defaults.jiraProject;
          }

          return payload;
        },
      };

  return [
    jiraStep,
    {
      id: "github-create-branch",
      nodeId: "step-github",
      label: "Create GitHub Branch",
      method: "github.create_branch",
      service: "github",
      buildInput: (context) => {
        const branchHint =
          context.issue_key || context.channel || context.user || "slack";

        return {
          branch_name: `${normalizeBranchSegment(branchHint, "slack")}-workflow`,
        };
      },
    },
    {
      id: "sheets-add-row",
      nodeId: "step-sheets",
      label: "Update Spreadsheet",
      method: "sheets.add_row",
      service: "google_sheets",
      buildInput: (context) => {
        const payload: Record<string, unknown> = {
          sheet_name: defaults.sheetName,
          row: {
            timestamp: nowIso(),
            event: context.event,
            channel: context.channel,
            user: context.user,
            text: context.text,
            issue_key: context.issue_key,
            branch_name: context.branch_name,
            ts: context.ts,
          },
          unique_by: ["channel", "ts", "execution_id"],
        };

        if (defaults.spreadsheetId) {
          payload.sheet_id = defaults.spreadsheetId;
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
        to: defaults.notifyEmail,
        subject: `Slack webhook workflow result: ${context.channel || "unknown-channel"}`,
        body: [
          `Channel: ${context.channel || "unknown-channel"}`,
          `User: ${context.user || "unknown-user"}`,
          `Issue: ${context.issue_key || "not-created"}`,
          `Branch: ${context.branch_name || "n/a"}`,
          `Text: ${context.text || "(none)"}`,
          `Event: ${context.event}`,
        ].join("\n"),
      }),
    },
  ];
}

function updateLinearContextFromStep(args: {
  stepId: string;
  context: LinearExecutionContext;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
}): void {
  if (
    args.stepId === "jira-create" ||
    args.stepId === "jira-get-issue" ||
    args.stepId === "jira-update"
  ) {
    const issueKey =
      extractIssueKeyFromOutput(args.outputPayload) ||
      extractIssueKeyFromText(args.inputPayload.issue_key) ||
      extractIssueKeyFromText(args.inputPayload.issueKey);
    if (issueKey) {
      args.context.issue_key = issueKey;
    }

    const issueId =
      asString(args.outputPayload.id) || asString(args.outputPayload.issue_id);
    if (issueId) {
      args.context.issue_id = issueId;
    }

    const summary =
      asString(args.outputPayload.summary) ||
      asString(args.outputPayload.title);
    if (summary) {
      args.context.issue_title = summary;
    }

    const status =
      asString(args.outputPayload.status) || asString(args.inputPayload.status);
    if (status) {
      args.context.issue_status = status;
    }

    const description =
      asString(args.outputPayload.description) ||
      asString(args.outputPayload.issue_description);
    if (description) {
      args.context.issue_description = description;
    }

    return;
  }

  if (args.stepId === "github-create-branch") {
    const branchName =
      asString(args.outputPayload.branch_name) ||
      asString(args.outputPayload.branch) ||
      asString(args.inputPayload.branch_name) ||
      asString(args.inputPayload.branch);

    if (branchName) {
      args.context.branch_name = branchName;
    }
  }
}

function buildLinearWorkflowEmailDetails(args: {
  workflowName: string;
  workflowId: string;
  executionId: string;
  startedAt: string;
  retryOfExecutionId?: string;
  event: NormalizedWebhookEvent;
  context: LinearExecutionContext;
  stepResults: WebhookStepResult[];
}): string {
  const completedSteps =
    args.stepResults.length > 0
      ? args.stepResults
          .map((step, index) => {
            const error = asString(step.error);
            return error
              ? `${index + 1}. ${step.method} | ${step.status.toUpperCase()} | ${error}`
              : `${index + 1}. ${step.method} | ${step.status.toUpperCase()}`;
          })
          .join("\n")
      : "No prior steps completed before email notification.";

  const lines = [
    "Workflow Execution Summary",
    `Workflow: ${args.workflowName}`,
    `Workflow ID: ${args.workflowId}`,
    `Execution ID: ${args.executionId}`,
    `Started At: ${args.startedAt}`,
    `Generated At: ${nowIso()}`,
    `Trigger Source: ${args.event.source}`,
    `Trigger Event: ${args.event.event}`,
  ];

  if (args.event.source === "slack") {
    lines.push(`Slack Channel: ${args.context.channel || "n/a"}`);
    lines.push(`Slack User: ${args.context.user || "n/a"}`);
    lines.push(
      `Slack Message Time: ${formatEventTimestamp(args.context.ts || "")}`,
    );
    lines.push(
      `Slack Message: ${truncateForEmail(args.context.text || "", 500) || "n/a"}`,
    );
  }

  if (args.event.source === "jira") {
    lines.push(
      `Jira Ticket: ${args.context.issue_key || args.context.issue_id || "n/a"}`,
    );
    lines.push(`Jira Title: ${args.context.issue_title || "n/a"}`);
    lines.push(
      `Jira Description: ${truncateForEmail(args.context.issue_description || "", 500) || "n/a"}`,
    );
    lines.push(`Jira Status: ${args.context.issue_status || "n/a"}`);
    lines.push(
      `Jira Timestamp: ${formatEventTimestamp(args.context.timestamp || "")}`,
    );
    lines.push(`Jira User: ${args.context.user || "n/a"}`);
  }

  if (args.context.issue_key || args.context.issue_id) {
    lines.push(
      `Issue: ${args.context.issue_key || args.context.issue_id || "unknown"}`,
    );
  }

  if (args.context.branch_name) {
    lines.push(`Branch: ${args.context.branch_name}`);
  }

  if (args.context.channel) {
    lines.push(`Channel: ${args.context.channel}`);
  }

  if (args.retryOfExecutionId) {
    lines.push(`Retry Of Execution: ${args.retryOfExecutionId}`);
  }

  lines.push("", "Completed Steps:", completedSteps);
  return lines.join("\n");
}

async function executeLinearWebhookWorkflow(args: {
  workflowId: string;
  workflowName: string;
  generatedSource: string;
  event: NormalizedWebhookEvent;
  context: LinearExecutionContext;
  description: string;
  nodes: Workflow["nodes"];
  edges: Workflow["edges"];
  stepPlan: LinearWorkflowStepPlan[];
  options?: GithubWorkflowExecutionOptions;
}): Promise<ExecutionResult> {
  const missingDetails = await resolveExecutionMissingDetails(
    args.options?.missingDetails,
  );
  const missingDetailKeys = Object.keys(missingDetails);
  const retryReuseState = buildRetryReuseState({
    stepPlan: args.stepPlan,
    previousStepRuns: args.options?.previousStepRuns,
  });

  const usePostgres = isPostgresReady();
  const startedAt = nowIso();
  let nodes = args.nodes;

  let workflowId = args.workflowId;
  let workflowCreatedAt = startedAt;

  if (usePostgres) {
    await saveWorkflowDefinition({
      id: workflowId,
      ownerUserId: GITHUB_DEFAULT_WORKFLOW_OWNER,
      name: args.workflowName,
      description: args.description,
      nodes,
      edges: args.edges,
      status: "running",
      createdAt: workflowCreatedAt,
      updatedAt: startedAt,
      generatedJson: {
        source: args.generatedSource,
        trigger: args.event.event,
      },
    });
  } else {
    const workflow = dataStore.createWorkflow({
      name: args.workflowName,
      description: args.description,
      nodes,
      edges: args.edges,
      status: "running",
      ownerUserId: GITHUB_DEFAULT_WORKFLOW_OWNER,
      generatedJson: {
        source: args.generatedSource,
        trigger: args.event.event,
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
      message: `Workflow "${args.workflowName}" execution started`,
      workflowId,
      executionId,
      details: {
        source: "webhook",
        trigger: args.event.event,
        eventPayload: {
          source: args.event.source,
          event: args.event.event,
          data: args.event.data,
        },
        retryOfExecutionId: args.options?.retryOfExecutionId,
        missingDetailKeys,
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

  for (const step of args.stepPlan) {
    const stepId = `${executionId}:${step.id}`;
    const baseInputPayload = {
      ...step.buildInput(args.context),
      workflowId,
      executionId,
      stepId,
      trigger: args.event.event,
    };

    const shouldReuseCompletedStep =
      Boolean(args.options?.retryOfExecutionId) &&
      retryReuseState.completedStepIds.has(step.id);

    if (shouldReuseCompletedStep) {
      const reusedOutput = {
        ...asRecord(retryReuseState.outputByStepId.get(step.id)),
        _reusedFromExecutionId: args.options?.retryOfExecutionId,
        _skippedOnRetry: true,
      };

      updateLinearContextFromStep({
        stepId: step.id,
        context: args.context,
        inputPayload: baseInputPayload,
        outputPayload: reusedOutput,
      });

      if (usePostgres) {
        await saveStepRun({
          stepId,
          executionId,
          toolName: step.method,
          inputPayload: baseInputPayload,
          outputPayload: reusedOutput,
          status: "success",
          retryCount: 1,
        });
      }

      nodes = setNodeStatus(nodes, step.nodeId, "completed", {
        result: reusedOutput,
      });

      await persistWorkflowSnapshot({
        usePostgres,
        workflowId,
        ownerUserId: GITHUB_DEFAULT_WORKFLOW_OWNER,
        name: args.workflowName,
        description: args.description,
        nodes,
        edges: args.edges,
        status: "running",
        createdAt: workflowCreatedAt,
        updatedAt: nowIso(),
        generatedSource: args.generatedSource,
        triggerEvent: args.event.event,
      });

      dataStore.addLog({
        level: "info",
        service: toAuditService(step.service),
        action: "mcp_execute_node_reused",
        message: `${step.label} reused from previous execution`,
        workflowId,
        executionId,
        nodeId: step.nodeId,
        details: {
          method: step.method,
          reusedFromExecutionId: args.options?.retryOfExecutionId,
          output: reusedOutput,
          missingDetailKeys,
        },
      });

      stepResults.push({
        id: step.id,
        nodeId: step.nodeId,
        method: step.method,
        status: "success",
        output: reusedOutput,
      });

      continue;
    }

    const inputPayload = applyMissingDetailsToPayload({
      method: step.method,
      payload: baseInputPayload,
      missingDetails,
    });

    if (step.id === "sheets-add-row") {
      const row = asRecord(inputPayload.row);
      inputPayload.row = {
        ...row,
        execution_id: executionId,
        workflow_id: workflowId,
      };
    }

    if (step.id === "gmail-send") {
      const existingSubject = asString(inputPayload.subject);
      const existingBody = asString(inputPayload.body);
      const issueKey = args.context.issue_key || args.context.issue_id;
      const detailedBody = buildLinearWorkflowEmailDetails({
        workflowName: args.workflowName,
        workflowId,
        executionId,
        startedAt,
        retryOfExecutionId: args.options?.retryOfExecutionId,
        event: args.event,
        context: args.context,
        stepResults,
      });

      inputPayload.subject = issueKey
        ? `[${issueKey}] ${existingSubject || `${args.workflowName} result`}`
        : existingSubject || `${args.workflowName} result`;

      inputPayload.body = existingBody
        ? `${existingBody}\n\n---\n${detailedBody}`
        : detailedBody;
    }

    nodes = setNodeStatus(nodes, step.nodeId, "running");
    await persistWorkflowSnapshot({
      usePostgres,
      workflowId,
      ownerUserId: GITHUB_DEFAULT_WORKFLOW_OWNER,
      name: args.workflowName,
      description: args.description,
      nodes,
      edges: args.edges,
      status: "running",
      createdAt: workflowCreatedAt,
      updatedAt: nowIso(),
      generatedSource: args.generatedSource,
      triggerEvent: args.event.event,
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

    if (success) {
      updateLinearContextFromStep({
        stepId: step.id,
        context: args.context,
        inputPayload,
        outputPayload,
      });
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
        missingDetailKeys,
      },
    });

    if (success) {
      captureLoopSignalsForSuccessfulStep({
        stepId: step.id,
        executionId,
        inputPayload,
        outputPayload,
        issueKey: args.context.issue_key || "",
      });
    }

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
      name: args.workflowName,
      description: args.description,
      nodes,
      edges: args.edges,
      status: "running",
      createdAt: workflowCreatedAt,
      updatedAt: nowIso(),
      generatedSource: args.generatedSource,
      triggerEvent: args.event.event,
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
    name: args.workflowName,
    description: args.description,
    nodes,
    edges: args.edges,
    status: finalStatus,
    createdAt: workflowCreatedAt,
    updatedAt: completedAt,
    generatedSource: args.generatedSource,
    triggerEvent: args.event.event,
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
        ? `Workflow "${args.workflowName}" execution completed`
        : `Workflow "${args.workflowName}" execution failed`,
    workflowId,
    executionId,
    details: {
      trigger: args.event.event,
      eventPayload: {
        source: args.event.source,
        event: args.event.event,
        data: args.event.data,
      },
      stepResults,
      retryOfExecutionId: args.options?.retryOfExecutionId,
      missingDetailKeys,
    },
  });

  return {
    workflowId,
    executionId,
    status: finalStatus,
    steps: stepResults,
  };
}
