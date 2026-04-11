import { Router } from "express";
import { dataStore } from "../data/store.js";
import {
  getEventLogs,
  getEventLogStats,
  getStepRuns,
  isPostgresReady,
  type StepRunRecord,
} from "../services/postgres-store.js";

const router = Router();

function mapLogsToStepRunsFallback(limit: number, offset: number) {
  const source = dataStore.getLogs({ limit: 1000, offset: 0 }).logs;
  const stepLikeLogs = source.filter(
    (log) => log.action === "mcp_execute" || log.action === "mcp_execute_node",
  );

  const rows: StepRunRecord[] = stepLikeLogs.map((log) => ({
    stepId: `step-fallback-${log.id}`,
    executionId: log.executionId,
    workflowId: log.workflowId,
    toolName:
      (typeof log.details?.method === "string" && log.details.method) ||
      (typeof log.details?.operation === "string" && log.details.operation) ||
      log.action,
    inputPayload: undefined,
    outputPayload: log.details,
    status: log.level === "error" ? "failed" : "success",
    retryCount: 0,
    createdAt: log.timestamp,
    updatedAt: log.timestamp,
  }));

  return {
    rows: rows.slice(offset, offset + limit),
    total: rows.length,
  };
}

// GET /api/logs - List audit logs with filtering
router.get("/", async (req, res) => {
  const { level, service, search, workflowId, limit, offset } = req.query;

  const filters = {
    level: level as "info" | "warning" | "error" | "debug" | undefined,
    service: service as
      | "jira"
      | "slack"
      | "github"
      | "postgres"
      | "google_sheets"
      | "gmail"
      | "system"
      | undefined,
    search: search as string | undefined,
    workflowId: workflowId as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
  };

  if (!isPostgresReady()) {
    return res.status(503).json({
      success: false,
      error:
        "PostgreSQL is not ready. Audit Logs only read from event_logs in PostgreSQL.",
    });
  }

  let result: { logs: unknown[]; total: number };

  try {
    result = await getEventLogs(filters);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: `Failed to load PostgreSQL event_logs: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    });
  }

  res.json({
    success: true,
    data: result.logs,
    pagination: {
      total: result.total,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    },
  });
});

// POST /api/logs - Create a new log entry (internal use)
router.post("/", (req, res) => {
  const {
    level,
    service,
    action,
    message,
    details,
    workflowId,
    nodeId,
    userId,
  } = req.body;

  if (!level || !service || !action || !message) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields: level, service, action, message",
    });
  }

  const log = dataStore.addLog({
    level,
    service,
    action,
    message,
    details,
    workflowId,
    nodeId,
    userId,
  });

  res.status(201).json({
    success: true,
    data: log,
  });
});

// GET /api/logs/step-runs - List persisted step runs
router.get("/step-runs", async (req, res) => {
  const { executionId, workflowId, status, search, limit, offset } = req.query;

  const parsedLimit = limit ? parseInt(limit as string, 10) : 100;
  const parsedOffset = offset ? parseInt(offset as string, 10) : 0;

  const filters = {
    executionId: typeof executionId === "string" ? executionId : undefined,
    workflowId: typeof workflowId === "string" ? workflowId : undefined,
    status: typeof status === "string" ? status : undefined,
    search: typeof search === "string" ? search : undefined,
    limit: Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 500)
      : 100,
    offset: Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0,
  };

  if (isPostgresReady()) {
    try {
      const result = await getStepRuns(filters);

      return res.json({
        success: true,
        source: "postgres",
        data: result.rows,
        pagination: {
          total: result.total,
          limit: filters.limit,
          offset: filters.offset,
        },
      });
    } catch (error) {
      console.warn(
        `PostgreSQL step-runs query failed; using in-memory fallback: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  const fallback = mapLogsToStepRunsFallback(filters.limit, filters.offset);

  return res.json({
    success: true,
    source: "memory",
    data: fallback.rows,
    pagination: {
      total: fallback.total,
      limit: filters.limit,
      offset: filters.offset,
    },
  });
});

// GET /api/logs/stats - Get log statistics
router.get("/stats", async (_req, res) => {
  if (!isPostgresReady()) {
    return res.status(503).json({
      success: false,
      error:
        "PostgreSQL is not ready. Log stats only read from event_logs in PostgreSQL.",
    });
  }

  try {
    const stats = await getEventLogStats();
    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: `Failed to load PostgreSQL event_log stats: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    });
  }
});

export default router;
