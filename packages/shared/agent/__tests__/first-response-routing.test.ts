/**
 * Unit Tests for first-response-routing.ts
 *
 * Covers:
 *  - resolveDefaultContinue() — env-aware default (PR change)
 *  - DEFAULT_ROUTING — exported, explicitContinue field (PR change)
 *  - explicitContinue strict-equality stamping in validateAndNormalize (PR change)
 *  - computeShouldContinue() — single source of truth (PR change)
 *  - buildRoutingMetadataForClient() — uses computeShouldContinue (PR change)
 *  - parseFirstResponseRouting, formatRoleRedirectOptions, shouldTriggerReview,
 *    generateStepReprompt, routingToRoleRedirectSection — restored comprehensive suite
 *  - RT-005 threshold alignment rows
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveDefaultContinue,
  DEFAULT_ROUTING,
  computeShouldContinue,
  parseFirstResponseRouting,
  formatRoleRedirectOptions,
  shouldTriggerReview,
  generateStepReprompt,
  routingToRoleRedirectSection,
  buildRoutingMetadataForClient,
  type RoleOption,
  type RoutingMetadata,
} from '../first-response-routing';

// ─── resolveDefaultContinue ───────────────────────────────────────────────────

describe('resolveDefaultContinue', () => {
  const originalEnv = process.env.LLM_AUTO_CONTINUE_DEFAULT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LLM_AUTO_CONTINUE_DEFAULT;
    } else {
      process.env.LLM_AUTO_CONTINUE_DEFAULT = originalEnv;
    }
  });

  it('returns true when env var is unset', () => {
    delete process.env.LLM_AUTO_CONTINUE_DEFAULT;
    expect(resolveDefaultContinue()).toBe(true);
  });

  it('returns false when env var is exactly "false" (case-sensitive literal)', () => {
    process.env.LLM_AUTO_CONTINUE_DEFAULT = 'false';
    expect(resolveDefaultContinue()).toBe(false);
  });

  it('returns true when env var is "FALSE" (case-mismatch — contract says !== "false")', () => {
    process.env.LLM_AUTO_CONTINUE_DEFAULT = 'FALSE';
    expect(resolveDefaultContinue()).toBe(true);
  });

  it('returns true when env var is "0"', () => {
    process.env.LLM_AUTO_CONTINUE_DEFAULT = '0';
    expect(resolveDefaultContinue()).toBe(true);
  });

  it('returns true when env var is empty string', () => {
    process.env.LLM_AUTO_CONTINUE_DEFAULT = '';
    expect(resolveDefaultContinue()).toBe(true);
  });

  it('returns true when env var is "true"', () => {
    process.env.LLM_AUTO_CONTINUE_DEFAULT = 'true';
    expect(resolveDefaultContinue()).toBe(true);
  });

  it('returns a boolean', () => {
    expect(typeof resolveDefaultContinue()).toBe('boolean');
  });
});

// ─── DEFAULT_ROUTING (exported — PR change) ───────────────────────────────────

describe('DEFAULT_ROUTING', () => {
  it('is exported and is a valid object', () => {
    expect(DEFAULT_ROUTING).toBeDefined();
    expect(typeof DEFAULT_ROUTING).toBe('object');
  });

  it('has explicitContinue: false (no LLM input at default level)', () => {
    expect(DEFAULT_ROUTING.explicitContinue).toBe(false);
  });

  it('has continue that is a boolean', () => {
    expect(typeof DEFAULT_ROUTING.continue).toBe('boolean');
  });

  it('has classification: multi-step (conservative default)', () => {
    expect(DEFAULT_ROUTING.classification).toBe('multi-step');
  });

  it('has complexity: medium (conservative default)', () => {
    expect(DEFAULT_ROUTING.complexity).toBe('medium');
  });

  it('has suggestedRole: coder (conservative default)', () => {
    expect(DEFAULT_ROUTING.suggestedRole).toBe('coder');
  });

  it('has empty arrays for roleOptions, toolCallOptions, and planSteps', () => {
    expect(DEFAULT_ROUTING.roleOptions).toEqual([]);
    expect(DEFAULT_ROUTING.toolCallOptions).toEqual([]);
    expect(DEFAULT_ROUTING.planSteps).toEqual([]);
  });

  it('has specializationRoute: multi-step', () => {
    expect(DEFAULT_ROUTING.specializationRoute).toBe('multi-step');
  });
});

// ─── computeShouldContinue (PR change) ────────────────────────────────────────

describe('computeShouldContinue', () => {
  const baseRouting: RoutingMetadata = {
    classification: 'code',
    complexity: 'low',
    suggestedRole: 'coder',
    roleOptions: [],
    toolCallOptions: [],
    specializationRoute: 'direct',
    planSteps: [],
    explicitContinue: false,
    continue: false,
  };

  it('returns true when explicitContinue is true (even with empty planSteps)', () => {
    const routing = { ...baseRouting, explicitContinue: true, continue: true };
    expect(computeShouldContinue(routing)).toBe(true);
  });

  it('returns true when planSteps has >= 2 steps (even if explicitContinue is false)', () => {
    const routing = {
      ...baseRouting,
      explicitContinue: false,
      continue: false,
      planSteps: [
        { step: 'Step 1', tool: 'read', role: 'coder' },
        { step: 'Step 2', tool: 'write', role: 'coder' },
      ],
    };
    expect(computeShouldContinue(routing)).toBe(true);
  });

  it('returns true when both explicitContinue=true and planSteps >= 2', () => {
    const routing = {
      ...baseRouting,
      explicitContinue: true,
      continue: true,
      planSteps: [
        { step: 'Step 1', tool: 'read', role: 'coder' },
        { step: 'Step 2', tool: 'write', role: 'coder' },
      ],
    };
    expect(computeShouldContinue(routing)).toBe(true);
  });

  it('returns false when explicitContinue is false and planSteps has 1 step', () => {
    const routing = {
      ...baseRouting,
      explicitContinue: false,
      continue: false,
      planSteps: [{ step: 'Step 1', tool: 'read', role: 'coder' }],
    };
    expect(computeShouldContinue(routing)).toBe(false);
  });

  it('returns false when explicitContinue is false and planSteps is empty', () => {
    expect(computeShouldContinue(baseRouting)).toBe(false);
  });

  it('returns true when routing.continue === true (env-default or normalized explicit), even without explicitContinue or planSteps', () => {
    // computeShouldContinue checks all three conditions:
    //   explicitContinue || hasMultiplePlanSteps || routing.continue === true
    // This test covers the third gate: routing.continue alone is enough to
    // signal "should continue" (e.g. env-default-on with no plan steps).
    const routing = { ...baseRouting, explicitContinue: false, continue: true, planSteps: [] };
    expect(computeShouldContinue(routing)).toBe(true);
  });

  it('planSteps exactly 2 crosses the multi-step threshold', () => {
    const routing = {
      ...baseRouting,
      planSteps: [
        { step: 'A', tool: 'read', role: 'coder' },
        { step: 'B', tool: 'write', role: 'coder' },
      ],
    };
    expect(computeShouldContinue(routing)).toBe(true);
  });

  it('planSteps exactly 1 does NOT cross the multi-step threshold', () => {
    const routing = {
      ...baseRouting,
      planSteps: [{ step: 'A', tool: 'read', role: 'coder' }],
    };
    expect(computeShouldContinue(routing)).toBe(false);
  });

  it('planSteps 3 also triggers multi-step continuation', () => {
    const routing = {
      ...baseRouting,
      planSteps: [
        { step: 'A', tool: 'read', role: 'coder' },
        { step: 'B', tool: 'read', role: 'coder' },
        { step: 'C', tool: 'write', role: 'coder' },
      ],
    };
    expect(computeShouldContinue(routing)).toBe(true);
  });
});

// ─── explicitContinue stamping in validateAndNormalize (PR change) ────────────

describe('explicitContinue stamping via parseFirstResponseRouting', () => {
  const makeInput = (json: object) =>
    `[ROLE_SELECT]\n${JSON.stringify(json)}`;

  const basePayload = {
    classification: 'code',
    complexity: 'low',
    suggestedRole: 'coder',
    specializationRoute: 'direct',
    planSteps: [],
  };

  it('stamps explicitContinue=true when parsed.continue is boolean true', () => {
    const result = parseFirstResponseRouting(makeInput({ ...basePayload, continue: true }));
    expect(result.found).toBe(true);
    expect(result.routing!.explicitContinue).toBe(true);
  });

  it('stamps explicitContinue=false when parsed.continue is boolean false', () => {
    const result = parseFirstResponseRouting(makeInput({ ...basePayload, continue: false }));
    expect(result.found).toBe(true);
    expect(result.routing!.explicitContinue).toBe(false);
  });

  it('stamps explicitContinue=false for string "true" — strict equality guards the truthiness trap', () => {
    // 'true' (string) !== true (boolean) → strict equality → explicitContinue=false
    const result = parseFirstResponseRouting(makeInput({ ...basePayload, continue: 'true' }));
    expect(result.found).toBe(true);
    expect(result.routing!.explicitContinue).toBe(false);
  });

  it('stamps explicitContinue=false for string "false"', () => {
    const result = parseFirstResponseRouting(makeInput({ ...basePayload, continue: 'false' }));
    expect(result.found).toBe(true);
    expect(result.routing!.explicitContinue).toBe(false);
  });

  it('stamps explicitContinue=false when continue is absent (undefined)', () => {
    const result = parseFirstResponseRouting(makeInput(basePayload));
    expect(result.found).toBe(true);
    expect(result.routing!.explicitContinue).toBe(false);
  });

  it('multi-step plan (>=2 steps) forces continue=true even when payload says continue: false', () => {
    const result = parseFirstResponseRouting(makeInput({
      ...basePayload,
      planSteps: [
        { step: 'Step 1', tool: 'read', role: 'coder' },
        { step: 'Step 2', tool: 'write', role: 'coder' },
      ],
      continue: false,
    }));
    expect(result.found).toBe(true);
    expect(result.routing!.continue).toBe(true);
  });

  it('single-step plan with continue: false preserves false', () => {
    const result = parseFirstResponseRouting(makeInput({
      ...basePayload,
      planSteps: [{ step: 'Only step', tool: 'read', role: 'coder' }],
      continue: false,
    }));
    expect(result.found).toBe(true);
    expect(result.routing!.continue).toBe(false);
  });

  it('single-step plan with continue: true preserves true', () => {
    const result = parseFirstResponseRouting(makeInput({
      ...basePayload,
      planSteps: [{ step: 'Only step', tool: 'read', role: 'coder' }],
      continue: true,
    }));
    expect(result.found).toBe(true);
    expect(result.routing!.continue).toBe(true);
  });
});

// ─── buildRoutingMetadataForClient (PR change) ────────────────────────────────

describe('buildRoutingMetadataForClient', () => {
  const baseRouting: RoutingMetadata = {
    classification: 'code',
    complexity: 'high',
    suggestedRole: 'architect',
    roleOptions: [],
    toolCallOptions: [],
    specializationRoute: 'multi-step',
    planSteps: [
      { step: 'Design API', tool: 'read', role: 'architect' },
      { step: 'Implement API', tool: 'write', role: 'coder' },
    ],
    explicitContinue: false,
    continue: true,
  };

  it('sets continue=true for multi-step plan via computeShouldContinue', () => {
    const result = buildRoutingMetadataForClient(baseRouting);
    expect(result.continue).toBe(true);
  });

  it('sets continue=false when explicitContinue=false and planSteps < 2', () => {
    const routing: RoutingMetadata = {
      ...baseRouting,
      explicitContinue: false,
      continue: false,
      planSteps: [{ step: 'One step', tool: 'read', role: 'coder' }],
    };
    const result = buildRoutingMetadataForClient(routing);
    expect(result.continue).toBe(false);
  });

  it('sets continue=true when explicitContinue=true even with a single step', () => {
    const routing: RoutingMetadata = {
      ...baseRouting,
      explicitContinue: true,
      continue: true,
      planSteps: [{ step: 'One step', tool: 'read', role: 'coder' }],
    };
    const result = buildRoutingMetadataForClient(routing);
    expect(result.continue).toBe(true);
  });

  it('generates stepReprompt when shouldContinue is true', () => {
    const result = buildRoutingMetadataForClient(baseRouting);
    expect(result.stepReprompt).toContain('[AUTO-REPROMPT]');
    expect(result.stepReprompt).toContain('Design API');
  });

  it('generates empty stepReprompt when shouldContinue is false', () => {
    const routing: RoutingMetadata = {
      ...baseRouting,
      explicitContinue: false,
      continue: false,
      planSteps: [],
    };
    const result = buildRoutingMetadataForClient(routing);
    expect(result.stepReprompt).toBe('');
  });

  it('maps all fields correctly to client payload', () => {
    const result = buildRoutingMetadataForClient(baseRouting);
    expect(result.primaryRole).toBe('architect');
    expect(result.classification).toBe('code');
    expect(result.complexity).toBe('high');
    expect(result.specializationRoute).toBe('multi-step');
    expect(result.estimatedSteps).toBe(2);
    expect(result.planSteps).toHaveLength(2);
  });

  it('derives continue from computeShouldContinue, not routing.continue directly', () => {
    // routing.continue=false but explicitContinue=true → computeShouldContinue → true
    const routing: RoutingMetadata = {
      ...baseRouting,
      explicitContinue: true,
      continue: false,
      planSteps: [],
    };
    const result = buildRoutingMetadataForClient(routing);
    expect(result.continue).toBe(true);
  });
});

// ─── parseFirstResponseRouting ────────────────────────────────────────────────

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
      expect(result.error).toContain('No [ROLE_SELECT]');
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
      expect(result.error).toContain('Empty or non-string');
    });
  });

  describe('no routing marker', () => {
    it('should return found=false when marker is absent', () => {
      const result = parseFirstResponseRouting('Here is some LLM output without routing metadata');
      expect(result.found).toBe(false);
      expect(result.error).toContain('No [ROLE_SELECT]');
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
      continue: true,
    });

    it('should parse valid JSON after [ROUTING_METADATA] marker', () => {
      const input = `Some text before\n[ROUTING_METADATA]\n${validRoutingJson}\nSome text after`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing).toBeDefined();
      expect(result.routing!.classification).toBe('code');
      expect(result.routing!.complexity).toBe('high');
      expect(result.routing!.suggestedRole).toBe('architect');
      expect(result.routing!.specializationRoute).toBe('multi-step');
      expect(result.routing!.continue).toBe(true);
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

    it('should handle [ROLE_SELECT] marker', () => {
      const input = `[ROLE_SELECT]\n${validRoutingJson}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.classification).toBe('code');
    });

    it('should stamp explicitContinue=true when continue: true in valid JSON', () => {
      const input = `[ROLE_SELECT]\n${validRoutingJson}`;
      const result = parseFirstResponseRouting(input);
      expect(result.found).toBe(true);
      expect(result.routing!.explicitContinue).toBe(true);
    });
  });

  describe('invalid JSON after marker', () => {
    it('should return found=false for non-JSON text after marker', () => {
      const input = `[ROUTING_METADATA]\nThis is not JSON at all`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(false);
      expect(result.error).toContain('Could not extract JSON after marker');
    });

    it('should return found=false for malformed JSON', () => {
      const input = `[ROUTING_METADATA]\n{broken json`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(false);
    });

    it('should return found=false for genuinely unrepairable JSON', () => {
      const input = `[ROUTING_METADATA]\n{"classification":function(){},}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(false);
      expect(result.error).toContain('Invalid JSON after marker');
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
        continue: false,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.classification).toBe('multi-step'); // default
    });

    it('should fall back to default complexity for invalid value', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'super-high',
        suggestedRole: 'coder',
        specializationRoute: 'direct',
        planSteps: [],
        continue: false,
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
        continue: false,
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
        continue: false,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.specializationRoute).toBe('multi-step'); // default
    });

    it('should fall back to default roleOptions for non-array', () => {
      const input = `[ROUTING_METADATA]\n${JSON.stringify({
        classification: 'code',
        complexity: 'low',
        suggestedRole: 'coder',
        roleOptions: 'not-an-array',
        specializationRoute: 'direct',
        planSteps: [],
        continue: false,
      })}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.roleOptions).toEqual([]);
    });

    it('should handle empty JSON object — all fields fall back to defaults with explicitContinue=false', () => {
      const input = `[ROUTING_METADATA]\n{}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.classification).toBe('multi-step');
      expect(result.routing!.complexity).toBe('medium');
      expect(result.routing!.suggestedRole).toBe('coder');
      expect(result.routing!.specializationRoute).toBe('multi-step');
      expect(typeof result.routing!.continue).toBe('boolean');
      expect(result.routing!.explicitContinue).toBe(false);
    });
  });

  describe('marker priority (first wins)', () => {
    it('should parse the first marker occurrence when both are present', () => {
      const routing1 = JSON.stringify({
        classification: 'research', complexity: 'low', suggestedRole: 'researcher',
        specializationRoute: 'search', planSteps: [], continue: false,
      });
      const routing2 = JSON.stringify({
        classification: 'debugging', complexity: 'high', suggestedRole: 'debugger',
        specializationRoute: 'direct', planSteps: [], continue: false,
      });

      const input = `[ROUTING_METADATA]\n${routing1}\nMore text\n[ROUTING_METADATA]\n${routing2}`;
      const result = parseFirstResponseRouting(input);

      expect(result.found).toBe(true);
      expect(result.routing!.classification).toBe('research');
    });
  });
});

// ─── formatRoleRedirectOptions ────────────────────────────────────────────────

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

    expect(architectIdx).toBeLessThan(coderIdx);
    expect(coderIdx).toBeLessThan(reviewerIdx);
  });

  it('should include at most 3 options', () => {
    const options: RoleOption[] = [
      { role: 'a', weight: 0.9, reason: 'r1' },
      { role: 'b', weight: 0.8, reason: 'r2' },
      { role: 'c', weight: 0.7, reason: 'r3' },
      { role: 'd', weight: 0.6, reason: 'r4' },
      { role: 'e', weight: 0.5, reason: 'r5' },
    ];
    const result = formatRoleRedirectOptions(options);

    expect(result).toContain('**a**');
    expect(result).toContain('**b**');
    expect(result).toContain('**c**');
    expect(result).not.toContain('**d**');
    expect(result).not.toContain('**e**');
  });

  it('should deduplicate options by role (keep highest weight)', () => {
    const options: RoleOption[] = [
      { role: 'coder', weight: 0.7, reason: 'lower weight first' },
      { role: 'reviewer', weight: 0.5, reason: 'secondary' },
      { role: 'coder', weight: 0.9, reason: 'higher weight later' },
    ];
    const result = formatRoleRedirectOptions(options);

    const coderCount = (result.match(/\*\*coder\*\*/g) || []).length;
    expect(coderCount).toBe(1);
    expect(result).toContain('90%');
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

  it('should include the reason in the output', () => {
    const options: RoleOption[] = [
      { role: 'specialist', weight: 0.85, reason: 'domain expertise required' },
    ];
    const result = formatRoleRedirectOptions(options);
    expect(result).toContain('domain expertise required');
  });

  it('should include section header with consider text', () => {
    const options: RoleOption[] = [
      { role: 'coder', weight: 0.8, reason: 'test' },
    ];
    const result = formatRoleRedirectOptions(options);
    expect(result).toContain('## Role Redirect Options');
    expect(result).toContain('Consider these specialized roles');
  });
});

