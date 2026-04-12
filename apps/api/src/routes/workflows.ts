import { Router } from "express";
import { dataStore } from "../data/store.js";
import type { Workflow } from "../types/index.js";
import {
  deleteWorkflowExecutionArtifacts,
  deleteMissingDetailMemory,
  deleteWorkflowDefinition,
  getEventLogs,
  getStepRuns,
  getWorkflowDefinition,
  isPostgresReady,
  listMissingDetailMemory,
  listWorkflowDefinitions,
  saveWorkflowDefinition,
  upsertMissingDetailMemory,
  type MissingDetailMemoryRecord,
  type StepRunRecord,
} from "../services/postgres-store.js";
import { executeWebhookWorkflow } from "../services/webhook-workflow-executor.js";
import type { NormalizedWebhookEvent } from "../types/webhook.js";

const router = Router();

const AGENTIC_SERVICE_URL = (
  process.env.AGENTIC_SERVICE_URL ?? "http://localhost:8010"
).replace(/\/$/, "");
const AGENTIC_SERVICE_TIMEOUT_MS = Number(
  process.env.AGENTIC_SERVICE_TIMEOUT_MS ?? "60000",
);

type AuthenticatedRequest = {
  userId?: string;
};

type WorkflowNodeType = Workflow["nodes"][number]["type"];
type WorkflowNodeService = Workflow["nodes"][number]["service"];

type WorkflowListScope = "all" | "default" | "user";

type DefaultWorkflowTemplate = {
  id: "GITHUB_START_WORKFLOW" | "JIRA_START_WORKFLOW" | "SLACK_START_WORKFLOW";
  name: string;
  description: string;
  triggerService: "github" | "jira" | "slack";
  triggerLabel: string;
  steps: Array<{
    service: WorkflowNodeService;
    operation: string;
    label: string;
  }>;
};

const DEFAULT_WORKFLOW_IDS = new Set([
  "GITHUB_START_WORKFLOW",
  "JIRA_START_WORKFLOW",
  "SLACK_START_WORKFLOW",
  "wf-webhook-github-default",
  "wf-webhook-jira-default",
  "wf-webhook-slack-default",
]);

const DEFAULT_WORKFLOW_SOURCES = new Set([
  "webhook-github-default",
  "webhook-jira-default",
  "webhook-slack-default",
]);

const DEFAULT_ROUTED_WORKFLOWS = new Set([
  "GITHUB_START_WORKFLOW",
  "JIRA_START_WORKFLOW",
  "SLACK_START_WORKFLOW",
]);

const DEFAULT_WORKFLOW_TEMPLATES: DefaultWorkflowTemplate[] = [
  {
    id: "GITHUB_START_WORKFLOW",
    name: "GitHub Default Workflow",
    description:
      "Waits for GitHub webhooks and executes Jira, Slack, Sheets, and Gmail actions.",
    triggerService: "github",
    triggerLabel: "GitHub Webhook Trigger",
    steps: [
      {
        service: "jira",
        operation: "create-issue",
        label: "Create Jira Ticket",
      },
      {
        service: "slack",
        operation: "send-message",
        label: "Post to Slack",
      },
      {
        service: "google_sheets",
        operation: "add-row",
        label: "Update Spreadsheet",
      },
      {
        service: "gmail",
        operation: "send-email",
        label: "Send Email",
      },
    ],
  },
  {
    id: "JIRA_START_WORKFLOW",
    name: "Jira Default Workflow",
    description:
      "Waits for Jira webhooks and executes GitHub, Slack, Sheets, and Gmail actions.",
    triggerService: "jira",
    triggerLabel: "Jira Webhook Trigger",
    steps: [
      {
        service: "github",
        operation: "create-branch",
        label: "Create GitHub Branch",
      },
      {
        service: "slack",
        operation: "send-message",
        label: "Post to Slack",
      },
      {
        service: "google_sheets",
        operation: "add-row",
        label: "Update Spreadsheet",
      },
      {
        service: "gmail",
        operation: "send-email",
        label: "Send Email",
      },
    ],
  },
  {
    id: "SLACK_START_WORKFLOW",
    name: "Slack Default Workflow",
    description:
      "Waits for Slack webhooks and executes Jira, GitHub, Sheets, and Gmail actions.",
    triggerService: "slack",
    triggerLabel: "Slack Webhook Trigger",
    steps: [
      {
        service: "jira",
        operation: "create-issue",
        label: "Create Jira Ticket",
      },
      {
        service: "github",
        operation: "create-branch",
        label: "Create GitHub Branch",
      },
      {
        service: "google_sheets",
        operation: "add-row",
        label: "Update Spreadsheet",
      },
      {
        service: "gmail",
        operation: "send-email",
        label: "Send Email",
      },
    ],
  },
];

const missingDetailMemoryFallback = new Map<
  string,
  MissingDetailMemoryRecord
>();

