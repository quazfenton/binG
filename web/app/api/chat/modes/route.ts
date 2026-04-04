/**
 * GET /api/chat/modes
 * - Returns available orchestration modes with metadata
 * - With ?current=1: returns current persisted mode for authenticated user
 *
 * POST /api/chat/modes
 * - Sets the orchestration mode for authenticated user (persists to DB)
 * - Emits MODE_CHANGE event to event store
 * - Accepts: { mode, sessionId?, source?, config? }
 * - Auth: Uses session_id cookie (internal auth) or JWT Bearer token
 *
 * DELETE /api/chat/modes
 * - Resets mode to default (task-router)
 * - Auth: Uses session_id cookie (internal auth) or JWT Bearer token
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import { createLogger } from '@/lib/utils/logger';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

interface ModeMetadata {
  id: string;
  name: string;
  description: string;
  status: 'stable' | 'experimental' | 'deprecated';
  features: string[];
  bestFor: string;
  active: boolean;
  providers: string[];
  executionType: 'v1' | 'v2' | 'both';  // v1=LLM API, v2=CLI agent, both=supports either
  v1Capabilities?: string[];            // What it does in V1 mode (API calls)
  v2Capabilities?: string[];            // What it does in V2 mode (CLI agents)
  configOptions?: Record<string, {
    type: 'select' | 'number' | 'text' | 'toggle';
    label: string;
    default: any;
    options?: string[];
    min?: number;
    max?: number;
    description?: string;
  }>;
}

const MODE_CATALOG: Record<string, Omit<ModeMetadata, 'active'>> = {
  'task-router': {
    id: 'task-router',
    name: 'Task Router (Default)',
    description: 'Routes tasks between OpenCode and Nullclaw based on task type',
    status: 'stable',
    features: [
      'Automatic task classification',
      'OpenCode for coding tasks',
      'Nullclaw for non-coding tasks',
      'Execution policy selection',
    ],
    bestFor: 'General purpose - coding + automation tasks',
    providers: ['opencode', 'nullclaw', 'cli'],
    executionType: 'both',
    v1Capabilities: ['Routes to V1 LLM providers for simple queries'],
    v2Capabilities: ['Routes to OpenCode CLI for coding', 'Routes to Nullclaw for automation', 'Advanced agent loops'],
    configOptions: {
      agent: {
        type: 'select',
        label: 'Preferred Agent',
        default: 'auto',
        options: ['auto', 'opencode', 'nullclaw', 'cli', 'advanced'],
        description: 'Force specific agent or auto-route',
      },
    },
  },
  'unified-agent': {
    id: 'unified-agent',
    name: 'Unified Agent Service',
    description: 'Intelligent fallback chain: StatefulAgent → V2 → V1 API',
    status: 'experimental',
    features: [
      'StatefulAgent for complex tasks',
      'Fallback: StatefulAgent → V2 Native → V2 Local → V1 API',
      'Mastra workflow integration',
      'Tool execution support',
    ],
    bestFor: 'Complex multi-step agentic workflows',
    providers: ['openai', 'anthropic', 'mistral'],
    executionType: 'both',
    v1Capabilities: ['Direct LLM API fallback', 'Simple task completion'],
    v2Capabilities: ['StatefulAgent with plan-act-verify', 'ToolExecutor with smartApply', 'Self-healing diff repair'],
  },
  'stateful-agent': {
    id: 'stateful-agent',
    name: 'Stateful Agent',
    description: 'Plan-Act-Verify with persistent session state and ToolExecutor',
    status: 'experimental',
    features: [
      'Plan-Act-Verify cycle',
      'ToolExecutor with smartApply cascade',
      'Session persistence',
      'Self-healing diff repair',
    ],
    bestFor: 'Direct agent execution with file editing capabilities',
    providers: ['sandbox', 'vfs'],
    executionType: 'both',
    v1Capabilities: ['LLM API calls for planning and verification', 'Direct tool execution via API'],
    v2Capabilities: ['CLI agent spawning for execution phase', 'ToolExecutor with smartApply', 'Self-healing diff repair via CLI tools'],
    configOptions: {
      maxSelfHealAttempts: {
        type: 'number',
        label: 'Max Self-Heal Attempts',
        default: 3,
        min: 1,
        max: 10,
        description: 'How many times to retry failed diffs',
      },
      enableReflection: {
        type: 'toggle',
        label: 'Enable Reflection',
        default: true,
        description: 'Post-execution quality review',
      },
    },
  },
  'agent-kernel': {
    id: 'agent-kernel',
    name: 'Agent Kernel',
    description: 'OS-like priority scheduler with agent lifecycle management',
    status: 'experimental',
    features: [
      'Priority-based scheduling (critical/high/normal/low)',
      'Agent lifecycle (spawn/suspend/resume/terminate)',
      'Resource quotas and time-slicing',
      'Self-healing with health monitoring',
    ],
    bestFor: 'Multi-agent workloads with priority-based dispatch',
    providers: ['internal'],
    executionType: 'both',
    v1Capabilities: ['Schedules V1 LLM API calls as work items', 'Concurrent API call management'],
    v2Capabilities: ['Spawns CLI agent processes', 'Manages agent pools (ephemeral/persistent/daemon/worker)', 'Delegates to Nullclaw/Research/DAG agents'],
    configOptions: {
      priority: {
        type: 'select',
        label: 'Task Priority',
        default: 'normal',
        options: ['critical', 'high', 'normal', 'low'],
        description: 'Scheduling priority for this task',
      },
      maxConcurrent: {
        type: 'number',
        label: 'Max Concurrent Agents',
        default: 8,
        min: 1,
        max: 16,
        description: 'Maximum simultaneous agents',
      },
    },
  },
  'agent-loop': {
    id: 'agent-loop',
    name: 'Agent Loop',
    description: 'ToolLoopAgent - iterative tool-loop execution with filesystem tools',
    status: 'experimental',
    features: [
      'ToolLoopAgent integration (Vercel AI SDK)',
      'Multi-provider LLM routing',
      'Filesystem tool execution (read/write/exec)',
      'Streaming support',
    ],
    bestFor: 'Iterative tasks requiring multiple tool calls and feedback loops',
    providers: ['openrouter', 'chutes', 'github', 'nvidia', 'together'],
    executionType: 'both',
    v1Capabilities: ['ToolLoopAgent with V1 API calls', 'Streaming token generation', 'Direct tool responses via API'],
    v2Capabilities: ['CLI agent spawning for filesystem tools', 'Execute bash commands via CLI', 'File operations via CLI tools'],
    configOptions: {
      maxIterations: {
        type: 'number',
        label: 'Max Iterations',
        default: 10,
        min: 1,
        max: 50,
        description: 'Maximum tool loop iterations',
      },
    },
  },
  'execution-graph': {
    id: 'execution-graph',
    name: 'Execution Graph',
    description: 'DAG dependency engine for parallel task execution with retry',
    status: 'experimental',
    features: [
      'Directed Acyclic Graph task dependencies',
      'Parallel execution of independent tasks',
      'Automatic retry on failure',
      'Real-time status tracking',
    ],
    bestFor: 'Tasks with explicit dependency graphs and parallel execution needs',
    providers: ['internal'],
    executionType: 'both',
    v1Capabilities: ['Plans tasks via LLM API calls', 'Tracks dependency graph progress'],
    v2Capabilities: ['Identifies parallel execution opportunities', 'Manages DAG of CLI agent executions', 'Auto-retry with max attempts'],
    configOptions: {
      maxRetries: {
        type: 'number',
        label: 'Max Retries',
        default: 3,
        min: 0,
        max: 5,
        description: 'Retry attempts per failed node',
      },
    },
  },
  'nullclaw': {
    id: 'nullclaw',
    name: 'Nullclaw',
    description: 'External server for messaging, browsing, and automation tasks',
    status: 'experimental',
    features: [
      'Discord/Telegram messaging',
      'Web browsing automation',
      'API call execution',
      'Task scheduling',
    ],
    bestFor: 'Non-coding tasks: messaging, browsing, automation',
    providers: ['nullclaw'],
    executionType: 'v2',
    v2Capabilities: ['Discord message sending', 'Telegram automation', 'Web browsing with Puppeteer', 'HTTP API calls', 'Scheduled tasks'],
    configOptions: {
      taskType: {
        type: 'select',
        label: 'Task Type',
        default: 'automate',
        options: ['message', 'browse', 'automate'],
        description: 'Type of Nullclaw task to execute',
      },
      model: {
        type: 'text',
        label: 'Model',
        default: '',
        description: 'Model to use (leave empty for server default)',
      },
    },
  },
  'opencode-sdk': {
    id: 'opencode-sdk',
    name: 'OpenCode SDK',
    description: 'Direct SDK connection to local OpenCode server (remote CLI agent)',
    status: 'experimental',
    features: [
      'Direct SDK to OpenCode server',
      'Session management',
      'File operations and git integration',
      'Multi-provider LLM support',
    ],
    bestFor: 'Local OpenCode server integration with full tool access',
    providers: ['openai', 'anthropic', 'google'],
    executionType: 'v2',
    v2Capabilities: ['Remote CLI agent execution', 'Session-based prompting via OpenCode server', 'File read/write/search', 'Git diff operations'],
    configOptions: {
      hostname: {
        type: 'text',
        label: 'Server Hostname',
        default: '127.0.0.1',
        description: 'OpenCode server address',
      },
      port: {
        type: 'number',
        label: 'Server Port',
        default: 4096,
        min: 1024,
        max: 65535,
        description: 'OpenCode server port',
      },
    },
  },
  'mastra-workflow': {
    id: 'mastra-workflow',
    name: 'Mastra Workflows',
    description: 'Workflow engine with planner/executor/critic pattern',
    status: 'experimental',
    features: [
      'Workflow-based execution',
      'Quality evaluations',
      'Memory system',
      'MCP integration',
    ],
    bestFor: 'Structured workflows with quality gates',
    providers: ['mastra'],
    executionType: 'both',
    v1Capabilities: ['Planner step via LLM API calls', 'Executor step via API tools', 'Critic step (reviews + code quality eval)'],
    v2Capabilities: ['CLI agent spawning for execution', 'Self-healing loop via CLI tools', 'MCP tool integration with CLI agents'],
    configOptions: {
      workflowId: {
        type: 'select',
        label: 'Workflow',
        default: 'code-agent',
        options: ['code-agent', 'research', 'parallel', 'data-analysis', 'hitl-code-review'],
        description: 'Which Mastra workflow to run',
      },
      selfHealing: {
        type: 'toggle',
        label: 'Self-Healing',
        default: true,
        description: 'Allow workflow to auto-fix errors',
      },
    },
  },
  'crewai': {
    id: 'crewai',
    name: 'CrewAI Agents',
    description: 'Role-based multi-agent collaboration',
    status: 'experimental',
    features: [
      'Role-based agents (Planner, Coder, Critic)',
      'Sequential/hierarchical processes',
      'Self-healing execution',
      'Knowledge base integration',
    ],
    bestFor: 'Complex tasks requiring multiple specialized agents',
    providers: ['crewai'],
    executionType: 'both',
    v1Capabilities: ['Role agents via LLM API calls', 'Sequential/hierarchical process via API', 'Knowledge base via API'],
    v2Capabilities: ['CLI agent spawning for roles', 'Delegation to CLI agents', 'Self-healing via CLI tools'],
    configOptions: {
      process: {
        type: 'select',
        label: 'Process Type',
        default: 'sequential',
        options: ['sequential', 'hierarchical', 'consensual'],
        description: 'How agents coordinate work',
      },
      memory: {
        type: 'toggle',
        label: 'Agent Memory',
        default: true,
        description: 'Share context between agents',
      },
    },
  },
  'v2-executor': {
    id: 'v2-executor',
    name: 'V2 Containerized',
    description: 'OpenCode containerized execution with sandbox isolation',
    status: 'stable',
    features: [
      'Containerized execution',
      'Sandbox isolation',
      'Direct file operations',
      'Bash command execution',
    ],
    bestFor: 'Isolated code execution with full sandbox',
    providers: ['opencode', 'daytona'],
    executionType: 'v2',
    v2Capabilities: ['Sandbox creation (Sprites/E2B/Daytona)', 'OpenCode CLI spawning', 'Nullclaw integration', 'Checkpoint/restore', 'Security hardening'],
    configOptions: {
      sandbox: {
        type: 'select',
        label: 'Sandbox Provider',
        default: 'auto',
        options: ['auto', 'sprites', 'e2b', 'daytona', 'codesandbox'],
        description: 'Which sandbox to use',
      },
      maxSteps: {
        type: 'number',
        label: 'Max Steps',
        default: 15,
        min: 5,
        max: 50,
        description: 'Maximum agent loop steps',
      },
    },
  },
  'agent-team': {
    id: 'agent-team',
    name: 'Agent Team',
    description: 'Multi-agent team orchestration with 5 collaboration strategies',
    status: 'experimental',
    features: [
      'Hierarchical delegation (manager → workers)',
      'Collaborative parallel work',
      'Consensus voting',
      'Relay assembly line',
      'Competitive solutions',
    ],
    bestFor: 'Complex tasks requiring multiple specialized agents working together',
    providers: ['claude-code', 'amp', 'codex', 'opencode'],
    executionType: 'v2',
    v2Capabilities: ['Multi-agent orchestration', 'Cross-CLI agent coordination', 'Strategy-based collaboration', 'Quality scoring and consensus'],
    configOptions: {
      strategy: {
        type: 'select',
        label: 'Collaboration Strategy',
        default: 'hierarchical',
        options: ['hierarchical', 'collaborative', 'consensus', 'relay', 'competitive'],
        description: 'How agents work together',
      },
      maxIterations: {
        type: 'number',
        label: 'Max Iterations',
        default: 3,
        min: 1,
        max: 10,
        description: 'Max rounds for consensus/competitive',
      },
      timeoutMs: {
        type: 'number',
        label: 'Timeout (ms)',
        default: 300000,
        min: 60000,
        max: 1800000,
        description: 'Max execution time',
      },
    },
  },
};

const VALID_MODES = [
  'task-router',
  'unified-agent',
  'stateful-agent',
  'agent-kernel',
  'agent-loop',
  'execution-graph',
  'nullclaw',
  'opencode-sdk',
  'mastra-workflow',
  'crewai',
  'v2-executor',
  'agent-team',
] as const;

const logger = createLogger('ModesEndpoint');

export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  // Support ?current=1 to get the user's current persisted mode
  if (url.searchParams.get('current') === '1') {
    // Resolve user identity from session_id cookie, JWT, or anonymous session
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.success ? authResult.userId : authResult.anonymousId;

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
        CREATE TABLE IF NOT EXISTS user_orchestration_mode (
          user_id TEXT PRIMARY KEY,
          mode TEXT NOT NULL,
          session_id TEXT,
          source TEXT DEFAULT 'api',
          config TEXT,
          previous_mode TEXT,
          changed_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_user_mode_changed ON user_orchestration_mode(changed_at DESC);
      `);

      const row = db.prepare(`
        SELECT mode, session_id, source, config, previous_mode, changed_at
        FROM user_orchestration_mode
        WHERE user_id = ?
      `).get(userId) as {
        mode: string;
        session_id: string | null;
        source: string;
        config: string | null;
        previous_mode: string | null;
        changed_at: number;
      } | undefined;

      if (!row) {
        return NextResponse.json({
          success: true,
          mode: 'task-router',
          isDefault: true,
          source: 'default',
        });
      }

      const catalogEntry = MODE_CATALOG[row.mode];

      return NextResponse.json({
        success: true,
        mode: row.mode,
        isDefault: row.mode === 'task-router',
        source: row.source,
        sessionId: row.session_id,
        config: row.config ? (() => { try { return JSON.parse(row.config); } catch { return null; } })() : null,
        previousMode: row.previous_mode,
        changedAt: row.changed_at,
        catalog: catalogEntry ? {
          name: catalogEntry.name,
          description: catalogEntry.description,
          executionType: catalogEntry.executionType,
        } : null,
      });
    } catch (error: any) {
      logger.error('Failed to get current mode', { error: error.message });
      return NextResponse.json(
        { success: false, error: error.message || 'Internal server error' },
        { status: 500 }
      );
    }
  }

  // Default: return all available modes
  const modes: ModeMetadata[] = VALID_MODES.map((id) => {
    const catalog = MODE_CATALOG[id];
    if (!catalog) return null;

    // Determine if mode is active/configured based on env vars
    let active = false;
    switch (id) {
      case 'task-router':
        active = true;
        break;
      case 'unified-agent':
        active = true;
        break;
      case 'stateful-agent':
        active = true;
        break;
      case 'agent-kernel':
        // Available when kernel config is present
        active = true;
        break;
      case 'agent-loop':
        // Available when Mastra ToolLoopAgent is configured
        active = process.env.MASTRA_ENABLED === 'true' || !!process.env.DEFAULT_MODEL;
        break;
      case 'execution-graph':
        // Always available - pure dependency graph engine
        active = true;
        break;
      case 'nullclaw':
        active = !!process.env.NULLCLAW_URL;
        break;
      case 'opencode-sdk':
        active = !!process.env.OPENCODE_HOSTNAME || !!process.env.OPENCODE_PORT;
        break;
      case 'mastra-workflow':
        active = process.env.MASTRA_ENABLED === 'true';
        break;
      case 'crewai':
        active = process.env.CREWAI_ENABLED === 'true';
        break;
      case 'v2-executor':
        active =
          process.env.V2_AGENT_ENABLED === 'true' ||
          process.env.OPENCODE_CONTAINERIZED === 'true';
        break;
      case 'agent-team':
        active = true;
        break;
    }

    return { ...catalog, active };
  }).filter(Boolean) as ModeMetadata[];

  return NextResponse.json({
    success: true,
    modes,
    defaultMode: 'task-router',
  });
}

// ============================================================================
// POST /api/chat/modes - Set mode with persistence + event emission
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    // Resolve user identity from session_id cookie, JWT, or anonymous session
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.success ? authResult.userId : authResult.anonymousId;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unable to resolve user identity' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { mode, sessionId, source = 'ui', config } = body as {
      mode: string;
      sessionId?: string;
      source?: 'ui' | 'api' | 'header' | 'default';
      config?: Record<string, unknown>;
    };

    // Validate required fields
    if (!mode) {
      return NextResponse.json(
        { success: false, error: 'mode is required' },
        { status: 400 }
      );
    }

    // Validate mode is one of the known modes
    const catalogEntry = MODE_CATALOG[mode];
    if (!catalogEntry) {
      return NextResponse.json(
        { success: false, error: `Unknown mode: ${mode}`, availableModes: Object.keys(MODE_CATALOG) },
        { status: 400 }
      );
    }

    const db = getDatabase();
    const now = Date.now();

    // Ensure table exists (idempotent)
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_orchestration_mode (
        user_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        session_id TEXT,
        source TEXT DEFAULT 'api',
        config TEXT,
        previous_mode TEXT,
        changed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_mode_changed ON user_orchestration_mode(changed_at DESC);
    `);

    // Get previous mode
    let previousMode = 'task-router';
    try {
      const row = db.prepare('SELECT mode FROM user_orchestration_mode WHERE user_id = ?').get(userId);
      if (row?.mode) {
        previousMode = row.mode;
      }
    } catch {
      // Table might not have data yet
    }

    // Upsert current mode
    db.prepare(`
      INSERT INTO user_orchestration_mode (user_id, mode, session_id, source, config, previous_mode, changed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        mode = excluded.mode,
        session_id = excluded.session_id,
        source = excluded.source,
        config = excluded.config,
        previous_mode = excluded.previous_mode,
        changed_at = excluded.changed_at
    `).run(
      userId,
      mode,
      sessionId || null,
      source,
      config ? JSON.stringify(config) : null,
      previousMode,
      now
    );

    // Emit MODE_CHANGE event to event store
    try {
      const eventStoreDb = getDatabase();
      eventStoreDb.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          user_id TEXT NOT NULL,
          session_id TEXT,
          payload TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          created_at INTEGER NOT NULL,
          processed_at INTEGER,
          error TEXT,
          retry_count INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_events_type_status ON events(type, status);
        CREATE INDEX IF NOT EXISTS idx_events_user_created ON events(user_id, created_at DESC);
      `);

      const eventId = `evt_mode_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      eventStoreDb.prepare(`
        INSERT INTO events (id, type, user_id, session_id, payload, status, created_at)
        VALUES (?, 'MODE_CHANGE', ?, ?, ?, 'pending', ?)
      `).run(
        eventId,
        userId,
        sessionId || null,
        JSON.stringify({
          userId,
          sessionId,
          fromMode: previousMode,
          toMode: mode,
          source,
          config: config || null,
        }),
        now
      );

      logger.info('MODE_CHANGE event emitted', { userId, fromMode: previousMode, toMode: mode, source, eventId });
    } catch (eventError: any) {
      // Don't fail mode change if event emission fails
      logger.warn('Failed to emit MODE_CHANGE event (non-fatal)', { error: eventError.message });
    }

    logger.info('Mode changed', { userId, fromMode: previousMode, toMode: mode, source });

    return NextResponse.json({
      success: true,
      mode,
      previousMode,
      sessionId,
      source,
      changedAt: now,
      catalog: {
        name: catalogEntry.name,
        description: catalogEntry.description,
        executionType: catalogEntry.executionType,
        providers: catalogEntry.providers,
      },
    });
  } catch (error: any) {
    logger.error('Failed to set mode', { error: error.message, stack: error.stack });
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE /api/chat/modes - Reset mode to default
// ============================================================================
export async function DELETE(request: NextRequest) {
  try {
    // Resolve user identity from session_id cookie, JWT, or anonymous session
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.success ? authResult.userId : authResult.anonymousId;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unable to resolve user identity' },
        { status: 401 }
      );
    }

    const db = getDatabase();

    // Get current mode before reset
    let currentMode = 'task-router';
    try {
      const row = db.prepare('SELECT mode FROM user_orchestration_mode WHERE user_id = ?').get(userId);
      if (row?.mode) {
        currentMode = row.mode;
      }
    } catch {
      // No data
    }

    // Delete persisted mode (resets to default)
    db.prepare('DELETE FROM user_orchestration_mode WHERE user_id = ?').run(userId);

    // Emit MODE_CHANGE event
    try {
      const eventStoreDb = getDatabase();
      const eventId = `evt_mode_reset_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      eventStoreDb.prepare(`
        INSERT INTO events (id, type, user_id, session_id, payload, status, created_at)
        VALUES (?, 'MODE_CHANGE', ?, NULL, ?, 'pending', ?)
      `).run(
        eventId,
        userId,
        JSON.stringify({
          userId,
          fromMode: currentMode,
          toMode: 'task-router',
          source: 'api',
          config: null,
        }),
        Date.now()
      );
    } catch {
      // Non-fatal
    }

    logger.info('Mode reset to default', { userId, fromMode: currentMode });

    return NextResponse.json({
      success: true,
      mode: 'task-router',
      previousMode: currentMode,
      message: 'Mode reset to default (task-router)',
    });
  } catch (error: any) {
    logger.error('Failed to reset mode', { error: error.message });
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