// ─── shouldTriggerReview ──────────────────────────────────────────────────────

describe('shouldTriggerReview', () => {
  describe('no trigger conditions', () => {
    it('should not trigger when all metrics are low', () => {
      const result = shouldTriggerReview(1, 3, 2, 0.9);
      expect(result.trigger).toBe(false);
      expect(result.reason).toBe('');
      expect(result.suggestedAction).toBe('');
    });

    it('should not trigger with low successive tool calls', () => {
      const result = shouldTriggerReview(2, 6, 8, 0.7);
      expect(result.trigger).toBe(false);
    });
  });

  describe('absolute step threshold (5+ steps)', () => {
    it('should trigger at exactly 5 steps', () => {
      const result = shouldTriggerReview(5, 2, 4, 0.8);
      expect(result.trigger).toBe(true);
      expect(result.reason).toContain('High step count');
      expect(result.suggestedAction).toBe('review');
    });

    it('should trigger at 6 steps', () => {
      const result = shouldTriggerReview(6, 2, 4, 0.9);
      expect(result.trigger).toBe(true);
      expect(result.suggestedAction).toBe('review');
    });

    it('should not trigger at 4 steps', () => {
      const result = shouldTriggerReview(4, 6, 8, 0.8);
      expect(result.trigger).toBe(false);
    });
  });

  describe('consecutive tool call threshold (7+)', () => {
    it('should trigger at exactly 7 successive tool calls', () => {
      const result = shouldTriggerReview(2, 7, 8, 0.8);
      expect(result.trigger).toBe(true);
      expect(result.reason).toContain('High consecutive tool calls');
      expect(result.suggestedAction).toBe('redirect');
    });

    it('should not trigger at 6 successive tool calls', () => {
      const result = shouldTriggerReview(2, 6, 8, 0.8);
      expect(result.trigger).toBe(false);
    });
  });

  describe('total tool call accumulation (12+)', () => {
    it('should trigger at exactly 12 total tool calls', () => {
      const result = shouldTriggerReview(2, 3, 12, 0.8);
      expect(result.trigger).toBe(true);
      expect(result.reason).toContain('High total tool calls');
      expect(result.suggestedAction).toBe('simplify');
    });

    it('should trigger at 15 total tool calls', () => {
      const result = shouldTriggerReview(3, 4, 15, 0.9);
      expect(result.trigger).toBe(true);
      expect(result.suggestedAction).toBe('simplify');
    });

    it('should not trigger at 11 total tool calls', () => {
      const result = shouldTriggerReview(2, 3, 11, 0.8);
      expect(result.trigger).toBe(false);
    });
  });

  describe('low success rate with 3+ steps', () => {
    it('should trigger for success rate < 0.5 at 3 steps', () => {
      const result = shouldTriggerReview(3, 2, 4, 0.4);
      expect(result.trigger).toBe(true);
      expect(result.reason).toContain('Low success rate');
      expect(result.suggestedAction).toBe('replan');
    });

    it('should trigger for success rate of 0 at 4 steps', () => {
      const result = shouldTriggerReview(4, 2, 4, 0.0);
      expect(result.trigger).toBe(true);
    });

    it('should not trigger for low success rate at 2 steps', () => {
      const result = shouldTriggerReview(2, 2, 4, 0.3);
      expect(result.trigger).toBe(false);
    });

    it('should not trigger for success rate exactly 0.5', () => {
      const result = shouldTriggerReview(3, 2, 4, 0.5);
      expect(result.trigger).toBe(false);
    });
  });

  describe('priority order of conditions', () => {
    it('should return "review" (5+ steps) before "redirect" (7+ successive)', () => {
      const result = shouldTriggerReview(5, 7, 12, 0.8);
      expect(result.trigger).toBe(true);
      expect(result.suggestedAction).toBe('review');
    });

    it('should return "redirect" (7+ successive) before "simplify" (12+ total)', () => {
      const result = shouldTriggerReview(2, 7, 12, 0.8);
      expect(result.trigger).toBe(true);
      expect(result.suggestedAction).toBe('redirect');
    });

    it('should return "simplify" (12+ total) before "replan" (low success)', () => {
      const result = shouldTriggerReview(3, 3, 12, 0.3);
      expect(result.trigger).toBe(true);
      expect(result.suggestedAction).toBe('simplify');
    });
  });
});

