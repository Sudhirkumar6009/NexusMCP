import { Router } from "express";
import { dataStore } from "../data/store.js";
import {
  getEventLogs,
  getEventLogStats,
  getStepRuns,
  initPostgresStore,
  isPostgresReady,
  saveEventLog,
  type StepRunRecord,
} from "../services/postgres-store.js";

const router = Router();

function toPositiveInt(
  value: unknown,
  fallback: number,
  options?: { min?: number; max?: number },
): number {
  const numeric =
    typeof value === "string" ? Number.parseInt(value, 10) : Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const floored = Math.floor(numeric);
  const min = options?.min ?? Number.MIN_SAFE_INTEGER;
  const max = options?.max ?? Number.MAX_SAFE_INTEGER;

  if (floored < min) {
    return min;
  }

  if (floored > max) {
    return max;
  }

  return floored;
}

async function ensurePostgresReady(): Promise<boolean> {
  if (isPostgresReady()) {
    return true;
  }

  try {
    return await initPostgresStore();
  } catch {
    return false;
  }
}

let hasBackfilledAuditLogs = false;

async function backfillAuditLogsFromMemoryIfNeeded(): Promise<void> {
  if (hasBackfilledAuditLogs) {
    return;
  }

  const memoryLogs = dataStore.getLogs({ limit: 1000, offset: 0 }).logs;
  if (memoryLogs.length === 0) {
    // Keep backfill enabled for future requests because logs may appear later.
    return;
  }

  for (const log of memoryLogs) {
    try {
      await saveEventLog(log);
    } catch (error) {
      console.warn(
        `Audit log backfill entry failed (${log.id}): ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  hasBackfilledAuditLogs = true;
}

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
  const parsedLimit = toPositiveInt(limit, 50, { min: 1, max: 1000 });
  const parsedOffset = toPositiveInt(offset, 0, { min: 0, max: 1000000 });

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
    limit: parsedLimit,
    offset: parsedOffset,
  };

  if (!(await ensurePostgresReady())) {
    return res.status(503).json({
      success: false,
      error:
        "PostgreSQL is not ready. Audit Logs only read from event_logs in PostgreSQL.",
    });
  }

  let result: { logs: unknown[]; total: number };

  try {
    result = await getEventLogs(filters);

    if (result.total === 0) {
      await backfillAuditLogsFromMemoryIfNeeded();
      result = await getEventLogs(filters);
    }
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
      limit: parsedLimit,
      offset: parsedOffset,
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

  const parsedLimit = toPositiveInt(limit, 100, { min: 1, max: 500 });
  const parsedOffset = toPositiveInt(offset, 0, { min: 0, max: 1000000 });

  const filters = {
    executionId: typeof executionId === "string" ? executionId : undefined,
    workflowId: typeof workflowId === "string" ? workflowId : undefined,
    status: typeof status === "string" ? status : undefined,
    search: typeof search === "string" ? search : undefined,
    limit: parsedLimit,
    offset: parsedOffset,
  };

  if (await ensurePostgresReady()) {
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
  if (!(await ensurePostgresReady())) {
    return res.status(503).json({
      success: false,
      error:
        "PostgreSQL is not ready. Log stats only read from event_logs in PostgreSQL.",
    });
  }

  try {
    await backfillAuditLogsFromMemoryIfNeeded();
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
