import { Router } from "express";
import { dataStore } from "../data/store.js";
import type { Workflow } from "../types/index.js";
import {
  deleteWorkflowDefinition,
  getEventLogs,
  getWorkflowDefinition,
  isPostgresReady,
  listWorkflowDefinitions,
  saveWorkflowDefinition,
} from "../services/postgres-store.js";

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

  const workflow = dataStore.createWorkflow({
    name: `Agentic Flow: ${args.prompt.slice(0, 64)}`,
    description: args.prompt,
    nodes,
    edges,
    status: "ready",
    ownerUserId: args.ownerUserId,
    generatedJson: {
      source: "agentic-flow",
      prompt: args.prompt,
      plan: payloadRecord,
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

  const scoped =
    scope === "default"
      ? workflows.filter((workflow) => isDefaultWorkflow(workflow))
      : scope === "user"
        ? workflows.filter((workflow) => !isDefaultWorkflow(workflow))
        : workflows;

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
  const { name, description, nodes, edges, status } = req.body;
  const generatedJson =
    req.body?.generatedJson && typeof req.body.generatedJson === "object"
      ? (req.body.generatedJson as Record<string, unknown>)
      : undefined;
  const userId = getRequestUserId(req);

  if (!name) {
    return res.status(400).json({
      success: false,
      error: "Workflow name is required",
    });
  }

  const workflow = dataStore.createWorkflow({
    name,
    description: description || "",
    nodes: nodes || [],
    edges: edges || [],
    status: status || "draft",
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
router.post("/:id/execute", (req, res) => {
  const execution = dataStore.createExecution(req.params.id);

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

  // Create the workflow
  const workflow = dataStore.createWorkflow({
    name: `Generated: ${prompt.substring(0, 30)}...`,
    description: prompt,
    nodes: nodes as Workflow["nodes"],
    edges,
    status: "draft",
    ownerUserId: userId,
    generatedJson: {
      source: "generate",
      prompt,
      nodes,
      edges,
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