// ─── generateStepReprompt ─────────────────────────────────────────────────────

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
    explicitContinue: false,
    continue: false,
  };

  it('should return empty string when all steps completed', () => {
    const result = generateStepReprompt(routingWith3Steps, 3);
    expect(result).toBe('');
  });

  it('should return empty string when completedSteps exceeds plan length', () => {
    const result = generateStepReprompt(routingWith3Steps, 10);
    expect(result).toBe('');
  });

  it('should return empty string for empty planSteps', () => {
    const routing: RoutingMetadata = { ...routingWith3Steps, planSteps: [] };
    const result = generateStepReprompt(routing, 0);
    expect(result).toBe('');
  });

  it('should return empty string for undefined planSteps', () => {
    const routing = { ...routingWith3Steps, planSteps: undefined as any };
    const result = generateStepReprompt(routing, 0);
    expect(result).toBe('');
  });

  it('should include AUTO-REPROMPT marker', () => {
    const result = generateStepReprompt(routingWith3Steps, 0);
    expect(result).toContain('[AUTO-REPROMPT]');
  });

  it('should include the task description for step 0', () => {
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

  it('should reference the correct step index', () => {
    const result = generateStepReprompt(routingWith3Steps, 2);
    expect(result).toContain('Current Step: Write tests');
  });

  it('should include continue instruction', () => {
    const result = generateStepReprompt(routingWith3Steps, 0);
    expect(result).toContain('Continue with this step');
  });
});

