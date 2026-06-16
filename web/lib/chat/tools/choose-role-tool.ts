import { tool } from 'ai';
import { z } from 'zod';
import { normalizeAndValidateRole } from '@bing/shared/agent';

/**
 * choose_role Capability
 *
 * Allows the agent to dynamically switch its internal role/persona based on
 * evolving task requirements, ensuring the system prompt remains optimized.
 *
 * Canonical lineage (must stay in sync with CHOOSE_ROLE_DIRECTIVE in
 * packages/shared/agent/system-prompts-dynamic.ts): the 9 role IDs below and
 * the 3 lineage concepts — complexity, domain, failure recovery — are the
 * single coherent menu across every LLM-facing call site.
 *
 * Alias of role_selection — both names are handled by the system.
 */
export const chooseRoleCapability = tool({
  description:
    'Switch the current expert role/persona to better handle one of the 3 lineage concepts: task complexity, domain, or failure recovery. ' +
    'USE THIS when the task has multiple phases (call choose_role role="architect" to plan, then role="coder" to implement, then role="reviewer" to verify) ' +
    'or when you hit repeated tool failures (call choose_role role="debugger" to investigate — failure-recovery lineage) ' +
    'or when the user asks for research (call choose_role role="researcher" — domain lineage) ' +
    'or when you outlined a multi-role coordination problem (call choose_role role="orchestrator" — complexity lineage). ' +
    'Available roles (must be one of the 9 canonical IDs from CHOOSE_ROLE_DIRECTIVE): coder, reviewer, planner, architect, researcher, debugger, specialist, orchestrator, simplifier.',
  inputSchema: z.object({
    role: z.string().describe(
      'The target expert role to adopt — must be one of the 9 canonical IDs from CHOOSE_ROLE_DIRECTIVE in packages/shared/agent/system-prompts-dynamic.ts: ' +
      'coder, reviewer, planner, architect, researcher, debugger, specialist, orchestrator, simplifier. ' +
      'Pair `reason` with one of the 3 lineage concepts: complexity, domain, or failure recovery.',
    ),
    reason: z.string().optional().describe(
      'Reasoning for the role switch — frame it using one of the 3 lineage concepts: task complexity (multi-phase or architectural decisions), ' +
      'domain (specialist expertise or external research), or failure recovery (debugging error loops, post-mortem of recent failures).',
    ),
    recentFailures: z.array(z.string()).optional().describe(
      'Recent tool execution error messages — biases routing toward the failure-recovery lineage (debugger role) when 2+ entries are present. ' +
      'Used by the normalization layer to surface error context; not free-form text.',
    ),
  }),
  execute: ({ role, reason, recentFailures }) => {
    const result = normalizeAndValidateRole(role, reason || '', {
      recentFailures,
    });

    if (!result.valid) {
      return {
        success: false,
        roleAdopted: result.roleAdopted,
        rolePrompt: '',
        roleSource: null,
        message: result.message,
      };
    }

    return {
      success: true,
      roleAdopted: result.roleAdopted,
      rolePrompt: result.rolePrompt,
      roleSource: result.roleSource,
      message: result.message,
    };
  },
});

// ─── Module-load drift-check ───────────────────────────────────────────────
// Ensure the 9 role IDs documented in the Zod schema.describe()s above stay
// in lock-step with the canonical SYSTEM_PROMPTS Record from
// @bing/shared/agent/system-prompts.ts. If a role is renamed/removed upstream,
// fail-fast here rather than silently splitting the choose-role menu in front of
// LLMs (which the prior tests already flagged as a regression risk).
const _DOCUMENTED_CHOOSE_ROLES = [
  'coder',
  'reviewer',
  'planner',
  'architect',
  'researcher',
  'debugger',
  'specialist',
  'orchestrator',
  'simplifier',
] as const;
const _CANONICAL_KEYS = Object.keys(SYSTEM_PROMPTS as unknown as Record<string, unknown>);
const _MISSING_ROLE = (_DOCUMENTED_CHOOSE_ROLES as readonly string[])
  .find(r => !(_CANONICAL_KEYS as string[]).includes(r));
if (_MISSING_ROLE) {
  throw new Error(
    `[choose-role-tool] drift-check failed: documented role "${_MISSING_ROLE}" is missing from ` +
    `canonical SYSTEM_PROMPTS (${_CANONICAL_KEYS.length} canonical keys, ` +
    `${_DOCUMENTED_CHOOSE_ROLES.length} documented choose-roles). ` +
    `Either rename the role upstream in packages/shared/agent/system-prompts.ts, ` +
    `or update the 9 IDs documented in the Zod schema.describe()s above.`
  );
}

