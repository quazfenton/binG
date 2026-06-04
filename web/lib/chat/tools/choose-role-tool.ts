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
    reason: z.string().describe('Reasoning for the role switch (e.g., handling high-complexity refactor, debugging error loops).'),
  }),
  execute: ({ role, reason }) => {
    const result = normalizeAndValidateRole(role, reason || '');

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
