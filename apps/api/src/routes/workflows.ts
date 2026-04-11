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

// GET /api/workflows - List all workflows
router.get("/", async (_req, res) => {
  let workflows = dataStore.getWorkflows();

  if (isPostgresReady()) {
    const postgresWorkflows = await listWorkflowDefinitions();
    if (postgresWorkflows.length > 0) {
      workflows = postgresWorkflows;
    }
  }

  res.json({
    success: true,
    data: workflows,
  });
});

// GET /api/workflows/:id - Get a single workflow
router.get("/:id", async (req, res) => {
  let workflow = dataStore.getWorkflow(req.params.id);

  if (isPostgresReady()) {
    const postgresWorkflow = await getWorkflowDefinition(req.params.id);
    if (postgresWorkflow) {
      workflow = postgresWorkflow;
    }
  }

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
    (a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
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
      total: isPostgresReady()
        ? results.total
        : enrichedLogs.length,
      limit,
      offset,
    },
  });
});

// POST /api/workflows - Create a new workflow
router.post("/", async (req, res) => {
  const { name, description, nodes, edges, status } = req.body;

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
  });

  if (isPostgresReady()) {
    await saveWorkflowDefinition(workflow);
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

  let workflow = dataStore.updateWorkflow(workflowId, updates);

  if (!workflow && isPostgresReady()) {
    const existing = await getWorkflowDefinition(workflowId);
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
    await saveWorkflowDefinition(workflow);
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
  const deletedInMemory = dataStore.deleteWorkflow(workflowId);
  const deletedInPostgres = isPostgresReady()
    ? await deleteWorkflowDefinition(workflowId)
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
  const workflow = isPostgresReady()
    ? await getWorkflowDefinition(workflowId)
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
    await saveWorkflowDefinition(updated);
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
  const workflow = isPostgresReady()
    ? await getWorkflowDefinition(workflowId)
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
    await saveWorkflowDefinition(updated);
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
  const workflow = isPostgresReady()
    ? await getWorkflowDefinition(workflowId)
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
    await saveWorkflowDefinition(updated);
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
  });

  if (isPostgresReady()) {
    await saveWorkflowDefinition(workflow);
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

    res.json({
      success: true,
      data: payload,
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