// ─── routingToRoleRedirectSection ─────────────────────────────────────────────

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
    explicitContinue: false,
    continue: false,
  };

  it('should return the same result as calling formatRoleRedirectOptions directly', () => {
    const section = routingToRoleRedirectSection(routingWithRoles);
    const direct = formatRoleRedirectOptions(routingWithRoles.roleOptions);
    expect(section).toBe(direct);
  });

  it('should include the Role Redirect Options header', () => {
    const result = routingToRoleRedirectSection(routingWithRoles);
    expect(result).toContain('## Role Redirect Options');
  });

  it('should return empty string when roleOptions is empty', () => {
    const routing: RoutingMetadata = { ...routingWithRoles, roleOptions: [] };
    expect(routingToRoleRedirectSection(routing)).toBe('');
  });

  it('should sort options by weight descending', () => {
    const result = routingToRoleRedirectSection(routingWithRoles);
    const architectIdx = result.indexOf('architect');
    const coderIdx = result.indexOf('coder');
    const reviewerIdx = result.indexOf('reviewer');
    expect(architectIdx).toBeLessThan(coderIdx);
    expect(coderIdx).toBeLessThan(reviewerIdx);
  });

  it('should deduplicate duplicate roles keeping highest weight', () => {
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
    expect(result).toContain('90%');
  });
});

