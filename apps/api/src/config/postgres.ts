import { Pool, type PoolConfig } from "pg";

let postgresPool: Pool | null = null;

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isPostgresConfigured(): boolean {
  if (process.env.DATABASE_URL) {
    return true;
  }

  return Boolean(
    process.env.PGHOST && process.env.PGUSER && process.env.PGDATABASE,
  );
}

function buildPoolConfig(): PoolConfig {
  if (process.env.DATABASE_URL) {
    const useSsl =
      String(process.env.PGSSL || "false").toLowerCase() === "true";
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      max: toInt(process.env.PG_MAX_CLIENTS, 20),
      idleTimeoutMillis: toInt(process.env.PG_IDLE_TIMEOUT_MS, 30000),
      connectionTimeoutMillis: toInt(process.env.PG_CONNECT_TIMEOUT_MS, 5000),
    };
  }

  return {
    host: process.env.PGHOST || "localhost",
    port: toInt(process.env.PGPORT, 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
    database: process.env.PGDATABASE || "NexusMCP",
    max: toInt(process.env.PG_MAX_CLIENTS, 20),
    idleTimeoutMillis: toInt(process.env.PG_IDLE_TIMEOUT_MS, 30000),
    connectionTimeoutMillis: toInt(process.env.PG_CONNECT_TIMEOUT_MS, 5000),
  };
}

export function getPostgresPool(): Pool {
  if (!postgresPool) {
    postgresPool = new Pool(buildPoolConfig());
  }

  return postgresPool;
}

export async function testPostgresConnection(): Promise<void> {
  const pool = getPostgresPool();
  await pool.query("SELECT 1");
}

export async function closePostgresPool(): Promise<void> {
  if (!postgresPool) {
    return;
  }

  await postgresPool.end();
  postgresPool = null;
}
