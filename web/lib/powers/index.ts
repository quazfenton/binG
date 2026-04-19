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
  /**
   * Auto-inject this power as a user message when its triggers match.
   * Only set for ubiquitous, always-beneficial powers (e.g. URL scraping when a link appears).
   * Most powers should NOT auto-inject — they're discovered on-demand via power_list/power_read.
   */
  autoInject?: boolean;
  /** Capability IDs that this auto-inject power subsumes.
   *  Prevents duplicate registration in loadCapabilitiesAsPowers().
   *  Only relevant when autoInject is true. */
  coversCapabilityIds?: string[];
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

    // NOTE: We do NOT eagerly register every power action into the unified
    // ToolRegistry here. Action-tools are registered lazily by
    // buildPowerTools() only for trigger-matched powers, keeping the LLM's
    // tool list small. The power_read tool provides on-demand access to
    // any power's full content.
    //
    // However, we register a single generic `power_execute` catch-all tool
    // so the legacy TOOL_REGISTRY dispatch path (used by
    // executeModelToolCallsFromResponse) can still route power calls.
    await this.ensurePowerExecuteRegistered();

    log.info('Power registered', { id: manifest.id, actions: manifest.actions.length, source: manifest.source });
  }

  /**
   * Ensure the generic `power_execute` catch-all tool is registered in the
   * ToolRegistry. This enables the legacy TOOL_REGISTRY dispatch path
   * (used by executeModelToolCallsFromResponse) to route any power call
   * without needing each action registered individually.
   */
  private powerExecuteRegistered = false;
  private async ensurePowerExecuteRegistered(): Promise<void> {
    if (this.powerExecuteRegistered) return;
    this.powerExecuteRegistered = true;

    try {
      const { ToolRegistry } = await import('@/lib/tools/registry');
      const toolRegistry = ToolRegistry.getInstance();
      await toolRegistry.registerTool({
        name: 'power_execute',
        capability: 'powers.execute',
        provider: 'wasm-runner',
        handler: async (params: any, context: any) => {
          const { powerId, action, args } = params || {};
          if (!powerId || !action) {
            return { ok: false, error: 'powerId and action are required' };
          }
          return executePower(powerId, action, args || {}, context);
        },
        inputSchema: z.object({
          powerId: z.string().describe('The power to execute'),
          action: z.string().describe('The action within that power'),
          args: z.record(z.unknown()).optional().describe('Action parameters'),
        }),
        metadata: {
          tags: ['power', 'catch-all'],
        },
      });
    } catch {
      // Non-fatal — if ToolRegistry isn't available, the Vercel AI path still works
    }
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
    this.powerExecuteRegistered = false;
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
   * Get powers that should be auto-injected as user messages.
   * These are ubiquitous, always-beneficial powers (e.g. URL scraping) that
   * are auto-guaranteed to be useful when their triggers match.
   *
   * Unlike general powers (discovered on-demand via power_list/power_read),
   * auto-inject powers are proactively surfaced to preserve prompt caching
   * (injected as USER messages, not system prompt).
   */
  getAutoInjectPowers(userMessage: string): PowerManifest[] {
    const lower = userMessage.toLowerCase();
    return this.getActive().filter(power =>
      power.autoInject && power.triggers?.some(t => lower.includes(t.toLowerCase()))
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
 * Build Vercel AI tools from registered powers.
 *
 * STRATEGY: Only register action-tools for trigger-matched powers to avoid
 * bloating the LLM's tool list with every action of every installed power.
 * All powers remain discoverable via the `power_list` utility tool, and their
 * full content is available on-demand via `power_read`.
 *
 * When no userMessage is provided (e.g. initial prompt construction), only
 * utility tools are registered — action-tools are added lazily on subsequent
 * turns when the user message matches a power's triggers.
 *
 * @param context - Execution context (userId, conversationId, etc.)
 * @param userMessage - Optional current user message for trigger matching
 */
export async function buildPowerTools(
  context: { userId?: string; conversationId?: string; sessionId?: string },
  userMessage?: string,
): Promise<Record<string, any>> {
  const tools: Record<string, any> = {};
  const { tool } = await import('ai');

  // Only register action-tools for trigger-matched powers to keep the tool
  // list small. The LLM can discover all powers via power_list and read
  // full content via power_read — no need to preload every action.
  const matchedPowers = userMessage
    ? powersRegistry.matchByTriggers(userMessage)
    : [];

  for (const power of matchedPowers) {
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

  // Utility tools — always available
  tools['power_list'] = tool({
    description: 'List all installed powers (id, name, description, triggers)',
    parameters: z.object({}).optional(),
    execute: async () => ({ powers: powersRegistry.getSummary() }),
  } as any);

  tools['power_read'] = tool({
    description: 'Read the full SKILL.md content for a given power id. Use this to get detailed instructions, actions, and parameters before calling a power action.',
    parameters: z.object({ powerId: z.string() }),
    execute: async ({ powerId }: { powerId: string }) => {
      const p = powersRegistry.getById(powerId);
      return p ? { content: p.rawMarkdown, id: p.id, name: p.name } : { error: 'not found' };
    },
  } as any);

  tools['power_execute'] = tool({
    description: 'Execute any power action by powerId and action name. Use this to invoke powers that were not trigger-matched (discovered via power_read). For trigger-matched powers, prefer the dedicated power_<id>_<action> tools.',
    parameters: z.object({
      powerId: z.string().describe('The power to execute'),
      action: z.string().describe('The action within that power'),
      args: z.record(z.unknown()).optional().describe('Action parameters'),
    }),
    execute: async ({ powerId, action, args }: { powerId: string; action: string; args?: Record<string, unknown> }) => {
      return executePower(powerId, action, args || {}, context);
    },
  } as any);

  return tools;
}

/**
 * Build a USER message injecting auto-inject powers that match the user message.
 *
 * DESIGN: Powers are NOT injected into the system prompt — they're injected as
 * USER messages to preserve prompt caching. Only powers with `autoInject: true`
 * are proactively injected (e.g. URL scraping when a link appears). All other
 * powers are discovered on-demand via power_list/power_read tools.
 *
 * To enable auto-inject for a power, set `autoInject: true` in its manifest:
 * ```ts
 * const urlScraperPower: PowerManifest = {
 *   id: 'url-scraper',
 *   name: 'URL Scraper',
 *   // ... other fields ...
 *   triggers: ['http://', 'https://', 'www.'],
 *   autoInject: true,  // ← auto-inject when triggers match
 * };
 * ```
 *
 * @param userMessage - The current user message, used for trigger matching
 * @returns A user message string for auto-inject powers, or empty string if none match
 */
export function buildAutoInjectUserMessage(userMessage: string): string {
  const autoInjectPowers = powersRegistry.getAutoInjectPowers(userMessage);
  if (autoInjectPowers.length === 0) return '';

  const sections = autoInjectPowers.map(power => {
    const actionsList = power.actions.map(a => `  - **${a.name}**: ${a.description}`).join('\n');
    return `### ⚡ ${power.name} (id: ${power.id})
**Description**: ${power.description}
**Actions**:
${actionsList}
**Trigger matched** — this power is auto-loaded because it's always beneficial when its triggers match.`;
  });

  return `[Auto-loaded power(s) — these are always available when their triggers match]

${sections.join('\n\n')}

You can use the dedicated power tools (power_<id>_<action>) or power_execute to invoke these.`;
}

/**
 * Shared helper to auto-inject core powers into a messages array.
 *
 * Appends auto-inject content as a separate USER message (does NOT mutate
 * existing messages). LLM APIs support consecutive user messages — only
 * synthetic *assistant* turns break ordering.
 *
 * Use this in all LLM call paths to keep the logic consistent.
 *
 * @param messages - The message array to modify
 * @param userMessage - The current user message text, used for trigger matching
 * @returns The modified messages array (same reference, possibly with new message appended)
 */
export function appendAutoInjectPowers(
  messages: Array<{ role: string; content: string | unknown[] }>,
  userMessage: string
): Array<{ role: string; content: string | unknown[] }> {
  // Dedup guard: if auto-inject was already applied, skip
  const alreadyInjected = messages.some(m =>
    typeof m.content === 'string' && m.content.startsWith('[Auto-loaded power(s)')
  );
  if (alreadyInjected) return messages;

  const autoInjectMsg = buildAutoInjectUserMessage(userMessage);
  if (autoInjectMsg) {
    messages.push({ role: 'user', content: autoInjectMsg });
  }
  return messages;
}

// Re-exports from mem0-power
export { mem0PowerManifest, buildMem0Tools, buildMem0SystemPrompt, getMem0Client, isMem0Configured, mem0Search } from './mem0-power';

// Re-exports from web-search-power
export { webSearchPowerManifest } from './web-search-power';
