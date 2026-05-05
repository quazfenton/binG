/**
 * Spec Enhancement Mode API
 * 
 * GET /api/chat/spec-mode
 * - Returns available spec enhancement modes with metadata
 * - With ?current=1: returns current persisted mode for authenticated user
 *
 * POST /api/chat/spec-mode
 * - Sets the spec enhancement mode for authenticated user (persists to DB)
 * - Accepts: { mode, chain?, source? }
 * - Auth: Uses session_id cookie (internal auth) or JWT Bearer token
 *
 * DELETE /api/chat/spec-mode
 * - Resets mode to default (max)
 * - Auth: Uses session_id cookie (internal auth) or JWT Bearer token
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { getDatabase } from '@/lib/database/connection';
import { createLogger } from '@/lib/utils/logger';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

interface SpecModeMetadata {
  id: string;
  name: string;
  description: string;
  status: 'stable' | 'experimental';
  rounds: number;
  features: string[];
  bestFor: string;
}

const SPEC_MODE_CATALOG: Record<string, Omit<SpecModeMetadata, 'id'>> = {
  'normal': {
    name: 'Normal (No Enhancement)',
    description: 'Direct implementation without spec amplification. Uses the user\'s prompt as-is.',
    status: 'stable',
    rounds: 0,
    features: [
      'No spec amplification',
      'Direct implementation',
      'Fast response time',
    ],
    bestFor: 'Simple edits, quick fixes, and straightforward coding tasks',
  },
  'enhanced': {
    name: 'Enhanced (DAG)',
    description: 'DAG-based spec refinement using the original spec amplification system.',
    status: 'stable',
    rounds: 5,
    features: [
      'DAG-based task refinement',
      'Task explosion and merging',
      'Quality filtering',
    ],
    bestFor: 'Moderate complexity tasks requiring structured refinement',
  },
  'max': {
    name: 'Maximalist',
    description: 'Comprehensive multi-round enhancement with meta-prompts. 10 rounds with mid-point plan regeneration.',
    status: 'stable',
    rounds: 10,
    features: [
      'Multi-round enhancement (10 rounds)',
      'Meta-prompt injection at each round',
      'Mid-point plan regeneration',
      'Context weighting with exponential decay',
      '11 specialized chains (frontend, backend, ML/AI, etc.)',
    ],
    bestFor: 'Large feature additions, comprehensive implementations, full-stack applications',
  },
  'super': {
    name: 'Super Mode',
    description: 'Hyper-detailed multi-chain build process combining 10 specialized chains into 100+ step sequential build.',
    status: 'experimental',
    rounds: 100,
    features: [
      'Sequential chain execution (frontend, backend, API, system, data, devops, security, ML/AI, mobile, web3)',
      'Planning phases at 1.5, 2.5, 3.5, 4.5, 5.5 for each chain',
      'Mid-point plan regeneration',
      'Execution budget limits (maxPhases, timeBudgetMs)',
      'Layered context: Plan + Meta-Prompt + Implementation',
    ],
    bestFor: 'Enterprise-level applications, complex multi-system builds, comprehensive full-stack implementations',
  },
};

const VALID_MODES = ['normal', 'enhanced', 'max', 'super'] as const;
const VALID_CHAINS = ['default', 'frontend', 'ml_ai', 'backend', 'mobile', 'security', 'devops', 'data', 'api', 'system', 'web3'] as const;

const logger = createLogger('SpecModeEndpoint');

export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  // Support ?current=1 to get the user's current persisted mode
  if (url.searchParams.get('current') === '1') {
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.success && authResult.userId 
      ? authResult.userId 
      : request.cookies.get('anon-session-id')?.value || undefined;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unable to resolve user identity' },
        { status: 401 }
      );
    }

    try {
      const db = getDatabase();

      // Ensure table exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_spec_mode (
          user_id TEXT PRIMARY KEY,
          mode TEXT NOT NULL DEFAULT 'max',
          chain TEXT,
          source TEXT DEFAULT 'api',
          previous_mode TEXT,
          changed_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_spec_mode_changed ON user_spec_mode(changed_at DESC);
      `);

      const row = db.prepare(`
        SELECT mode, chain, source, previous_mode, changed_at
        FROM user_spec_mode
        WHERE user_id = ?
      `).get(userId) as {
        mode: string;
        chain: string | null;
        source: string;
        previous_mode: string | null;
        changed_at: number;
      } | undefined;

      if (!row) {
        return NextResponse.json({
          success: true,
          mode: 'max',
          chain: null,
          isDefault: true,
          source: 'default',
        });
      }

      const catalogEntry = SPEC_MODE_CATALOG[row.mode];

      return NextResponse.json({
        success: true,
        mode: row.mode,
        chain: row.chain,
        isDefault: row.mode === 'max',
        source: row.source,
        previousMode: row.previous_mode,
        changedAt: row.changed_at,
        catalog: catalogEntry ? {
          name: catalogEntry.name,
          description: catalogEntry.description,
          rounds: catalogEntry.rounds,
        } : null,
      });
    } catch (error: any) {
      logger.error('Failed to get current spec mode', { error: error.message });
      return NextResponse.json(
        { success: false, error: error.message || 'Internal server error' },
        { status: 500 }
      );
    }
  }

  // Default: return all available modes
  const modes = VALID_MODES.map((id) => {
    const catalog = SPEC_MODE_CATALOG[id];
    if (!catalog) return null;

    return {
      id,
      ...catalog,
      active: true, // All spec modes are available
    };
  }).filter(Boolean) as SpecModeMetadata[];

  // Return chains for super mode
  const chains = VALID_CHAINS.map((chain) => ({
    id: chain,
    name: chain === 'default' ? 'Full-Stack (Default)' : 
          chain === 'ml_ai' ? 'ML & AI' : 
          chain.charAt(0).toUpperCase() + chain.slice(1).replace('_', ' '),
  }));

  return NextResponse.json({
    success: true,
    modes,
    chains,
    defaultMode: 'max',
  });
}

// ============================================================================
// POST /api/chat/spec-mode - Set spec enhancement mode
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.success && authResult.userId 
      ? authResult.userId 
      : request.cookies.get('anon-session-id')?.value || undefined;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unable to resolve user identity' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { mode, chain, source = 'ui' } = body as {
      mode: string;
      chain?: string;
      source?: 'ui' | 'api' | 'header' | 'default';
    };

    // Validate required fields
    if (!mode) {
      return NextResponse.json(
        { success: false, error: 'mode is required' },
        { status: 400 }
      );
    }

    // Validate mode
    if (!VALID_MODES.includes(mode as typeof VALID_MODES[number])) {
      return NextResponse.json(
        { success: false, error: `Unknown mode: ${mode}`, availableModes: VALID_MODES },
        { status: 400 }
      );
    }

    // Validate chain (only for super mode)
    if (chain && mode !== 'super') {
      return NextResponse.json(
        { success: false, error: 'chain is only applicable for super mode' },
        { status: 400 }
      );
    }

    if (chain && !VALID_CHAINS.includes(chain as typeof VALID_CHAINS[number])) {
      return NextResponse.json(
        { success: false, error: `Unknown chain: ${chain}`, availableChains: VALID_CHAINS },
        { status: 400 }
      );
    }

    const catalogEntry = SPEC_MODE_CATALOG[mode];
    const db = getDatabase();
    const now = Date.now();

    // Ensure table exists (idempotent)
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_spec_mode (
        user_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL DEFAULT 'max',
        chain TEXT,
        source TEXT DEFAULT 'api',
        previous_mode TEXT,
        changed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_spec_mode_changed ON user_spec_mode(changed_at DESC);
    `);

    // Get previous mode
    let previousMode = 'max';
    try {
      const row = db.prepare('SELECT mode FROM user_spec_mode WHERE user_id = ?').get(userId);
      if (row?.mode) {
        previousMode = row.mode;
      }
    } catch {
      // Table might not have data yet
    }

    // Upsert current mode
    db.prepare(`
      INSERT INTO user_spec_mode (user_id, mode, chain, source, previous_mode, changed_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        mode = excluded.mode,
        chain = excluded.chain,
        source = excluded.source,
        previous_mode = excluded.previous_mode,
        changed_at = excluded.changed_at
    `).run(
      userId,
      mode,
      chain || null,
      source,
      previousMode,
      now
    );

    logger.info('Spec mode changed', { userId, fromMode: previousMode, toMode: mode, chain, source });

    return NextResponse.json({
      success: true,
      mode,
      chain: chain || null,
      previousMode,
      source,
      changedAt: now,
      catalog: catalogEntry ? {
        name: catalogEntry.name,
        description: catalogEntry.description,
        rounds: catalogEntry.rounds,
      } : null,
    });
  } catch (error: any) {
    logger.error('Failed to set spec mode', { error: error.message, stack: error.stack });
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE /api/chat/spec-mode - Reset to default
// ============================================================================
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.success && authResult.userId 
      ? authResult.userId 
      : request.cookies.get('anon-session-id')?.value || undefined;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unable to resolve user identity' },
        { status: 401 }
      );
    }

    const db = getDatabase();

    // Get current mode before reset
    let currentMode = 'max';
    try {
      const row = db.prepare('SELECT mode FROM user_spec_mode WHERE user_id = ?').get(userId);
      if (row?.mode) {
        currentMode = row.mode;
      }
    } catch {
      // No data
    }

    // Delete persisted mode (resets to default)
    db.prepare('DELETE FROM user_spec_mode WHERE user_id = ?').run(userId);

    logger.info('Spec mode reset to default', { userId, fromMode: currentMode });

    return NextResponse.json({
      success: true,
      mode: 'max',
      chain: null,
      previousMode: currentMode,
      message: 'Spec mode reset to default (max)',
    });
  } catch (error: any) {
    logger.error('Failed to reset spec mode', { error: error.message });
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}