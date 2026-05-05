/**
 * Unified PowerDefinition Schema
 *
 * Bridges the existing `CapabilityDefinition` (from capabilities.ts) and
 * `PowerManifest` (from powers/index.ts) into a single authoritative type.
 *
 * Key design decisions:
 * - `runtime` is a structured object (type + entrypoint) so the agent router
 *   can dispatch without caring whether the power is a "Capability" or "Power".
 * - `providerPriority` is carried over from CapabilityDefinition so the
 *   CapabilityRouter can still select the best provider.
 * - `source` uses a superset that includes 'core' (native capabilities) as
 *   well as 'local'/'user'/'marketplace' (user-installable powers).
 * - Zod schemas are exported for runtime validation of YAML frontmatter
 *   and API payloads.
 */

import { z } from 'zod';

// Re-use existing category types from capabilities.ts for compatibility
export type CapabilityCategory = 'file' | 'sandbox' | 'web' | 'repo' | 'memory' | 'automation' | 'desktop';
export type ToolLatency = 'low' | 'medium' | 'high';
export type ToolCost = 'low' | 'medium' | 'high';

// ============================================================================
// Zod Schemas (runtime validation)
// ============================================================================

/**
 * Schema for a single action within a power.
 * Mirrors the existing PowerAction but adds validation.
 */
export const PowerActionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  paramsSchema: z.record(z.any()).optional(),
  returns: z.record(z.any()).optional(),
  timeoutMs: z.number().positive().optional().default(30_000),
});

export type PowerAction = z.infer<typeof PowerActionSchema>;

/**
 * Runtime descriptor — how this power is actually executed.
 */
export const RuntimeDescriptorSchema = z.object({
  type: z.enum(['native', 'wasm', 'api', 'llm']),
  /** Path to binary, API route, or handler identifier */
  entrypoint: z.string().optional(),
  /** Provider ID(s) to try, in priority order. Maps to CapabilityRouter providers. */
  providerPriority: z.array(z.string()).optional(),
});

export type RuntimeDescriptor = z.infer<typeof RuntimeDescriptorSchema>;

/**
 * Permission descriptor for sandboxed powers.
 */
export const PowerPermissionsSchema = z.object({
  allowedHosts: z.array(z.string()).optional(),
  requiredScopes: z.array(z.string()).optional(),
  /** Filesystem paths this power may access (for WASM sandbox) */
  allowedPaths: z.array(z.string()).optional(),
});

export type PowerPermissions = z.infer<typeof PowerPermissionsSchema>;

/**
 * Tool metadata for intelligent routing (same as capabilities.ts ToolMetadata).
 */
export const PowerMetadataSchema = z.object({
  latency: z.enum(['low', 'medium', 'high']).optional(),
  cost: z.enum(['low', 'medium', 'high']).optional(),
  reliability: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).optional(),
});

export type PowerMetadata = z.infer<typeof PowerMetadataSchema>;

/**
 * Full PowerDefinition — the unified schema for all tools.
 */
