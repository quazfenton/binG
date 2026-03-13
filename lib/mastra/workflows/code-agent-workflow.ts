/**
 * Code Agent Workflow
 *
 * Multi-step workflow for code generation and execution.
 * Implements planner → executor → critic pattern with self-healing.
 * 
 * FEATURES:
 * - Conditional branching for self-healing
 * - State management for tracking execution
 * - Retry logic for transient failures
 * - Comprehensive error handling
 *
 * @see https://mastra.ai/docs/workflows/overview
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { simulatedOrchestrator } from '../../agent/simulated-orchestration';
import { getModel } from '../models/model-router';
import {
  writeFileTool,
  readFileTool,
  executeCodeTool,
  syntaxCheckTool,
  listFilesTool,
  deletePathTool,
  installDepsTool,
} from '../tools';

// ===========================================
// Schema Definitions
// ===========================================

/**
 * Workflow input schema
 */
export const WorkflowInput = z.object({
  task: z.string().describe('User task description'),
  ownerId: z.string().describe('Workspace owner ID'),
});

/**
 * Plan output schema
 */
export const PlanOutput = z.object({
  steps: z.array(z.object({
    action: z.string().describe('Action description'),
    tool: z.string().describe('Tool ID to use'),
    parameters: z.record(z.any()).describe('Tool parameters'),
  })),
});

/**
 * Tool result schema
 */
export const ToolResult = z.object({
  step: z.object({
    action: z.string(),
    tool: z.string(),
    parameters: z.record(z.any()),
  }),
  result: z.record(z.any()),
});

/**
 * Workflow state schema for tracking execution
 */
export const WorkflowState = z.object({
  currentStep: z.string(),
  attempts: z.number().default(0),
  errors: z.array(z.object({
    step: z.string(),
    message: z.string(),
    timestamp: z.number(),
  })).default([]),
  toolResults: z.array(z.any()).default([]),
  needsSelfHealing: z.boolean().default(false),
  selfHealingAttempts: z.number().default(0),
});

// ===========================================
// Step Definitions
// ===========================================

/**
 * Step 0: Collective Orchestrator
 * Checks for external task proposals from other frameworks
 */
export const collectiveStep = createStep({
  id: 'collective',
  inputSchema: WorkflowInput,
  outputSchema: z.object({
    task: z.string(),
    externalProposals: z.array(z.any()),
  }),
  execute: async ({ inputData }) => {
    const proposals = simulatedOrchestrator.listProposals();
    const relevant = proposals.filter(p => p.status === 'proposed');
    
    return {
      task: inputData.task,
      externalProposals: relevant,
    };
  },
});

/**
 * Step 1: Planner
 *
 * Analyzes task and creates execution plan
 */
