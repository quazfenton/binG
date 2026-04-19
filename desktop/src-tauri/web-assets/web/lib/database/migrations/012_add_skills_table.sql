-- Migration: Add skills table for DB-backed skill persistence
-- This complements the filesystem-based SkillsManager with queryable metadata

CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    version TEXT DEFAULT '1.0.0',
    system_prompt TEXT,
    tags TEXT, -- JSON array of tags
    workflows TEXT, -- JSON array of workflow definitions
    sub_capabilities TEXT, -- JSON array of sub-capability strings
    reinforcement TEXT, -- JSON object with execution stats and weights
    location TEXT, -- filesystem path relative to .agents/skills/
    enabled BOOLEAN DEFAULT TRUE,
    source TEXT DEFAULT 'manual', -- 'manual', 'auto-extracted', 'imported'
    extracted_from_event TEXT, -- event ID if auto-extracted
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_skills_user_id ON skills(user_id);
CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);
CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source);
CREATE INDEX IF NOT EXISTS idx_skills_created_at ON skills(created_at);

-- View for active skills with readable tag arrays
CREATE VIEW IF NOT EXISTS active_skills_view AS
SELECT
    id,
    user_id,
    name,
    description,
    version,
    source,
    enabled,
    created_at,
    updated_at
FROM skills
WHERE enabled = TRUE
ORDER BY created_at DESC;
