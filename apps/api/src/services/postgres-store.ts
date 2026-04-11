import { randomBytes, createCipheriv, createHash } from "crypto";
import type { AuditLog, Workflow, WorkflowExecution } from "../types/index.js";
import {
  getPostgresPool,
  isPostgresConfigured,
  testPostgresConnection,
} from "../config/postgres.js";

type Json =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

type LogFilters = {
  level?: AuditLog["level"];
  service?: AuditLog["service"];
  workflowId?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

type StepRunFilters = {
  executionId?: string;
  workflowId?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type StepRunRecord = {
  stepId: string;
  executionId?: string;
  workflowId?: string;
  toolName: string;
  inputPayload?: Json;
  outputPayload?: Json;
  status: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
};

let postgresReady = false;

const schemaStatements = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  `CREATE TABLE IF NOT EXISTS workflow_definitions (
      workflow_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      natural_language_input TEXT NOT NULL,
      generated_dag JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';`,
  `ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
  `ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS owner_user_id TEXT;`,
  `CREATE TABLE IF NOT EXISTS workflow_executions (
      execution_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflow_definitions(workflow_id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'paused', 'completed')),
      start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      end_time TIMESTAMPTZ
    );`,
  `CREATE TABLE IF NOT EXISTS step_runs (
      step_id TEXT PRIMARY KEY,
      execution_id TEXT REFERENCES workflow_executions(execution_id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      input_payload JSONB,
      output_payload JSONB,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0
    );`,
  `ALTER TABLE step_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
  `ALTER TABLE step_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
  `CREATE TABLE IF NOT EXISTS mcp_tool_registry (
      tool_id TEXT PRIMARY KEY,
      service_name TEXT NOT NULL,
      method_name TEXT NOT NULL,
      schema JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(service_name, method_name)
    );`,
  `CREATE TABLE IF NOT EXISTS service_connections (
      connection_id TEXT PRIMARY KEY,
      service_name TEXT NOT NULL UNIQUE,
      api_key_encrypted TEXT,
      token_encrypted TEXT,
      scopes JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE TABLE IF NOT EXISTS event_logs (
      log_id TEXT PRIMARY KEY,
      execution_id TEXT REFERENCES workflow_executions(execution_id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error', 'debug')),
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      service TEXT,
      action TEXT,
      workflow_id TEXT,
      node_id TEXT,
      user_id TEXT,
      details JSONB
    );`,
  `CREATE TABLE IF NOT EXISTS approval_requests (
      approval_id TEXT PRIMARY KEY,
      execution_id TEXT REFERENCES workflow_executions(execution_id) ON DELETE CASCADE,
      step_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      approved_by TEXT,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE TABLE IF NOT EXISTS context_state_store (
      execution_id TEXT NOT NULL REFERENCES workflow_executions(execution_id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value JSONB NOT NULL,
      PRIMARY KEY (execution_id, key)
    );`,
  `CREATE INDEX IF NOT EXISTS idx_event_logs_timestamp ON event_logs(timestamp DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_event_logs_level ON event_logs(level);`,
  `CREATE INDEX IF NOT EXISTS idx_event_logs_service ON event_logs(service);`,
  `CREATE INDEX IF NOT EXISTS idx_step_runs_execution_id ON step_runs(execution_id);`,
  `CREATE INDEX IF NOT EXISTS idx_step_runs_updated_at ON step_runs(updated_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id ON workflow_executions(workflow_id);`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_definitions_owner_user_id ON workflow_definitions(owner_user_id, updated_at DESC);`,
];

function normalizeStatus(status: string): string {
  if (status === "completed") return "success";
  if (status === "paused") return "paused";
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  return "success";
}

function encryptedSecret(value?: string): string | null {
  if (!value) return null;

  const secret =
    process.env.CREDENTIALS_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    "nexusmcp-local-dev-encryption-key";

  const key = createHash("sha256").update(secret, "utf8").digest();
  const iv = randomBytes(12);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

async function query(sql: string, params: unknown[] = []) {
  const pool = getPostgresPool();
  return pool.query(sql, params);
}

export function isPostgresReady(): boolean {
  return postgresReady;
}

export async function initPostgresStore(): Promise<boolean> {
  if (!isPostgresConfigured()) {
    postgresReady = false;
    return false;
  }

  await testPostgresConnection();

  for (const statement of schemaStatements) {
    await query(statement);
  }

  postgresReady = true;
  return true;
}

export async function saveWorkflowDefinition(
  workflow: Pick<
    Workflow,
    | "id"
    | "name"
    | "description"
    | "nodes"
    | "edges"
    | "status"
    | "createdAt"
    | "updatedAt"
  > & {
    ownerUserId?: string;
    generatedJson?: Record<string, unknown>;
  },
): Promise<void> {
  if (!postgresReady) return;

  const dag = {
    nodes: workflow.nodes,
    edges: workflow.edges,
    status: workflow.status,
    generatedJson: workflow.generatedJson,
  };

  await query(
    `INSERT INTO workflow_definitions (workflow_id, name, natural_language_input, generated_dag, status, owner_user_id, updated_at, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz, $8::timestamptz)
     ON CONFLICT (workflow_id)
     DO UPDATE SET
       name = EXCLUDED.name,
       natural_language_input = EXCLUDED.natural_language_input,
       generated_dag = EXCLUDED.generated_dag,
       status = EXCLUDED.status,
       owner_user_id = COALESCE(EXCLUDED.owner_user_id, workflow_definitions.owner_user_id),
       updated_at = EXCLUDED.updated_at`,
    [
      workflow.id,
      workflow.name,
      workflow.description || "",
      JSON.stringify(dag),
      workflow.status,
      workflow.ownerUserId || null,
      workflow.updatedAt,
      workflow.createdAt,
    ],
  );
}

function parseWorkflowRow(row: Record<string, unknown>): Workflow {
  const dagRaw =
    row.generated_dag && typeof row.generated_dag === "object"
      ? (row.generated_dag as Record<string, unknown>)
      : {};

  const nodes = Array.isArray(dagRaw.nodes) ? dagRaw.nodes : [];
  const edges = Array.isArray(dagRaw.edges) ? dagRaw.edges : [];

  const statusRaw =
    typeof row.status === "string" && row.status.trim().length > 0
      ? row.status.trim()
      : typeof dagRaw.status === "string"
        ? dagRaw.status.trim()
        : "draft";

  const status: Workflow["status"] =
    statusRaw === "draft" ||
    statusRaw === "ready" ||
    statusRaw === "running" ||
    statusRaw === "completed" ||
    statusRaw === "failed" ||
    statusRaw === "paused"
      ? statusRaw
      : "draft";

  return {
    id: String(row.workflow_id || ""),
    name: String(row.name || "Untitled Workflow"),
    description: String(row.natural_language_input || ""),
    nodes: nodes as Workflow["nodes"],
    edges: edges as Workflow["edges"],
    status,
    createdAt: new Date(
      String(row.created_at || new Date().toISOString()),
    ).toISOString(),
    updatedAt: new Date(
      String(row.updated_at || row.created_at || new Date().toISOString()),
    ).toISOString(),
    executionHistory: [],
    ownerUserId:
      typeof row.owner_user_id === "string" ? row.owner_user_id : undefined,
    generatedJson:
      dagRaw.generatedJson && typeof dagRaw.generatedJson === "object"
        ? (dagRaw.generatedJson as Record<string, unknown>)
        : undefined,
  };
}

export async function listWorkflowDefinitions(
  ownerUserId?: string,
): Promise<Workflow[]> {
  if (!postgresReady) return [];

  const params: unknown[] = [];
  const whereClause = ownerUserId
    ? (() => {
        params.push(ownerUserId);
        return `WHERE owner_user_id = $${params.length}`;
      })()
    : "";

  const result = await query(
    `SELECT workflow_id, name, natural_language_input, generated_dag, status, owner_user_id, updated_at, created_at
     FROM workflow_definitions
     ${whereClause}
     ORDER BY updated_at DESC, created_at DESC`,
    params,
  );

  return result.rows.map((row) =>
    parseWorkflowRow(row as Record<string, unknown>),
  );
}

export async function getWorkflowDefinition(
  workflowId: string,
  ownerUserId?: string,
): Promise<Workflow | null> {
  if (!postgresReady) return null;

  const params: unknown[] = [workflowId];
  const ownerClause = ownerUserId
    ? (() => {
        params.push(ownerUserId);
        return ` AND owner_user_id = $${params.length}`;
      })()
    : "";

  const result = await query(
    `SELECT workflow_id, name, natural_language_input, generated_dag, status, owner_user_id, updated_at, created_at
     FROM workflow_definitions
     WHERE workflow_id = $1
     ${ownerClause}
     LIMIT 1`,
    params,
  );

  if (result.rows.length === 0) {
    return null;
  }

  return parseWorkflowRow(result.rows[0] as Record<string, unknown>);
}

export async function deleteWorkflowDefinition(
  workflowId: string,
  ownerUserId?: string,
): Promise<boolean> {
  if (!postgresReady) return false;

  const params: unknown[] = [workflowId];
  const ownerClause = ownerUserId
    ? (() => {
        params.push(ownerUserId);
        return ` AND owner_user_id = $${params.length}`;
      })()
    : "";

  const result = await query(
    `DELETE FROM workflow_definitions WHERE workflow_id = $1${ownerClause}`,
    params,
  );

  return (result.rowCount ?? 0) > 0;
}

export async function saveWorkflowExecution(
  execution: Pick<
    WorkflowExecution,
    "id" | "workflowId" | "status" | "startedAt" | "completedAt"
  >,
): Promise<void> {
  if (!postgresReady) return;

  await query(
    `INSERT INTO workflow_executions (execution_id, workflow_id, status, start_time, end_time)
     VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)
     ON CONFLICT (execution_id)
     DO UPDATE SET
       status = EXCLUDED.status,
       end_time = EXCLUDED.end_time`,
    [
      execution.id,
      execution.workflowId,
      normalizeStatus(execution.status),
      execution.startedAt,
      execution.completedAt || null,
    ],
  );
}

export async function saveStepRun(args: {
  stepId: string;
  executionId?: string;
  toolName: string;
  inputPayload?: Json;
  outputPayload?: Json;
  status: string;
  retryCount?: number;
}): Promise<void> {
  if (!postgresReady) return;

  await query(
    `INSERT INTO step_runs (step_id, execution_id, tool_name, input_payload, output_payload, status, retry_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, NOW(), NOW())
     ON CONFLICT (step_id)
     DO UPDATE SET
       input_payload = COALESCE(step_runs.input_payload, EXCLUDED.input_payload),
       output_payload = EXCLUDED.output_payload,
       status = EXCLUDED.status,
       retry_count = EXCLUDED.retry_count,
       updated_at = NOW()`,
    [
      args.stepId,
      args.executionId || null,
      args.toolName,
      args.inputPayload !== undefined
        ? JSON.stringify(args.inputPayload)
        : null,
      args.outputPayload !== undefined
        ? JSON.stringify(args.outputPayload)
        : null,
      args.status,
      args.retryCount ?? 0,
    ],
  );
}

export async function registerMcpTool(args: {
  toolId: string;
  serviceName: string;
  methodName: string;
  schema?: Json;
}): Promise<void> {
  if (!postgresReady) return;

  await query(
    `INSERT INTO mcp_tool_registry (tool_id, service_name, method_name, schema)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (tool_id)
     DO UPDATE SET
       service_name = EXCLUDED.service_name,
       method_name = EXCLUDED.method_name,
       schema = EXCLUDED.schema`,
    [
      args.toolId,
      args.serviceName,
      args.methodName,
      JSON.stringify(args.schema ?? {}),
    ],
  );
}

export async function saveServiceConnection(args: {
  connectionId: string;
  serviceName: string;
  apiKey?: string;
  token?: string;
  scopes?: string[];
}): Promise<void> {
  if (!postgresReady) return;

  await query(
    `INSERT INTO service_connections (connection_id, service_name, api_key_encrypted, token_encrypted, scopes, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
     ON CONFLICT (service_name)
     DO UPDATE SET
       connection_id = EXCLUDED.connection_id,
       api_key_encrypted = EXCLUDED.api_key_encrypted,
       token_encrypted = EXCLUDED.token_encrypted,
       scopes = EXCLUDED.scopes,
       updated_at = NOW()`,
    [
      args.connectionId,
      args.serviceName,
      encryptedSecret(args.apiKey),
      encryptedSecret(args.token),
      JSON.stringify(args.scopes ?? []),
    ],
  );
}

export async function saveEventLog(log: AuditLog): Promise<void> {
  if (!postgresReady) return;

  await query(
    `INSERT INTO event_logs (log_id, execution_id, message, level, timestamp, service, action, workflow_id, node_id, user_id, details)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (log_id)
     DO NOTHING`,
    [
      log.id,
      log.executionId || null,
      log.message,
      log.level,
      log.timestamp,
      log.service,
      log.action,
      log.workflowId || null,
      log.nodeId || null,
      log.userId || null,
      JSON.stringify(log.details ?? {}),
    ],
  );
}

export async function getEventLogs(
  filters?: LogFilters,
): Promise<{ logs: AuditLog[]; total: number }> {
  if (!postgresReady) {
    return { logs: [], total: 0 };
  }

  const where: string[] = [];
  const params: unknown[] = [];

  if (filters?.level) {
    params.push(filters.level);
    where.push(`level = $${params.length}`);
  }

  if (filters?.service) {
    params.push(filters.service);
    where.push(`service = $${params.length}`);
  }

  if (filters?.workflowId) {
    params.push(filters.workflowId);
    where.push(
      `(workflow_id = $${params.length} OR execution_id IN (SELECT execution_id FROM workflow_executions WHERE workflow_id = $${params.length}))`,
    );
  }

  if (filters?.search) {
    params.push(`%${filters.search}%`);
    where.push(
      `(message ILIKE $${params.length} OR action ILIKE $${params.length})`,
    );
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const totalResult = await query(
    `SELECT COUNT(*)::int AS total FROM event_logs ${whereClause}`,
    params,
  );

  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;
  const rowParams = [...params, limit, offset];

  const rowsResult = await query(
    `SELECT log_id, execution_id, message, level, timestamp, service, action, workflow_id, node_id, user_id, details
     FROM event_logs
     ${whereClause}
     ORDER BY timestamp DESC
     LIMIT $${rowParams.length - 1}
     OFFSET $${rowParams.length}`,
    rowParams,
  );

  const logs: AuditLog[] = rowsResult.rows.map((row) => ({
    id: String(row.log_id),
    executionId: row.execution_id ? String(row.execution_id) : undefined,
    message: String(row.message),
    level: row.level as AuditLog["level"],
    timestamp: new Date(row.timestamp).toISOString(),
    service: row.service as AuditLog["service"],
    action: row.action ? String(row.action) : "event",
    workflowId: row.workflow_id ? String(row.workflow_id) : undefined,
    nodeId: row.node_id ? String(row.node_id) : undefined,
    userId: row.user_id ? String(row.user_id) : undefined,
    details:
      row.details && typeof row.details === "object"
        ? (row.details as Record<string, unknown>)
        : undefined,
  }));

  return {
    logs,
    total: totalResult.rows[0]?.total ?? 0,
  };
}

export async function getEventLogStats(): Promise<{
  total: number;
  byLevel: Record<AuditLog["level"], number>;
  byService: Record<AuditLog["service"], number>;
  last24Hours: number;
}> {
  const emptyStats = {
    total: 0,
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

  if (!postgresReady) {
    return emptyStats;
  }

  const [totalResult, levelResult, serviceResult, recentResult] =
    await Promise.all([
      query(`SELECT COUNT(*)::int AS total FROM event_logs`),
      query(
        `SELECT level, COUNT(*)::int AS count FROM event_logs GROUP BY level`,
      ),
      query(
        `SELECT service, COUNT(*)::int AS count FROM event_logs GROUP BY service`,
      ),
      query(
        `SELECT COUNT(*)::int AS count FROM event_logs WHERE timestamp > NOW() - INTERVAL '24 hours'`,
      ),
    ]);

  const stats = {
    ...emptyStats,
    total: totalResult.rows[0]?.total ?? 0,
    last24Hours: recentResult.rows[0]?.count ?? 0,
  };

  for (const row of levelResult.rows) {
    const level = row.level as AuditLog["level"];
    if (level in stats.byLevel) {
      stats.byLevel[level] = row.count;
    }
  }

  for (const row of serviceResult.rows) {
    const service = row.service as AuditLog["service"];
    if (service in stats.byService) {
      stats.byService[service] = row.count;
    }
  }

  return stats;
}

export async function getStepRuns(
  filters?: StepRunFilters,
): Promise<{ rows: StepRunRecord[]; total: number }> {
  if (!postgresReady) {
    return { rows: [], total: 0 };
  }

  const where: string[] = [];
  const params: unknown[] = [];

  if (filters?.executionId) {
    params.push(filters.executionId);
    where.push(`s.execution_id = $${params.length}`);
  }

  if (filters?.workflowId) {
    params.push(filters.workflowId);
    where.push(`e.workflow_id = $${params.length}`);
  }

  if (filters?.status) {
    params.push(filters.status);
    where.push(`s.status = $${params.length}`);
  }

  if (filters?.search) {
    params.push(`%${filters.search}%`);
    where.push(`s.tool_name ILIKE $${params.length}`);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const totalResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM step_runs s
     LEFT JOIN workflow_executions e ON e.execution_id = s.execution_id
     ${whereClause}`,
    params,
  );

  const limit = filters?.limit ?? 100;
  const offset = filters?.offset ?? 0;
  const rowParams = [...params, limit, offset];

  const rowsResult = await query(
    `SELECT s.step_id, s.execution_id, e.workflow_id, s.tool_name, s.input_payload, s.output_payload, s.status, s.retry_count, s.created_at, s.updated_at
     FROM step_runs s
     LEFT JOIN workflow_executions e ON e.execution_id = s.execution_id
     ${whereClause}
     ORDER BY s.updated_at DESC, s.created_at DESC
     LIMIT $${rowParams.length - 1}
     OFFSET $${rowParams.length}`,
    rowParams,
  );

  const rows: StepRunRecord[] = rowsResult.rows.map((row) => ({
    stepId: String(row.step_id),
    executionId: row.execution_id ? String(row.execution_id) : undefined,
    workflowId: row.workflow_id ? String(row.workflow_id) : undefined,
    toolName: String(row.tool_name),
    inputPayload:
      row.input_payload === null || row.input_payload === undefined
        ? undefined
        : (row.input_payload as Json),
    outputPayload:
      row.output_payload === null || row.output_payload === undefined
        ? undefined
        : (row.output_payload as Json),
    status: String(row.status),
    retryCount: Number(row.retry_count ?? 0),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));

  return {
    rows,
    total: totalResult.rows[0]?.total ?? 0,
  };
}

export async function saveApprovalRequest(args: {
  approvalId: string;
  executionId?: string;
  stepId?: string;
  status: "pending" | "approved" | "rejected";
  approvedBy?: string;
  timestamp?: string;
}): Promise<void> {
  if (!postgresReady) return;

  await query(
    `INSERT INTO approval_requests (approval_id, execution_id, step_id, status, approved_by, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
     ON CONFLICT (approval_id)
     DO UPDATE SET
       status = EXCLUDED.status,
       approved_by = EXCLUDED.approved_by,
       timestamp = EXCLUDED.timestamp`,
    [
      args.approvalId,
      args.executionId || null,
      args.stepId || null,
      args.status,
      args.approvedBy || null,
      args.timestamp || new Date().toISOString(),
    ],
  );
}

export async function saveExecutionContext(args: {
  executionId: string;
  key: string;
  value: Json;
}): Promise<void> {
  if (!postgresReady) return;

  await query(
    `INSERT INTO context_state_store (execution_id, key, value)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (execution_id, key)
     DO UPDATE SET
       value = EXCLUDED.value`,
    [args.executionId, args.key, JSON.stringify(args.value)],
  );
}