export const plannerStep = createStep({
  id: 'planner',
  inputSchema: WorkflowInput,
  outputSchema: z.object({
    plan: PlanOutput,
    ownerId: z.string(),
    needsSelfHealing: z.boolean().default(false),
  }),
  stateSchema: WorkflowState,
  execute: async ({ inputData, state, setState, getStepResult }) => {
    const { task, ownerId } = inputData;
    const collectiveResult = getStepResult(collectiveStep);
    const agent = getModel('reasoning');

    try {
      setState({ ...state, currentStep: 'planner' });
      
      const response = await agent.generate([
        {
          role: 'system',
          content: `You are a planning agent. Output a JSON plan with steps.
          
          COLLECTIVE CONTEXT:
          ${JSON.stringify(collectiveResult?.externalProposals || [])}

Available tools:
- WRITE_FILE: Create or update files
- READ_FILE: Read file contents
- DELETE_PATH: Delete files or directories
- LIST_FILES: List directory contents
- EXECUTE_CODE: Run code in sandbox
- SYNTAX_CHECK: Check code syntax
- INSTALL_DEPS: Install dependencies

Output format:
{
  "steps": [
    {
      "action": "Read existing file",
      "tool": "READ_FILE",
      "parameters": { "path": "src/index.ts" }
    }
  ]
}`,
        },
        { role: 'user', content: task },
      ]);

      // Validate JSON before parsing
      const trimmedText = response.text.trim();
      if (!trimmedText.startsWith('{') && !trimmedText.startsWith('[')) {
        throw new Error(`Invalid JSON response: ${trimmedText.slice(0, 100)}`);
      }

      let plan: any;
      try {
        plan = JSON.parse(trimmedText);
      } catch (parseError) {
        throw new Error(`Failed to parse plan JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
      }

      // Validate plan structure
      if (!plan.steps || !Array.isArray(plan.steps)) {
        throw new Error('Plan must contain a "steps" array');
      }

      return { plan, ownerId, needsSelfHealing: false };
    } catch (error) {
      setState({
        ...state,
        errors: [...state.errors, {
          step: 'planner',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        }],
        needsSelfHealing: true,
      });
      throw error;
    }
  },
  retries: 2,
});

/**
 * Step 2: Executor
 *
 * Executes the planned steps using tools
 *
 * FIXED: Added getStepResult helper for accessing previous step results
 */
export const executorStep = createStep({
  id: 'executor',
  inputSchema: z.object({
    plan: PlanOutput,
    ownerId: z.string(),
    needsSelfHealing: z.boolean().optional(),
  }),
  outputSchema: z.object({
    toolResults: z.array(ToolResult),
    attempts: z.number(),
    hasErrors: z.boolean(),
  }),
  stateSchema: WorkflowState,
  execute: async ({ inputData, state, setState, getStepResult }) => {
    const { plan, ownerId, needsSelfHealing } = inputData;
    const toolResults = [];
    let hasErrors = false;

    setState({
      ...state,
      currentStep: 'executor',
      needsSelfHealing: needsSelfHealing || false,
    });

    // Get planner step result using getStepResult helper
    const plannerResult = getStepResult(plannerStep);
    if (plannerResult?.needsSelfHealing) {
      console.log('[Executor] Planner indicated self-healing may be needed');
    }

    const allTools = [
      writeFileTool,
      readFileTool,
      deletePathTool,
      listFilesTool,
      executeCodeTool,
      syntaxCheckTool,
      installDepsTool,
    ];

    for (const step of plan.steps) {
      const tool = allTools.find(t => t.id === step.tool);

      if (!tool) {
        const error = new Error(`Unknown tool: ${step.tool}. Available tools: ${allTools.map(t => t.id).join(', ')}`);
        setState({
          ...state,
          errors: [...state.errors, {
            step: 'executor',
            message: error.message,
            timestamp: Date.now(),
          }],
        });
        toolResults.push({ step, result: { error: error.message } });
        hasErrors = true;
        continue;
      }

      try {
        const result = await tool.execute({
          context: { ...step.parameters, ownerId },
        });

        toolResults.push({ step, result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setState({
          ...state,
          errors: [...state.errors, {
            step: `executor:${step.tool}`,
            message: errorMessage,
            timestamp: Date.now(),
          }],
        });
        toolResults.push({
          step,
          result: { error: errorMessage },
        });
        hasErrors = true;
      }
    }

    return { toolResults, attempts: (state.attempts || 0) + 1, hasErrors };
  },
  retries: 1,
});

/**
 * Step 3: Critic (Self-Healing)
 *
 * Reviews execution results and determines if self-healing is needed
 *
 * FIXED: Changed from context.getStepPayload() to inputData per Mastra SDK
 * FIXED: Added getStepResult helper and bail() for early exit
 * NEW: Added code quality evaluation using evals/scorers
 */
export const criticStep = createStep({
  id: 'critic',
  inputSchema: z.object({
    task: z.string(),
    toolResults: z.array(ToolResult),
    attempts: z.number(),
    ownerId: z.string(),
    hasErrors: z.boolean(),
  }),
  outputSchema: z.object({
    final: z.string(),
    needsSelfHealing: z.boolean(),
    fixInstructions: z.string().optional(),
  }),
  stateSchema: WorkflowState,
  execute: async ({ inputData, state, setState, getStepResult, bail }) => {
    // FIXED: Use inputData directly instead of context.getStepPayload()
    const { task, toolResults, attempts, hasErrors } = inputData;
    const agent = getModel('reasoning');

    try {
      setState({ ...state, currentStep: 'critic' });

      // Get executor step result using getStepResult helper
      const executorResult = getStepResult(executorStep);
      if (executorResult?.hasErrors === false) {
        // No errors - bail early with success
        console.log('[Critic] No errors detected, bailing early');
        return bail({
          final: JSON.stringify(toolResults),
          needsSelfHealing: false,
        });
      }

      // If no errors, return success immediately
      if (!hasErrors) {
        return {
          final: JSON.stringify(toolResults),
          needsSelfHealing: false,
        };
      }

      // NEW: Evaluate generated code quality if code was produced
      const codeResult = toolResults.find(r => r.step.tool === 'WRITE_FILE' || r.step.tool === 'EXECUTE_CODE');
      if (codeResult?.result?.output) {
        try {
          const { evaluateCode, passesEvaluation } = await import('@/lib/mastra/evals/code-quality');
          const evalResult = await evaluateCode(codeResult.result.output, 'typescript');
          
          if (evalResult.recommendation === 'reject') {
            console.log('[Critic] Code evaluation rejected:', evalResult.overall.feedback);
            return {
              final: JSON.stringify(toolResults),
              needsSelfHealing: true,
              fixInstructions: `Code quality issues: ${evalResult.overall.feedback}`,
            };
          }
        } catch (evalError) {
          console.warn('[Critic] Code evaluation failed:', evalError);
          // Continue without evaluation if it fails
        }
      }

      const response = await agent.generate([
        {
          role: 'system',
          content: `Review the tool execution results and determine if self-healing is needed.

Output JSON:
{
  "success": boolean,
  "needsSelfHealing": boolean,
  "fixInstructions": string | null
}

If there are errors and attempts < 3, set needsSelfHealing to true and provide fix instructions.`,
        },
        { role: 'user', content: JSON.stringify({ task, toolResults, attempts }) },
      ]);

      const trimmedText = response.text.trim();
      let parsed: any;

      try {
        parsed = JSON.parse(trimmedText);
      } catch (parseError) {
        // If JSON parsing fails, assume no self-healing needed
        return {
          final: response.text,
          needsSelfHealing: false,
        };
      }

      const needsSelfHealing = parsed.needsSelfHealing || (!parsed.success && attempts < 3);

      return {
        final: JSON.stringify(toolResults),
        needsSelfHealing,
        fixInstructions: parsed.fixInstructions || parsed.fix || undefined,
      };
    } catch (error) {
      setState({
        ...state,
        errors: [...state.errors, {
          step: 'critic',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        }],
      });
      // Use bail for error exit
      return bail({
        final: `Error in critic step: ${error instanceof Error ? error.message : 'Unknown error'}`,
        needsSelfHealing: false,
      });
    }
  },
  retries: 1,
});

/**
 * Step 4: Self-Healing Planner
 *
 * Creates a new plan to fix identified issues
 *
 * NEW: This step is only executed when branching condition is met
 * FIXED: Added getStepResult helper and bail() for early exit
 */
export const selfHealingPlannerStep = createStep({
  id: 'self-healing-planner',
  inputSchema: z.object({
    task: z.string(),
    toolResults: z.array(ToolResult),
    fixInstructions: z.string().optional(),
    ownerId: z.string(),
    selfHealingAttempts: z.number(),
  }),
  outputSchema: z.object({
    plan: PlanOutput,
    ownerId: z.string(),
    selfHealingAttempts: z.number(),
  }),
  stateSchema: WorkflowState,
  execute: async ({ inputData, state, setState, getStepResult, bail }) => {
    const { task, toolResults, fixInstructions, ownerId, selfHealingAttempts } = inputData;
    const agent = getModel('reasoning');

    try {
      setState({
        ...state,
        currentStep: 'self-healing-planner',
        selfHealingAttempts: selfHealingAttempts + 1,
      });

      // Get critic step result to check if self-healing is still needed
      const criticResult = getStepResult(criticStep);
      if (!criticResult?.needsSelfHealing) {
        // Self-healing no longer needed - bail early
        console.log('[Self-Healing Planner] Self-healing no longer needed, bailing');
        return bail({
          plan: { steps: [] },
          ownerId,
          selfHealingAttempts: selfHealingAttempts + 1,
        });
      }

      const response = await agent.generate([
        {
          role: 'system',
          content: `You are a self-healing planning agent. The previous execution had issues.

Previous tool results:
${JSON.stringify(toolResults, null, 2)}

Fix instructions:
${fixInstructions || 'Please analyze the errors and create a fix plan.'}

Create a new plan to fix these issues. Output JSON:
{
  "steps": [
    {
      "action": "Fix action",
      "tool": "TOOL_ID",
      "parameters": { }
    }
  ]
}`,
        },
        { role: 'user', content: task },
      ]);

      const trimmedText = response.text.trim();
      let plan: any;

      try {
        plan = JSON.parse(trimmedText);
      } catch (parseError) {
        throw new Error(`Failed to parse self-healing plan: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
      }

      if (!plan.steps || !Array.isArray(plan.steps)) {
        throw new Error('Self-healing plan must contain a "steps" array');
      }

      return { plan, ownerId, selfHealingAttempts: selfHealingAttempts + 1 };
    } catch (error) {
      setState({
        ...state,
        errors: [...state.errors, {
          step: 'self-healing-planner',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        }],
      });
      throw error;
    }
  },
  retries: 1,
});

// ===========================================
// Workflow Definition with Branching
// ===========================================

/**
 * Code Agent Workflow with Branching
 * 
 * Orchestrates code generation and execution with self-healing.
 * Uses conditional branching to trigger self-healing when errors occur.
 * 
 * Flow:
 * 1. Planner creates execution plan
 * 2. Executor runs the plan
 * 3. Critic reviews results
 * 4. BRANCH: If errors exist and attempts < 3, go to self-healing
 * 5. Self-healing creates new fix plan
 * 6. Executor runs fix plan
 * 7. Loop back to critic
 */
export const codeAgentWorkflow = createWorkflow({
  id: 'code-agent',
  // @ts-ignore - name is supported in some Mastra versions
  name: 'Code Agent Workflow',
  inputSchema: WorkflowInput,
  outputSchema: z.object({
    result: z.string(),
    state: WorkflowState,
    selfHealingAttempts: z.number(),
  }),
  stateSchema: WorkflowState,
  retryConfig: {
    attempts: 2,
    delay: 1000,
  },
  options: {
    onFinish: async ({ status, result, error, runId }) => {
      console.log(`[Code Agent] Workflow ${runId} finished with status: ${status}`);
      if (status === 'success') {
        console.log('[Code Agent] Result:', result);
      } else if (status === 'failed') {
        console.error('[Code Agent] Error:', error);
      }
    },
    onError: async ({ error, runId }) => {
      console.error(`[Code Agent] Workflow ${runId} error:`, error);
    },
  },
})
  .then(collectiveStep)
  .then(plannerStep)
  .then(executorStep)
  .then(criticStep)
  // BRANCHING: Condition for self-healing loop
  // @ts-ignore - branch API may vary
  .branch(
    // Condition: Check if self-healing is needed
    async ({ inputData, state }) => {
      const criticResult = inputData as { needsSelfHealing?: boolean; fixInstructions?: string };
      const maxSelfHealingAttempts = 3;
      
      const needsHealing = criticResult?.needsSelfHealing === true;
      const attemptsRemaining = (state?.selfHealingAttempts || 0) < maxSelfHealingAttempts;
      
      console.log(`[Code Agent] Branch condition: needsHealing=${needsHealing}, attemptsRemaining=${attemptsRemaining}`);
      
      return needsHealing && attemptsRemaining;
    },
    // If TRUE: Execute self-healing path
    // @ts-ignore - branch step array API may vary
    [
      selfHealingPlannerStep,
      // After self-healing plan, execute the fix plan
      executorStep,
      // Then go back to critic for re-evaluation
      criticStep,
    ],
    // If FALSE: Complete workflow (no additional steps)
    []
  )
  .commit();

/**
 * Get workflow by ID
 */
export function getCodeAgentWorkflow() {
  return codeAgentWorkflow;
}