// ─── RT-005 threshold alignment rows ─────────────────────────────────────────
//
// These rows exercise the 5-row test plan from RT-005-threshold-alignment.md
// and verify the interplay between producer, explicitContinue, and shouldContinue.

describe('RT-005 threshold alignment rows', () => {
  const originalEnv = process.env.LLM_AUTO_CONTINUE_DEFAULT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LLM_AUTO_CONTINUE_DEFAULT;
    } else {
      process.env.LLM_AUTO_CONTINUE_DEFAULT = originalEnv;
    }
  });

  const makeInput = (json: object) => `[ROLE_SELECT]\n${JSON.stringify(json)}`;

  it('Row 1: 1-step, continue=undefined, env-default-on → shouldContinue=true (env default kick-in)', () => {
    delete process.env.LLM_AUTO_CONTINUE_DEFAULT;
    const result = parseFirstResponseRouting(makeInput({
      classification: 'code', complexity: 'low', suggestedRole: 'coder',
      specializationRoute: 'direct',
      planSteps: [{ step: 'step1', tool: 'read', role: 'coder' }],
    }));
    expect(result.found).toBe(true);
    // env-default-on → continue=true; but explicitContinue=false (undefined !== true)
    expect(result.routing!.continue).toBe(true);
    expect(result.routing!.explicitContinue).toBe(false);
    const client = buildRoutingMetadataForClient(result.routing!);
    // explicitContinue=false + planSteps.length=1 → hasMultiplePlanSteps=false
    // BUT routing.continue=true (env-default-on), and computeShouldContinue
    // checks all three: explicitContinue || hasMultiplePlanSteps || routing.continue
    // So client.continue=true (routing.continue kicks in).
    expect(client.continue).toBe(true);
  });

  it('Row 2: 1-step, continue=false (explicit-off), env-default-on → routing.continue=false preserved', () => {
    delete process.env.LLM_AUTO_CONTINUE_DEFAULT;
    const result = parseFirstResponseRouting(makeInput({
      classification: 'code', complexity: 'low', suggestedRole: 'coder',
      specializationRoute: 'direct',
      planSteps: [{ step: 'step1', tool: 'read', role: 'coder' }],
      continue: false,
    }));
    expect(result.found).toBe(true);
    expect(result.routing!.continue).toBe(false);
    expect(result.routing!.explicitContinue).toBe(false);
    const client = buildRoutingMetadataForClient(result.routing!);
    expect(client.continue).toBe(false);
  });

  it('Row 3: 1-step, continue=true (explicit-on), env-default-off → shouldContinue=true', () => {
    process.env.LLM_AUTO_CONTINUE_DEFAULT = 'false';
    const result = parseFirstResponseRouting(makeInput({
      classification: 'code', complexity: 'low', suggestedRole: 'coder',
      specializationRoute: 'direct',
      planSteps: [{ step: 'step1', tool: 'read', role: 'coder' }],
      continue: true,
    }));
    expect(result.found).toBe(true);
    expect(result.routing!.continue).toBe(true);
    expect(result.routing!.explicitContinue).toBe(true);
    const client = buildRoutingMetadataForClient(result.routing!);
    expect(client.continue).toBe(true);
  });

  it('Row 4: 2-step, continue=undefined, env-default-off → shouldContinue=true (multi-step wins)', () => {
    process.env.LLM_AUTO_CONTINUE_DEFAULT = 'false';
    const result = parseFirstResponseRouting(makeInput({
      classification: 'code', complexity: 'low', suggestedRole: 'coder',
      specializationRoute: 'direct',
      planSteps: [
        { step: 'step1', tool: 'read', role: 'coder' },
        { step: 'step2', tool: 'write', role: 'coder' },
      ],
    }));
    expect(result.found).toBe(true);
    // >=2 steps forces continue=true in validateAndNormalize regardless of env
    expect(result.routing!.continue).toBe(true);
    const client = buildRoutingMetadataForClient(result.routing!);
    // planSteps.length=2 >=2 → computeShouldContinue=true
    expect(client.continue).toBe(true);
  });

  it('Row 5 (boundary): exactly 1 step, no explicit continue, env-default-off → client.continue=false', () => {
    process.env.LLM_AUTO_CONTINUE_DEFAULT = 'false';
    const result = parseFirstResponseRouting(makeInput({
      classification: 'code', complexity: 'low', suggestedRole: 'coder',
      specializationRoute: 'direct',
      planSteps: [{ step: 'step1', tool: 'read', role: 'coder' }],
    }));
    expect(result.found).toBe(true);
    // env-default=false + 1 step + no explicit → routing.continue=false
    expect(result.routing!.continue).toBe(false);
    const client = buildRoutingMetadataForClient(result.routing!);
    // explicitContinue=false + planSteps=1 < 2 → computeShouldContinue=false
    expect(client.continue).toBe(false);
  });
});
