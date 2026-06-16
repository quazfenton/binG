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
  description: 'Switch the current expert role/persona to better handle task complexity, domain, or failure recovery. Alias of role_selection.',
  inputSchema: z.object({
    role: z.string().describe('The target expert role to adopt. Use a role key from the unified prompt library (e.g., debugger, architect, reviewer, tester, researcher, coder, documenter, planner, mlEngineer, etc.).'),
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
