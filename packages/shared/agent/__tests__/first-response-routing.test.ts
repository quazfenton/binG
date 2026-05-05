/**
 * Unit Tests for parseFirstResponseRouting, formatRoleRedirectOptions,
 * and shouldTriggerReview from first-response-routing.ts
 *
 * Covers parsing, validation/normalization, formatting, and review-trigger logic.
 */

import { describe, it, expect } from 'vitest';
import {
  parseFirstResponseRouting,
  formatRoleRedirectOptions,
  shouldTriggerReview,
  getNextPlanStep,
  generateStepReprompt,
  routingToRoleRedirectSection,
  type RoleOption,
  type RoutingMetadata,
} from '../first-response-routing';

// ─── parseFirstResponseRouting ────────────────────────────────────────

describe('parseFirstResponseRouting', () => {
  describe('empty or invalid input', () => {
    it('should return found=false for empty string', () => {
      const result = parseFirstResponseRouting('');
      expect(result.found).toBe(false);
      expect(result.error).toContain('Empty or non-string');
    });

    it('should return found=false for whitespace-only string', () => {
      const result = parseFirstResponseRouting('   ');
      expect(result.found).toBe(false);
      expect(result.error).toContain('No [ROUTING_METADATA] marker');
    });

    it('should return found=false for null', () => {
      const result = parseFirstResponseRouting(null as any);
      expect(result.found).toBe(false);
      expect(result.error).toContain('Empty or non-string');
    });

    it('should return found=false for undefined', () => {
      const result = parseFirstResponseRouting(undefined as any);
      expect(result.found).toBe(false);
    });

    it('should return found=false for non-string input (number)', () => {
      const result = parseFirstResponseRouting(42 as any);
      expect(result.found).toBe(false);
    });
  });

  describe('no routing marker', () => {
    it('should return found=false when marker is absent', () => {
      const result = parseFirstResponseRouting('Here is some LLM output without routing metadata');
      expect(result.found).toBe(false);
      expect(result.error).toContain('No [ROUTING_METADATA] marker');
    });
  });

  describe('valid routing metadata', () => {
    const validRoutingJson = JSON.stringify({
      classification: 'code',
      complexity: 'high',
      suggestedRole: 'architect',
      roleOptions: [
        { role: 'architect', weight: 0.9, reason: 'system design' },
        { role: 'coder', weight: 0.6, reason: 'implementation' },
      ],
      toolCallOptions: [
        { tool: 'bash', weight: 0.8, reason: 'build commands' },
      ],
      specializationRoute: 'multi-step',
      planSteps: [
        { step: 'Design API', tool: 'read', role: 'architect' },
        { step: 'Implement API', tool: 'write', role: 'coder' },
      ],
      requiresAutoReprompt: true,
      estimatedSteps: 3,
    });

    it('should parse valid JSON after the marker', () => {
      const input = `Some text before\n[ROUTING_METADATA]\n${validRoutingJson}\nSome text after`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing).toBeDefined();
      expect(result.routing!.classification).toBe('code');
      expect(result.routing!.complexity).toBe('high');
      expect(result.routing!.suggestedRole).toBe('architect');
      expect(result.routing!.specializationRoute).toBe('multi-step');
      expect(result.routing!.requiresAutoReprompt).toBe(true);
      expect(result.routing!.estimatedSteps).toBe(3);
    });

    it('should parse roleOptions correctly', () => {
      const input = `[ROUTING_METADATA]\n${validRoutingJson}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.roleOptions).toHaveLength(2);
      expect(result.routing!.roleOptions[0]).toEqual({
        role: 'architect',
        weight: 0.9,
        reason: 'system design',
      });
      expect(result.routing!.roleOptions[1]).toEqual({
        role: 'coder',
        weight: 0.6,
        reason: 'implementation',
      });
    });

    it('should parse toolCallOptions correctly', () => {
      const input = `[ROUTING_METADATA]\n${validRoutingJson}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.toolCallOptions).toHaveLength(1);
      expect(result.routing!.toolCallOptions[0]).toEqual({
        tool: 'bash',
        weight: 0.8,
        reason: 'build commands',
      });
    });

    it('should parse planSteps correctly', () => {
      const input = `[ROUTING_METADATA]\n${validRoutingJson}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.planSteps).toHaveLength(2);
      expect(result.routing!.planSteps[0]).toEqual({
        step: 'Design API',
        tool: 'read',
        role: 'architect',
      });
    });

    it('should preserve rawJson for debugging', () => {
      const input = `[ROUTING_METADATA]\n${validRoutingJson}`;
      const result = parseFirstResponseRouting(input);

      expect(result.rawJson).toBeDefined();
      expect(result.rawJson!.length).toBeGreaterThan(0);
    });

    it('should handle marker with no space before JSON', () => {
      const input = `[ROUTING_METADATA]${validRoutingJson}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.classification).toBe('code');
    });

    it('should handle JSON on a new line after marker', () => {
      const input = `[ROUTING_METADATA]\n${validRoutingJson}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
    });
  });

  describe('invalid JSON after marker', () => {
    it('should return found=false for non-JSON text after marker', () => {
      const input = `[ROUTING_METADATA]\nThis is not JSON at all`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(false);
      expect(result.error).toContain('Could not extract JSON object');
    });

    it('should return found=false for malformed JSON', () => {
      const input = `[ROUTING_METADATA]\n{broken json`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(false);
    });

    it('should repair JSON when comment breaks brace matching (first-pass repair path)', () => {
      // A comment containing { without matching } causes extractFirstJsonObject to fail,
      // then tryRepairJson strips the comment and extraction succeeds on second pass.
      // This tests the !extracted → repair → re-extract path, NOT the catch-block retry.
      const input = `[ROUTING_METADATA]\n// config {\n{"classification":"code","complexity":"low","suggestedRole":"coder","roleOptions":[],"toolCallOptions":[],"specializationRoute":"direct","planSteps":[],"requiresAutoReprompt":false,"estimatedSteps":1}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.classification).toBe('code');
    });

    it('should repair trailing commas in extracted JSON', () => {
      // extractFirstJsonObject finds balanced braces, JSON.parse fails on trailing commas,
      // then the catch block retries with tryRepairJson which strips them.
      const jsonWithTrailingComma = `{"classification":"code","complexity":"low","suggestedRole":"coder","roleOptions":[{"role":"coder","weight":0.8,"reason":"default",}],"toolCallOptions":[],"specializationRoute":"direct","planSteps":[],"requiresAutoReprompt":false,"estimatedSteps":1,}`;
      const input = `[ROUTING_METADATA]\n${jsonWithTrailingComma}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.classification).toBe('code');
      expect(result.routing!.roleOptions).toHaveLength(1);
      expect(result.routing!.roleOptions[0].role).toBe('coder');
    });

    it('should repair single-line comments in extracted JSON', () => {
      // extractFirstJsonObject finds balanced braces, JSON.parse fails on // comments,
      // then the catch block retries with tryRepairJson which strips them.
      const jsonWithComments = `{"classification":"code", // task type\n"complexity":"low","suggestedRole":"coder","roleOptions":[],"toolCallOptions":[],"specializationRoute":"direct","planSteps":[],"requiresAutoReprompt":false,"estimatedSteps":1}`;
      const input = `[ROUTING_METADATA]\n${jsonWithComments}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.classification).toBe('code');
      expect(result.routing!.complexity).toBe('low');
    });

    it('should repair block comments in extracted JSON', () => {
      const jsonWithBlockComments = `{"classification":"code",/* task type */"complexity":"low","suggestedRole":"coder","roleOptions":[],"toolCallOptions":[],"specializationRoute":"direct","planSteps":[],"requiresAutoReprompt":false,"estimatedSteps":1}`;
      const input = `[ROUTING_METADATA]\n${jsonWithBlockComments}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.classification).toBe('code');
    });

    it('should repair both trailing commas and comments in extracted JSON', () => {
      const jsonWithBoth = `{"classification":"code", // task\n"complexity":"low","suggestedRole":"coder","roleOptions":[{"role":"coder","weight":0.8,"reason":"default",}],"toolCallOptions":[],"specializationRoute":"direct","planSteps":[],"requiresAutoReprompt":false,"estimatedSteps":1,}`;
      const input = `[ROUTING_METADATA]\n${jsonWithBoth}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.classification).toBe('code');
    });

    it('should return found=false for genuinely unrepairable JSON', () => {
      const input = `[ROUTING_METADATA]\n{"classification":function(){},}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(false);
      expect(result.error).toContain('JSON parse error');
    });
  });

  describe('validation and normalization — field fallbacks', () => {
    it('should fall back to default classification for invalid value', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'invalid-type',
        complexity: 'low',
        suggestedRole: 'coder',
        specializationRoute: 'direct',
        planSteps: [],
        requiresAutoReprompt: false,
        estimatedSteps: 1,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.classification).toBe('multi-step'); // default
      expect(result.error).toContain('Invalid classification');
    });

    it('should fall back to default complexity for invalid value', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'super-high',
        suggestedRole: 'coder',
        specializationRoute: 'direct',
        planSteps: [],
        requiresAutoReprompt: false,
        estimatedSteps: 1,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.complexity).toBe('medium'); // default
    });

    it('should fall back to default suggestedRole for invalid value', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'superhero',
        specializationRoute: 'direct',
        planSteps: [],
        requiresAutoReprompt: false,
        estimatedSteps: 1,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.suggestedRole).toBe('coder'); // default
    });

    it('should fall back to default specializationRoute for invalid value', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        specializationRoute: 'teleport',
        planSteps: [],
        requiresAutoReprompt: false,
        estimatedSteps: 1,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.specializationRoute).toBe('direct'); // default
    });

    it('should fall back to default roleOptions for non-array', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        roleOptions: 'not-an-array',
        specializationRoute: 'direct',
        planSteps: [],
        requiresAutoReprompt: false,
        estimatedSteps: 1,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      // Should fall back to DEFAULT_ROUTING.roleOptions
      expect(result.routing!.roleOptions).toHaveLength(2);
      expect(result.routing!.roleOptions[0].role).toBe('coder');
    });

    it('should filter roleOptions with missing required fields', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        roleOptions: [
          { role: 'coder', weight: 0.8, reason: 'good' },
          { role: 'reviewer' }, // missing weight
          { weight: 0.5, reason: 'no role' }, // missing role
          null, // null entry
        ],
        specializationRoute: 'direct',
        planSteps: [],
        requiresAutoReprompt: false,
        estimatedSteps: 1,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.roleOptions).toHaveLength(1);
      expect(result.routing!.roleOptions[0].role).toBe('coder');
    });

    it('should clamp roleOption weights to 0-1 range', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        roleOptions: [
          { role: 'coder', weight: 1.5, reason: 'over 1' },
          { role: 'reviewer', weight: -0.3, reason: 'negative' },
        ],
        specializationRoute: 'direct',
        planSteps: [],
        requiresAutoReprompt: false,
        estimatedSteps: 1,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.roleOptions[0].weight).toBe(1);
      expect(result.routing!.roleOptions[1].weight).toBe(0);
    });

    it('should filter toolCallOptions with missing required fields', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        toolCallOptions: [
          { tool: 'bash', weight: 0.9, reason: 'run commands' },
          { tool: 'read' }, // missing weight
        ],
        specializationRoute: 'direct',
        planSteps: [],
        requiresAutoReprompt: false,
        estimatedSteps: 1,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.toolCallOptions).toHaveLength(1);
    });

    it('should clamp toolCallOption weights to 0-1 range', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        toolCallOptions: [
          { tool: 'bash', weight: 2.0, reason: 'too high' },
          { tool: 'read', weight: -1, reason: 'negative' },
        ],
        specializationRoute: 'direct',
        planSteps: [],
        requiresAutoReprompt: false,
        estimatedSteps: 1,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.toolCallOptions[0].weight).toBe(1);
      expect(result.routing!.toolCallOptions[1].weight).toBe(0);
    });

    it('should filter planSteps with missing step field', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        planSteps: [
          { step: 'Do thing', tool: 'bash', role: 'coder' },
          { tool: 'bash' }, // missing step — filtered out
          null,
        ],
        specializationRoute: 'direct',
        requiresAutoReprompt: false,
        estimatedSteps: 1,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.planSteps).toHaveLength(1);
      expect(result.routing!.planSteps[0].step).toBe('Do thing');
    });

    it('should default planStep tool/role to empty string when missing', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        planSteps: [{ step: 'Do thing' }],
        specializationRoute: 'direct',
        requiresAutoReprompt: false,
        estimatedSteps: 1,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.planSteps[0].tool).toBe('');
      expect(result.routing!.planSteps[0].role).toBe('');
    });

    it('should default requiresAutoReprompt to false when non-boolean', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        specializationRoute: 'direct',
        planSteps: [],
        requiresAutoReprompt: 'yes',
        estimatedSteps: 1,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.requiresAutoReprompt).toBe(false);
    });

    it('should round and clamp estimatedSteps to minimum 1', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        specializationRoute: 'direct',
        planSteps: [],
        requiresAutoReprompt: false,
        estimatedSteps: 3.7,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.estimatedSteps).toBe(4);
    });

    it('should default estimatedSteps when below 1', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        specializationRoute: 'direct',
        planSteps: [],
        requiresAutoReprompt: false,
        estimatedSteps: 0,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.estimatedSteps).toBe(1); // default
    });

    it('should default estimatedSteps when non-number', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        specializationRoute: 'direct',
        planSteps: [],
        requiresAutoReprompt: false,
        estimatedSteps: 'many',
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.estimatedSteps).toBe(1); // default
    });

    it('should handle roleOptions with missing reason gracefully', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        roleOptions: [{ role: 'coder', weight: 0.8 }],
        specializationRoute: 'direct',
        planSteps: [],
        requiresAutoReprompt: false,
        estimatedSteps: 1,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.roleOptions[0].reason).toBe('');
    });

    it('should handle toolCallOptions with missing reason gracefully', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        toolCallOptions: [{ tool: 'bash', weight: 0.9 }],
        specializationRoute: 'direct',
        planSteps: [],
        requiresAutoReprompt: false,
        estimatedSteps: 1,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.toolCallOptions[0].reason).toBe('');
    });
  });

  describe('edge cases', () => {
    it('should handle marker appearing multiple times (uses first)', () => {
      const routing1 = JSON.stringify({ classification: 'research', complexity: 'low', suggestedRole: 'researcher', specializationRoute: 'search', planSteps: [], requiresAutoReprompt: false, estimatedSteps: 1 });
      const routing2 = JSON.stringify({ classification: 'debugging', complexity: 'high', suggestedRole: 'debugger', specializationRoute: 'direct', planSteps: [], requiresAutoReprompt: false, estimatedSteps: 1 });

      const input = `[ROUTING_METADATA]\n${routing1}\nMore text\n[ROUTING_METADATA]\n${routing2}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.classification).toBe('research');
    });

    it('should handle empty JSON object after marker', () => {
      const input = `[ROUTING_METADATA]\n{}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      // All fields should fall back to defaults
      expect(result.routing!.classification).toBe('multi-step');
      expect(result.routing!.complexity).toBe('medium');
      expect(result.routing!.suggestedRole).toBe('coder');
      expect(result.routing!.specializationRoute).toBe('direct');
      expect(result.routing!.requiresAutoReprompt).toBe(false);
      expect(result.routing!.estimatedSteps).toBe(1);
    });
  });
});