export const PowerDefinitionSchema = z.object({
  /** Unique identifier (e.g., 'file.read', 'mem0-memory.add') */
  id: z.string().min(1),
  /** Human-readable name */
  name: z.string().min(1),
  /** Semver version */
  version: z.string().optional().default('1.0.0'),
  /** Detailed description */
  description: z.string().min(1),
  /** Category for grouping */
  category: z.enum(['file', 'sandbox', 'web', 'repo', 'memory', 'automation', 'desktop']).optional(),
  /** Source of the power */
  source: z.enum(['core', 'local', 'user', 'marketplace']),
  /** Runtime environment + routing info */
  runtime: RuntimeDescriptorSchema,
  /** Triggers for automatic invocation (keywords for LLM context) */
  triggers: z.array(z.string()).optional().default([]),
  /** Core actions/tools provided by this power */
  actions: z.array(PowerActionSchema).min(1),
  /** Permissions required for execution */
  permissions: PowerPermissionsSchema.optional(),
  /** Tags for discovery and filtering */
  tags: z.array(z.string()).optional().default([]),
  /** Tool metadata for intelligent routing */
  metadata: PowerMetadataSchema.optional(),
  /** Whether this power is enabled */
  enabled: z.boolean().optional().default(true),
  /** Raw markdown body (SKILL.md content after frontmatter).
   *  NOT stored in the ghost registry — only loaded on demand. */
  rawMarkdown: z.string().optional(),
  /** Timestamp when installed (user/marketplace powers) */
  installedAt: z.number().optional(),
  /** Whether this power has been verified (marketplace) */
  verified: z.boolean().optional(),
  /** Whether auth is required (carried over from CapabilityDefinition) */
  requiresAuth: z.boolean().optional().default(false),
  /** Auto-inject this power as a user message when its triggers match.
   *  Only for ubiquitous, always-beneficial powers (e.g. web search when a URL appears). */
  autoInject: z.boolean().optional().default(false),
  /** Capability IDs that this auto-inject power subsumes.
   *  Prevents duplicate registration in loadCapabilitiesAsPowers(). */
  coversCapabilityIds: z.array(z.string()).optional(),
});

export type PowerDefinition = z.infer<typeof PowerDefinitionSchema>;

// ============================================================================
// Adapter Functions
// ============================================================================

/**
 * Convert a CapabilityDefinition (from capabilities.ts) into a PowerDefinition.
 *
 * This allows existing capabilities to participate in the unified registry
 * without any code duplication. The original CapabilityDefinition remains
 * the source of truth for the CapabilityRouter; this function creates a
 * "shadow" PowerDefinition that the PowersRegistry can index.
 */
export function capabilityToPower(
  cap: import('./capabilities').CapabilityDefinition,
  options?: { enabled?: boolean }
): PowerDefinition {
  return {
    id: cap.id,
    name: cap.name,
    version: '1.0.0',
    description: cap.description,
    category: cap.category,
    source: 'core',
    runtime: {
      type: 'native',
      providerPriority: cap.providerPriority,
    },
    triggers: cap.tags,
    actions: [
      {
        name: cap.id,
        description: cap.description,
        timeoutMs: 30_000,
        // Note: the Zod inputSchema is not directly serialisable to JSON Schema
        // here; the CapabilityRouter validates input at execution time instead.
      },
    ],
    permissions: cap.permissions
      ? { requiredScopes: cap.permissions }
      : undefined,
    tags: cap.tags,
    metadata: cap.metadata,
    enabled: options?.enabled ?? true,
    requiresAuth: cap.requiresAuth,
  };
}

/**
 * Convert a PowerDefinition back into a shape compatible with the existing
 * PowerManifest (powers/index.ts) so the PowersRegistry can register it.
 *
 * This is a lossy conversion — PowerDefinition is the superset.
 */
export function powerToManifest(
  power: PowerDefinition
): import('@/lib/powers').PowerManifest {
  return {
    id: power.id,
    name: power.name,
    version: power.version ?? '1.0.0',
    description: power.description,
    triggers: power.triggers,
    actions: power.actions.map(a => ({
      name: a.name,
      description: a.description,
      paramsSchema: a.paramsSchema,
      returns: a.returns,
      timeoutMs: a.timeoutMs,
    })),
    permissions: power.permissions,
    source: power.source,
    enabled: power.enabled ?? true,
    rawMarkdown: power.rawMarkdown,
    installedAt: power.installedAt,
    verified: power.verified,
    autoInject: power.autoInject,
    coversCapabilityIds: power.coversCapabilityIds,
  };
}

/**
 * Validate raw YAML frontmatter against the PowerDefinition schema.
 * Returns the validated PowerDefinition or throws a ZodError.
 */
export function validatePowerDefinition(data: unknown): PowerDefinition {
  return PowerDefinitionSchema.parse(data);
}

/**
 * Safe validation — returns an object with `success` flag instead of throwing.
 */
export function safeValidatePowerDefinition(data: unknown):
  { success: true; data: PowerDefinition } | { success: false; errors: string[] } {
  const result = PowerDefinitionSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}
