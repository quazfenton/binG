/**
 * First-Response Routing Parser
 *
 * Parses structured routing metadata embedded in the LLM's first response.
 * This replaces the need for a separate TaskClassification step by having
 * the LLM classify and route itself via prompt engineering (see
 * DYNAMIC_FIRST_RESPONSE_ROUTING in system-prompts-dynamic.ts).
 *
 * The LLM includes a [ROUTING_METADATA] JSON block in its first response.
 * This module extracts and validates that block, then the orchestrator uses
 * it to direct subsequent auto-re-prompted steps.
 */

import { tryRepairJson, extractFirstJsonObject } from './spec-parser-utils';

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
  requiresAutoReprompt: boolean;
  estimatedSteps: number;
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
const ROUTING_MARKER = '[ROUTING_METADATA]';

/** Default routing for when parsing fails — safe conservative defaults */
const DEFAULT_ROUTING: RoutingMetadata = {
  classification: 'multi-step',
  complexity: 'medium',
  suggestedRole: 'coder',
  roleOptions: [
    { role: 'coder', weight: 0.8, reason: 'default primary role' },
    { role: 'reviewer', weight: 0.4, reason: 'default secondary role' },
  ],
  toolCallOptions: [],
  specializationRoute: 'direct',
  planSteps: [],
  requiresAutoReprompt: false,
  estimatedSteps: 1,
};

// ─── Parser ──────────────────────────────────────────────────────────

/**
 * Extract and parse [ROUTING_METADATA] from an LLM response.
 *
 * The LLM includes a JSON block after the [ROUTING_METADATA] marker.
 * This function:
 * 1. Locates the marker in the response text
 * 2. Extracts the JSON object following it
 * 3. Validates and normalizes the parsed structure
 * 4. Returns a ParsedRouting result
 */
export function parseFirstResponseRouting(responseText: string): ParsedRouting {
  if (!responseText || typeof responseText !== 'string') {
    return { found: false, error: 'Empty or non-string response' };
  }

  const markerIndex = responseText.indexOf(ROUTING_MARKER);
  if (markerIndex === -1) {
    return { found: false, error: 'No [ROUTING_METADATA] marker found in response' };
  }

  // Extract the text after the marker — the JSON should follow
  const afterMarker = responseText.slice(markerIndex + ROUTING_MARKER.length).trim();

  // Try to extract a JSON object from the remaining text
  const extracted = extractFirstJsonObject(afterMarker);
  if (!extracted) {
    // Try repairing common LLM JSON issues
    const repaired = tryRepairJson(afterMarker);
    const repairedExtracted = extractFirstJsonObject(repaired);
    if (!repairedExtracted) {
      return { found: false, rawJson: afterMarker.slice(0, 200), error: 'Could not extract JSON object from response after marker' };
    }
    // Parse the extracted JSON string into an object
    try {
      const parsed = JSON.parse(repairedExtracted);
      return validateAndNormalize(parsed, afterMarker.slice(0, 200));
    } catch (e: any) {
      return { found: false, rawJson: repairedExtracted.slice(0, 200), error: `JSON parse error: ${e.message}` };
    }
  }

  // Parse the extracted JSON string into an object
  try {
    const parsed = JSON.parse(extracted);
    return validateAndNormalize(parsed, afterMarker.slice(0, 200));
  } catch (e: any) {
    // Extraction succeeded but JSON.parse failed (e.g., trailing commas or comments).
    // Repair the extracted string and retry.
    try {
      const repaired = tryRepairJson(extracted);
      const parsed = JSON.parse(repaired);
      return validateAndNormalize(parsed, afterMarker.slice(0, 200));
    } catch {
      return { found: false, rawJson: extracted.slice(0, 200), error: `JSON parse error: ${e.message}` };
    }
  }
}

/**
 * Validate and normalize a parsed routing metadata object.
 * Falls back to defaults for missing/invalid fields.
 */