// ─── formatRoleRedirectOptions ───────────────────────────────────────

describe('formatRoleRedirectOptions', () => {
  it('should return empty string for null input', () => {
    expect(formatRoleRedirectOptions(null as any)).toBe('');
  });

  it('should return empty string for undefined input', () => {
    expect(formatRoleRedirectOptions(undefined as any)).toBe('');
  });

  it('should return empty string for empty array', () => {
    expect(formatRoleRedirectOptions([])).toBe('');
  });

  it('should format a single option', () => {
    const options: RoleOption[] = [
      { role: 'architect', weight: 0.9, reason: 'system design needed' },
    ];
    const result = formatRoleRedirectOptions(options);

    expect(result).toContain('## Role Redirect Options');
    expect(result).toContain('architect');
    expect(result).toContain('90%');
    expect(result).toContain('system design needed');
  });

  it('should format multiple options sorted by weight descending', () => {
    const options: RoleOption[] = [
      { role: 'coder', weight: 0.6, reason: 'implementation' },
      { role: 'architect', weight: 0.9, reason: 'design' },
      { role: 'reviewer', weight: 0.3, reason: 'quality check' },
    ];
    const result = formatRoleRedirectOptions(options);

    const architectIdx = result.indexOf('architect');
    const coderIdx = result.indexOf('coder');
    const reviewerIdx = result.indexOf('reviewer');

    expect(architectIdx).toBeGreaterThan(-1);
    expect(coderIdx).toBeGreaterThan(-1);
    expect(reviewerIdx).toBeGreaterThan(-1);
    // Architect (highest weight) should appear first
    expect(architectIdx).toBeLessThan(coderIdx);
    expect(coderIdx).toBeLessThan(reviewerIdx);
  });

  it('should limit to maxItems options (default 3)', () => {
    const options: RoleOption[] = [
      { role: 'a', weight: 0.9, reason: 'r1' },
      { role: 'b', weight: 0.8, reason: 'r2' },
      { role: 'c', weight: 0.7, reason: 'r3' },
      { role: 'd', weight: 0.6, reason: 'r4' },
      { role: 'e', weight: 0.5, reason: 'r5' },
    ];
    const result = formatRoleRedirectOptions(options);

    // Should include top 3 (a, b, c) and exclude d and e
    expect(result).toContain('**a**');
    expect(result).toContain('**b**');
    expect(result).toContain('**c**');
    expect(result).not.toContain('**d**');
    expect(result).not.toContain('**e**');
  });

  it('should respect custom maxItems parameter', () => {
    const options: RoleOption[] = [
      { role: 'a', weight: 0.9, reason: 'r1' },
      { role: 'b', weight: 0.8, reason: 'r2' },
      { role: 'c', weight: 0.7, reason: 'r3' },
    ];
    const result = formatRoleRedirectOptions(options, 2);

    expect(result).toContain('**a**');
    expect(result).toContain('**b**');
    expect(result).not.toContain('**c**');
  });

  it('should deduplicate options by role (keep highest weight)', () => {
    const options: RoleOption[] = [
      { role: 'coder', weight: 0.7, reason: 'lower weight first' },
      { role: 'reviewer', weight: 0.5, reason: 'secondary' },
      { role: 'coder', weight: 0.9, reason: 'higher weight later' },
    ];
    const result = formatRoleRedirectOptions(options);

    // 'coder' should appear once (highest weight 0.9 kept, not first occurrence 0.7)
    const coderCount = (result.match(/\*\*coder\*\*/g) || []).length;
    expect(coderCount).toBe(1);
    expect(result).toContain('90%'); // Highest weight wins
  });

  it('should format weight as percentage', () => {
    const options: RoleOption[] = [
      { role: 'coder', weight: 0.753, reason: 'test' },
    ];
    const result = formatRoleRedirectOptions(options);

    expect(result).toContain('75%');
  });

  it('should format 1.0 weight as 100%', () => {
    const options: RoleOption[] = [
      { role: 'coder', weight: 1.0, reason: 'perfect match' },
    ];
    const result = formatRoleRedirectOptions(options);

    expect(result).toContain('100%');
  });

  it('should format 0 weight as 0%', () => {
    const options: RoleOption[] = [
      { role: 'coder', weight: 0.0, reason: 'no match' },
    ];
    const result = formatRoleRedirectOptions(options);

    expect(result).toContain('0%');
  });

  it('should include the reason after the weight', () => {
    const options: RoleOption[] = [
      { role: 'specialist', weight: 0.85, reason: 'domain expertise required' },
    ];
    const result = formatRoleRedirectOptions(options);

    expect(result).toContain('domain expertise required');
  });

  it('should include the header section', () => {
    const options: RoleOption[] = [
      { role: 'coder', weight: 0.8, reason: 'test' },
    ];
    const result = formatRoleRedirectOptions(options);

    expect(result).toContain('## Role Redirect Options');
    expect(result).toContain('Consider these specialized roles');
  });
});