function getRequestUserId(req: unknown): string | undefined {
  const request = req as AuthenticatedRequest;
  return typeof request.userId === "string" ? request.userId : undefined;
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

function ensureWebhookWaitingGraph(args: {
  nodes: Workflow["nodes"];
  edges: Workflow["edges"];
}): { nodes: Workflow["nodes"]; edges: Workflow["edges"] } {
  const nodes = Array.isArray(args.nodes) ? [...args.nodes] : [];
  const edges = Array.isArray(args.edges) ? [...args.edges] : [];

  const triggerIndex = nodes.findIndex((node) => node.type === "trigger");
  if (triggerIndex >= 0) {
    return {
      nodes: nodes.map((node, index) => {
        if (index !== triggerIndex) {
          return node;
        }

        return {
          ...node,
          operation: node.operation || "on-webhook-event",
          label: node.label || "Webhook Trigger",
          config: {
            ...(node.config || {}),
            waitFor: "webhook",
            triggerMode: "webhook_wait",
          },
          status: node.status || "pending",
        };
      }),
      edges,
    };
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  let triggerId = "trigger-webhook";
  let triggerCounter = 1;
  while (nodeIds.has(triggerId)) {
    triggerId = `trigger-webhook-${triggerCounter}`;
    triggerCounter += 1;
  }

  const firstNode = nodes[0];
  const minX =
    nodes.length > 0
      ? Math.min(...nodes.map((node) => node.position?.x ?? 320))
      : 320;

  const triggerNode: Workflow["nodes"][number] = {
    id: triggerId,
    type: "trigger",
    service: "postgres",
    operation: "on-webhook-event",
    label: "Webhook Trigger",
    config: {
      waitFor: "webhook",
      triggerMode: "webhook_wait",
    },
    position: {
      x: Math.max(minX - 240, 60),
      y: firstNode?.position?.y ?? 80,
    },
    status: "pending",
  };

  if (!firstNode) {
    return {
      nodes: [triggerNode],
      edges,
    };
  }

  const edgeIds = new Set(edges.map((edge) => edge.id));
  let edgeId = `edge-${triggerId}-${firstNode.id}`;
  let edgeCounter = 1;
  while (edgeIds.has(edgeId)) {
    edgeId = `edge-${triggerId}-${firstNode.id}-${edgeCounter}`;
    edgeCounter += 1;
  }

  return {
    nodes: [triggerNode, ...nodes],
    edges: [
      {
        id: edgeId,
        source: triggerId,
        target: firstNode.id,
      },
      ...edges,
    ],
  };
}

function buildDefaultWorkflowTemplate(
  template: DefaultWorkflowTemplate,
): Workflow {
  const now = new Date().toISOString();
  const triggerNodeId = `${template.id}-trigger`;

  const nodes: Workflow["nodes"] = [
    {
      id: triggerNodeId,
      type: "trigger",
      service: template.triggerService,
      operation: "on-webhook-event",
      label: template.triggerLabel,
      config: {
        workflow: template.id,
        waitFor: "webhook",
        triggerMode: "webhook_wait",
      },
      position: { x: 120, y: 90 },
      status: "pending",
    },
    ...template.steps.map((step, index) => ({
      id: `${template.id}-step-${index + 1}`,
      type: "action" as const,
      service: step.service,
      operation: step.operation,
      label: step.label,
      config: {},
      position: { x: 120 + (index + 1) * 250, y: 90 },
      status: "pending" as const,
    })),
  ];

  const edges: Workflow["edges"] = nodes.slice(1).map((node, index) => ({
    id: `${template.id}-edge-${index + 1}`,
    source: nodes[index].id,
    target: node.id,
  }));

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    nodes,
    edges,
    status: "ready",
    createdAt: now,
    updatedAt: now,
    executionHistory: [],
    generatedJson: {
      source: `webhook-${template.triggerService}-default`,
      workflow: template.id,
      template: true,
      triggerMode: "webhook_wait",
    },
  };
}

function ensureDefaultWorkflowTemplates(workflows: Workflow[]): Workflow[] {
  const existingIds = new Set(workflows.map((workflow) => workflow.id));
  const missingTemplates = DEFAULT_WORKFLOW_TEMPLATES.filter(
    (template) => !existingIds.has(template.id),
  ).map((template) => buildDefaultWorkflowTemplate(template));

  return missingTemplates.length > 0
    ? [...missingTemplates, ...workflows]
    : workflows;
}

function parseWorkflowListScope(value: unknown): WorkflowListScope {
  if (typeof value !== "string") {
    return "all";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "default") return "default";
  if (normalized === "user") return "user";
  return "all";
}

function isDefaultWorkflow(workflow: Workflow): boolean {
  if (DEFAULT_WORKFLOW_IDS.has(workflow.id)) {
    return true;
  }

  const generatedJson = asRecord(workflow.generatedJson);
  const sourceRaw = generatedJson.source;
  const source =
    typeof sourceRaw === "string" ? sourceRaw.trim().toLowerCase() : "";

  if (source && DEFAULT_WORKFLOW_SOURCES.has(source)) {
    return true;
  }

  const routedWorkflowRaw = generatedJson.workflow;
  const routedWorkflow =
    typeof routedWorkflowRaw === "string"
      ? routedWorkflowRaw.trim().toUpperCase()
      : "";

  if (routedWorkflow && DEFAULT_ROUTED_WORKFLOWS.has(routedWorkflow)) {
    return true;
  }

  return false;
}

function isWebhookWaitingWorkflow(workflow: Workflow): boolean {
  const generatedJson = asRecord(workflow.generatedJson);
  const triggerMode = asString(generatedJson.triggerMode).toLowerCase();
  const waitFor = asString(generatedJson.waitFor).toLowerCase();

  if (triggerMode === "webhook_wait" || waitFor === "webhook") {
    return true;
  }

  const triggerNode = workflow.nodes.find((node) => node.type === "trigger");
  if (!triggerNode) {
    return false;
  }

  const triggerConfig = asRecord(triggerNode.config);
  const configTriggerMode = asString(triggerConfig.triggerMode).toLowerCase();
  const configWaitFor = asString(triggerConfig.waitFor).toLowerCase();
  const operation = asString(triggerNode.operation).toLowerCase();

  return (
    configTriggerMode === "webhook_wait" ||
    configWaitFor === "webhook" ||
    operation === "on-webhook-event"
  );
}

function normalizeMissingDetailKey(rawKey: string): string {
  const normalized = rawKey
    .trim()
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_.]/g, "")
    .replace(/^_+|_+$/g, "");

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

  if (normalized === "sheetid" || normalized === "spreadsheetid") {
    return "sheet_id";
  }

  return normalized;
}

function normalizeMissingDetailScope(rawScope: unknown): string {
  const normalized = asString(rawScope).toLowerCase();
  return normalized || "missing-details";
}

function normalizeMissingDetailMemoryOwner(ownerUserId?: string): string {
  const normalized = asString(ownerUserId);
  return normalized || "anonymous";
}

function fallbackMemoryCompositeKey(args: {
  ownerUserId?: string;
  scope?: string;
  detailKey: string;
}): string {
  const owner = normalizeMissingDetailMemoryOwner(args.ownerUserId);
  const scope = normalizeMissingDetailScope(args.scope);
  return `${owner}::${scope}::${args.detailKey}`;
}

