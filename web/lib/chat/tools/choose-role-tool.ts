import { tool } from 'ai';
import { z } from 'zod';
import {
  normalizeAndValidateRole,
  getAvailableChooseRoles,
  CHOOSE_ROLE_MENU,
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
// result into the module-local `_AVAILABLE_CHOOSE_ROLES` const referenced
// by the tool description and Zod describe(). Zod schemas need a string
// at registration time, NOT a function — so we keep the local snapshot
// for that one purpose. normalizeAndValidateRole computes a fresh check
// at runtime so drift introduced by HMR still surfaces there.
//
// SEV-13 (reviewer critique #2): re-export the FUNCTION rather than the
// local snapshot. Downstream consumers (tests, prompt-composer) reading
// a frozen snapshot under HMR or vitest's isolate-modules would observe
// stale drift-checked values after re-load. Re-exporting the function
// lets each consumer pull a fresh value on demand.
const _AVAILABLE_CHOOSE_ROLES: readonly string[] = getAvailableChooseRoles();

/**
 * SEV-13 (reviewer critique #3): defense-in-depth production guard extracted
 * to a module-level helper so `chooseRoleCapability.execute()` reads as a
 * single line. The runtime drift-check lives in `getAvailableChooseRoles()`
 * (throws in production on missing-from-canonical IDs). Mirror that guard
 * here so a future refactor that accidentally bypasses the source-package
 * throw path still fails loudly at the LLM-facing entrypoint. Outside
 * production we rely on `getAvailableChooseRoles()`' `console.warn` to keep
 * dev boot unblocked.
 *
 * Operator-friendly error: names the drifted IDs rather than only counting,
 * so on-call grep-sees-the-actual-missing-role rather than hunting for the
 * discrepancy between `live.length` and `CHOOSE_ROLE_MENU.length`.
 */
function assertNoChooseRoleMenuDrift(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const live = getAvailableChooseRoles();
  const choices = CHOOSE_ROLE_MENU as readonly string[];
  if (live.length === choices.length) return;
  const missingFromLive = choices.filter((id) => !live.includes(id));
  const extraInLive = live.filter((id) => !choices.includes(id));
  throw new Error(
    `[choose-role] drift: ` +
    `${missingFromLive.length} canonical id(s) missing from live SYSTEM_PROMPTS keys — [${missingFromLive.join(', ') || '\u2205'}]. ` +
    `${extraInLive.length} extra live key(s) not in CHOOSE_ROLE_MENU — [${extraInLive.join(', ') || '\u2205'}]. ` +
    `Fix: rename in packages/shared/agent/system-prompts.ts, or update the ids in CHOOSE_ROLE_MENU.`,
  );
}

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
    // SEV-13 (reviewer critique #3): defense-in-depth production guard —
    // single-line call. See assertNoChooseRoleMenuDrift() for the full
    // rationale + operator-friendly ID-naming error message.
    assertNoChooseRoleMenuDrift();

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

// SEV-13 (reviewer critique #2): re-export the FUNCTION, not the local
// snapshot. Downstream consumers (tests, prompt-composer) should call
// `getAvailableChooseRoles()` freshly on each use so HMR / isolate-modules
// re-load produces the current drift-checked list, not a stale snapshot
// captured at this module's first load.
export { getAvailableChooseRoles };

