/**
 * Skill Store Service
 *
 * DB-backed persistence for skills, complementing the filesystem-based SkillsManager.
 * Provides queryable metadata, reinforcement tracking, and skill discovery.
 *
 * @module services/skill-store
 */

import { getDatabase } from '@/lib/database/connection';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Services:SkillStore');

export interface SkillRecord {
  id: string;
  userId: string;
  name: string;
  description?: string;
  version: string;
  systemPrompt?: string;
  tags: string[];
  workflows?: any[];
  subCapabilities?: string[];
  reinforcement?: {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    avgSuccessRate: number;
    weights: Record<string, number>;
  };
  location?: string;
  enabled: boolean;
  source: 'manual' | 'auto-extracted' | 'imported';
  extractedFromEvent?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillInput {
  userId: string;
  name: string;
  description?: string;
  version?: string;
  systemPrompt?: string;
  tags?: string[];
  workflows?: any[];
  subCapabilities?: string[];
  reinforcement?: Partial<SkillRecord['reinforcement']>;
  location?: string;
  source?: 'manual' | 'auto-extracted' | 'imported';
  extractedFromEvent?: string;
}

export interface UpdateSkillInput {
  description?: string;
  version?: string;
  systemPrompt?: string;
  tags?: string[];
  workflows?: any[];
  subCapabilities?: string[];
  reinforcement?: Partial<SkillRecord['reinforcement']>;
  enabled?: boolean;
}

export interface SkillQuery {
  userId?: string;
  enabled?: boolean;
  source?: string;
  tag?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Skill Store Service
 */
export class SkillStore {
  /**
   * Create a new skill in the database
   */
  async create(input: CreateSkillInput): Promise<SkillRecord> {
    const db = getDatabase();

    const id = `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO skills (
        id, user_id, name, description, version, system_prompt,
        tags, workflows, sub_capabilities, reinforcement,
        location, enabled, source, extracted_from_event,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.userId,
      input.name,
      input.description || null,
      input.version || '1.0.0',
      input.systemPrompt || null,
      JSON.stringify(input.tags || []),
      input.workflows ? JSON.stringify(input.workflows) : null,
      input.subCapabilities ? JSON.stringify(input.subCapabilities) : null,
      input.reinforcement ? JSON.stringify({
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        avgSuccessRate: 0,
        weights: {},
        ...input.reinforcement,
      }) : null,
      input.location || null,
      1,
      input.source || 'manual',
      input.extractedFromEvent || null,
      now,
      now,
    );

    logger.info('Skill created', { id, name: input.name, userId: input.userId, source: input.source });

    return this.getById(id)!;
  }

  /**
   * Get skill by ID
   */
  getById(id: string): SkillRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any;
    return row ? this.mapRowToSkill(row) : null;
  }

  /**
   * Get skill by user ID and name
   */
  getByUserIdAndName(userId: string, name: string): SkillRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM skills WHERE user_id = ? AND name = ?').get(userId, name) as any;
    return row ? this.mapRowToSkill(row) : null;
  }

  /**
   * Query skills with filters
   */
  query(query: SkillQuery): SkillRecord[] {
    const db = getDatabase();
    let sql = 'SELECT * FROM skills WHERE 1=1';
    const params: any[] = [];

    if (query.userId) {
      sql += ' AND user_id = ?';
      params.push(query.userId);
    }
    if (query.enabled !== undefined) {
      sql += ' AND enabled = ?';
      params.push(query.enabled ? 1 : 0);
    }
    if (query.source) {
      sql += ' AND source = ?';
      params.push(query.source);
    }
    if (query.tag) {
      sql += ' AND tags LIKE ?';
      params.push(`%${query.tag}%`);
    }
    if (query.search) {
      sql += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${query.search}%`, `%${query.search}%`);
    }