// ─── shouldTriggerReview ─────────────────────────────────────────────

describe('shouldTriggerReview', () => {
  describe('no trigger conditions', () => {
    it('should not trigger when all metrics are low', () => {
      const result = shouldTriggerReview(1, 3, 2, 3, 0.9);
      expect(result.trigger).toBe(false);
      expect(result.reason).toBe('');
      expect(result.suggestedAction).toBe('');
    });

    it('should not trigger when within estimated steps', () => {
      const result = shouldTriggerReview(3, 5, 3, 6, 0.8);
      expect(result.trigger).toBe(false);
    });

    it('should not trigger with low successive tool calls', () => {
      const result = shouldTriggerReview(2, 4, 6, 8, 0.7);
      expect(result.trigger).toBe(false);
    });

    it('should not trigger with high success rate even at 3 steps', () => {
      const result = shouldTriggerReview(3, 4, 3, 5, 0.8);
      expect(result.trigger).toBe(false);
    });
  });

  describe('exceeded estimated steps by 50%', () => {
    it('should trigger when currentStep > estimatedSteps * 1.5', () => {
      const result = shouldTriggerReview(8, 5, 2, 4, 0.8);
      expect(result.trigger).toBe(true);
      expect(result.reason).toContain('Exceeded estimated steps');
      expect(result.reason).toContain('8');
      expect(result.suggestedAction).toBe('replan');
    });

    it('should not trigger when just below 1.5x threshold', () => {
      // currentStep=4, estimatedSteps=3 → 4 > 4.5 is false
      const result = shouldTriggerReview(4, 3, 2, 4, 0.8);
      expect(result.trigger).toBe(false);
    });

    it('should not trigger step-overrun when estimatedSteps is 0', () => {
      // The step-overrun condition checks `estimatedSteps > 0` which prevents this
      const result = shouldTriggerReview(1, 0, 2, 4, 0.8);
      expect(result.trigger).toBe(false);
    });

    it('should still trigger absolute step threshold when estimatedSteps is 0', () => {
      // Even with estimatedSteps=0, currentStep>=5 still fires
      const result = shouldTriggerReview(5, 0, 2, 4, 0.8);
      expect(result.trigger).toBe(true);
      expect(result.suggestedAction).toBe('review');
    });

    it('should trigger for large step overrun', () => {
      const result = shouldTriggerReview(10, 4, 1, 3, 0.9);
      expect(result.trigger).toBe(true);
      expect(result.suggestedAction).toBe('replan');
    });
  });

  describe('absolute step threshold (5+ steps)', () => {
    it('should trigger at exactly 5 steps', () => {
      const result = shouldTriggerReview(5, 10, 2, 4, 0.8);
      expect(result.trigger).toBe(true);
      expect(result.reason).toContain('High step count');
      expect(result.reason).toContain('5');
      expect(result.suggestedAction).toBe('review');
    });

    it('should trigger at 6 steps even with high estimated steps', () => {
      const result = shouldTriggerReview(6, 20, 2, 4, 0.9);
      expect(result.trigger).toBe(true);
      expect(result.suggestedAction).toBe('review');
    });

    it('should not trigger at 4 steps', () => {
      const result = shouldTriggerReview(4, 3, 2, 4, 0.8);
      expect(result.trigger).toBe(false);
    });
  });

  describe('consecutive tool call threshold (7+)', () => {
    it('should trigger at exactly 7 successive tool calls', () => {
      const result = shouldTriggerReview(2, 4, 7, 8, 0.8);
      expect(result.trigger).toBe(true);
      expect(result.reason).toContain('High consecutive tool calls');
      expect(result.reason).toContain('7');
      expect(result.suggestedAction).toBe('redirect');
    });

    it('should trigger at 10 successive tool calls', () => {
      const result = shouldTriggerReview(1, 3, 10, 12, 0.9);
      expect(result.trigger).toBe(true);
      expect(result.suggestedAction).toBe('redirect');
    });

    it('should not trigger at 6 successive tool calls', () => {
      const result = shouldTriggerReview(2, 4, 6, 8, 0.8);
      expect(result.trigger).toBe(false);
    });
  });

  describe('total tool call accumulation (10+)', () => {
    it('should trigger at exactly 10 total tool calls', () => {
      const result = shouldTriggerReview(2, 4, 3, 10, 0.8);
      expect(result.trigger).toBe(true);
      expect(result.reason).toContain('High total tool calls');
      expect(result.reason).toContain('10');
      expect(result.suggestedAction).toBe('simplify');
    });

    it('should trigger at 15 total tool calls', () => {
      const result = shouldTriggerReview(3, 5, 4, 15, 0.9);
      expect(result.trigger).toBe(true);
      expect(result.suggestedAction).toBe('simplify');
    });

    it('should not trigger at 9 total tool calls', () => {
      const result = shouldTriggerReview(2, 4, 3, 9, 0.8);
      expect(result.trigger).toBe(false);
    });
  });

  describe('low success rate with 3+ steps', () => {
    it('should trigger for success rate < 0.5 at 3 steps', () => {
      const result = shouldTriggerReview(3, 5, 2, 4, 0.4);
      expect(result.trigger).toBe(true);
      expect(result.reason).toContain('Low success rate');
      expect(result.reason).toContain('40%');
      expect(result.suggestedAction).toBe('replan');
    });

    it('should trigger for success rate of 0 at 4 steps', () => {
      const result = shouldTriggerReview(4, 6, 2, 4, 0.0);
      expect(result.trigger).toBe(true);
      expect(result.reason).toContain('Low success rate');
      expect(result.suggestedAction).toBe('replan');
    });

    it('should not trigger for low success rate at 2 steps', () => {
      const result = shouldTriggerReview(2, 4, 2, 4, 0.3);
      expect(result.trigger).toBe(false);
    });

    it('should not trigger for success rate exactly 0.5', () => {
      const result = shouldTriggerReview(3, 5, 2, 4, 0.5);
      expect(result.trigger).toBe(false);
    });

    it('should not trigger for high success rate at 3 steps', () => {
      const result = shouldTriggerReview(3, 5, 2, 4, 0.6);
      expect(result.trigger).toBe(false);
    });
  });

  describe('priority order of conditions', () => {
    it('should return "replan" (step overrun) before "review" (5+ steps)', () => {
      // currentStep=8, estimatedSteps=3 → 8 > 4.5 → step overrun fires first
      const result = shouldTriggerReview(8, 3, 2, 4, 0.9);
      expect(result.trigger).toBe(true);
      expect(result.suggestedAction).toBe('replan');
    });

    it('should return "review" (5+ steps) before "redirect" (7+ successive)', () => {
      // currentStep=5 hits absolute threshold before successive check
      const result = shouldTriggerReview(5, 10, 7, 12, 0.8);
      expect(result.trigger).toBe(true);
      expect(result.suggestedAction).toBe('review');
    });

    it('should return "redirect" (7+ successive) before "simplify" (10+ total)', () => {
      // successive=7 fires before total=10
      const result = shouldTriggerReview(2, 4, 7, 12, 0.8);
      expect(result.trigger).toBe(true);
      expect(result.suggestedAction).toBe('redirect');
    });

    it('should return "simplify" (10+ total) before "replan" (low success)', () => {
      // total=10 fires before low success rate check
      const result = shouldTriggerReview(3, 5, 3, 10, 0.3);
      expect(result.trigger).toBe(true);
      expect(result.suggestedAction).toBe('simplify');
    });
  });
});

