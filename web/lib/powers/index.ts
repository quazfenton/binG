/**
 * Powers System — User-installable, WASM-sandboxed skill capabilities
 *
 * Powers are the "client-facing cousin" to capabilities:
 * - Less formal: no native provider registration required
 * - User-installable from marketplace or SKILL.md upload
 * - Sandboxed via WASM (host_read, host_write, host_fetch, host_poll)
 * - Exposed as Vercel AI tools via jsonSchemaToZod + capability bridge
 * - Reinforcement learning tracks success rates per power
 *
 * Architecture:
 *   SKILL.md (frontmatter + system prompt)
 *   → PowersRegistry (parse, validate, cache)
 *   → jsonSchemaToZod (action schema → zod)
 *   → CapabilityRouter ('powers.execute' capability)
 *   → WASM Runner (sandboxed execution)
 *   → Artifact persistence (VFS)
 *
 * @module powers
 */

import { z } from 'zod';
import { createLogger } from '@/lib/utils/logger';
import { getCapabilityRouter } from '@/lib/tools/router';

const log = createLogger('Powers');

// ============================================================================
// Types
// ============================================================================

export interface PowerAction {
  name: string;
  description: string;
  paramsSchema?: Record<string, any>;
  returns?: Record<string, any>;
  timeoutMs?: number;
}

export interface PowerManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  triggers?: string[];
  actions: PowerAction[];
  permissions?: { allowedHosts?: string[]; requiredScopes?: string[]; allowedPaths?: string[] };
  source: 'core' | 'local' | 'marketplace' | 'user';
  enabled: boolean;
  rawMarkdown?: string;
  installedAt?: number;
  verified?: boolean;
  /** Runtime type — populated when converting from PowerDefinition */
  runtime?: 'native' | 'wasm' | 'api' | 'llm';
  /** Provider priority list — populated when converting from PowerDefinition */
  providerPriority?: string[];
  /** Tags for discovery — populated when converting from PowerDefinition */
  tags?: string[];
  /** Tool metadata for intelligent routing */
  metadata?: { latency?: string; cost?: string; reliability?: number; tags?: string[] };
}

export interface PowerArtifact {
  path: string;
  content: string; // base64
  type?: string;
}

export interface PowerRunResult {
  ok: boolean;
  output?: string;
  artifacts?: PowerArtifact[];
  error?: string;
  logs?: Array<{ level: string; message: string; ts: number }>;
  durationMs: number;
}

// ============================================================================
// Source Priority Helper
// ============================================================================

/**
 * Priority ranking for power sources.
 * Higher number = higher priority (won't be overridden by lower).
 */
function sourcePriority(source: string): number {
  switch (source) {
    case 'core': return 3;
    case 'local': return 2;
    case 'marketplace': return 1;
    case 'user': return 1;
    default: return 0;
  }
}

// ============================================================================
// JSON Schema → Zod Converter
// ============================================================================

/**
 * Convert a JSON Schema fragment to a Zod schema.
 * Used to turn power action paramsSchema into Vercel AI tool parameters.
 */
export function jsonSchemaToZod(schema?: Record<string, any>): z.ZodTypeAny {
  if (!schema) return z.any();

  if (schema.type === 'object') {
    const props: Record<string, z.ZodTypeAny> = {};
    const required = new Set(schema.required || []);
    for (const [k, v] of Object.entries(schema.properties || {})) {
      const child = jsonSchemaToZod(v as any);
      props[k] = required.has(k) ? child : child.optional();
    }
    return z.object(props);
  }

  if (schema.type === 'array') {
    return z.array(jsonSchemaToZod(schema.items || {}));
  }

  if (schema.enum) {
    const values = schema.enum as string[];
    if (values.length === 0) return z.any();
    return z.enum(values as [string, ...string[]]);
  }

  switch (schema.type) {
    case 'string': return z.string();
    case 'integer': return z.number().int();
    case 'number': return z.number();
    case 'boolean': return z.boolean();
    default: return z.any();
  }
}

// ============================================================================
// Powers Registry
// ============================================================================