    sql += ' ORDER BY created_at DESC';

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }
    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.mapRowToSkill(row));
  }

  /**
   * Update a skill
   */
  async update(id: string, input: UpdateSkillInput): Promise<SkillRecord | null> {
    const db = getDatabase();
    const existing = this.getById(id);
    if (!existing) {
      logger.warn('Skill not found for update', { id });
      return null;
    }

    const now = new Date().toISOString();
    const setClauses: string[] = [];
    const params: any[] = [];

    if (input.description !== undefined) {
      setClauses.push('description = ?');
      params.push(input.description);
    }
    if (input.version !== undefined) {
      setClauses.push('version = ?');
      params.push(input.version);
    }
    if (input.systemPrompt !== undefined) {
      setClauses.push('system_prompt = ?');
      params.push(input.systemPrompt);
    }
    if (input.tags !== undefined) {
      setClauses.push('tags = ?');
      params.push(JSON.stringify(input.tags));
    }
    if (input.workflows !== undefined) {
      setClauses.push('workflows = ?');
      params.push(input.workflows ? JSON.stringify(input.workflows) : null);
    }
    if (input.subCapabilities !== undefined) {
      setClauses.push('sub_capabilities = ?');
      params.push(input.subCapabilities ? JSON.stringify(input.subCapabilities) : null);
    }
    if (input.reinforcement !== undefined) {
      const merged = { ...existing.reinforcement, ...input.reinforcement };
      setClauses.push('reinforcement = ?');
      params.push(JSON.stringify(merged));
    }
    if (input.enabled !== undefined) {
      setClauses.push('enabled = ?');
      params.push(input.enabled ? 1 : 0);
    }

    setClauses.push('updated_at = ?');
    params.push(now);

    params.push(id);
    db.prepare(`UPDATE skills SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    logger.info('Skill updated', { id });
    return this.getById(id);
  }

  /**
   * Delete a skill
   */
  async delete(id: string): Promise<boolean> {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    const deleted = (result as any).changes > 0;

    if (deleted) {
      logger.info('Skill deleted', { id });
    } else {
      logger.warn('Skill not found for deletion', { id });
    }

    return deleted;
  }

  /**
   * Record skill execution for reinforcement learning
   */
  async recordExecution(id: string, success: boolean): Promise<void> {
    const db = getDatabase();
    const skill = this.getById(id);
    if (!skill) {
      logger.warn('Skill not found for execution recording', { id });
      return;
    }

    const reinforcement = skill.reinforcement || {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      avgSuccessRate: 0,
      weights: {},
    };

    reinforcement.totalExecutions++;
    if (success) {
      reinforcement.successfulExecutions++;
    } else {
      reinforcement.failedExecutions++;
    }
    reinforcement.avgSuccessRate = reinforcement.totalExecutions > 0
      ? reinforcement.successfulExecutions / reinforcement.totalExecutions
      : 0;

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE skills SET reinforcement = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(reinforcement), now, id);
  }

  /**
   * Get top skills by success rate for a user
   */
  getTopSkills(userId: string, limit: number = 10): SkillRecord[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM skills
      WHERE user_id = ? AND enabled = 1 AND source = 'auto-extracted'
        AND reinforcement IS NOT NULL
        AND json_extract(reinforcement, '$.totalExecutions') >= 1
      ORDER BY json_extract(reinforcement, '$.avgSuccessRate') DESC
      LIMIT ?
    `).all(userId, limit) as any[];

    return rows.map(row => this.mapRowToSkill(row));
  }

  /**
   * Search skills by tag across all users
   */
  searchByTag(tag: string, limit: number = 20): SkillRecord[] {
    return this.query({ tag, enabled: true, limit });
  }

  /**
   * Count skills by source for a user
   */
  getStats(userId: string): {
    total: number;
    manual: number;
    autoExtracted: number;
    imported: number;
    enabled: number;
  } {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) as manual,
        SUM(CASE WHEN source = 'auto-extracted' THEN 1 ELSE 0 END) as autoExtracted,
        SUM(CASE WHEN source = 'imported' THEN 1 ELSE 0 END) as imported,
        SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled
      FROM skills WHERE user_id = ?
    `).get(userId) as any;

    return {
      total: row.total || 0,
      manual: row.manual || 0,
      autoExtracted: row.autoExtracted || 0,
      imported: row.imported || 0,
      enabled: row.enabled || 0,
    };
  }

  /**
   * Map database row to SkillRecord
   */
  private mapRowToSkill(row: any): SkillRecord {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      version: row.version || '1.0.0',
      systemPrompt: row.system_prompt,
      tags: this.safeJsonParse(row.tags, []),
      workflows: this.safeJsonParse(row.workflows),
      subCapabilities: this.safeJsonParse(row.sub_capabilities),
      reinforcement: this.safeJsonParse(row.reinforcement),
      location: row.location,
      enabled: Boolean(row.enabled),
      source: row.source || 'manual',
      extractedFromEvent: row.extracted_from_event,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private safeJsonParse(value: string | null, fallback?: any): any {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
}

// Singleton instance
export const skillStore = new SkillStore();