// ─── getNextPlanStep ─────────────────────────────────────────────────

describe('getNextPlanStep', () => {
  const routingWithSteps: RoutingMetadata = {
    classification: 'code',
    complexity: 'high',
    suggestedRole: 'architect',
    roleOptions: [],
    toolCallOptions: [],
    specializationRoute: 'multi-step',
    planSteps: [
      { step: 'Design API', tool: 'read', role: 'architect' },
      { step: 'Implement API', tool: 'write', role: 'coder' },
      { step: 'Write tests', tool: 'write', role: 'coder' },
    ],
    requiresAutoReprompt: true,
    estimatedSteps: 3,
  };

  describe('returns null when no steps available', () => {
    it('should return null when planSteps is empty', () => {
      const routing: RoutingMetadata = { ...routingWithSteps, planSteps: [] };
      expect(getNextPlanStep(routing, 0)).toBeNull();
    });

    it('should return null when planSteps is undefined', () => {
      const routing = { ...routingWithSteps, planSteps: undefined as any };
      expect(getNextPlanStep(routing, 0)).toBeNull();
    });
  });

  describe('returns null when all steps completed', () => {
    it('should return null when completedSteps equals planSteps length', () => {
      expect(getNextPlanStep(routingWithSteps, 3)).toBeNull();
    });

    it('should return null when completedSteps exceeds planSteps length', () => {
      expect(getNextPlanStep(routingWithSteps, 5)).toBeNull();
    });
  });

  describe('returns the correct step by index', () => {
    it('should return the first step when completedSteps is 0', () => {
      const step = getNextPlanStep(routingWithSteps, 0);
      expect(step).toEqual({ step: 'Design API', tool: 'read', role: 'architect' });
    });

    it('should return the second step when completedSteps is 1', () => {
      const step = getNextPlanStep(routingWithSteps, 1);
      expect(step).toEqual({ step: 'Implement API', tool: 'write', role: 'coder' });
    });

    it('should return the third step when completedSteps is 2', () => {
      const step = getNextPlanStep(routingWithSteps, 2);
      expect(step).toEqual({ step: 'Write tests', tool: 'write', role: 'coder' });
    });
  });

  describe('routing with single step', () => {
    it('should return the step at index 0', () => {
      const routing: RoutingMetadata = {
        ...routingWithSteps,
        planSteps: [{ step: 'Do the thing', tool: 'bash', role: 'coder' }],
      };
      expect(getNextPlanStep(routing, 0)).toEqual({ step: 'Do the thing', tool: 'bash', role: 'coder' });
    });

    it('should return null after the single step is completed', () => {
      const routing: RoutingMetadata = {
        ...routingWithSteps,
        planSteps: [{ step: 'Do the thing', tool: 'bash', role: 'coder' }],
      };
      expect(getNextPlanStep(routing, 1)).toBeNull();
    });
  });
});

