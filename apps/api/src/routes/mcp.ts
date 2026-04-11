import { Router } from "express";
import {
  processMCPRequest,
  executeNode,
  getAvailableMethods,
} from "../services/mcp.js";
import { dataStore } from "../data/store.js";
import { v4 as uuidv4 } from "uuid";
import {
  saveExecutionContext,
  saveStepRun,
  saveWorkflowDefinition,
  saveWorkflowExecution,
} from "../services/postgres-store.js";
import type { MCPRequest, DAGNode } from "../types/index.js";

const router = Router();

function toAuditService(
  method: string,
):
  | "jira"
  | "slack"
  | "github"
  | "postgres"
  | "google_sheets"
  | "gmail"
  | "system" {
  const token = method.split(".")[0]?.toLowerCase() || "system";

  if (token === "sheets" || token === "google_sheets") return "google_sheets";
  if (token === "jira") return "jira";
  if (token === "slack") return "slack";
  if (token === "github") return "github";
  if (token === "gmail") return "gmail";
  if (token === "postgres" || token === "postgresql") return "postgres";

  return "system";
}

async function safeSaveStepRun(args: {
  stepId: string;
  executionId?: string;
  toolName: string;
  inputPayload?: Record<string, unknown>;
  outputPayload?: Record<string, unknown>;
  status: string;
  retryCount?: number;
}) {
  try {
    await saveStepRun(args);
  } catch (error) {
    console.warn(
      `Failed to persist step run ${args.stepId}: ${
        error instanceof Error ? error.message : "Unknown PostgreSQL error"
      }`,
    );
  }
}

