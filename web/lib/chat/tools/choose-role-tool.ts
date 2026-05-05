import { tool } from 'ai';
import { z } from 'zod';
import { analyzeContextAndSuggestRoles, Role, REDIRECTABLE_ROLES } from '@bing/shared/agent/role-redirector';

/**
 * choose_role Capability
 * 
 * Allows the agent to dynamically switch its internal role/persona based on 
 * evolving task requirements, ensuring the system prompt remains optimized.
 */
export const chooseRoleCapability = tool({
  description: 'Switch the current expert role/persona to better handle task complexity, domain, or failure recovery.',
  inputSchema: z.object({
    role: z.enum(REDIRECTABLE_ROLES as any)
      .describe('The target expert role to adopt.'),
    reason: z.string().describe('Reasoning for the role switch (e.g., handling high-complexity refactor, debugging error loops).'),
  }),
  execute: async ({ role, reason }) => {
    try {
      // This tool is an orchestration directive. The system's routing layer 
      // monitors the tool history, detects this call, and re-injects the 
      // appropriate system prompt for the next turn.
      return {
        success: true,
        roleAdopted: role,
        message: `Role switched to ${role} for: ${reason}. System prompt will be updated for the next interaction.`,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
});
