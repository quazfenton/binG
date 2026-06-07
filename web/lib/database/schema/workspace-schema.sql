-- ============================================================================
-- Workspace Runtime Schema  (Phase 2 of cloudworkstationS plan)
-- Single source of truth — loaded via execSchemaFile(db, 'workspace-schema')
-- from VirtualPidRegistry, WorkspaceServiceManager, and WorkspacePreviewRegistry.
--
-- Tables:
--   workspace_processes  — Virtual PID mappings (provider-agnostic process table)
--   workspace_services   — Long-running daemon services (npm run dev, flask, etc.)
--   workspace_ports      — Detected ports with preview URLs
--   workspace_env        — Workspace-scoped environment variables
-- ============================================================================

-- ============================================================================
-- workspace_processes
-- Maps virtual PIDs to provider-specific real PIDs so that ps/kill work
-- transparently across sandbox providers (E2B, Modal, Daytona, etc.).
-- Mirrors the PidMapping interface from virtual-pid-registry.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspace_processes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id  TEXT    NOT NULL,
    vpid          INTEGER NOT NULL,
    real_pid      INTEGER NOT NULL,
    provider      TEXT    NOT NULL,
    sandbox_id    TEXT    NOT NULL DEFAULT '',
    command       TEXT    NOT NULL,
    user          TEXT,
    registered_at   INTEGER NOT NULL,
    last_confirmed_at INTEGER NOT NULL,
    is_service    INTEGER NOT NULL DEFAULT 0,
    service_id    TEXT,

    -- One vPID per workspace (monotonically increasing)
    UNIQUE(workspace_id, vpid)
);

CREATE INDEX IF NOT EXISTS idx_ws_proc_workspace
    ON workspace_processes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ws_proc_reverse
    ON workspace_processes(provider, real_pid);
CREATE INDEX IF NOT EXISTS idx_ws_proc_service
    ON workspace_processes(service_id) WHERE service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ws_proc_stale
    ON workspace_processes(workspace_id, last_confirmed_at);

-- ============================================================================
-- workspace_services
-- Turns long-running terminal processes (npm run dev, uvicorn, flask, etc.)
-- into first-class workspace services that survive PTY death and reconnects.
-- Mirrors the WorkspaceService interface from workspace-service-manager.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspace_services (
    id              TEXT    PRIMARY KEY,
    workspace_id    TEXT    NOT NULL,
    user_id         TEXT    NOT NULL,
    name            TEXT    NOT NULL,
    command         TEXT    NOT NULL,
    working_dir     TEXT    NOT NULL DEFAULT '/workspace',
    status          TEXT    NOT NULL DEFAULT 'starting'
                            CHECK(status IN ('starting','running','stopped','crashed','migrating')),
    pid             INTEGER,
    provider        TEXT,
    exit_code       INTEGER,
    auto_restart    INTEGER NOT NULL DEFAULT 0,
    env             TEXT,   -- JSON object of environment variables
    sandbox_provider TEXT,
    sandbox_id      TEXT,
    started_at      INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    logs            TEXT    DEFAULT '[]'  -- JSON array of log lines (rolling, max 500)
);

CREATE INDEX IF NOT EXISTS idx_ws_svc_workspace
    ON workspace_services(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ws_svc_status
    ON workspace_services(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_ws_svc_name
    ON workspace_services(workspace_id, name);

-- ============================================================================
-- workspace_ports
-- Bridges port detection to provider-specific preview URL generation.
-- Registers detected ports as workspace previews that AI agents can inspect.
-- Mirrors the WorkspacePreview interface from workspace-preview-registry.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspace_ports (
    id              TEXT    PRIMARY KEY,
    workspace_id    TEXT    NOT NULL,
    service_id      TEXT    NOT NULL,
    service_name    TEXT    NOT NULL,
    port            INTEGER NOT NULL,
    protocol        TEXT    NOT NULL DEFAULT 'http'
                            CHECK(protocol IN ('http','https','tcp')),
    url             TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'starting'
                            CHECK(status IN ('active','starting','unreachable','stale','stopped')),
    provider        TEXT,
    sandbox_id      TEXT,
    confidence      TEXT    NOT NULL DEFAULT 'low'
                            CHECK(confidence IN ('high','medium','low')),
    framework       TEXT,
    registered_at     INTEGER NOT NULL,
    last_reachable_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ws_port_workspace
    ON workspace_ports(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ws_port_service
    ON workspace_ports(workspace_id, service_id);
CREATE INDEX IF NOT EXISTS idx_ws_port_port
    ON workspace_ports(workspace_id, port);

-- ============================================================================
-- workspace_env
-- Persists workspace-scoped environment variables so they survive shell
-- reconnects and can be rehydrated into new PTY sessions.
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspace_env (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id  TEXT    NOT NULL,
    key           TEXT    NOT NULL,
    value         TEXT    NOT NULL,
    is_secret     INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL,

    UNIQUE(workspace_id, key)
);

CREATE INDEX IF NOT EXISTS idx_ws_env_workspace
    ON workspace_env(workspace_id);

-- ============================================================================
-- workspace_jobs
-- Persists long-running background jobs (training, builds, crawlers, etc.)
-- so they survive process restarts and can be rehydrated into the
-- EnhancedBackgroundJobsManager on bootstrap.
-- Mirrors the EnhancedJob interface from enhanced-background-jobs.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspace_jobs (
    id              TEXT    PRIMARY KEY,
    workspace_id    TEXT    NOT NULL,
    user_id         TEXT    NOT NULL,
    session_id      TEXT,
    sandbox_id      TEXT    NOT NULL,
    command         TEXT    NOT NULL,
    args            TEXT,   -- JSON array of string arguments
    interval_sec    INTEGER NOT NULL,
    timeout_sec     INTEGER,
    description     TEXT,
    tags            TEXT,   -- JSON array of string tags
    quota_category  TEXT    NOT NULL DEFAULT 'compute'
                            CHECK(quota_category IN ('compute','io','api')),
    max_executions  INTEGER NOT NULL DEFAULT 1000,
    stop_condition  TEXT,
    status          TEXT    NOT NULL DEFAULT 'running'
                            CHECK(status IN ('running','paused','stopped','completed','failed')),
    created_at      INTEGER NOT NULL,
    last_executed_at INTEGER,
    last_error      TEXT,
    execution_count INTEGER NOT NULL DEFAULT 0,
    dedup_id        TEXT
);

CREATE INDEX IF NOT EXISTS idx_ws_job_workspace
    ON workspace_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ws_job_status
    ON workspace_jobs(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_ws_job_session
    ON workspace_jobs(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ws_job_dedup
    ON workspace_jobs(dedup_id) WHERE dedup_id IS NOT NULL;
