/**
 * Single source of truth for the env-aware continuation default.
 *
 * Contract: returns true unless the operator explicitly sets
 * `LLM_AUTO_CONTINUE_DEFAULT=false` (literal, case-sensitive). Any other
 * value — unset, empty, "0", "FALSE" (case-mismatched) — defers to
 * default-on because the discriminator is `!== 'false'`.
 *
 * Referenced from:
 *   - DEFAULT_ROUTING.continue (cached at module load)
 *   - validateAndNormalize fallback path (per-step recompute)
 *
 * Runtime: safe in any environment because the `typeof process !==
 * 'undefined'` guard below protects against undeclared `process` in
 * browser bundles (this package has no `browser` export condition to
 * enforce server-only loading, so the guard is the load-bearing safety).
 */
function resolveDefaultContinue(): boolean {
  // Defensive access: tests/edge environments may not have process defined.
  // Default env-aware flag is on (=== 'false' string opt-out only).
  // typeof guard protects against undeclared `process` in browser bundles
  // (this package has no `browser` export condition to gate server-only).
  return typeof process !== 'undefined' && process.env?.LLM_AUTO_CONTINUE_DEFAULT !== 'false';
}

/**
 * First-Response Routing Parser
 *
 * Parses structured routing metadata embedded in the LLM's first response.
 * This replaces the need for a separate TaskClassification step by having
 * the LLM classify and route itself via prompt engineering (see
 * DYNAMIC_FIRST_RESPONSE_ROUTING in system-prompts-dynamic.ts).
 *
 * The LLM includes a [ROLE_SELECT] JSON block in its first response.
 * This module extracts and validates that block, then the orchestrator uses
 * it to direct subsequent auto-re-prompted steps.
 */

import { tryRepairJson, extractFirstJsonObject } from './spec-parser-utils';

// ─── Env-Aware Default ──────────────────────────────────────────────────────────────

/**
 * Single source of truth for the env-aware continuation default.
 *
 * Contract: returns `true` unless the operator explicitly sets
 * `LLM_AUTO_CONTINUE_DEFAULT=false` (literal, case-sensitive). Any other
 * value — unset, empty, "0", "FALSE" (case-mismatched) — defers to
 * default-on because the discriminator is `!== 'false'`.
 *
 * Runtime: declared at module-top so DEFAULT_ROUTING (cached at module
 * load) and validateAndNormalize fallback path both reach the same
 * definition. The `typeof process !== 'undefined'` guard prevents a
 * ReferenceError in browser/Worker bundles (this package has no
 * `browser` export condition to gate server-only loading).
 */
export function resolveDefaultContinue(): boolean {
  return typeof process !== 'undefined'
    && process.env?.LLM_AUTO_CONTINUE_DEFAULT !== 'false';
}


// ─── Types ───────────────────────────────────────────────────────────

export type TaskClassification = 'code' | 'research' | 'planning' | 'debugging' | 'review' | 'multi-step';
export type TaskComplexity = 'low' | 'medium' | 'high';
export type SpecializationRoute = 'direct' | 'skill' | 'action' | 'search' | 'sub-agent' | 'multi-step';
export type AgentRoleName = 'coder' | 'reviewer' | 'planner' | 'architect' | 'debugger' | 'researcher' | 'specialist';

export interface RoleOption {
  role: string;
  weight: number;
  reason: string;
}

export interface ToolCallOption {
  tool: string;
  weight: number;
  reason: string;
}

export interface PlanStep {
  step: string;
  tool: string;
  role: string;
}

export interface RoutingMetadata {
  classification: TaskClassification;
  complexity: TaskComplexity;
  suggestedRole: AgentRoleName;
  roleOptions: RoleOption[];
  toolCallOptions: ToolCallOption[];
  specializationRoute: SpecializationRoute;
  planSteps: PlanStep[];
  continue: boolean;
}

export interface ParsedRouting {
  /** Whether routing metadata was found and successfully parsed */
  found: boolean;
  /** The parsed routing metadata, if found */
  routing?: RoutingMetadata;
  /** The raw JSON string extracted from the response, for debugging */
  rawJson?: string;
  /** Parse error, if any */
  error?: string;
}

// ─── Constants ───────────────────────────────────────────────────────

/** Marker tag that the LLM uses to denote routing metadata */
const ROUTING_MARKER = '[ROLE_SELECT]';

