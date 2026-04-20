/**
 * Core Capabilities Loader — YAML-First Power Loading
 *
 * Scans `web/lib/tools/base/` for SKILL.md files, parses their YAML
 * frontmatter, validates against the PowerDefinition Zod schema, and
 * registers them as core powers in the PowersRegistry.
 *
 * Ghost-Registry Pattern:
 *   Only metadata (id, name, description, triggers, actions summary) is
 *   kept in memory. The raw markdown body is stored in a separate map and
 *   only pulled into the agent's context buffer when:
 *     1. The user explicitly requests the skill (`/skill <id>`)
 *     2. The agent is about to call an action within that skill
 *
 * Initialization:
 *   Call `loadCoreCapabilities()` once during server bootstrap.
 *   It is safe to call multiple times (idempotent).
 */

import { createLogger } from '@/lib/utils/logger';
import {
  type PowerDefinition,
  safeValidatePowerDefinition,
  powerToManifest,
  RuntimeDescriptorSchema,
} from './types';

const log = createLogger('Tools:Loader');

// ============================================================================
// Configuration
// ============================================================================

/**
 * Directory where core capability SKILL.md files live.
 * Resolved relative to process.cwd() so it works in both dev and production.
 */
const CORE_CAPABILITIES_DIR_SEGMENTS = ['web', 'lib', 'tools', 'base'];

function resolveCoreCapabilitiesDir(): string {
  // Avoid importing `path` at the module level — some bundlers tree-shake
  // it aggressively. Use runtime require/inline instead.
  const path = require('path') as typeof import('path');
  return path.join(process.cwd(), ...CORE_CAPABILITIES_DIR_SEGMENTS);
}

// ============================================================================
// Ghost Registry — markdown bodies stored separately
// ============================================================================

/**
 * Stores the full markdown body for a power, keyed by power ID.
 * This data is NOT kept in the PowersRegistry's in-memory map;
 * it is only loaded on demand when the agent needs the procedural
 * instructions from a SKILL.md.
 */
const markdownBodies = new Map<string, string>();

/**
 * Retrieve the markdown body for a power (on-demand loading).
 * Returns undefined if the power has no markdown body or is not loaded.
 */
export function getPowerMarkdown(powerId: string): string | undefined {
  return markdownBodies.get(powerId);
}

/**
 * Clear all stored markdown bodies (useful for testing / hot-reload).
 */
export function clearMarkdownBodies(): void {
  markdownBodies.clear();
}

// ============================================================================
// YAML Frontmatter Parser
// ============================================================================

/**
 * Extract YAML frontmatter and body from a markdown file.
 * Returns { frontmatter: raw YAML string, body: remaining markdown }.
 */
function extractFrontmatter(content: string): { frontmatter: string; body: string } | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  return {
    frontmatter: match[1],
    body: content.slice(match[0].length).trim(),
  };
}

/**
 * Parse YAML frontmatter into a plain object.
 *
 * Uses a lightweight approach: first tries `js-yaml` (if available),
 * otherwise falls back to a simple line-by-line key: value parser that
 * handles strings, numbers, booleans, and simple arrays.
 */
