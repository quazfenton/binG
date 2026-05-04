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

  // Remove [ROLE_SELECT] or legacy [ROUTING_METADATA] block
  cleaned = cleaned.replace(/^###?\s*\[(?:ROUTING_METADATA|ROLE_SELECT)\]\s*```?json?\s*[\s\S]*?```?\s*/g, '');

  // Remove stand-alone markers
  cleaned = cleaned.replace(/\[(?:ROUTING_METADATA|ROLE_SELECT)\][\s\S]*?}(?:\s*```)?/g, '');

  // Remove ### Initial Response section
  cleaned = cleaned.replace(/^###?\s*Initial Response[\s\S]*?^---/gm, '');

  // Clean up extra newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

/** Default routing for when parsing fails — safe conservative defaults */
const DEFAULT_ROUTING: RoutingMetadata = {
  classification: 'multi-step',
  complexity: 'medium',
  suggestedRole: 'coder',
  roleOptions: [],
  toolCallOptions: [],
  specializationRoute: 'multi-step',
  planSteps: [],
  continue: false,
};

/**
 * Extract and parse [ROLE_SELECT] from an LLM response.
 */
export function parseFirstResponseRouting(responseText: string): ParsedRouting {
  if (!responseText) {
    return { found: false, error: 'Empty response' };
  }

  // Support both new and legacy markers
  const markerIndex = responseText.indexOf('[ROLE_SELECT]') !== -1 
    ? responseText.indexOf('[ROLE_SELECT]')
    : responseText.indexOf('[ROUTING_METADATA]');

  if (markerIndex === -1) {
    return { found: false, error: 'No [ROLE_SELECT] marker found in response' };
  }

  // Find where the marker ends to start looking for JSON
  const markerText = responseText.includes('[ROLE_SELECT]') ? '[ROLE_SELECT]' : '[ROUTING_METADATA]';
  const afterMarker = responseText.slice(markerIndex + markerText.length).trim();
  
  const jsonObject = extractFirstJsonObject(afterMarker);

  if (!jsonObject) {
    return { found: false, error: 'Could not extract JSON after marker', rawJson: afterMarker.slice(0, 500) };
  }

  return validateAndNormalize(jsonObject, afterMarker.slice(0, 500));
}

/**
 * Validate and normalize a parsed routing metadata object.
 */
function validateAndNormalize(parsed: Record<string, any>, rawJson?: string): ParsedRouting {
  try {
    const routing: RoutingMetadata = {
      classification: parsed.classification || DEFAULT_ROUTING.classification,
      complexity: parsed.complexity || DEFAULT_ROUTING.complexity,
      suggestedRole: parsed.suggestedRole || parsed.role || DEFAULT_ROUTING.suggestedRole,
      roleOptions: Array.isArray(parsed.roleOptions) ? parsed.roleOptions : DEFAULT_ROUTING.roleOptions,
      toolCallOptions: Array.isArray(parsed.toolCallOptions) ? parsed.toolCallOptions : DEFAULT_ROUTING.toolCallOptions,
      specializationRoute: parsed.specializationRoute || DEFAULT_ROUTING.specializationRoute,
      planSteps: Array.isArray(parsed.planSteps) ? parsed.planSteps : DEFAULT_ROUTING.planSteps,
      continue: parsed.continue !== undefined ? !!parsed.continue : (parsed.requiresAutoReprompt !== undefined ? !!parsed.requiresAutoReprompt : false),
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
 * Generate a role redirect string from parsed routing metadata.
 */
export function routingToRoleRedirectSection(routing: RoutingMetadata): string {
  if (!routing.roleOptions || routing.roleOptions.length === 0) return '';
  
  let section = '\n## Role Redirect Options\n';
  section += 'Consider these specialized roles for better handling:\n\n';
  
  const sorted = [...routing.roleOptions]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);
    
  for (const opt of sorted) {
    section += `- **${opt.role}** (${(opt.weight * 100).toFixed(0)}% match): ${opt.reason}\n`;
  }
  
  return section;
}

/**
 * Generate a continuation prompt for the next step in the plan.
 */
export function generateStepReprompt(routing: RoutingMetadata, stepIndex: number): string {
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