/** Initial response marker */
const INITIAL_RESPONSE_MARKER = '### Initial Response';

/**
 * Strip routing metadata and initial response markers from response text.
 * Used to clean LLM responses before sending to client.
 */
export function stripRoutingMarkers(responseText: string): string {
  if (!responseText || typeof responseText !== 'string') {
    return responseText;
  }

  let cleaned = responseText;

  // Remove ALL [ROLE_SELECT]/[ROUTING_METADATA] markers and their associated JSON blocks.
  // A single while loop handles multiple occurrences. The per-marker for-loop was
  // redundant because the while loop covers all cases.
  const markerRegex = /\[(?:ROUTING_METADATA|ROLE_SELECT)\]/;
  let markerMatch;
  while ((markerMatch = cleaned.match(markerRegex)) !== null) {
    if (markerMatch.index === undefined) break;
    const jsonBlock = extractFirstJsonObject(cleaned.slice(markerMatch.index));
    if (jsonBlock) {
      const beforeMarker = cleaned.slice(0, markerMatch.index);
      const headerRegex = /###?\s*$/;
      const cleanedBefore = beforeMarker.replace(headerRegex, '');
      
      const afterJsonIndex = cleaned.indexOf(jsonBlock, markerMatch.index) + jsonBlock.length;
      let afterJson = cleaned.slice(afterJsonIndex);
      
      // Remove trailing code fences if present
      afterJson = afterJson.replace(/^\s*```?\s*/, '');
      
      cleaned = cleanedBefore + afterJson;
    } else {
      // JSON extraction failed — still strip the marker text so it doesn't leak to users
      const beforeMarker = cleaned.slice(0, markerMatch.index);
      const afterMarker = cleaned.slice(markerMatch.index + markerMatch[0].length);
      const headerRegex = /###?\s*$/;
      const cleanedBefore = beforeMarker.replace(headerRegex, '');
      cleaned = cleanedBefore + afterMarker;
    }
  }

  // 3. Remove ### Initial Response section
  cleaned = cleaned.replace(/^###?\s*Initial Response[\s\S]*?^---/gm, '');

  // 4. Clean up extra newlines and formatting artifacts
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

/** Default routing for when parsing fails — safe conservative defaults.
<<<<<<< Updated upstream
 * The `continue` flag is resolved through resolveDefaultContinue() at
 * module-top scope (single source of truth for the env-aware default). */
=======
 * The `continue` flag is resolved through resolveDefaultContinue(), so the
 * env-aware default-on behavior is the single source of truth. */
>>>>>>> Stashed changes
const DEFAULT_ROUTING: RoutingMetadata = {
  classification: 'multi-step',
  complexity: 'medium',
  suggestedRole: 'coder',
  roleOptions: [],
  toolCallOptions: [],
  specializationRoute: 'multi-step',
  planSteps: [],
<<<<<<< Updated upstream
  // Resolved via resolveDefaultContinue() — see env contract on the helper.
=======
  // Resolved via resolveDefaultContinue() so the env-aware default is
  // the single source of truth shared with the validateAndNormalize
  // fallback path.
>>>>>>> Stashed changes
  continue: resolveDefaultContinue(),
};

/**
 * Extract and parse [ROLE_SELECT] from an LLM response.
 */
export function parseFirstResponseRouting(responseText: string): ParsedRouting {
  if (!responseText || typeof responseText !== 'string') {
    return { found: false, error: 'Empty or non-string response' };
  }

  // Support both new and legacy markers; pick the earliest occurrence
  const roleSelectIdx = responseText.indexOf('[ROLE_SELECT]');
  const legacyIdx = responseText.indexOf('[ROUTING_METADATA]');
  let markerIndex = -1;
  let markerText = '[ROLE_SELECT]';
  
  if (roleSelectIdx !== -1 && (legacyIdx === -1 || roleSelectIdx <= legacyIdx)) {
    markerIndex = roleSelectIdx;
    markerText = '[ROLE_SELECT]';
  } else if (legacyIdx !== -1) {
    markerIndex = legacyIdx;
    markerText = '[ROUTING_METADATA]';
  }

  if (markerIndex === -1) {
    return { found: false, error: 'No [ROLE_SELECT] or [ROUTING_METADATA] marker found in response' };
  }

  const afterMarker = responseText.slice(markerIndex + markerText.length).trim();
  
  const jsonObject = extractFirstJsonObject(afterMarker);

  if (!jsonObject) {
    return { found: false, error: 'Could not extract JSON after marker', rawJson: afterMarker.slice(0, 500) };
  }

  try {
    const parsed = JSON.parse(jsonObject);
    return validateAndNormalize(parsed, afterMarker.slice(0, 500));
  } catch {
    return { found: false, error: 'Invalid JSON after marker', rawJson: afterMarker.slice(0, 500) };
  }
}

/**
 * Validate and normalize a parsed routing metadata object.
 */
function validateAndNormalize(parsed: Record<string, any>, rawJson?: string): ParsedRouting {
  try {
    // Helper to normalize boolean values from LLM output
    const normalizeBoolean = (value: unknown): boolean | undefined => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
      }
      return undefined;
    };

    // Validate classification
    const validClassifications: TaskClassification[] = ['code', 'research', 'planning', 'debugging', 'review', 'multi-step'];
    const classification = validClassifications.includes(parsed.classification)
      ? (parsed.classification as TaskClassification)
      : DEFAULT_ROUTING.classification;

    // Validate complexity
    const validComplexities: TaskComplexity[] = ['low', 'medium', 'high'];
    const complexity = validComplexities.includes(parsed.complexity)
      ? (parsed.complexity as TaskComplexity)
      : DEFAULT_ROUTING.complexity;

    // Validate suggestedRole
    const validRoles: AgentRoleName[] = ['coder', 'reviewer', 'planner', 'architect', 'debugger', 'researcher', 'specialist'];
    const suggestedRole = validRoles.includes(parsed.suggestedRole)
      ? (parsed.suggestedRole as AgentRoleName)
      : validRoles.includes(parsed.role)
      ? (parsed.role as AgentRoleName)
      : DEFAULT_ROUTING.suggestedRole;

    // Validate specializationRoute
    const validRoutes: SpecializationRoute[] = ['direct', 'skill', 'action', 'search', 'sub-agent', 'multi-step'];
    const specializationRoute = validRoutes.includes(parsed.specializationRoute)
      ? (parsed.specializationRoute as SpecializationRoute)
      : DEFAULT_ROUTING.specializationRoute;

    const routing: RoutingMetadata = {
      classification,
      complexity,
      suggestedRole,
      roleOptions: Array.isArray(parsed.roleOptions) ? parsed.roleOptions : DEFAULT_ROUTING.roleOptions,
      toolCallOptions: Array.isArray(parsed.toolCallOptions) ? parsed.toolCallOptions : DEFAULT_ROUTING.toolCallOptions,
      specializationRoute,
      planSteps: Array.isArray(parsed.planSteps) ? parsed.planSteps : DEFAULT_ROUTING.planSteps,
      continue:
        normalizeBoolean(parsed.continue) ??
        normalizeBoolean(parsed.requiresAutoReprompt) ??
        (Array.isArray(parsed.planSteps) && parsed.planSteps.length >= 2 ? true : resolveDefaultContinue()),
    };

    return {
      found: true,
      routing,
      rawJson,
    };
  } catch (err: any) {
    return { found: false, error: `Validation error: ${err.message}`, rawJson };
  }
}

/**
 * Format a list of role options into a human-readable role redirect section.
 * Deduplicates by role name (keeping the highest-weighted entry), sorts by
 * weight descending, and includes a section header. Returns '' when there are
 * no options to render.
 */
export function formatRoleRedirectOptions(
  roleOptions: Array<{ role: string; weight: number; reason: string }> | undefined | null,
): string {
  if (!roleOptions || roleOptions.length === 0) return '';

  // Deduplicate: keep the highest-weighted entry per role
  const dedup = new Map<string, { role: string; weight: number; reason: string }>();
  for (const opt of roleOptions) {
    if (!opt || !opt.role) continue;
    const existing = dedup.get(opt.role);
    if (!existing || opt.weight > existing.weight) {
      dedup.set(opt.role, { role: opt.role, weight: opt.weight, reason: opt.reason });
    }
  }

  if (dedup.size === 0) return '';

  const sorted = Array.from(dedup.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  let section = '\n## Role Redirect Options\n';
  section += 'Consider these specialized roles for better handling:\n\n';
  for (const opt of sorted) {
    section += `- **${opt.role}** (${(opt.weight * 100).toFixed(0)}% match): ${opt.reason}\n`;
  }

  return section;
}

/**
 * Generate a role redirect string from parsed routing metadata.
 */
export function routingToRoleRedirectSection(routing: RoutingMetadata): string {
  return formatRoleRedirectOptions(routing.roleOptions);
}

/**
 * Generate a continuation prompt for the next step in the plan.
 */
export function generateStepReprompt(routing: RoutingMetadata, stepIndex: number): string {
  if (!routing.planSteps || !Array.isArray(routing.planSteps)) return '';
  const step = routing.planSteps[stepIndex];
  if (!step) return '';

  return `[AUTO-REPROMPT]
Current Step: ${step.step}
Suggested Tool: ${step.tool}
Assigned Role: ${step.role}

Continue with this step. If completed, proceed to next steps or conclude.
`;
}

/**
 * Truncate response at the first [ROLE_SELECT] (or legacy [ROUTING_METADATA]) marker.
 * 
 * Some LLMs (especially text-mode fallback like gpt-oss) keep generating content after
 * emitting their [ROLE_SELECT] block — e.g. they "simulate" the next turn or repeat the
 * plan in a different format. We only want the prose BEFORE the first marker; everything
 * after (including the marker JSON and any subsequent simulated turns) is discarded for
 * the user-visible message.
 */
export function truncateAtFirstRouting(responseText: string): string {
  if (!responseText || typeof responseText !== 'string') return responseText;

  let earliestIdx = -1;
  for (const marker of ['[ROLE_SELECT]', '[ROUTING_METADATA]']) {
    const idx = responseText.indexOf(marker);
    if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
      earliestIdx = idx;
    }
  }

  if (earliestIdx === -1) return responseText;

  // Trim trailing whitespace/separators (e.g., "---\n\n") right before the marker
  let truncated = responseText.slice(0, earliestIdx);
  truncated = truncated.replace(/[\s\-_=*]+$/, '').trim();
  return truncated;
}

/**
 * Build a chat-route-friendly routing metadata payload that includes a
 * `stepReprompt` string. This is the contract the client (use-enhanced-chat.ts)
 * expects on `done.messageMetadata.routing` to auto-continue multi-step flows.
 */
export function buildRoutingMetadataForClient(routing: RoutingMetadata): {
  stepReprompt: string;
  primaryRole: string;
  estimatedSteps: number;
  classification: TaskClassification;
  complexity: TaskComplexity;
  specializationRoute: SpecializationRoute;
  planSteps: PlanStep[];
  continue: boolean;
} {
  // Bug #2 fix: planSteps >= 2 should force continue: true
  // The LLM outlined a multi-step plan but may have set continue: false.
  // resolveDefaultContinue() (env-aware, the single source of truth)
  // returns true unless LLM_AUTO_CONTINUE_DEFAULT=false is explicitly set,
  // so multi-step plans still trigger auto-continuation in the new
  // default-true behavior.
  const hasMultiplePlanSteps = Array.isArray(routing.planSteps) && routing.planSteps.length >= 2;
  const explicitContinue = !!routing.continue && Array.isArray(routing.planSteps) && routing.planSteps.length > 0;
  const shouldContinue = explicitContinue || hasMultiplePlanSteps;
  return {
    stepReprompt: shouldContinue ? generateStepReprompt(routing, 0) : '',
    primaryRole: routing.suggestedRole,
    estimatedSteps: routing.planSteps?.length || 0,
    classification: routing.classification,
    complexity: routing.complexity,
    specializationRoute: routing.specializationRoute,
    planSteps: routing.planSteps || [],
    continue: shouldContinue,
  };
}

/**
 * Determine if a review cycle should trigger.
 */
export function shouldTriggerReview(
  currentStep: number,
  successiveToolCalls: number,
  totalToolCalls: number,
  successRate: number,
): { trigger: boolean; reason: string; suggestedAction: string } {
  if (currentStep >= 5) {
    return { trigger: true, reason: 'High step count', suggestedAction: 'review' };
  }
  if (successiveToolCalls >= 7) {
    return { trigger: true, reason: 'High consecutive tool calls', suggestedAction: 'redirect' };
  }
  if (totalToolCalls >= 12) {
    return { trigger: true, reason: 'High total tool calls', suggestedAction: 'simplify' };
  }
  if (successRate < 0.5 && currentStep >= 3) {
    return { trigger: true, reason: 'Low success rate', suggestedAction: 'replan' };
  }
  return { trigger: false, reason: '', suggestedAction: '' };
}