function upsertMissingDetailMemoryFallback(args: {
  ownerUserId?: string;
  detailKey: string;
  detailValue: string;
  scope?: string;
  toolName?: string;
}): MissingDetailMemoryRecord {
  const ownerUserId = normalizeMissingDetailMemoryOwner(args.ownerUserId);
  const scope = normalizeMissingDetailScope(args.scope);
  const detailKey = normalizeMissingDetailKey(args.detailKey);
  const detailValue = asString(args.detailValue);
  const now = new Date().toISOString();

  const compositeKey = fallbackMemoryCompositeKey({
    ownerUserId,
    scope,
    detailKey,
  });

  const existing = missingDetailMemoryFallback.get(compositeKey);
  if (existing) {
    const updated: MissingDetailMemoryRecord = {
      ...existing,
      detailValue,
      toolName: args.toolName || existing.toolName,
      useCount: existing.useCount + 1,
      lastUsedAt: now,
      updatedAt: now,
    };
    missingDetailMemoryFallback.set(compositeKey, updated);
    return updated;
  }

  const created: MissingDetailMemoryRecord = {
    memoryId: `mem-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ownerUserId,
    detailKey,
    detailValue,
    scope,
    toolName: args.toolName,
    useCount: 1,
    lastUsedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  missingDetailMemoryFallback.set(compositeKey, created);
  return created;
}

function listMissingDetailMemoryFallback(args: {
  ownerUserId?: string;
  scope?: string;
  keys?: string[];
}): MissingDetailMemoryRecord[] {
  const ownerUserId = normalizeMissingDetailMemoryOwner(args.ownerUserId);
  const scope = normalizeMissingDetailScope(args.scope);
  const keyFilter = new Set(
    (args.keys || [])
      .map((key) => normalizeMissingDetailKey(key))
      .filter((key) => key.length > 0),
  );

  return [...missingDetailMemoryFallback.values()]
    .filter((entry) => {
      if (entry.ownerUserId !== ownerUserId) {
        return false;
      }

      if (scope !== "all" && entry.scope !== scope) {
        return false;
      }

      if (keyFilter.size > 0 && !keyFilter.has(entry.detailKey)) {
        return false;
      }

      return true;
    })
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
}

function deleteMissingDetailMemoryFallback(args: {
  ownerUserId?: string;
  memoryId: string;
}): boolean {
  const ownerUserId = normalizeMissingDetailMemoryOwner(args.ownerUserId);
  const memoryId = asString(args.memoryId);
  if (!memoryId) {
    return false;
  }

  const existing = [...missingDetailMemoryFallback.entries()].find(
    ([, value]) =>
      value.ownerUserId === ownerUserId && value.memoryId === memoryId,
  );

  if (!existing) {
    return false;
  }

  missingDetailMemoryFallback.delete(existing[0]);
  return true;
}

function parseMissingDetailValues(payload: unknown): Record<string, string> {
  const record = asRecord(payload);
  const normalized: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = normalizeMissingDetailKey(rawKey);
    const value = asString(rawValue);

    if (!key || !value) {
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

function inferWebhookSource(
  eventName: string,
): NormalizedWebhookEvent["source"] {
  const normalized = eventName.trim().toLowerCase();
  if (normalized.startsWith("jira.")) {
    return "jira";
  }
  if (normalized.startsWith("slack.")) {
    return "slack";
  }
  return "github";
}

function buildRetryWebhookEventFromStepRuns(
  stepRuns: StepRunRecord[],
): NormalizedWebhookEvent {
  const ordered = [...stepRuns].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  let eventName = "";
  const data: Record<string, unknown> = {};

  for (const step of ordered) {
    const input = asRecord(step.inputPayload);
    const row = asRecord(input.row);

    if (!eventName) {
      eventName = asString(input.trigger) || asString(input.event);
    }

    const repositoryCandidates = [
      input.repository,
      input.repo,
      row.repository,
      row.repo,
    ];
    const refCandidates = [input.ref, row.ref];
    const senderCandidates = [input.sender, row.sender];
    const pusherCandidates = [input.pusher, row.pusher];
    const beforeCandidates = [input.before, row.before];
    const afterCandidates = [input.after, row.after];

    if (!data.repository) {
      for (const candidate of repositoryCandidates) {
        const value = asString(candidate);
        if (value) {
          data.repository = value;
          break;
        }
      }
    }

    if (!data.ref) {
      for (const candidate of refCandidates) {
        const value = asString(candidate);
        if (value) {
          data.ref = value;
          break;
        }
      }
    }

    if (!data.sender) {
      for (const candidate of senderCandidates) {
        const value = asString(candidate);
        if (value) {
          data.sender = value;
          break;
        }
      }
    }

    if (!data.pusher) {
      for (const candidate of pusherCandidates) {
        const value = asString(candidate);
        if (value) {
          data.pusher = value;
          break;
        }
      }
    }

    if (!data.before) {
      for (const candidate of beforeCandidates) {
        const value = asString(candidate);
        if (value) {
          data.before = value;
          break;
        }
      }
    }

    if (!data.after) {
      for (const candidate of afterCandidates) {
        const value = asString(candidate);
        if (value) {
          data.after = value;
          break;
        }
      }
    }
  }

  const fallbackEvent = eventName || "github.retry";
  if (!data.repository) {
    data.repository = "unknown-repo";
  }

  return {
    source: inferWebhookSource(fallbackEvent),
    event: fallbackEvent,
    data,
  };
}

function normalizeNodeService(value?: string): WorkflowNodeService {
  const normalized = (value || "").trim().toLowerCase().replace(/-/g, "_");

  if (normalized === "jira") return "jira";
  if (normalized === "slack") return "slack";
  if (normalized === "github") return "github";
  if (normalized === "gmail") return "gmail";
  if (normalized === "google_sheets" || normalized === "sheets") {
    return "google_sheets";
  }
  if (normalized === "postgres" || normalized === "postgresql") {
    return "postgres";
  }

  return "postgres";
}

function toNodeType(phase?: string): WorkflowNodeType {
  const normalized = (phase || "").trim().toLowerCase();

  if (normalized === "start") return "trigger";
  if (normalized === "required-api") return "condition";
  if (normalized === "end") return "output";

  return "action";
}

function toNodeStatus(
  statusRaw: unknown,
): Workflow["nodes"][number]["status"] | undefined {
  if (typeof statusRaw !== "string") {
    return undefined;
  }

  const normalized = statusRaw.trim().toLowerCase();
  if (normalized === "pending") return "pending";
  if (normalized === "running") return "running";
  if (normalized === "done" || normalized === "completed") {
    return "completed";
  }
  if (normalized === "failed") return "failed";
  if (normalized === "skipped") return "skipped";

  return undefined;
}

function buildStoredWorkflowFromAgenticPayload(args: {
  prompt: string;
  payload: unknown;
  ownerUserId?: string;
}): Workflow | null {
  const payloadRecord = asRecord(args.payload);
  const rawSteps = Array.isArray(payloadRecord.steps)
    ? payloadRecord.steps
    : Array.isArray(payloadRecord.flowSteps)
      ? payloadRecord.flowSteps
      : [];

  if (rawSteps.length === 0) {
    return null;
  }

  const levelIndexMap = new Map<number, number>();
  const nodes: Workflow["nodes"] = rawSteps.flatMap((entry, index) => {
    const step = asRecord(entry);
    const id =
      typeof step.id === "string" && step.id.trim().length > 0
        ? step.id.trim()
        : `step-${index + 1}`;

    const label =
      typeof step.label === "string" && step.label.trim().length > 0
        ? step.label.trim()
        : id;

    const levelRaw = Number(step.level);
    const level = Number.isFinite(levelRaw) ? Math.max(0, levelRaw) : 0;
    const levelCount = levelIndexMap.get(level) ?? 0;
    levelIndexMap.set(level, levelCount + 1);

    const serviceFromTool =
      typeof step.tool === "string" && step.tool.includes(".")
        ? step.tool.split(".")[0]
        : undefined;

    const operation =
      typeof step.tool === "string" && step.tool.trim().length > 0
        ? step.tool
        : typeof step.phase === "string"
          ? step.phase
          : "process";

    return [
      {
        id,
        type: toNodeType(typeof step.phase === "string" ? step.phase : ""),
        service: normalizeNodeService(
          typeof step.serviceId === "string" ? step.serviceId : serviceFromTool,
        ),
        operation,
        label,
        config:
          step.arguments && typeof step.arguments === "object"
            ? (step.arguments as Record<string, unknown>)
            : {
                prompt: args.prompt,
              },
        position: {
          x: 120 + level * 320,
          y: 70 + levelCount * 136,
        },
        status: toNodeStatus(step.status),
      },
    ];
  });

  const rawEdges = Array.isArray(payloadRecord.edges)
    ? payloadRecord.edges
    : Array.isArray(payloadRecord.flowEdges)
      ? payloadRecord.flowEdges
      : [];

  let edges: Workflow["edges"] = rawEdges.flatMap((entry, index) => {
    const edge = asRecord(entry);
    const source =
      typeof edge.source === "string" && edge.source.trim().length > 0
        ? edge.source.trim()
        : "";
    const target =
      typeof edge.target === "string" && edge.target.trim().length > 0
        ? edge.target.trim()
        : "";

    if (!source || !target) {
      return [];
    }

    const id =
      typeof edge.id === "string" && edge.id.trim().length > 0
        ? edge.id.trim()
        : `edge-${index + 1}`;

    return [
      {
        id,
        source,
        target,
      },
    ];
  });

  if (edges.length === 0 && nodes.length > 1) {
    edges = nodes.slice(1).map((node, index) => ({
      id: `edge-auto-${index + 1}`,
      source: nodes[index].id,
      target: node.id,
    }));
  }

  const webhookGraph = ensureWebhookWaitingGraph({ nodes, edges });

  const workflow = dataStore.createWorkflow({
    name: `Agentic Flow: ${args.prompt.slice(0, 64)}`,
    description: args.prompt,
    nodes: webhookGraph.nodes,
    edges: webhookGraph.edges,
    status: "ready",
    ownerUserId: args.ownerUserId,
    generatedJson: {
      source: "agentic-flow",
      prompt: args.prompt,
      plan: payloadRecord,
      triggerMode: "webhook_wait",
      waitFor: "webhook",
    },
  });

  return workflow;
}

type AgenticIntegrationInput = {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "error" | "pending";
  enabled: boolean;
  tools: string[];
};

type AgenticToolDefinitionInput = {
  description: string;
  inputs: Record<string, string>;
};

function sanitizeAgenticIntegrations(
  payload: unknown,
): AgenticIntegrationInput[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const raw = entry as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) {
      return [];
    }

    const statusValue =
      typeof raw.status === "string" ? raw.status.trim().toLowerCase() : "";
    const status: AgenticIntegrationInput["status"] =
      statusValue === "connected" ||
      statusValue === "disconnected" ||
      statusValue === "error" ||
      statusValue === "pending"
        ? statusValue
        : "disconnected";

    const tools = Array.isArray(raw.tools)
      ? raw.tools
          .filter((tool): tool is string => typeof tool === "string")
          .map((tool) => tool.trim())
          .filter(Boolean)
      : [];

    return [
      {
        id,
        name:
          typeof raw.name === "string" && raw.name.trim().length > 0
            ? raw.name.trim()
            : id,
        status,
        enabled: Boolean(raw.enabled),
        tools,
      },
    ];
  });
}

function sanitizeAgenticTools(
  payload: unknown,
): Record<string, AgenticToolDefinitionInput> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const raw = payload as Record<string, unknown>;
  const sanitized: Record<string, AgenticToolDefinitionInput> = {};

  for (const [toolName, definition] of Object.entries(raw)) {
    const normalizedToolName = toolName.trim();
    if (!normalizedToolName || !definition || typeof definition !== "object") {
      continue;
    }

    const tool = definition as Record<string, unknown>;
    const description =
      typeof tool.description === "string" ? tool.description.trim() : "";

    const inputs: Record<string, string> = {};
    const rawInputs =
      tool.inputs &&
      typeof tool.inputs === "object" &&
      !Array.isArray(tool.inputs)
        ? (tool.inputs as Record<string, unknown>)
        : {};

    for (const [inputName, inputType] of Object.entries(rawInputs)) {
      const normalizedInputName = inputName.trim();
      if (!normalizedInputName) {
        continue;
      }

      inputs[normalizedInputName] =
        typeof inputType === "string" && inputType.trim().length > 0
          ? inputType.trim()
          : "string";
    }

    sanitized[normalizedToolName] = {
      description,
      inputs,
    };
  }

  return sanitized;
}

// GET /api/workflows - List current user's workflows
router.get("/", async (req, res) => {
  const userId = getRequestUserId(req);
  const scope = parseWorkflowListScope(req.query.scope);

  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 100)
    : undefined;

  const offsetRaw = Number(req.query.offset);
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";
  const query = search.toLowerCase();

  const workflows = isPostgresReady()
    ? await listWorkflowDefinitions(userId)
    : dataStore.getWorkflows();

  const workflowPool =
    scope === "default" ? ensureDefaultWorkflowTemplates(workflows) : workflows;

  const scoped =
    scope === "default"
      ? workflowPool.filter((workflow) => isDefaultWorkflow(workflow))
      : scope === "user"
        ? workflowPool.filter((workflow) => !isDefaultWorkflow(workflow))
        : workflowPool;

  const filtered = query
    ? scoped.filter(
        (workflow) =>
          workflow.name.toLowerCase().includes(query) ||
          workflow.description.toLowerCase().includes(query),
      )
    : scoped;

  const total = filtered.length;
  const paged =
    typeof limit === "number"
      ? filtered.slice(offset, offset + limit)
      : filtered;

  res.json({
    success: true,
    data: paged,
    pagination: {
      total,
      limit: limit ?? total,
      offset,
      hasMore: typeof limit === "number" ? offset + limit < total : false,
    },
  });
});

// GET /api/workflows/missing-details-memory - List saved missing detail values
router.get("/missing-details-memory", async (req, res) => {
  const userId = getRequestUserId(req);
  const scope = normalizeMissingDetailScope(req.query.scope);
  const keysRaw = asString(req.query.keys);
  const keys = keysRaw
    ? keysRaw
        .split(",")
        .map((key) => normalizeMissingDetailKey(key))
        .filter((key) => key.length > 0)
    : [];

  const rows = isPostgresReady()
    ? await listMissingDetailMemory({
        ownerUserId: userId,
        scope,
        keys,
        limit: 500,
        offset: 0,
      })
    : listMissingDetailMemoryFallback({
        ownerUserId: userId,
        scope,
        keys,
      });

  res.json({
    success: true,
    data: rows,
  });
});

// DELETE /api/workflows/missing-details-memory/:memoryId - Delete saved value
router.delete("/missing-details-memory/:memoryId", async (req, res) => {
  const userId = getRequestUserId(req);
  const memoryId = asString(req.params.memoryId);

  if (!memoryId) {
    return res.status(400).json({
      success: false,
      error: "memoryId is required",
    });
  }

  const deleted = isPostgresReady()
    ? await deleteMissingDetailMemory(memoryId, userId)
    : deleteMissingDetailMemoryFallback({
        ownerUserId: userId,
        memoryId,
      });

  if (!deleted) {
    return res.status(404).json({
      success: false,
      error: "Saved data not found",
    });
  }

  res.json({
    success: true,
    message: "Saved data deleted",
  });
});

// GET /api/workflows/:id - Get a single workflow
router.get("/:id", async (req, res) => {
  const userId = getRequestUserId(req);

  const workflow = isPostgresReady()
    ? await getWorkflowDefinition(req.params.id, userId)
    : dataStore.getWorkflow(req.params.id);

  if (!workflow) {
    return res.status(404).json({
      success: false,
      error: "Workflow not found",
    });
  }

  res.json({
    success: true,
    data: workflow,
  });
});

// GET /api/workflows/:id/audits - Get workflow-specific audits/logs
router.get("/:id/audits", async (req, res) => {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 200)
    : 50;

  const offsetRaw = Number(req.query.offset);
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

  const results = isPostgresReady()
    ? await getEventLogs({
        workflowId: req.params.id,
        limit,
        offset,
      })
    : dataStore.getLogs({
        limit,
        offset,
      });

  const filteredLogs = isPostgresReady()
    ? results.logs
    : results.logs.filter((log) => log.workflowId === req.params.id);

  const executionStats = new Map<
    string,
    {
      startedAt: string;
      endedAt: string;
      totalLogs: number;
      errorCount: number;
    }
  >();

  const byTimeAsc = [...filteredLogs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  for (const log of byTimeAsc) {
    if (!log.executionId) {
      continue;
    }

    const current = executionStats.get(log.executionId);
    if (!current) {
      executionStats.set(log.executionId, {
        startedAt: log.timestamp,
        endedAt: log.timestamp,
        totalLogs: 1,
        errorCount: log.level === "error" ? 1 : 0,
      });
      continue;
    }

    current.endedAt = log.timestamp;
    current.totalLogs += 1;
    if (log.level === "error") {
      current.errorCount += 1;
    }
  }

  const runNumberByExecutionId = new Map<string, number>();
  const orderedRuns = [...executionStats.entries()].sort(
    (a, b) =>
      new Date(a[1].startedAt).getTime() - new Date(b[1].startedAt).getTime(),
  );

  const runs = orderedRuns
    .map(([executionId, meta], index) => {
      const runNumber = index + 1;
      runNumberByExecutionId.set(executionId, runNumber);

      return {
        runNumber,
        executionId,
        startedAt: meta.startedAt,
        endedAt: meta.endedAt,
        totalLogs: meta.totalLogs,
        errorCount: meta.errorCount,
      };
    })
    .sort((a, b) => b.runNumber - a.runNumber);

  const enrichedLogs = filteredLogs.map((log) => ({
    ...log,
    runNumber: log.executionId
      ? runNumberByExecutionId.get(log.executionId)
      : undefined,
  }));

  res.json({
    success: true,
    data: {
      logs: enrichedLogs,
      runs,
    },
    pagination: {
      total: isPostgresReady() ? results.total : enrichedLogs.length,
      limit,
      offset,
    },
  });
});

// POST /api/workflows - Create a new workflow
router.post("/", async (req, res) => {
  const name = asString(req.body?.name);
  const description = asString(req.body?.description);
  const rawNodes = Array.isArray(req.body?.nodes)
    ? (req.body.nodes as Workflow["nodes"])
    : [];
  const rawEdges = Array.isArray(req.body?.edges)
    ? (req.body.edges as Workflow["edges"])
    : [];
  const workflowGraph = ensureWebhookWaitingGraph({
    nodes: rawNodes,
    edges: rawEdges,
  });
  const generatedJsonBase =
    req.body?.generatedJson && typeof req.body.generatedJson === "object"
      ? (req.body.generatedJson as Record<string, unknown>)
      : {};
  const generatedJson: Record<string, unknown> = {
    ...generatedJsonBase,
    source: asString(generatedJsonBase.source) || "user-create",
    triggerMode: "webhook_wait",
    waitFor: "webhook",
  };

  const status: Workflow["status"] = "ready";
  const userId = getRequestUserId(req);

  if (!name) {
    return res.status(400).json({
      success: false,
      error: "Workflow name is required",
    });
  }

  const workflow = dataStore.createWorkflow({
    name,
    description,
    nodes: workflowGraph.nodes,
    edges: workflowGraph.edges,
    status,
    generatedJson,
    ownerUserId: userId,
  });

  if (isPostgresReady()) {
    await saveWorkflowDefinition({
      ...workflow,
      ownerUserId: userId,
      generatedJson,
    });
  }

  res.status(201).json({
    success: true,
    data: workflow,
    message: "Workflow created successfully",
  });
});

// PUT /api/workflows/:id - Update a workflow
router.put("/:id", async (req, res) => {
  const updates: Partial<Workflow> = req.body;
  const workflowId = req.params.id;
  const userId = getRequestUserId(req);

  let workflow = dataStore.updateWorkflow(workflowId, updates);

  if (!workflow && isPostgresReady()) {
    const existing = await getWorkflowDefinition(workflowId, userId);
    if (existing) {
      workflow = {
        ...existing,
        ...updates,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  if (!workflow) {
    return res.status(404).json({
      success: false,
      error: "Workflow not found",
    });
  }

  if (isPostgresReady()) {
    await saveWorkflowDefinition({
      ...workflow,
      ownerUserId: workflow.ownerUserId || userId,
      generatedJson: workflow.generatedJson,
    });
  }

  res.json({
    success: true,
    data: workflow,
    message: "Workflow updated successfully",
  });
});

// DELETE /api/workflows/:id - Delete a workflow
router.delete("/:id", async (req, res) => {
  const workflowId = req.params.id;
  const userId = getRequestUserId(req);
  const deletedInMemory = dataStore.deleteWorkflow(workflowId);
  const deletedInPostgres = isPostgresReady()
    ? await deleteWorkflowDefinition(workflowId, userId)
    : false;

  if (!deletedInMemory && !deletedInPostgres) {
    return res.status(404).json({
      success: false,
      error: "Workflow not found",
    });
  }

  res.json({
    success: true,
    message: "Workflow deleted successfully",
  });
});

// POST /api/workflows/:id/execute - Execute a workflow
router.post("/:id/execute", async (req, res) => {
  const workflowId = req.params.id;
  const userId = getRequestUserId(req);

  const workflow = isPostgresReady()
    ? await getWorkflowDefinition(workflowId, userId)
    : dataStore.getWorkflow(workflowId);

  if (!workflow) {
    return res.status(404).json({
      success: false,
      error: "Workflow not found",
    });
  }

  if (isWebhookWaitingWorkflow(workflow)) {
    return res.status(409).json({
      success: false,
      error:
        "This workflow waits for webhook events and cannot be executed manually.",
    });
  }

  const execution = dataStore.createExecution(workflowId);

  if (!execution) {
    return res.status(404).json({
      success: false,
      error: "Workflow not found",
    });
  }

  res.json({
    success: true,
    data: execution,
    message: "Workflow execution started",
  });
});

// POST /api/workflows/executions/:executionId/retry-missing-details
router.post(
  "/executions/:executionId/retry-missing-details",
  async (req, res) => {
    const executionId = asString(req.params.executionId);
    const userId = getRequestUserId(req);

    if (!executionId) {
      return res.status(400).json({
        success: false,
        error: "Execution ID is required",
      });
    }

    const payloadSource =
      req.body?.missingDetails && typeof req.body.missingDetails === "object"
        ? req.body.missingDetails
        : req.body?.details && typeof req.body.details === "object"
          ? req.body.details
          : req.body;

    const missingDetails = parseMissingDetailValues(payloadSource);
    if (Object.keys(missingDetails).length === 0) {
      return res.status(400).json({
        success: false,
        error: "At least one missing detail value is required",
      });
    }

    if (!isPostgresReady()) {
      return res.status(503).json({
        success: false,
        error:
          "Retry requires PostgreSQL step run history. Please ensure PostgreSQL is ready.",
      });
    }

    const stepRunResult = await getStepRuns({
      executionId,
      limit: 500,
      offset: 0,
    });

    if (stepRunResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Execution step history was not found",
      });
    }

    const workflowId =
      stepRunResult.rows.find(
        (step) => typeof step.workflowId === "string" && step.workflowId.trim(),
      )?.workflowId ?? "";

    if (!workflowId) {
      return res.status(404).json({
        success: false,
        error: "Workflow for this execution could not be resolved",
      });
    }

    const routedWorkflow =
      workflowId === "GITHUB_START_WORKFLOW" ||
      workflowId === "wf-webhook-github-default"
        ? "GITHUB_START_WORKFLOW"
        : null;

    if (!routedWorkflow) {
      return res.status(400).json({
        success: false,
        error:
          "Retry with missing details is currently available for the GitHub default webhook workflow only.",
      });
    }

    const failedToolName =
      stepRunResult.rows.find((step) => {
        const status = asString(step.status).toLowerCase();
        return status === "failed" || status === "error";
      })?.toolName || "";

    await Promise.all(
      Object.entries(missingDetails).map(([detailKey, detailValue]) =>
        upsertMissingDetailMemory({
          ownerUserId: userId,
          detailKey,
          detailValue,
          scope: "missing-details",
          toolName: failedToolName || undefined,
        }),
      ),
    );

    const retryEvent = buildRetryWebhookEventFromStepRuns(stepRunResult.rows);
    const retriedExecution = await executeWebhookWorkflow({
      workflow: routedWorkflow,
      event: retryEvent,
      missingDetails,
      retryOfExecutionId: executionId,
      previousStepRuns: stepRunResult.rows,
    });

    if (!retriedExecution) {
      return res.status(500).json({
        success: false,
        error: "Failed to start retry execution",
      });
    }

    const deletedPreviousExecution = await deleteWorkflowExecutionArtifacts(
      executionId,
      userId,
    );
    dataStore.deleteExecutionArtifacts(executionId);

    if (!deletedPreviousExecution) {
      dataStore.addLog({
        level: "warning",
        service: "system",
        action: "workflow_retry_previous_execution_delete_skipped",
        message: `Retry started but previous execution ${executionId} was not deleted`,
        workflowId: retriedExecution.workflowId,
        executionId: retriedExecution.executionId,
        userId,
        details: {
          previousExecutionId: executionId,
        },
      });
    }

    dataStore.addLog({
      level: "info",
      service: "system",
      action: "workflow_retry_requested",
      message: `Retry requested for execution ${executionId}`,
      workflowId: retriedExecution.workflowId,
      executionId: retriedExecution.executionId,
      userId,
      details: {
        retryOfExecutionId: executionId,
        triggerEvent: retryEvent.event,
        missingDetails,
      },
    });

    res.json({
      success: true,
      data: {
        previousExecutionId: executionId,
        ...retriedExecution,
      },
      message: "Workflow retry execution started",
    });
  },
);

// POST /api/workflows/:id/pause - Pause a running workflow
router.post("/:id/pause", async (req, res) => {
  const workflowId = req.params.id;
  const userId = getRequestUserId(req);
  const workflow = isPostgresReady()
    ? await getWorkflowDefinition(workflowId, userId)
    : dataStore.getWorkflow(workflowId);

  if (!workflow) {
    return res.status(404).json({
      success: false,
      error: "Workflow not found",
    });
  }

  if (workflow.status !== "running") {
    return res.status(400).json({
      success: false,
      error: "Workflow is not running",
    });
  }

  const updated = {
    ...workflow,
    status: "paused" as Workflow["status"],
    updatedAt: new Date().toISOString(),
  };

  if (isPostgresReady()) {
    await saveWorkflowDefinition({
      ...updated,
      ownerUserId: updated.ownerUserId || userId,
      generatedJson: updated.generatedJson,
    });
  } else {
    dataStore.updateWorkflow(workflowId, { status: "paused" });
  }

  dataStore.addLog({
    level: "info",
    service: "system",
    action: "workflow_paused",
    message: `Workflow "${workflow.name}" paused`,
    workflowId: workflow.id,
  });

  res.json({
    success: true,
    data: updated,
    message: "Workflow paused",
  });
});

// POST /api/workflows/:id/resume - Resume a paused workflow
router.post("/:id/resume", async (req, res) => {
  const workflowId = req.params.id;
  const userId = getRequestUserId(req);
  const workflow = isPostgresReady()
    ? await getWorkflowDefinition(workflowId, userId)
    : dataStore.getWorkflow(workflowId);

  if (!workflow) {
    return res.status(404).json({
      success: false,
      error: "Workflow not found",
    });
  }

  if (workflow.status !== "paused") {
    return res.status(400).json({
      success: false,
      error: "Workflow is not paused",
    });
  }

  const updated = {
    ...workflow,
    status: "running" as Workflow["status"],
    updatedAt: new Date().toISOString(),
  };

  if (isPostgresReady()) {
    await saveWorkflowDefinition({
      ...updated,
      ownerUserId: updated.ownerUserId || userId,
      generatedJson: updated.generatedJson,
    });
  } else {
    dataStore.updateWorkflow(workflowId, { status: "running" });
  }

  dataStore.addLog({
    level: "info",
    service: "system",
    action: "workflow_resumed",
    message: `Workflow "${workflow.name}" resumed`,
    workflowId: workflow.id,
  });

  res.json({
    success: true,
    data: updated,
    message: "Workflow resumed",
  });
});

// POST /api/workflows/:id/stop - Stop a workflow
router.post("/:id/stop", async (req, res) => {
  const workflowId = req.params.id;
  const userId = getRequestUserId(req);
  const workflow = isPostgresReady()
    ? await getWorkflowDefinition(workflowId, userId)
    : dataStore.getWorkflow(workflowId);

  if (!workflow) {
    return res.status(404).json({
      success: false,
      error: "Workflow not found",
    });
  }

  if (workflow.status !== "running" && workflow.status !== "paused") {
    return res.status(400).json({
      success: false,
      error: "Workflow is not running or paused",
    });
  }

  const updated = {
    ...workflow,
    status: "ready" as Workflow["status"],
    updatedAt: new Date().toISOString(),
  };

  if (isPostgresReady()) {
    await saveWorkflowDefinition({
      ...updated,
      ownerUserId: updated.ownerUserId || userId,
      generatedJson: updated.generatedJson,
    });
  } else {
    dataStore.updateWorkflow(workflowId, { status: "ready" });
  }

  dataStore.addLog({
    level: "info",
    service: "system",
    action: "workflow_stopped",
    message: `Workflow "${workflow.name}" stopped`,
    workflowId: workflow.id,
  });

  res.json({
    success: true,
    data: updated,
    message: "Workflow stopped",
  });
});

// POST /api/workflows/generate - Generate workflow from prompt (AI simulation)
router.post("/generate", async (req, res) => {
  const { prompt } = req.body;
  const userId = getRequestUserId(req);

  if (!prompt) {
    return res.status(400).json({
      success: false,
      error: "Prompt is required",
    });
  }

  // Simulate AI processing delay
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Generate a mock workflow based on keywords in the prompt
  const promptLower = prompt.toLowerCase();
  const nodes = [];
  const edges = [];
  let nodeIndex = 1;

  // Determine trigger
  if (promptLower.includes("slack") || promptLower.includes("message")) {
    nodes.push({
      id: `node-${nodeIndex}`,
      type: "trigger",
      service: "slack",
      operation: "on-message",
      label: "Slack Message Trigger",
      config: { channel: "#general" },
      position: { x: 250, y: 50 },
    });
    nodeIndex++;
  } else if (
    promptLower.includes("github") ||
    promptLower.includes("push") ||
    promptLower.includes("pr")
  ) {
    nodes.push({
      id: `node-${nodeIndex}`,
      type: "trigger",
      service: "github",
      operation: "on-push",
      label: "GitHub Push Trigger",
      config: { branch: "main" },
      position: { x: 250, y: 50 },
    });
    nodeIndex++;
  }

  // Add actions based on keywords
  if (
    promptLower.includes("jira") ||
    promptLower.includes("ticket") ||
    promptLower.includes("issue")
  ) {
    const prevNode = nodes.length > 0 ? nodes[nodes.length - 1].id : null;
    nodes.push({
      id: `node-${nodeIndex}`,
      type: "action",
      service: "jira",
      operation: "create-issue",
      label: "Create Jira Issue",
      config: { project: "PROJ", type: "Task" },
      position: { x: 250, y: 50 + (nodeIndex - 1) * 100 },
    });
    if (prevNode) {
      edges.push({
        id: `edge-${edges.length + 1}`,
        source: prevNode,
        target: `node-${nodeIndex}`,
      });
    }
    nodeIndex++;
  }

  if (
    promptLower.includes("notify") ||
    promptLower.includes("alert") ||
    promptLower.includes("message")
  ) {
    const prevNode = nodes.length > 0 ? nodes[nodes.length - 1].id : null;
    nodes.push({
      id: `node-${nodeIndex}`,
      type: "action",
      service: "slack",
      operation: "send-message",
      label: "Send Notification",
      config: { channel: "#notifications" },
      position: { x: 250, y: 50 + (nodeIndex - 1) * 100 },
    });
    if (prevNode) {
      edges.push({
        id: `edge-${edges.length + 1}`,
        source: prevNode,
        target: `node-${nodeIndex}`,
      });
    }
    nodeIndex++;
  }

  if (
    promptLower.includes("database") ||
    promptLower.includes("postgres") ||
    promptLower.includes("store") ||
    promptLower.includes("save")
  ) {
    const prevNode = nodes.length > 0 ? nodes[nodes.length - 1].id : null;
    nodes.push({
      id: `node-${nodeIndex}`,
      type: "action",
      service: "postgres",
      operation: "insert",
      label: "Store in Database",
      config: { table: "records" },
      position: { x: 250, y: 50 + (nodeIndex - 1) * 100 },
    });
    if (prevNode) {
      edges.push({
        id: `edge-${edges.length + 1}`,
        source: prevNode,
        target: `node-${nodeIndex}`,
      });
    }
    nodeIndex++;
  }

  // If no nodes were generated, create a default workflow
  if (nodes.length === 0) {
    nodes.push(
      {
        id: "node-1",
        type: "trigger",
        service: "slack",
        operation: "on-message",
        label: "Trigger",
        config: {},
        position: { x: 250, y: 50 },
      },
      {
        id: "node-2",
        type: "action",
        service: "jira",
        operation: "create-issue",
        label: "Process",
        config: {},
        position: { x: 250, y: 150 },
      },
    );
    edges.push({ id: "edge-1", source: "node-1", target: "node-2" });
  }

  const workflowGraph = ensureWebhookWaitingGraph({
    nodes: nodes as Workflow["nodes"],
    edges,
  });

  // Create the workflow
  const workflow = dataStore.createWorkflow({
    name: `Generated: ${prompt.substring(0, 30)}...`,
    description: prompt,
    nodes: workflowGraph.nodes,
    edges: workflowGraph.edges,
    status: "ready",
    ownerUserId: userId,
    generatedJson: {
      source: "generate",
      prompt,
      nodes: workflowGraph.nodes,
      edges: workflowGraph.edges,
      triggerMode: "webhook_wait",
      waitFor: "webhook",
    },
  });

  if (isPostgresReady()) {
    await saveWorkflowDefinition({
      ...workflow,
      ownerUserId: userId,
      generatedJson: workflow.generatedJson,
    });
  }

  res.json({
    success: true,
    data: workflow,
    message: "Workflow generated from prompt",
  });
});

// POST /api/workflows/agentic-flow - Generate agentic flow via Python service
router.post("/agentic-flow", async (req, res) => {
  const prompt =
    typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const userId = getRequestUserId(req);

  if (!prompt) {
    return res.status(400).json({
      success: false,
      error: "Prompt is required",
    });
  }

  const integrations = sanitizeAgenticIntegrations(req.body?.integrations);
  const availableTools = sanitizeAgenticTools(req.body?.availableTools);
  const useStreamlined = req.body?.useStreamlined !== false; // Default to new flow

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AGENTIC_SERVICE_TIMEOUT_MS,
  );

  try {
    // Use new streamlined endpoint by default
    const endpoint = useStreamlined
      ? `${AGENTIC_SERVICE_URL}/agentic/streamlined-flow`
      : `${AGENTIC_SERVICE_URL}/agentic/flow`;

    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        integrations,
        availableTools,
        skip_connectivity_check: req.body?.skipConnectivityCheck ?? false,
      }),
      signal: controller.signal,
    });

    const contentType = upstream.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await upstream.json()
      : await upstream.text();

    if (!upstream.ok) {
      const detail =
        typeof payload === "string"
          ? payload
          : ((payload as { detail?: string; error?: string }).detail ??
            (payload as { detail?: string; error?: string }).error ??
            "Unknown upstream error");

      return res.status(502).json({
        success: false,
        error: `Agentic service error: ${detail}`,
      });
    }

    const storedWorkflow = buildStoredWorkflowFromAgenticPayload({
      prompt,
      payload,
      ownerUserId: userId,
    });

    if (storedWorkflow && isPostgresReady()) {
      await saveWorkflowDefinition({
        ...storedWorkflow,
        ownerUserId: userId,
        generatedJson: storedWorkflow.generatedJson,
      });
    }

    if (storedWorkflow) {
      dataStore.addLog({
        level: "info",
        service: "system",
        action: "workflow_generated_agentic",
        message: `Agentic workflow stored: ${storedWorkflow.name}`,
        workflowId: storedWorkflow.id,
        userId,
        details: {
          source: "agentic-flow",
          prompt,
        },
      });
    }

    const responsePayload =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? {
            ...(payload as Record<string, unknown>),
            storedWorkflowId: storedWorkflow?.id,
            storedAt: new Date().toISOString(),
          }
        : payload;

    res.json({
      success: true,
      data: responsePayload,
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";

    return res.status(isTimeout ? 504 : 500).json({
      success: false,
      error: isTimeout
        ? `Agentic service timeout after ${AGENTIC_SERVICE_TIMEOUT_MS}ms`
        : `Failed to contact agentic service: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
    });
  } finally {
    clearTimeout(timeout);
  }
});