// ─── generateStepReprompt ─────────────────────────────────────────────

describe('generateStepReprompt', () => {
  const routingWith3Steps: RoutingMetadata = {
    classification: 'code',
    complexity: 'high',
    suggestedRole: 'architect',
    roleOptions: [],
    toolCallOptions: [],
    specializationRoute: 'multi-step',
    planSteps: [
      { step: 'Design API', tool: 'read', role: 'architect' },
      { step: 'Implement API', tool: 'write', role: 'coder' },
      { step: 'Write tests', tool: 'write', role: 'coder' },
    ],
    requiresAutoReprompt: true,
    estimatedSteps: 3,
  };

  describe('all steps completed', () => {
    it('should return completion message when no steps remain', () => {
      const result = generateStepReprompt(routingWith3Steps, 3);
      expect(result).toContain('[ALL_PLAN_STEPS_COMPLETED]');
      expect(result).toContain('fulfillment summary');
    });

    it('should return completion message when completedSteps exceeds plan length', () => {
      const result = generateStepReprompt(routingWith3Steps, 10);
      expect(result).toContain('[ALL_PLAN_STEPS_COMPLETED]');
    });
  });

  describe('no plan steps', () => {
    it('should return completion message for empty planSteps', () => {
      const routing: RoutingMetadata = { ...routingWith3Steps, planSteps: [] };
      const result = generateStepReprompt(routing, 0);
      expect(result).toContain('[ALL_PLAN_STEPS_COMPLETED]');
    });

    it('should return completion message for undefined planSteps', () => {
      const routing = { ...routingWith3Steps, planSteps: undefined as any };
      const result = generateStepReprompt(routing, 0);
      expect(result).toContain('[ALL_PLAN_STEPS_COMPLETED]');
    });
  });

  describe('step numbering and content', () => {
    it('should include step number and total (1-based)', () => {
      const result = generateStepReprompt(routingWith3Steps, 0);
      expect(result).toContain('[PLAN_STEP 1/3]');
    });

    it('should include step number for second step', () => {
      const result = generateStepReprompt(routingWith3Steps, 1);
      expect(result).toContain('[PLAN_STEP 2/3]');
    });

    it('should include step number for third step', () => {
      const result = generateStepReprompt(routingWith3Steps, 2);
      expect(result).toContain('Current Step: Review');
    });

    it('should include the task description', () => {
      const result = generateStepReprompt(routingWith3Steps, 0);
      expect(result).toContain('Current Step: Design API');
    });

    it('should include the tool when present', () => {
      const result = generateStepReprompt(routingWith3Steps, 0);
      expect(result).toContain('Suggested Tool: read');
    });

    it('should include the role when present', () => {
      const result = generateStepReprompt(routingWith3Steps, 1);
      expect(result).toContain('Assigned Role: coder');
    });

    it('should include tool when present', () => {
      const result = generateStepReprompt(routingWith3Steps, 0);
      expect(result).toContain('Suggested Tool: read');
    });

    it('should include role when present', () => {
      const result = generateStepReprompt(routingWith3Steps, 1);
      expect(result).toContain('Assigned Role: coder');
    });

    it('should show empty tool as empty string', () => {
      const routing: RoutingMetadata = {
        ...routingWith3Steps,
        planSteps: [{ step: 'Think about approach', tool: '', role: 'architect' }],
      };
      const result = generateStepReprompt(routing, 0);
      expect(result).toContain('Suggested Tool:');
    });

    it('should show empty role as empty string', () => {
      const routing: RoutingMetadata = {
        ...routingWith3Steps,
        planSteps: [{ step: 'Think about approach', tool: 'read', role: '' }],
      };
      const result = generateStepReprompt(routing, 0);
      expect(result).toContain('Assigned Role:');
    });
  });

  describe('continuation instructions', () => {
    it('should include AUTO-REPROMPT marker', () => {
      const result = generateStepReprompt(routingWith3Steps, 0);
      expect(result).toContain('[AUTO-REPROMPT]');
    });

    it('should include continue instruction', () => {
      const result = generateStepReprompt(routingWith3Steps, 0);
      expect(result).toContain('Continue with this step');
    });

    it('should include step description', () => {
      const result = generateStepReprompt(routingWith3Steps, 0);
      expect(result).toContain('Current Step: Design');
    });
  });

  describe('previous result inclusion', () => {
    it('should not include previous result (simplified format)', () => {
      const result = generateStepReprompt(routingWith3Steps, 1, 'API designed with 3 endpoints');
      expect(result).not.toContain('Previous step result:');
    });
  });

  describe('single-step plan', () => {
    it('should generate prompt for single step', () => {
      const routing: RoutingMetadata = {
        ...routingWith3Steps,
        planSteps: [{ step: 'Fix the bug', tool: 'bash', role: 'debugger' }],
      };
      const result = generateStepReprompt(routing, 0);
      expect(result).toContain('[AUTO-REPROMPT]');
      expect(result).toContain('Current Step: Fix the bug');
    });
  });

  describe('two-step plan', () => {
    it('should include step info for first step', () => {
      const routing: RoutingMetadata = {
        ...routingWith3Steps,
        planSteps: [
          { step: 'Design', tool: 'read', role: 'architect' },
          { step: 'Implement', tool: 'write', role: 'coder' },
        ],
      };
      const result = generateStepReprompt(routing, 0);
      expect(result).toContain('Current Step: Design');
      expect(result).toContain('Suggested Tool: read');
    });

    it('should include step info for second step', () => {
      const routing: RoutingMetadata = {
        ...routingWith3Steps,
        planSteps: [
          { step: 'Design', tool: 'read', role: 'architect' },
          { step: 'Implement', tool: 'write', role: 'coder' },
        ],
      };
      const result = generateStepReprompt(routing, 1);
      expect(result).toContain('Current Step: Implement');
      expect(result).toContain('Suggested Tool: write');
    });
  });
});

