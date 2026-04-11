import { Router } from "express";
import { dataStore } from "../data/store.js";
import type { AuditLog } from "../types/index.js";
import {
  getEventLogs,
  getEventLogStats,
  getStepRuns,
  isPostgresReady,
  type StepRunRecord,
} from "../services/postgres-store.js";

const router = Router();

function inferServiceFromToolName(
  toolName: string,
):
  | "jira"
  | "slack"
  | "github"
  | "postgres"
  | "google_sheets"
  | "gmail"
  | "system" {
  const normalized = toolName.toLowerCase();

  if (normalized.startsWith("jira.")) return "jira";
  if (normalized.startsWith("slack.")) return "slack";
  if (normalized.startsWith("github.")) return "github";
  if (normalized.startsWith("gmail.")) return "gmail";
  if (
    normalized.startsWith("google_sheets.") ||
    normalized.startsWith("sheets.")
  ) {
    return "google_sheets";
  }
  if (
    normalized.startsWith("postgres.") ||
    normalized.startsWith("postgresql.")
  ) {
    return "postgres";
  }

  return "system";
}

function mapStepRunToAuditLog(step: StepRunRecord): AuditLog {
  const status = step.status.toLowerCase();
  const level: AuditLog["level"] =
    status === "failed" || status === "error"
      ? "error"
      : status === "running" || status === "retrying"
        ? "warning"
        : "info";

  return {
    id: `step-log-${step.stepId}`,
    timestamp: step.updatedAt,
    level,
    service: inferServiceFromToolName(step.toolName),
    action: "step_run",
    message: `Step ${step.toolName} ${step.status}`,
    executionId: step.executionId,
    workflowId: step.workflowId,
    details: {
      stepId: step.stepId,
      toolName: step.toolName,
      status: step.status,
      retryCount: step.retryCount,
      request: step.inputPayload,
      response: step.outputPayload,
    },
  };
}

function applyAuditFilters(
  logs: AuditLog[],
  filters: {
    level?: AuditLog["level"];
    service?: AuditLog["service"];
    workflowId?: string;
    search?: string;
  },
) {
  return logs.filter((log) => {
    if (filters.level && log.level !== filters.level) {
      return false;
    }

    if (filters.service && log.service !== filters.service) {
      return false;
    }

    if (filters.workflowId && log.workflowId !== filters.workflowId) {
      return false;
    }

    if (filters.search) {
      const query = filters.search.toLowerCase();
      const inMessage = log.message.toLowerCase().includes(query);
      const inAction = log.action.toLowerCase().includes(query);
      if (!inMessage && !inAction) {
        return false;
      }
    }

    return true;
  });
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

  const result = await (async () => {
    if (!isPostgresReady()) {
      return dataStore.getLogs(filters);
    }

    try {
      const postgresLogs = await getEventLogs(filters);

      if (postgresLogs.total > 0) {
        return postgresLogs;
      }

      // If event_logs is empty, derive audit data from PostgreSQL step_runs.
      const stepRunResult = await getStepRuns({
        workflowId: filters.workflowId,
        search: filters.search,
        limit: filters.limit ?? 50,
        offset: filters.offset ?? 0,
      });

      const derivedLogs = applyAuditFilters(
        stepRunResult.rows.map(mapStepRunToAuditLog),
        filters,
      );

      return {
        logs: derivedLogs,
        total: stepRunResult.total,
      };
    } catch (error) {
      console.warn(
        `PostgreSQL logs query failed; using in-memory fallback: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      return dataStore.getLogs(filters);
    }
  })();

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
  if (isPostgresReady()) {
    try {
      const stats = await getEventLogStats();

      if (stats.total > 0) {
        return res.json({
          success: true,
          data: stats,
        });
      }

      // If event_logs is empty, derive statistics from PostgreSQL step_runs.
      const stepRuns = await getStepRuns({ limit: 500, offset: 0 });
      const derived = stepRuns.rows.map(mapStepRunToAuditLog);

      const derivedStats = {
        total: derived.length,
        byLevel: {
          info: 0,
          warning: 0,
          error: 0,
          debug: 0,
        },
        byService: {
          jira: 0,
          slack: 0,
          github: 0,
          postgres: 0,
          google_sheets: 0,
          gmail: 0,
          system: 0,
        },
        last24Hours: 0,
      };

      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

      for (const log of derived) {
        derivedStats.byLevel[log.level] += 1;
        derivedStats.byService[log.service] += 1;

        if (new Date(log.timestamp).getTime() > oneDayAgo) {
          derivedStats.last24Hours += 1;
        }
      }

      return res.json({
        success: true,
        data: derivedStats,
      });
    } catch (error) {
      console.warn(
        `PostgreSQL log stats query failed; using in-memory fallback: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  const allLogs = dataStore.getLogs({ limit: 1000 });

  const stats = {
    total: allLogs.total,
    byLevel: {
      info: 0,
      warning: 0,
      error: 0,
      debug: 0,
    },
    byService: {
      jira: 0,
      slack: 0,
      github: 0,
      postgres: 0,
      google_sheets: 0,
      gmail: 0,
      system: 0,
    },
    last24Hours: 0,
  };

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  allLogs.logs.forEach((log) => {
    stats.byLevel[log.level]++;
    stats.byService[log.service]++;

    if (new Date(log.timestamp).getTime() > oneDayAgo) {
      stats.last24Hours++;
    }
  });

  res.json({
    success: true,
    data: stats,
  });
});

export default router;
