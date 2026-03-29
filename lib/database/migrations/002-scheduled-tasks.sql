-- Scheduled tasks table for dynamic cron
-- Migration: 002-scheduled-tasks
-- Date: 2026-03-29

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  payload TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run DATETIME,
  next_run DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME,
  timezone TEXT DEFAULT 'UTC',
  catch_up BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_active ON scheduled_tasks(active);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_id ON scheduled_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_type ON scheduled_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_active ON scheduled_tasks(next_run, active);

-- Comments
COMMENT ON TABLE scheduled_tasks IS 'Dynamic cron jobs for scheduled task execution';
COMMENT ON COLUMN scheduled_tasks.id IS 'Unique task identifier (UUID)';
COMMENT ON COLUMN scheduled_tasks.user_id IS 'User who owns this task (Auth0 sub)';
COMMENT ON COLUMN scheduled_tasks.task_type IS 'Task type discriminator (e.g., HACKER_NEWS_DAILY)';
COMMENT ON COLUMN scheduled_tasks.cron_expression IS 'Cron expression for scheduling (e.g., 0 9 * * *)';
COMMENT ON COLUMN scheduled_tasks.payload IS 'JSON-encoded task parameters';
COMMENT ON COLUMN scheduled_tasks.active IS 'Whether task is currently active';
COMMENT ON COLUMN scheduled_tasks.last_run IS 'Last execution timestamp';
COMMENT ON COLUMN scheduled_tasks.next_run IS 'Next scheduled execution timestamp';
COMMENT ON COLUMN scheduled_tasks.timezone IS 'Timezone for cron evaluation (default: UTC)';
COMMENT ON COLUMN scheduled_tasks.catch_up IS 'Whether to run missed executions';