export class PowersRegistry {
  private powers = new Map<string, PowerManifest>();
  private wasmHandlers = new Map<string, string>(); // powerId → wasm path
  private skillsByTag = new Map<string, string[]>();
  private skillsByCapability = new Map<string, string[]>();

  /**
   * Register a power from a parsed SKILL.md manifest or PowerDefinition.
   *
   * Priority rules:
   *   - 'core' powers are never overridden by non-core powers
   *   - 'local' powers override 'marketplace' and 'user' powers
   *   - Same-source re-registration is allowed (idempotent update)
   *
   * Accepts both PowerManifest and PowerDefinition (converted via powerToManifest).
   */
  async register(manifest: PowerManifest): Promise<void> {
    const existing = this.powers.get(manifest.id);

    // Priority: core > local > marketplace/user
    if (existing) {
      const existingPriority = sourcePriority(existing.source);
      const incomingPriority = sourcePriority(manifest.source);
      if (existingPriority > incomingPriority) {
        log.debug(`Skipping ${manifest.id} — ${existing.source} version has higher priority than ${manifest.source}`);
        return;
      }
    }

    this.powers.set(manifest.id, manifest);

    // Index by tags
    for (const tag of manifest.triggers || []) {
      const skills = this.skillsByTag.get(tag.toLowerCase()) || [];
      if (!skills.includes(manifest.id)) {
        skills.push(manifest.id);
        this.skillsByTag.set(tag.toLowerCase(), skills);
      }
    }

    // Index by action capabilities
    for (const action of manifest.actions) {
      const skills = this.skillsByCapability.get(action.name.toLowerCase()) || [];
      if (!skills.includes(manifest.id)) {
        skills.push(manifest.id);
        this.skillsByCapability.set(action.name.toLowerCase(), skills);
      }
    }

    // Register as a tool in the unified ToolRegistry
    const { ToolRegistry } = await import('@/lib/tools/registry');
    const toolRegistry = ToolRegistry.getInstance();
    for (const action of manifest.actions) {
      await toolRegistry.registerTool({
        name: `power_${manifest.id}_${action.name}`,
        capability: `powers.${action.name}`,
        provider: 'wasm-runner',
        handler: async (params: any, context: any) => {
          return executePower(manifest.id, action.name, params, context);
        },
        inputSchema: action.paramsSchema ? jsonSchemaToZod(action.paramsSchema) : z.object({}),
        metadata: {
          tags: manifest.triggers || [],
        },
      });
    }

    log.info('Power registered', { id: manifest.id, actions: manifest.actions.length, source: manifest.source });
  }

  /**
   * Register a PowerDefinition directly (converts to PowerManifest internally).
   * This is the preferred entry point when working with the unified PowerDefinition schema.
   */
  async registerPowerDefinition(powerDef: import('@/lib/tools/types').PowerDefinition): Promise<void> {
    const { powerToManifest } = await import('@/lib/tools/types');
    const manifest = powerToManifest(powerDef);
    return this.register(manifest);
  }

  /**
   * Register a WASM handler path for a power
   */
  registerWasmHandler(powerId: string, wasmPath: string): void {
    this.wasmHandlers.set(powerId, wasmPath);
    log.info('WASM handler registered', { powerId, wasmPath });
  }

  /**
   * Unregister a power
   */
  remove(powerId: string): void {
    const power = this.powers.get(powerId);
    if (!power) return;

    // Remove from tag index
    for (const tag of power.triggers || []) {
      const skills = this.skillsByTag.get(tag.toLowerCase());
      if (skills) {
        const idx = skills.indexOf(powerId);
        if (idx > -1) skills.splice(idx, 1);
        if (skills.length === 0) this.skillsByTag.delete(tag.toLowerCase());
      }
    }

    // Remove from capability index
    for (const action of power.actions) {
      const skills = this.skillsByCapability.get(action.name.toLowerCase());
      if (skills) {
        const idx = skills.indexOf(powerId);
        if (idx > -1) skills.splice(idx, 1);
        if (skills.length === 0) this.skillsByCapability.delete(action.name.toLowerCase());
      }
    }

    this.powers.delete(powerId);
    this.wasmHandlers.delete(powerId);
  }

  /**
   * Clear all powers
   */
  clear(): void {
    this.powers.clear();
    this.wasmHandlers.clear();
    this.skillsByTag.clear();
    this.skillsByCapability.clear();
  }