async function safeEnsureExecutionRecords(args: {
  executionId?: string;
  workflowId?: string;
  workflowName?: string;
  prompt?: string;
}) {
  if (!args.executionId) {
    return;
  }

  const workflowId = args.workflowId || `adhoc-${args.executionId}`;

  try {
    await saveWorkflowDefinition({
      id: workflowId,
      name: args.workflowName || "Ad-hoc MCP Execution",
      description: args.prompt || "",
      nodes: [],
      edges: [],
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await saveWorkflowExecution({
      id: args.executionId,
      workflowId,
      status: "running",
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn(
      `Failed to upsert execution records for ${args.executionId}: ${
        error instanceof Error ? error.message : "Unknown PostgreSQL error"
      }`,
    );
  }
}

// POST /api/mcp/execute - Execute an MCP request
router.post("/execute", async (req, res) => {
  const mcpRequest = req.body as MCPRequest;
  const params = (mcpRequest.params ?? {}) as Record<string, unknown>;
  const executionId =
    typeof params.executionId === "string"
      ? params.executionId
      : typeof params.execution_id === "string"
        ? params.execution_id
        : undefined;
  const workflowId =
    typeof params.workflowId === "string"
      ? params.workflowId
      : typeof params.workflow_id === "string"
        ? params.workflow_id
        : undefined;
  const workflowName =
    typeof params.workflowName === "string"
      ? params.workflowName
      : typeof params.workflow_name === "string"
        ? params.workflow_name
        : undefined;
  const stepId = `step-${uuidv4()}`;

  if (!mcpRequest.jsonrpc || mcpRequest.jsonrpc !== "2.0") {
    return res.status(400).json({
      success: false,
      error: "Invalid JSON-RPC request: missing or invalid jsonrpc version",
    });
  }

  if (!mcpRequest.method) {
    return res.status(400).json({
      success: false,
      error: "Invalid JSON-RPC request: missing method",
    });
  }

  await safeEnsureExecutionRecords({
    executionId,
    workflowId,
    workflowName,
    prompt: typeof params.prompt === "string" ? params.prompt : undefined,
  });

  await safeSaveStepRun({
    stepId,
    executionId,
    toolName: mcpRequest.method,
    inputPayload: params,
    status: "running",
    retryCount: typeof params.retry_count === "number" ? params.retry_count : 0,
  });

  const response = await processMCPRequest(mcpRequest);

  await safeSaveStepRun({
    stepId,
    executionId,
    toolName: mcpRequest.method,
    inputPayload: params,
    outputPayload: response as unknown as Record<string, unknown>,
    status: response.error ? "failed" : "success",
    retryCount: typeof params.retry_count === "number" ? params.retry_count : 0,
  });

  dataStore.addLog({
    level: response.error ? "error" : "info",
    service: toAuditService(mcpRequest.method),
    action: "mcp_execute",
    message: response.error
      ? `MCP method ${mcpRequest.method} failed`
      : `MCP method ${mcpRequest.method} executed`,
    executionId,
    workflowId,
    details: {
      requestId: mcpRequest.id,
      method: mcpRequest.method,
      hasError: Boolean(response.error),
    },
  });

  if (executionId) {
    await saveWorkflowExecution({
      id: executionId,
      workflowId: workflowId || `adhoc-${executionId}`,
      status: response.error ? "failed" : "completed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }).catch((error) => {
      console.warn(
        `Failed to finalize execution ${executionId}: ${
          error instanceof Error ? error.message : "Unknown PostgreSQL error"
        }`,
      );
    });

    await saveExecutionContext({
      executionId,
      key: `step:${stepId}:response`,
      value: response as unknown as Record<string, unknown>,
    }).catch((error) => {
      console.warn(
        `Failed to save execution context for ${executionId}: ${
          error instanceof Error ? error.message : "Unknown PostgreSQL error"
        }`,
      );
    });
  }

  res.json({
    success: !response.error,
    data: response,
  });
});

// POST /api/mcp/execute-node - Execute a workflow node
router.post("/execute-node", async (req, res) => {
  const node = req.body as DAGNode;
  const executionId =
    typeof req.body?.executionId === "string"
      ? req.body.executionId
      : typeof req.body?.execution_id === "string"
        ? req.body.execution_id
        : undefined;
  const workflowId =
    typeof req.body?.workflowId === "string"
      ? req.body.workflowId
      : typeof req.body?.workflow_id === "string"
        ? req.body.workflow_id
        : undefined;
  const stepId = node.id || `step-${uuidv4()}`;

  if (!node.id || !node.service || !node.operation) {
    return res.status(400).json({
      success: false,
      error: "Invalid node: missing id, service, or operation",
    });
  }

  await safeEnsureExecutionRecords({
    executionId,
    workflowId,
    workflowName: "DAG Node Execution",
  });

  await safeSaveStepRun({
    stepId,
    executionId,
    toolName: `${node.service}.${node.operation}`,
    inputPayload: node.config,
    status: "running",
    retryCount: 0,
  });

  const result = await executeNode(node);

  await safeSaveStepRun({
    stepId,
    executionId,
    toolName: `${node.service}.${node.operation}`,
    inputPayload: node.config,
    outputPayload: result as unknown as Record<string, unknown>,
    status: result.error ? "failed" : "success",
    retryCount: 0,
  });

  dataStore.addLog({
    level: result.error ? "error" : "info",
    service: node.service,
    action: "mcp_execute_node",
    message: result.error
      ? `Node ${node.id} failed`
      : `Node ${node.id} executed`,
    executionId,
    workflowId,
    nodeId: node.id,
    details: {
      operation: node.operation,
      hasError: Boolean(result.error),
    },
  });

  if (executionId) {
    await saveWorkflowExecution({
      id: executionId,
      workflowId: workflowId || `adhoc-${executionId}`,
      status: result.error ? "failed" : "completed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }).catch((error) => {
      console.warn(
        `Failed to finalize node execution ${executionId}: ${
          error instanceof Error ? error.message : "Unknown PostgreSQL error"
        }`,
      );
    });
  }

  res.json({
    success: !result.error,
    data: result,
  });
});

// GET /api/mcp/methods - List available MCP methods
router.get("/methods", (_req, res) => {
  const methods = getAvailableMethods();

  res.json({
    success: true,
    data: methods,
  });
});

// POST /api/mcp/batch - Execute multiple MCP requests
router.post("/batch", async (req, res) => {
  const requests = req.body as MCPRequest[];

  if (!Array.isArray(requests)) {
    return res.status(400).json({
      success: false,
      error: "Request body must be an array of MCP requests",
    });
  }

  const responses = await Promise.all(
    requests.map((request) => processMCPRequest(request)),
  );

  res.json({
    success: true,
    data: responses,
  });
});

// WebSocket-like endpoint for streaming execution updates
// In a real app, this would be a WebSocket connection
router.post("/stream", async (req, res) => {
  const { workflowId } = req.body;

  const workflow = dataStore.getWorkflow(workflowId);

  if (!workflow) {
    return res.status(404).json({
      success: false,
      error: "Workflow not found",
    });
  }

  // Start execution
  const execution = dataStore.createExecution(workflowId);

  if (!execution) {
    return res.status(500).json({
      success: false,
      error: "Failed to create execution",
    });
  }

  dataStore.addLog({
    level: "info",
    service: "system",
    action: "workflow_stream_run_started",
    message: `Workflow "${workflow.name}" stream execution started`,
    workflowId,
    executionId: execution.id,
    details: {
      workflowName: workflow.name,
      nodes: workflow.nodes.length,
    },
  });

  // Execute nodes in order (simplified - real implementation would handle DAG topology)
  const results: Record<string, unknown> = {};

  for (const node of workflow.nodes) {
    dataStore.addLog({
      level: "info",
      service: node.service,
      action: "workflow_node_started",
      message: `Node ${node.id} (${node.operation}) started`,
      workflowId,
      executionId: execution.id,
      nodeId: node.id,
      details: {
        operation: node.operation,
        label: node.label,
      },
    });

    // Update node status to running
    dataStore.updateExecution(execution.id, {
      currentNodeId: node.id,
      nodeResults: {
        ...execution.nodeResults,
        [node.id]: {
          nodeId: node.id,
          status: "running",
          startedAt: new Date().toISOString(),
        },
      },
    });

    // Execute the node
    const result = await executeNode(node);
    results[node.id] = result;

    dataStore.addLog({
      level: result.error ? "error" : "info",
      service: node.service,
      action: result.error ? "workflow_node_failed" : "workflow_node_completed",
      message: result.error
        ? `Node ${node.id} failed: ${result.error}`
        : `Node ${node.id} completed`,
      workflowId,
      executionId: execution.id,
      nodeId: node.id,
      details: {
        operation: node.operation,
        result: result.result,
        error: result.error,
      },
    });

    // Update node status to completed or failed
    dataStore.updateExecution(execution.id, {
      nodeResults: {
        ...execution.nodeResults,
        [node.id]: {
          nodeId: node.id,
          status: result.error ? "failed" : "completed",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          result: result.result,
          error: result.error,
        },
      },
    });

    // If node failed, stop execution
    if (result.error) {
      dataStore.updateExecution(execution.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
      });

      dataStore.updateWorkflow(workflowId, { status: "failed" });

      dataStore.addLog({
        level: "error",
        service: "system",
        action: "workflow_stream_run_failed",
        message: `Workflow "${workflow.name}" failed on node ${node.id}`,
        workflowId,
        executionId: execution.id,
        nodeId: node.id,
        details: {
          operation: node.operation,
          error: result.error,
        },
      });

      return res.json({
        success: false,
        data: {
          execution: dataStore.getExecution(execution.id),
          results,
        },
        error: `Node ${node.id} failed: ${result.error}`,
      });
    }
  }

  // Mark execution as completed
  dataStore.updateExecution(execution.id, {
    status: "completed",
    completedAt: new Date().toISOString(),
    currentNodeId: undefined,
  });

  dataStore.updateWorkflow(workflowId, { status: "completed" });

  dataStore.addLog({
    level: "info",
    service: "system",
    action: "workflow_stream_run_completed",
    message: `Workflow "${workflow.name}" stream execution completed`,
    workflowId,
    executionId: execution.id,
    details: {
      nodesExecuted: workflow.nodes.length,
    },
  });

  res.json({
    success: true,
    data: {
      execution: dataStore.getExecution(execution.id),
      results,
    },
    message: "Workflow executed successfully",
  });
});

export default router;
