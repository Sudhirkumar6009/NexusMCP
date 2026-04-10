-- NexusMCP Database Initialization
-- This script runs on first database creation

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255),
    avatar_url TEXT,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Workflows table
CREATE TABLE IF NOT EXISTS workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    prompt TEXT NOT NULL,
    dag_data JSONB NOT NULL,
    status VARCHAR(50) DEFAULT 'draft',
    user_id UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Workflow executions table
CREATE TABLE IF NOT EXISTS executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'running',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    progress INTEGER DEFAULT 0,
    steps_data JSONB DEFAULT '[]'::jsonb,
    context_data JSONB DEFAULT '{}'::jsonb,
    error_message TEXT
);

-- Integrations table
CREATE TABLE IF NOT EXISTS integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'disconnected',
    config JSONB DEFAULT '{}'::jsonb,
    credentials JSONB DEFAULT '{}'::jsonb,
    user_id UUID REFERENCES users(id),
    last_sync_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    user_id UUID REFERENCES users(id),
    details JSONB DEFAULT '{}'::jsonb,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_workflows_user_id ON workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
CREATE INDEX IF NOT EXISTS idx_executions_workflow_id ON executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_integrations_user_id ON integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_integrations_type ON integrations(type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Functions
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_workflows_updated_at ON workflows;
CREATE TRIGGER update_workflows_updated_at
    BEFORE UPDATE ON workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_integrations_updated_at ON integrations;
CREATE TRIGGER update_integrations_updated_at
    BEFORE UPDATE ON integrations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STRICT NexusMCP Runtime Persistence Schema (Requested)
-- NOTE: Configure POSTGRES_DB=NexusMCP (see docker-compose or local .env)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1) Workflows (definitions)
CREATE TABLE IF NOT EXISTS workflow_definitions (
    workflow_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    natural_language_input TEXT NOT NULL,
    generated_dag JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2) Executions (runtime instances)
CREATE TABLE IF NOT EXISTS workflow_executions (
    execution_id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflow_definitions(workflow_id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'paused', 'completed')),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP WITH TIME ZONE
);

-- 3) Step Runs (DAG node tracking)
CREATE TABLE IF NOT EXISTS step_runs (
    step_id TEXT PRIMARY KEY,
    execution_id TEXT REFERENCES workflow_executions(execution_id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    input_payload JSONB,
    output_payload JSONB,
    status TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0
);

-- 4) MCP Tool Registry
CREATE TABLE IF NOT EXISTS mcp_tool_registry (
    tool_id TEXT PRIMARY KEY,
    service_name TEXT NOT NULL,
    method_name TEXT NOT NULL,
    schema JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(service_name, method_name)
);

-- 5) Credentials / Connections
CREATE TABLE IF NOT EXISTS service_connections (
    connection_id TEXT PRIMARY KEY,
    service_name TEXT NOT NULL UNIQUE,
    api_key_encrypted TEXT,
    token_encrypted TEXT,
    scopes JSONB,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6) Event Logs (audit trail)
CREATE TABLE IF NOT EXISTS event_logs (
    log_id TEXT PRIMARY KEY,
    execution_id TEXT REFERENCES workflow_executions(execution_id) ON DELETE SET NULL,
    message TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('info', 'error', 'warning', 'debug')),
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    service TEXT,
    action TEXT,
    workflow_id TEXT,
    node_id TEXT,
    user_id TEXT,
    details JSONB
);

-- 7) Approval Requests (human-in-loop)
CREATE TABLE IF NOT EXISTS approval_requests (
    approval_id TEXT PRIMARY KEY,
    execution_id TEXT REFERENCES workflow_executions(execution_id) ON DELETE CASCADE,
    step_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_by TEXT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 8) Context / State Store
CREATE TABLE IF NOT EXISTS context_state_store (
    execution_id TEXT NOT NULL REFERENCES workflow_executions(execution_id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    PRIMARY KEY (execution_id, key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id ON workflow_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_step_runs_execution_id ON step_runs(execution_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_timestamp ON event_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_event_logs_level ON event_logs(level);
CREATE INDEX IF NOT EXISTS idx_event_logs_service ON event_logs(service);
