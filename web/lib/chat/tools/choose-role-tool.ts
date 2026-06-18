import { tool } from 'ai';
import { z } from 'zod';
import {
  normalizeAndValidateRole,
  getAvailableChooseRoles,
} from '@bing/shared/agent';

// SEV-12 polish (2026-06-18 followup): the canonical 9-ID choose-role menu
// and the drift-safe intersection-with-SYSTEM_PROMPTS helper both live in
// `packages/shared/agent/unified-role-selector.ts` (CHOOSE_ROLE_MENU +
// getAvailableChooseRoles). We import from there rather than maintain a
// duplicate copy here, so:
//   - the LLM-facing Zod describe() advertises the SAME set the runtime
//     validator consults (no drift between what we tell the LLM is
//     acceptable and what we actually validate against),
//   - adding a new role to CHOOSE_ROLE_MENU upstream automatically
//     propagates here without a separate edit,
//   - the SEV-12 production-throw / dev-warn invariant is enforced from a
//     single place inside @bing/shared/agent (so test suites that import
//     the shared helpers directly also catch drift).
//
// Note: we call getAvailableChooseRoles() ONCE at module load and sink the
// result into the `_AVAILABLE_CHOOSE_ROLES` const referenced by both the
// Zod describe() and any downstream consumers. The same string is what
// normalizeAndValidateRole computes internally on each call.
const _AVAILABLE_CHOOSE_ROLES: readonly string[] = getAvailableChooseRoles();

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
    `Available roles (intersected with canonical SYSTEM_PROMPTS keys, ${_AVAILABLE_CHOOSE_ROLES.length} IDs at load time): ${_AVAILABLE_CHOOSE_ROLES.join(', ')}.`,
  inputSchema: z.object({
    role: z.string().describe(
      `The target expert role to adopt — must be one of the live canonical IDs from CHOOSE_ROLE_MENU: ` +
      `${_AVAILABLE_CHOOSE_ROLES.join(', ')}. ` +
      `Pair \`reason\` with one of the 3 lineage concepts: complexity, domain, or failure recovery.`,
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

// Re-export for downstream consumers (tests, prompt-composer). The value
// here is a snapshot at module-load — normalizeAndValidateRole computes a
// fresh check at runtime so drift introduced by HMR still surfaces there.
export { _AVAILABLE_CHOOSE_ROLES };