// POST /api/workflows/event-orchestrator - Deterministic event workflow mapping
router.post("/event-orchestrator", async (req, res) => {
  const event =
    req.body?.event &&
    typeof req.body.event === "object" &&
    !Array.isArray(req.body.event)
      ? (req.body.event as Record<string, unknown>)
      : req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : null;

  if (!event) {
    return res.status(400).json({
      success: false,
      error: "Event payload is required",
    });
  }

  const source =
    typeof event.source === "string" ? event.source.trim().toLowerCase() : "";

  if (!["jira", "github", "slack"].includes(source)) {
    return res.status(400).json({
      success: false,
      error: "event.source must be one of: jira, github, slack",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AGENTIC_SERVICE_TIMEOUT_MS,
  );

  try {
    const upstream = await fetch(
      `${AGENTIC_SERVICE_URL}/agentic/event-workflow`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event }),
        signal: controller.signal,
      },
    );

    const contentType = upstream.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await upstream.json()
      : await upstream.text();

    if (!upstream.ok) {
      const detail =
        typeof payload === "string"
          ? payload
          : ((payload as { detail?: string; error?: string }).detail ??
            (payload as { detail?: string; error?: string }).error ??
            "Unknown upstream error");

      return res.status(502).json({
        success: false,
        error: `Event orchestrator error: ${detail}`,
      });
    }

    res.json({
      success: true,
      data: payload,
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";

    return res.status(isTimeout ? 504 : 500).json({
      success: false,
      error: isTimeout
        ? `Event orchestrator timeout after ${AGENTIC_SERVICE_TIMEOUT_MS}ms`
        : `Failed to contact agentic service: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
    });
  } finally {
    clearTimeout(timeout);
  }
});

// POST /api/workflows/smart-execute - Smart LLM-powered execution
router.post("/smart-execute", async (req, res) => {
  const prompt =
    typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";

  if (!prompt) {
    return res.status(400).json({
      success: false,
      error: "Prompt is required",
    });
  }

  const integrations = sanitizeAgenticIntegrations(req.body?.integrations);
  const availableTools = sanitizeAgenticTools(req.body?.availableTools);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AGENTIC_SERVICE_TIMEOUT_MS,
  );

  try {
    const upstream = await fetch(
      `${AGENTIC_SERVICE_URL}/agentic/smart-execute`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          integrations,
          availableTools,
          execute: req.body?.execute ?? false,
        }),
        signal: controller.signal,
      },
    );

    const contentType = upstream.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await upstream.json()
      : await upstream.text();

    if (!upstream.ok) {
      const detail =
        typeof payload === "string"
          ? payload
          : ((payload as { detail?: string; error?: string }).detail ??
            (payload as { detail?: string; error?: string }).error ??
            "Unknown upstream error");

      return res.status(502).json({
        success: false,
        error: `Smart execution error: ${detail}`,
      });
    }

    res.json({
      success: true,
      data: payload,
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";

    return res.status(isTimeout ? 504 : 500).json({
      success: false,
      error: isTimeout
        ? `Smart execution timeout after ${AGENTIC_SERVICE_TIMEOUT_MS}ms`
        : `Failed to contact agentic service: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
    });
  } finally {
    clearTimeout(timeout);
  }
});

// POST /api/workflows/default-flow - Execute with default 5-step flow
router.post("/default-flow", async (req, res) => {
  const prompt =
    typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";

  if (!prompt) {
    return res.status(400).json({
      success: false,
      error: "Prompt is required",
    });
  }

  const integrations = sanitizeAgenticIntegrations(req.body?.integrations);
  const availableTools = sanitizeAgenticTools(req.body?.availableTools);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AGENTIC_SERVICE_TIMEOUT_MS,
  );

  try {
    const upstream = await fetch(
      `${AGENTIC_SERVICE_URL}/agentic/default-flow`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          integrations,
          availableTools,
          execute: req.body?.execute ?? false,
        }),
        signal: controller.signal,
      },
    );

    const contentType = upstream.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await upstream.json()
      : await upstream.text();

    if (!upstream.ok) {
      const detail =
        typeof payload === "string"
          ? payload
          : ((payload as { detail?: string; error?: string }).detail ??
            (payload as { detail?: string; error?: string }).error ??
            "Unknown upstream error");

      return res.status(502).json({
        success: false,
        error: `Default flow error: ${detail}`,
      });
    }

    res.json({
      success: true,
      data: payload,
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";

    return res.status(isTimeout ? 504 : 500).json({
      success: false,
      error: isTimeout
        ? `Default flow timeout after ${AGENTIC_SERVICE_TIMEOUT_MS}ms`
        : `Failed to contact agentic service: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
    });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