async function parseYamlFrontmatter(raw: string): Promise<Record<string, any> | null> {
  // Try js-yaml first (proper YAML support)
  try {
    const yaml = await import('js-yaml');
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    // js-yaml not available or parse failed — fall through to simple parser
  }

  // Simple line-by-line fallback parser
  // Handles: key: value, key: "quoted", key: [a, b, c], nested objects (1 level)
  const result: Record<string, any> = {};
  let currentKey: string | null = null;
  let currentValue: string[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check if this is a new key: value line
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0 && !trimmed.startsWith(' ') && !trimmed.startsWith('-')) {
      // Flush previous key
      if (currentKey !== null) {
        result[currentKey] = parseSimpleValue(currentValue.join('\n'));
        currentValue = [];
      }

      currentKey = trimmed.slice(0, colonIdx).trim();
      const rest = trimmed.slice(colonIdx + 1).trim();
      if (rest) {
        currentValue.push(rest);
      }
    } else if (currentKey !== null) {
      // Continuation line
      currentValue.push(trimmed);
    }
  }

  // Flush last key
  if (currentKey !== null) {
    result[currentKey] = parseSimpleValue(currentValue.join('\n'));
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse a simple YAML value (string, number, boolean, or array).
 */
function parseSimpleValue(raw: string): any {
  const trimmed = raw.trim();

  // Boolean
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  // Quoted string
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  // Array (simple inline: [a, b, c])
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    return inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }

  // Multi-line array (YAML list with - items)
  if (trimmed.includes('\n-')) {
    return trimmed.split('\n')
      .filter(l => l.trim().startsWith('-'))
      .map(l => l.replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  // Plain string
  return trimmed;
}

/**
 * Normalize the parsed YAML frontmatter into a PowerDefinition-compatible
 * object. Handles the `runtime` field which can be a string or object.
 */
function normalizeFrontmatter(fm: Record<string, any>): Record<string, any> {
  const normalized = { ...fm };

  // Normalize runtime: string → { type: string }
  if (typeof normalized.runtime === 'string') {
    normalized.runtime = { type: normalized.runtime };
  }

  // Ensure actions is an array
  if (normalized.actions && !Array.isArray(normalized.actions)) {
    normalized.actions = [normalized.actions];
  }

  // Ensure triggers is an array
  if (normalized.triggers && !Array.isArray(normalized.triggers)) {
    normalized.triggers = [normalized.triggers];
  }

  // Ensure coversCapabilityIds is an array
  if (normalized.coversCapabilityIds && !Array.isArray(normalized.coversCapabilityIds)) {
    normalized.coversCapabilityIds = [normalized.coversCapabilityIds];
  }

  // Ensure tags is an array
  if (!normalized.tags) {
    normalized.tags = normalized.triggers || [];
  } else if (!Array.isArray(normalized.tags)) {
    normalized.tags = [normalized.tags];
  }

  // Set default source for core capabilities
  if (!normalized.source) {
    normalized.source = 'core';
  }

  return normalized;
}

// ============================================================================
// Core Loader
// ============================================================================

/** Track which power IDs have been loaded from SKILL.md (idempotency) */
const loadedPowerIds = new Set<string>();

/**
 * Load all core capabilities from SKILL.md files in the base directory.
 *
 * Idempotent: calling multiple times will not re-register powers that
 * have already been loaded (unless `forceReload` is true).
 */
export async function loadCoreCapabilities(options?: { forceReload?: boolean }): Promise<{
  loaded: number;
  skipped: number;
  errors: string[];
}> {
  const dir = resolveCoreCapabilitiesDir();
  const errors: string[] = [];
  let loaded = 0;
  let skipped = 0;

  log.info(`Loading core capabilities from: ${dir}`);

  // Dynamic import to avoid bundling fs in client code
  let fs: typeof import('fs');
  try {
    fs = await import('fs');
  } catch {
    log.warn('Filesystem module not available — skipping core capability loading');
    return { loaded: 0, skipped: 0, errors: ['fs module unavailable'] };
  }

  if (!fs.existsSync(dir)) {
    log.warn(`Core capabilities directory does not exist: ${dir}. Skipping load.`);
    return { loaded: 0, skipped: 0, errors: [] };
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const filePath = require('path').join(dir, file);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const extracted = extractFrontmatter(content);

      if (!extracted) {
        log.warn(`Skipping ${file}: no YAML frontmatter found`);
        skipped++;
        continue;
      }

      const rawFm = await parseYamlFrontmatter(extracted.frontmatter);
      if (!rawFm) {
        log.warn(`Skipping ${file}: failed to parse YAML frontmatter`);
        skipped++;
        continue;
      }

      const normalized = normalizeFrontmatter(rawFm);

      // Validate against PowerDefinition Zod schema
      const validation = safeValidatePowerDefinition(normalized);
      if (!validation.success) {
        const validationError = validation as { success: false; errors: string[] };
        log.warn(`Skipping ${file}: validation failed`, { errors: validationError.errors });
        errors.push(`${file}: ${validationError.errors.join('; ')}`);
        skipped++;
        continue;
      }

      const powerDef = validation.data;

      // Idempotency check
      if (!options?.forceReload && loadedPowerIds.has(powerDef.id)) {
        log.debug(`Skipping ${file}: ${powerDef.id} already loaded`);
        skipped++;
        continue;
      }

      // Ghost-registry pattern: store markdown body separately
      if (extracted.body) {
        markdownBodies.set(powerDef.id, extracted.body);
      }

      // Register in PowersRegistry via adapter
      try {
        const { powersRegistry } = await import('@/lib/powers');
        const manifest = powerToManifest(powerDef);

        // If force-reloading, remove the old version first
        if (options?.forceReload && powersRegistry.getById(powerDef.id)) {
          powersRegistry.remove(powerDef.id);
        }

        await powersRegistry.register(manifest);
        loadedPowerIds.add(powerDef.id);
        loaded++;

        log.info(`Core capability registered: ${powerDef.id} (runtime: ${powerDef.runtime.type}, actions: ${powerDef.actions.length})`);
      } catch (regError: any) {
        log.error(`Failed to register ${powerDef.id}`, { error: regError.message });
        errors.push(`${file}: registration failed — ${regError.message}`);
        skipped++;
      }
    } catch (error: any) {
      log.error(`Error processing ${file}`, { error: error.message });
      errors.push(`${file}: ${error.message}`);
      skipped++;
    }
  }

  log.info(`Core capabilities loading complete: ${loaded} loaded, ${skipped} skipped`);

  return { loaded, skipped, errors };
}

/**
 * Load ALL existing CapabilityDefinitions from capabilities.ts as core powers.
 * This bridges the existing hard-coded capabilities into the unified registry
 * so they appear alongside SKILL.md powers in the API and system prompt.
 *
 * Called during bootstrap after loadCoreCapabilities().
 */
export async function loadCapabilitiesAsPowers(): Promise<{
  loaded: number;
  errors: string[];
}> {
  const { ALL_CAPABILITIES } = await import('./capabilities');
  const { capabilityToPower, powerToManifest } = await import('./types');
  const { powersRegistry } = await import('@/lib/powers');

  let loaded = 0;
  const errors: string[] = [];

  // Build the set of capability IDs covered by auto-inject powers once,
  // reusing the already-imported powersRegistry.
  const coveredCapabilityIds = new Set<string>();
  for (const p of powersRegistry.getActive()) {
    if (p.autoInject && p.coversCapabilityIds) {
      for (const cid of p.coversCapabilityIds) coveredCapabilityIds.add(cid);
    }
  }

  for (const cap of ALL_CAPABILITIES) {
    try {
      // Skip if already loaded (e.g., from a SKILL.md override or auto-inject power)
      if (loadedPowerIds.has(cap.id)) {
        log.debug(`Capability ${cap.id} already loaded from SKILL.md — skipping TS fallback`);
        continue;
      }

      // Skip capabilities that are covered by auto-inject powers to avoid duplicates.
      // Derives the overlap list dynamically from registered auto-inject powers'
      // `coversCapabilityIds` field, so adding a new auto-inject power automatically
      // prevents its duplicate capability entries — no hardcoded list to maintain.
      if (coveredCapabilityIds.has(cap.id)) {
        log.debug(`Capability ${cap.id} skipped — covered by auto-inject power`);
        loadedPowerIds.add(cap.id); // Mark as loaded so auto-inject power doesn't get overridden
        continue;
      }

      const powerDef = capabilityToPower(cap);
      const manifest = powerToManifest(powerDef);

      await powersRegistry.register(manifest);
      loadedPowerIds.add(cap.id);
      loaded++;
    } catch (error: any) {
      errors.push(`${cap.id}: ${error.message}`);
    }
  }

  log.info(`Loaded ${loaded} capabilities as core powers (${errors.length} errors)`);
  return { loaded, errors };
}

/**
 * Register built-in auto-inject powers (powers with autoInject: true).
 *
 * These are ubiquitous, always-beneficial powers that are proactively
 * injected as USER messages when their triggers match — e.g., web search
 * when a URL appears. They are NOT discovered on-demand via power_list/power_read.
 *
 * Called during bootstrap after loadCoreCapabilities() and loadCapabilitiesAsPowers().
 */
export async function loadAutoInjectPowers(): Promise<{
  loaded: number;
  errors: string[];
}> {
  const { powersRegistry } = await import('@/lib/powers');
  const errors: string[] = [];
  let loaded = 0;

  // Web Search & URL Fetch — the canonical auto-inject power
  try {
    const { webSearchPowerManifest } = await import('@/lib/powers/web-search-power');
    if (!loadedPowerIds.has(webSearchPowerManifest.id)) {
      await powersRegistry.register(webSearchPowerManifest);
      loadedPowerIds.add(webSearchPowerManifest.id);
      loaded++;

      log.info(`Auto-inject power registered: ${webSearchPowerManifest.id}`);
    } else {
      log.debug(`Auto-inject power ${webSearchPowerManifest.id} already loaded — skipping`);
    }
  } catch (error: any) {
    errors.push(`web-search: ${error.message}`);
  }

  // Code Search & Grep — auto-inject for codebase search queries
  try {
    const { codeSearchPowerManifest } = await import('@/lib/powers/code-search-power');
    if (!loadedPowerIds.has(codeSearchPowerManifest.id)) {
      await powersRegistry.register(codeSearchPowerManifest);
      loadedPowerIds.add(codeSearchPowerManifest.id);
      loaded++;

      log.info(`Auto-inject power registered: ${codeSearchPowerManifest.id}`);
    } else {
      log.debug(`Auto-inject power ${codeSearchPowerManifest.id} already loaded — skipping`);
    }
  } catch (error: any) {
    errors.push(`code-search: ${error.message}`);
  }

  log.info(`Loaded ${loaded} auto-inject powers (${errors.length} errors)`);
  return { loaded, errors };
}

/**
 * Convenience function that calls all three loader stages in sequence:
 *   1. loadCoreCapabilities() — SKILL.md files from web/lib/tools/base/
 *   2. loadCapabilitiesAsPowers() — existing CapabilityDefinitions
 *   3. loadAutoInjectPowers() — built-in auto-inject powers (web-search, etc.)
 *
 * Safe to call multiple times (idempotent).
 */
export async function loadAllPowers(options?: { forceReload?: boolean }): Promise<{
  loaded: number;
  errors: string[];
}> {
  const allErrors: string[] = [];
  let totalLoaded = 0;

  // Load auto-inject powers FIRST so their coversCapabilityIds are registered
  // before loadCapabilitiesAsPowers() runs — this lets the capability loader
  // skip duplicate entries dynamically.
  const autoInject = await loadAutoInjectPowers();
  totalLoaded += autoInject.loaded;
  allErrors.push(...autoInject.errors);

  const core = await loadCoreCapabilities(options);
  totalLoaded += core.loaded;
  allErrors.push(...core.errors);

  const caps = await loadCapabilitiesAsPowers();
  totalLoaded += caps.loaded;
  allErrors.push(...caps.errors);

  log.info(`All powers loaded: ${totalLoaded} total (${allErrors.length} errors)`);
  return { loaded: totalLoaded, errors: allErrors };
}

/**
 * Get the set of loaded power IDs (for introspection / testing).
 */
export function getLoadedPowerIds(): Set<string> {
  return new Set(loadedPowerIds);
}

/**
 * Reset the loader state (for testing / hot-reload).
 */
export function resetLoader(): void {
  loadedPowerIds.clear();
  clearMarkdownBodies();
}