  /**
   * Get a power by ID
   */
  getById(id: string): PowerManifest | undefined {
    return this.powers.get(id);
  }

  /**
   * Get the WASM handler path for a power
   */
  getWasmHandler(powerId: string): string | undefined {
    return this.wasmHandlers.get(powerId);
  }

  /**
   * Get all active powers
   */
  getActive(): PowerManifest[] {
    return [...this.powers.values()].filter(p => p.enabled);
  }

  /**
   * Match powers against a user message by triggers
   */
  matchByTriggers(userMessage: string): PowerManifest[] {
    const lower = userMessage.toLowerCase();
    return this.getActive().filter(power =>
      power.triggers?.some(t => lower.includes(t.toLowerCase()))
    );
  }

  /**
   * Get powers by tag
   */
  getByTag(tag: string): PowerManifest[] {
    const ids = this.skillsByTag.get(tag.toLowerCase()) || [];
    return ids.map(id => this.powers.get(id)).filter((p): p is PowerManifest => p !== undefined);
  }

  /**
   * Get powers by action name
   */
  getByAction(actionName: string): PowerManifest[] {
    const ids = this.skillsByCapability.get(actionName.toLowerCase()) || [];
    return ids.map(id => this.powers.get(id)).filter((p): p is PowerManifest => p !== undefined);
  }

  /**
   * Get summary for UI (ghost-registry friendly — no markdown body)
   */
  getSummary(): Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    actions: number;
    enabled: boolean;
    source: string;
    triggers: string[];
    runtime?: string;
    tags?: string[];
  }> {
    return this.getActive().map(p => ({
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      actions: p.actions.length,
      enabled: p.enabled,
      source: p.source,
      triggers: p.triggers || [],
      runtime: p.runtime,
      tags: p.tags,
    }));
  }

  /**
   * Get registry stats
   */
  getStats(): {
    total: number;
    enabled: number;
    bySource: Record<string, number>;
    tags: number;
    actions: number;
  } {
    const powers = [...this.powers.values()];
    const bySource: Record<string, number> = {};
    for (const p of powers) {
      bySource[p.source] = (bySource[p.source] || 0) + 1;
    }
    return {
      total: powers.length,
      enabled: powers.filter(p => p.enabled).length,
      bySource,
      tags: this.skillsByTag.size,
      actions: this.skillsByCapability.size,
    };
  }
}

// Singleton
export const powersRegistry = new PowersRegistry();

// ============================================================================
// Power as Capability Bridge
//
// Powers are exposed through the capability system via 'powers.execute'
// This routes power execution through the CapabilityRouter so it benefits
// from the same provider selection, fallback, and permission infrastructure.
// ============================================================================

/**
 * Execute a power action through the capability system.
 *
 * @param powerId - The power to execute
 * @param actionName - The action within that power
 * @param params - Action parameters
 * @param context - Execution context (userId, conversationId, etc.)
 */
export async function executePower(
  powerId: string,
  actionName: string,
  params: Record<string, any>,
  context: { userId?: string; conversationId?: string; sessionId?: string } = {}
): Promise<PowerRunResult> {
  const power = powersRegistry.getById(powerId);
  if (!power) {
    return { ok: false, error: `power_not_found:${powerId}`, durationMs: 0 };
  }

  const action = power.actions.find(a => a.name === actionName);
  if (!action) {
    return { ok: false, error: `action_not_found:${actionName}`, durationMs: 0 };
  }

  log.info('Executing power', { powerId, actionName, userId: context.userId });

  // Try WASM runner if handler is registered
  const wasmPath = powersRegistry.getWasmHandler(powerId);
  if (wasmPath) {
    try {
      const { globalRunner } = await import('./wasm/runner');
      const result = await globalRunner.call(wasmPath, {
        action: actionName,
        params,
        ctx: {
          userId: context.userId || 'anon',
          conversationId: context.conversationId || 'anon',
          traceId: crypto.randomUUID().slice(0, 8),
        },
      }, {
        timeoutMs: action.timeoutMs ?? 30_000,
        allowedHosts: power.permissions?.allowedHosts ?? [],
        maxMemoryPages: 128, // 8 MB
      });

      return {
        ok: result.ok,
        output: result.output,
        artifacts: result.artifacts as PowerArtifact[] | undefined,
        error: result.error,
        logs: result.logs,
        durationMs: result.durationMs,
      };
    } catch (err: any) {
      log.error('WASM power execution failed', { powerId, actionName, error: err.message });
      return {
        ok: false,
        error: `wasm_execution_error:${err.message}`,
        durationMs: 0,
      };
    }
  }

  // Fallback: return the SKILL.md content so the LLM can self-execute
  // using the system prompt instructions
  log.info('No WASM handler — returning SKILL.md for LLM self-execution', { powerId });
  return {
    ok: true,
    output: power.rawMarkdown || `Power ${powerId} — ${action.description}`,
    durationMs: 0,
  };
}

