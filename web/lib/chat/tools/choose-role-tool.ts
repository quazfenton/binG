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
  description: 'Switch the current expert role/persona to better handle task complexity, domain, or failure recovery. USE THIS when the task has multiple phases (call choose_role role="architect" to plan, then role="coder" to implement) or when you hit repeated tool failures (call choose_role role="debugger" to investigate) or when you finished coding and need a review (call choose_role role="reviewer") or when the user asks for research (call choose_role role="researcher"). Available roles: coder, architect, reviewer, debugger, tester, researcher, planner, documenter, mlEngineer.',
  inputSchema: z.object({
    role: z.string().describe('The target expert role to adopt (e.g. coder, architect, reviewer, debugger, tester, researcher, planner, documenter, mlEngineer)'),
    reason: z.string().optional().describe('Reasoning for the role switch (e.g. handling high-complexity refactor, debugging error loops)'),
    recentFailures: z.array(z.string()).optional().describe('Recent tool execution error messages (system injects these, biases toward debugger role when 2+ failures)'),
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
