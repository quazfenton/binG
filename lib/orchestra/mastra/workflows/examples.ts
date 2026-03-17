/**
 * Mastra Workflow Examples
 *
 * Demonstrates advanced workflow patterns:
 * - Conditional branching
 * - Parallel execution
 * - Self-healing loops
 * - Human-in-the-loop
 *
 * @see lib/mastra/workflows/
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';

// ===========================================
// Example 1: Conditional Branching
// ===========================================

/**
 * Workflow that branches based on task complexity
 */
export const conditionalWorkflow = createWorkflow({
  id: 'conditional-example',
  inputSchema: z.object({
    task: z.string(),
    complexity: z.enum(['simple', 'complex']),
  }),
  outputSchema: z.object({
    result: z.string(),
    path: z.string(),
  }),
})
  .then(
    createStep({
      id: 'route',
      inputSchema: z.object({
        task: z.string(),
        complexity: z.enum(['simple', 'complex']),
      }),
      outputSchema: z.object({
        task: z.string(),
        path: z.string(),
      }),
      execute: async ({ inputData }) => {
        const { task, complexity } = inputData;
        return {
          task,
          path: complexity === 'complex' ? 'complex' : 'simple',
        };
      },
    })
  )
  .branch(
    // Condition: Check if task is complex
    async ({ inputData }) => {
      return inputData.path === 'complex';
    },
    // If TRUE: Execute complex path
    // @ts-ignore - branch step array API may vary
    [
      createStep({
        id: 'complex-path',
        inputSchema: z.object({ task: z.string() }),
        outputSchema: z.object({ result: z.string() }),
        execute: async ({ inputData }) => {
          // Complex processing with multiple steps
          await new Promise(resolve => setTimeout(resolve, 1000));
          return { result: `Complex result for: ${inputData.task}` };
        },
      }),
    ],
    // If FALSE: Execute simple path
    [
      createStep({
        id: 'simple-path',
        inputSchema: z.object({ task: z.string() }),
        outputSchema: z.object({ result: z.string() }),
        execute: async ({ inputData }) => {
          // Simple processing
          return { result: `Simple result for: ${inputData.task}` };
        },
      }),
    ]
  )
  .commit();

// ===========================================
// Example 2: Parallel Execution
// ===========================================

/**
 * Workflow that processes multiple files in parallel
 */
export const parallelWorkflow = createWorkflow({
  id: 'parallel-example',
  inputSchema: z.object({
    files: z.array(z.string()),
    ownerId: z.string(),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      file: z.string(),
      content: z.string(),
    })),
  }),
})
  .then(
    createStep({
      id: 'read-files-parallel',
      inputSchema: z.object({
        files: z.array(z.string()),
        ownerId: z.string(),
      }),
      outputSchema: z.object({
        results: z.array(z.object({
          file: z.string(),
          content: z.string(),
        })),
      }),
      execute: async ({ inputData }) => {
        const { files, ownerId } = inputData;

        // Read all files in PARALLEL
        const results = await Promise.all(
          files.map(async (file) => {
            // Simulate file reading
            await new Promise(resolve => setTimeout(resolve, 100));
            return {
              file,
              content: `Content of ${file} for ${ownerId}`,
            };
          })
        );

        return { results };
      },
    })
  )
  .commit();

// ===========================================
// Example 3: Self-Healing Loop
// ===========================================

/**
 * Workflow with automatic retry and self-healing
 */
export const selfHealingWorkflow = createWorkflow({
  id: 'self-healing-example',
  inputSchema: z.object({
    task: z.string(),
    maxAttempts: z.number().default(3),
  }),
  outputSchema: z.object({
    result: z.string(),
    attempts: z.number(),
  }),
  stateSchema: z.object({
    attempts: z.number().default(0),
    errors: z.array(z.string()).default([]),
  }),
})
  .then(
    createStep({
      id: 'execute',
      inputSchema: z.object({
        task: z.string(),
        maxAttempts: z.number(),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        result: z.string().optional(),
        error: z.string().optional(),
      }),
      stateSchema: z.object({
        attempts: z.number(),
        errors: z.array(z.string()),
      }),
      execute: async ({ inputData, state, setState }) => {
        const { task, maxAttempts } = inputData;
        const currentAttempt = state.attempts + 1;

        setState({
          ...state,
          attempts: currentAttempt,
        });

        // Simulate execution that might fail
        const shouldFail = currentAttempt < maxAttempts;

        if (shouldFail) {
          const error = `Attempt ${currentAttempt} failed`;
          setState({
            ...state,
            attempts: currentAttempt,
            errors: [...state.errors, error],
          });

          return {
            success: false,
            error,
          };
        }

        return {
          success: true,
          result: `Success after ${currentAttempt} attempts: ${task}`,
        };
      },
    })
  )
  .branch(
    // Condition: Check if execution failed and has attempts remaining
    async ({ inputData, state }) => {
      const result = inputData as { success?: boolean; error?: string };
      return !result.success && state.attempts < 3;
    },
    // If TRUE: Retry (loop back to execute step)
    // @ts-ignore - branch step array API may vary
    [],
    // If FALSE: Continue to completion
    []
  )
  .commit();