/**
 * Build Vercel AI tools from all registered powers.
 * Each action becomes a typed tool via jsonSchemaToZod.
 */
export async function buildPowerTools(context: { userId?: string; conversationId?: string; sessionId?: string }): Promise<Record<string, any>> {
  const tools: Record<string, any> = {};
  const { tool } = await import('ai');

  for (const power of powersRegistry.getActive()) {
    for (const action of power.actions) {
      const toolName = `power_${power.id}_${action.name}`;
      const paramsZod = action.paramsSchema
        ? jsonSchemaToZod(action.paramsSchema)
        : z.object({}).optional();

      tools[toolName] = tool({
        description: `${power.name} > ${action.name} - ${action.description}`,
        parameters: paramsZod,
        execute: async (args: any) => {
          return executePower(power.id, action.name, args || {}, context);
        },
      } as any);
    }
  }

  // Utility tools
  tools['power_list'] = tool({
    description: 'List all installed powers',
    parameters: z.object({}).optional(),
    execute: async () => ({ powers: powersRegistry.getSummary() }),
  } as any);

  tools['power_read'] = tool({
    description: 'Read SKILL.md for a given power id',
    parameters: z.object({ powerId: z.string() }),
    execute: async ({ powerId }: { powerId: string }) => {
      const p = powersRegistry.getById(powerId);
      return p ? { content: p.rawMarkdown, id: p.id, name: p.name } : { error: 'not found' };
    },
  } as any);

  return tools;
}

/**
 * Build a system prompt block listing active powers for the LLM.
 * This is injected into the agent's system prompt alongside the
 * standard TOOL_CAPABILITIES block from system-prompts.ts.
 */
export function buildPowersSystemPrompt(
  basePrompt: string,
  userMessage?: string
): string {
  const activePowers = powersRegistry.getActive();
  if (activePowers.length === 0) return basePrompt;

  // Match powers to user message
  const matchedPowers = userMessage
    ? powersRegistry.matchByTriggers(userMessage)
    : [];

  const sections: string[] = [basePrompt];

  sections.push(`
============================================
# AVAILABLE POWERS (User-Installed Skills)
============================================

You have access to the following user-installed powers.
These are specialized skills that provide additional capabilities.

${activePowers.map(power => {
    const isActive = matchedPowers.some(m => m.id === power.id);
    const status = isActive ? '⚡ ACTIVE (matches current task)' : '📦 AVAILABLE';
    return `## Power: ${power.name} ${status}
**ID**: ${power.id}
**Version**: ${power.version}
**Description**: ${power.description}
**Actions**: ${power.actions.map(a => a.name).join(', ')}
**Triggers**: ${power.triggers?.join(', ') || 'none'}

${power.actions.map(a => `- **${a.name}**: ${a.description}`).join('\n')}
`;
  }).join('\n---\n')}

## Rules
1. Use powers when the task matches their description or triggers
2. Prefer built-in capabilities over powers when both apply
3. Powers marked ⚡ ACTIVE are most relevant to the current task
4. Each power action is a tool call with typed parameters
5. Power execution is sandboxed (WASM) with restricted permissions
`);

  return sections.join('\n');
}

// Re-exports from mem0-power
export { mem0PowerManifest, buildMem0Tools, buildMem0SystemPrompt, getMem0Client, isMem0Configured, mem0Search } from './mem0-power';