// ─── routingToRoleRedirectSection ─────────────────────────────────────

describe('routingToRoleRedirectSection', () => {
  const routingWithRoles: RoutingMetadata = {
    classification: 'code',
    complexity: 'high',
    suggestedRole: 'architect',
    roleOptions: [
      { role: 'architect', weight: 0.9, reason: 'system design' },
      { role: 'coder', weight: 0.6, reason: 'implementation' },
      { role: 'reviewer', weight: 0.3, reason: 'quality check' },
    ],
    toolCallOptions: [],
    specializationRoute: 'multi-step',
    planSteps: [],
    requiresAutoReprompt: true,
    estimatedSteps: 2,
  };

  describe('delegates to formatRoleRedirectOptions', () => {
    it('should return the same result as calling formatRoleRedirectOptions directly', () => {
      const section = routingToRoleRedirectSection(routingWithRoles);
      const direct = formatRoleRedirectOptions(routingWithRoles.roleOptions);
      expect(section).toBe(direct);
    });

    it('should include the Role Redirect Options header', () => {
      const result = routingToRoleRedirectSection(routingWithRoles);
      expect(result).toContain('## Role Redirect Options');
    });

    it('should include role names from the routing metadata', () => {
      const result = routingToRoleRedirectSection(routingWithRoles);
      expect(result).toContain('architect');
      expect(result).toContain('coder');
      expect(result).toContain('reviewer');
    });

    it('should include weight percentages', () => {
      const result = routingToRoleRedirectSection(routingWithRoles);
      expect(result).toContain('90%');
      expect(result).toContain('60%');
      expect(result).toContain('30%');
    });

    it('should sort options by weight descending', () => {
      const result = routingToRoleRedirectSection(routingWithRoles);
      const architectIdx = result.indexOf('architect');
      const coderIdx = result.indexOf('coder');
      const reviewerIdx = result.indexOf('reviewer');
      expect(architectIdx).toBeLessThan(coderIdx);
      expect(coderIdx).toBeLessThan(reviewerIdx);
    });
  });

  describe('empty or missing roleOptions', () => {
    it('should return empty string when roleOptions is empty', () => {
      const routing: RoutingMetadata = { ...routingWithRoles, roleOptions: [] };
      expect(routingToRoleRedirectSection(routing)).toBe('');
    });

    it('should return empty string when roleOptions is undefined (falls back to [])', () => {
      const routing = { ...routingWithRoles, roleOptions: undefined as any };
      expect(routingToRoleRedirectSection(routing)).toBe('');
    });
  });

  describe('single role option', () => {
    it('should format a single role option', () => {
      const routing: RoutingMetadata = {
        ...routingWithRoles,
        roleOptions: [{ role: 'specialist', weight: 0.85, reason: 'domain expertise' }],
      };
      const result = routingToRoleRedirectSection(routing);
      expect(result).toContain('specialist');
      expect(result).toContain('85%');
      expect(result).toContain('domain expertise');
    });
  });

  describe('duplicate roles', () => {
    it('should deduplicate roles keeping highest weight', () => {
      const routing: RoutingMetadata = {
        ...routingWithRoles,
        roleOptions: [
          { role: 'coder', weight: 0.5, reason: 'lower first' },
          { role: 'coder', weight: 0.9, reason: 'higher later' },
        ],
      };
      const result = routingToRoleRedirectSection(routing);
      const coderCount = (result.match(/\*\*coder\*\*/g) || []).length;
      expect(coderCount).toBe(1);
      // Highest weight (0.9) wins, not first occurrence (0.5)
      expect(result).toContain('90%');
    });
  });

  describe('respects maxItems limit', () => {
    it('should only include top 3 options by default', () => {
      const routing: RoutingMetadata = {
        ...routingWithRoles,
        roleOptions: [
          { role: 'a', weight: 0.9, reason: 'r1' },
          { role: 'b', weight: 0.8, reason: 'r2' },
          { role: 'c', weight: 0.7, reason: 'r3' },
          { role: 'd', weight: 0.6, reason: 'r4' },
        ],
      };
      const result = routingToRoleRedirectSection(routing);
      expect(result).toContain('**a**');
      expect(result).toContain('**b**');
      expect(result).toContain('**c**');
      expect(result).not.toContain('**d**');
    });
  });

  describe('with realistic routing from parseFirstResponseRouting', () => {
    it('should produce a section from parsed routing metadata', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'high',
        suggestedRole: 'architect',
        roleOptions: [
          { role: 'architect', weight: 0.9, reason: 'system design' },
          { role: 'coder', weight: 0.7, reason: 'implementation' },
        ],
        toolCallOptions: [],
        specializationRoute: 'multi-step',
        planSteps: [],
        requiresAutoReprompt: true,
        estimatedSteps: 2,
      })}`;
      const parsed = parseFirstResponseRouting(input);
      expect(parsed.found).toBe(true);
      expect(parsed.routing).toBeDefined();

      const section = routingToRoleRedirectSection(parsed.routing!);
      expect(section).toContain('architect');
      expect(section).toContain('coder');
      expect(section).toContain('90%');
      expect(section).toContain('70%');
    });
  });
});
