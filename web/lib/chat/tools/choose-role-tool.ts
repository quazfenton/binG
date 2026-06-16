import { tool } from 'ai';
import { z } from 'zod';
import { normalizeAndValidateRole } from '@bing/shared/agent';

/**
 * choose_role Capability
 * 
 * Allows the agent to dynamically switch its internal role/persona based on 
 * evolving task requirements, ensuring the system prompt remains optimized.
 *
 * Alias of role_selection — both names are handled by the system.
 */
export const chooseRoleCapability = tool({
  description: 'Switch the current expert role/persona to better handle task complexity, domain, or failure recovery. USE THIS when: (1) the task has multiple phases — e.g., call choose_role role="architect" to plan, then role="coder" to implement; (2) you hit repeated tool failures — call choose_role role="debugger" to investigate; (3) you finished coding and need a review — call choose_role role="reviewer"; (4) the user asks for research — call choose_role role="researcher". Available roles (canonical 9-ID set shared with CHOOSE_ROLE_DIRECTIVE): coder, reviewer, planner, architect, researcher, debugger, specialist, orchestrator, simplifier. specialist = narrow-domain expertise; orchestrator = multi-agent coordination or handoff; simplifier = reduce scope. tester / documenter (broader agent-role library) and mlEngineer (supplementary library) are also valid; not in directive's worked examples.',
  inputSchema: z.object({
    role: z.string().describe('The target expert role to adopt. The canonical 9-ID set is (coder, reviewer, planner, architect, researcher, debugger, specialist, orchestrator, simplifier — same menu as CHOOSE_ROLE_DIRECTIVE). specialist = narrow domain expertise (e.g., GPU kernels, security audit, vector index internals); orchestrator = multi-agent coordination or role handoff; simplifier = reduce scope or return partial. The other 3 valid IDs are available but not in CHOOSE_ROLE_DIRECTIVE's worked examples: tester and documenter are in the broader agent-role prompt library (unified-role-selector core entries); mlEngineer is in the supplementary prompts library (registered as SupplementaryAgentRole). The 9 canonical IDs are the directive's preferred default unless the task explicitly matches one of the supplementary roles.'),
    reason: z.string().optional().describe('Reasoning for the role switch (e.g., handling high-complexity refactor, debugging error loops). Optional — handler coerces undefined to empty string.'),
    recentFailures: z.array(z.string()).optional().describe('Recent tool execution error messages (system injects these; biases toward debugger role when ≥2 failures).'),
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