function validateAndNormalize(parsed: Record<string, any>, rawJson?: string): ParsedRouting {
  const errors: string[] = [];

  // Validate classification
  const validClassifications: TaskClassification[] = ['code', 'research', 'planning', 'debugging', 'review', 'multi-step'];
  const classification = validClassifications.includes(parsed.classification)
    ? (parsed.classification as TaskClassification)
    : DEFAULT_ROUTING.classification;
  if (!validClassifications.includes(parsed.classification)) {
    errors.push(`Invalid classification: ${parsed.classification}`);
  }

  // Validate complexity
  const validComplexities: TaskComplexity[] = ['low', 'medium', 'high'];
  const complexity = validComplexities.includes(parsed.complexity)
    ? (parsed.complexity as TaskComplexity)
    : DEFAULT_ROUTING.complexity;

  // Validate suggestedRole
  const validRoles: AgentRoleName[] = ['coder', 'reviewer', 'planner', 'architect', 'debugger', 'researcher', 'specialist'];
  const suggestedRole = validRoles.includes(parsed.suggestedRole)
    ? (parsed.suggestedRole as AgentRoleName)
    : DEFAULT_ROUTING.suggestedRole;

  // Validate roleOptions
  const roleOptions: RoleOption[] = Array.isArray(parsed.roleOptions)
    ? parsed.roleOptions
        .filter((r: any) => r && typeof r.role === 'string' && typeof r.weight === 'number')
        .map((r: any) => ({
          role: r.role,
          weight: Math.max(0, Math.min(1, r.weight)),
          reason: typeof r.reason === 'string' ? r.reason : '',
        }))
    : DEFAULT_ROUTING.roleOptions;

  // Validate toolCallOptions
  const toolCallOptions: ToolCallOption[] = Array.isArray(parsed.toolCallOptions)
    ? parsed.toolCallOptions
        .filter((t: any) => t && typeof t.tool === 'string' && typeof t.weight === 'number')
        .map((t: any) => ({
          tool: t.tool,
          weight: Math.max(0, Math.min(1, t.weight)),
          reason: typeof t.reason === 'string' ? t.reason : '',
        }))
    : DEFAULT_ROUTING.toolCallOptions;

  // Validate specializationRoute
  const validRoutes: SpecializationRoute[] = ['direct', 'skill', 'action', 'search', 'sub-agent', 'multi-step'];
  const specializationRoute = validRoutes.includes(parsed.specializationRoute)
    ? (parsed.specializationRoute as SpecializationRoute)
    : DEFAULT_ROUTING.specializationRoute;

  // Validate planSteps
  const planSteps: PlanStep[] = Array.isArray(parsed.planSteps)
    ? parsed.planSteps
        .filter((s: any) => s && typeof s.step === 'string')
        .map((s: any) => ({
          step: s.step,
          tool: typeof s.tool === 'string' ? s.tool : '',
          role: typeof s.role === 'string' ? s.role : '',
        }))
    : DEFAULT_ROUTING.planSteps;

  // Validate requiresAutoReprompt
  const requiresAutoReprompt = typeof parsed.requiresAutoReprompt === 'boolean'
    ? parsed.requiresAutoReprompt
    : DEFAULT_ROUTING.requiresAutoReprompt;

  // Validate estimatedSteps
  const estimatedSteps = typeof parsed.estimatedSteps === 'number' && parsed.estimatedSteps >= 1
    ? Math.round(parsed.estimatedSteps)
    : DEFAULT_ROUTING.estimatedSteps;

  const routing: RoutingMetadata = {
    classification,
    complexity,
    suggestedRole,
    roleOptions,
    toolCallOptions,
    specializationRoute,
    planSteps,
    requiresAutoReprompt,
    estimatedSteps,
  };

  return {
    found: true,
    routing,
    rawJson,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

/**
 * Format an array of role redirect options into a markdown section string.
 * Shared between routingToRoleRedirectSection and feedback-injection.ts.
 */
export function formatRoleRedirectOptions(
  options: Array<{ role: string; weight: number; reason: string }>,
  maxItems: number = 3,
): string {
  if (!options || options.length === 0) {
    return '';
  }

  let section = '\n## Role Redirect Options\n';
  section += 'Consider these specialized roles for better handling:\n\n';

  // Deduplicate by role (keep highest-weight entry per role)
  const deduped = options.filter(
    (r, i) => options.findIndex((x) => x.role === r.role) === i,
  );
  const sorted = [...deduped]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxItems);

  for (const redirect of sorted) {
    section += `- **${redirect.role}** (${(redirect.weight * 100).toFixed(0)}% match): ${redirect.reason}\n`;
  }

  return section;
}

/**
 * Generate a role redirect string from parsed routing metadata.
 * This is used by injectFeedback when no failures exist but routing
 * metadata is available from the first response.
 */
export function routingToRoleRedirectSection(routing: RoutingMetadata): string {
  return formatRoleRedirectOptions(routing.roleOptions || []);
}

/**
 * Determine if a review cycle should trigger based on:
 * - Number of successive re-prompts
 * - Tool call accumulation
 * - Success rate
 * - Plan step progress
 */
export function shouldTriggerReview(
  currentStep: number,
  estimatedSteps: number,
  successiveToolCalls: number,
  totalToolCalls: number,
  successRate: number,
): { trigger: boolean; reason: string; suggestedAction: string } {
  // Step-based threshold: if we've exceeded estimated steps by 50%
  if (currentStep > estimatedSteps * 1.5 && estimatedSteps > 0) {
    return {
      trigger: true,
      reason: `Exceeded estimated steps (${currentStep} > ${estimatedSteps * 1.5})`,
      suggestedAction: 'replan',
    };
  }

  // Absolute step threshold: always review after 5+ steps
  if (currentStep >= 5) {
    return {
      trigger: true,
      reason: `High step count (${currentStep} steps)`,
      suggestedAction: 'review',
    };
  }

  // Consecutive tool call threshold
  if (successiveToolCalls >= 7) {
    return {
      trigger: true,
      reason: `High consecutive tool calls (${successiveToolCalls})`,
      suggestedAction: 'redirect',
    };
  }

  // Total tool call accumulation
  if (totalToolCalls >= 10) {
    return {
      trigger: true,
      reason: `High total tool calls (${totalToolCalls})`,
      suggestedAction: 'simplify',
    };
  }

  // Low success rate
  if (successRate < 0.5 && currentStep >= 3) {
    return {
      trigger: true,
      reason: `Low success rate (${(successRate * 100).toFixed(0)}%) with ${currentStep} steps`,
      suggestedAction: 'replan',
    };
  }

  return { trigger: false, reason: '', suggestedAction: '' };
}

/**
 * Get the next plan step to execute based on routing metadata.
 * Returns null if all steps are completed.
 */
export function getNextPlanStep(
  routing: RoutingMetadata,
  completedSteps: number,
): PlanStep | null {
  if (!routing.planSteps || routing.planSteps.length === 0) {
    return null;
  }

  if (completedSteps >= routing.planSteps.length) {
    return null;
  }

  return routing.planSteps[completedSteps];
}

/**
 * Generate an auto-re-prompt message for the next step in the plan.
 * This is injected into the conversation to continue the orchestrated flow.
 */
export function generateStepReprompt(
  routing: RoutingMetadata,
  completedSteps: number,
  previousResult?: string,
): string {
  const nextStep = getNextPlanStep(routing, completedSteps);
  if (!nextStep) {
    return '[ALL_PLAN_STEPS_COMPLETED] Review the full execution and provide a fulfillment summary.';
  }

  let reprompt = `\n[PLAN_STEP ${completedSteps + 1}/${routing.planSteps.length}]\n`;
  reprompt += `Task: ${nextStep.step}\n`;
  if (nextStep.tool) reprompt += `Tool: ${nextStep.tool}\n`;
  if (nextStep.role) reprompt += `Role: ${nextStep.role}\n`;

  if (previousResult) {
    reprompt += `\nPrevious step result:\n${previousResult.slice(0, 500)}${previousResult.length > 500 ? '...' : ''}\n`;
  }

  reprompt += `\nProceed with this step. `;
  if (completedSteps + 1 < routing.planSteps.length) {
    reprompt += `After completing, include [ROUTING_METADATA] with updated planSteps for remaining steps.`;
  } else {
    reprompt += `This is the final step. Include [FULFILLMENT REVIEW] in your response.`;
  }

  return reprompt;
}