// ===========================================
// Example 4: Multi-Stage Pipeline
// ===========================================

/**
 * Workflow with multiple processing stages
 */
export const pipelineWorkflow = createWorkflow({
  id: 'pipeline-example',
  inputSchema: z.object({
    code: z.string(),
    language: z.string(),
  }),
  outputSchema: z.object({
    validated: z.boolean(),
    formatted: z.string(),
    tested: z.boolean(),
  }),
})
  .then(
    createStep({
      id: 'validate',
      inputSchema: z.object({
        code: z.string(),
        language: z.string(),
      }),
      outputSchema: z.object({
        code: z.string(),
        valid: z.boolean(),
      }),
      execute: async ({ inputData }) => {
        // Validate code syntax
        const valid = inputData.code.length > 0;
        return {
          code: inputData.code,
          valid,
        };
      },
    })
  )
  .then(
    createStep({
      id: 'format',
      inputSchema: z.object({
        code: z.string(),
        valid: z.boolean(),
      }),
      outputSchema: z.object({
        code: z.string(),
        formatted: z.string(),
      }),
      execute: async ({ inputData }) => {
        // Format code
        const formatted = inputData.code.trim();
        return {
          code: inputData.code,
          formatted,
        };
      },
    })
  )
  .then(
    createStep({
      id: 'test',
      inputSchema: z.object({
        code: z.string(),
        formatted: z.string(),
      }),
      outputSchema: z.object({
        formatted: z.string(),
        tested: z.boolean(),
      }),
      execute: async ({ inputData }) => {
        // Run tests
        const tested = inputData.formatted.length > 0;
        return {
          formatted: inputData.formatted,
          tested,
        };
      },
    })
  )
  .commit();

// ===========================================
// Example 5: Fan-Out/Fan-In Pattern
// ===========================================

/**
 * Workflow that fans out to multiple workers then aggregates results
 */
export const fanOutFanInWorkflow = createWorkflow({
  id: 'fan-out-fan-in-example',
  inputSchema: z.object({
    items: z.array(z.string()),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      item: z.string(),
      processed: z.string(),
    })),
    total: z.number(),
  }),
})
  .then(
    createStep({
      id: 'fan-out',
      inputSchema: z.object({
        items: z.array(z.string()),
      }),
      outputSchema: z.object({
        tasks: z.array(z.object({
          item: z.string(),
          processed: z.string(),
        })),
      }),
      execute: async ({ inputData }) => {
        const { items } = inputData;

        // Process all items in parallel (fan-out)
        const tasks = await Promise.all(
          items.map(async (item) => ({
            item,
            processed: `Processed: ${item}`,
          }))
        );

        return { tasks };
      },
    })
  )
  .then(
    createStep({
      id: 'fan-in',
      inputSchema: z.object({
        tasks: z.array(z.object({
          item: z.string(),
          processed: z.string(),
        })),
      }),
      outputSchema: z.object({
        results: z.array(z.object({
          item: z.string(),
          processed: z.string(),
        })),
        total: z.number(),
      }),
      execute: async ({ inputData }) => {
        const { tasks } = inputData;

        // Aggregate results (fan-in)
        return {
          results: tasks,
          total: tasks.length,
        };
      },
    })
  )
  .commit();

// ===========================================
// Usage Examples
// ===========================================

/**
 * Example: Using conditional workflow
 */
export async function useConditionalExample() {
  const workflow = conditionalWorkflow;
  const run = await workflow.createRun();

  const result = await run.start({
    inputData: {
      task: 'Build a feature',
      complexity: 'complex',
    },
  });

  console.log('Conditional result:', result);
}

/**
 * Example: Using parallel workflow
 */
export async function useParallelExample() {
  const workflow = parallelWorkflow;
  const run = await workflow.createRun();

  const result = await run.start({
    inputData: {
      files: ['file1.ts', 'file2.ts', 'file3.ts'],
      ownerId: 'user_123',
    },
  });

  console.log('Parallel result:', result);
}

/**
 * Example: Using self-healing workflow
 */
export async function useSelfHealingExample() {
  const workflow = selfHealingWorkflow;
  const run = await workflow.createRun();

  const result = await run.start({
    inputData: {
      task: 'Flaky task',
      maxAttempts: 3,
    },
  });

  console.log('Self-healing result:', result);
}
