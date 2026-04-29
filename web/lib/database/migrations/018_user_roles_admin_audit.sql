-- Migration 018: Add user_roles and admin_audit_log tables
-- HIGH-6 fix: Move admin authorization from static ADMIN_USER_IDS env var to database.
-- Supports granular RBAC with role-based permissions and audit trail for admin actions.

-- User roles table: maps users to named roles with optional per-resource scope
CREATE TABLE IF NOT EXISTS user_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,           -- 'admin', 'billing', 'moderator', etc.
    resource TEXT,                -- Optional resource scope (NULL = global role)
    granted_by TEXT,              -- User ID who granted the role
    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,         -- Optional expiry for temporary roles
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, role, resource)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);
CREATE INDEX IF NOT EXISTS idx_user_roles_active ON user_roles(is_active);
CREATE INDEX IF NOT EXISTS idx_user_roles_expires ON user_roles(expires_at);

-- Admin audit log: tracks all admin actions for accountability
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id TEXT NOT NULL,       -- Admin who performed the action
    action TEXT NOT NULL,              -- e.g., 'role:grant', 'role:revoke', 'user:delete'
    target_user_id TEXT,              -- User affected by the action
    target_resource TEXT,             -- Resource affected (optional)
    details TEXT,                      -- JSON blob with action-specific details
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);
