/**
 * Parallel Execution Example Workflow
 *
 * Demonstrates parallel step execution in Mastra workflows.
 * Useful for:
 * - Reading multiple files concurrently
 * - Running independent operations simultaneously
 * - Parallel testing or validation
 *
 * @see https://mastra.ai/docs/workflows/parallel
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { readFileTool, listFilesTool, syntaxCheckTool } from '../tools';

// ===========================================
// Schema Definitions
// ===========================================

export const ParallelInput = z.object({
  paths: z.array(z.string()).describe('List of file paths to process in parallel'),
  ownerId: z.string().describe('Workspace owner ID'),
});

export const FileContent = z.object({
  path: z.string(),
  content: z.string(),
  language: z.string().optional(),
  size: z.number(),
});

export const ParallelState = z.object({
  processedFiles: z.number().default(0),
  errors: z.array(z.object({
    path: z.string(),
    error: z.string(),
  })).default([]),
});

// ===========================================
// Step Definitions
// ===========================================

/**
 * List all files to process
 */
export const listFilesStep = createStep({
  id: 'list-files',
  inputSchema: ParallelInput,
  outputSchema: z.object({
    files: z.array(z.string()),
    ownerId: z.string(),
  }),
  stateSchema: ParallelState,
  execute: async ({ inputData, state, setState }) => {
    const { paths, ownerId } = inputData;
    
    setState({ ...state, processedFiles: 0 });

    // If no paths provided, list root directory
    if (!paths || paths.length === 0) {
      const result = await listFilesTool.execute({
        context: { path: '/', ownerId },
      });
      
      const filePaths = result.files
        .filter(f => f.type === 'file')
        .map(f => f.path);
      
      return { files: filePaths, ownerId };
    }

    return { files: paths, ownerId };
  },
});

/**
 * Read multiple files in PARALLEL
 * 
 * This demonstrates parallel execution - all files are read concurrently
 */
export const readFilesParallelStep = createStep({
  id: 'read-files-parallel',
  inputSchema: z.object({
    files: z.array(z.string()),
    ownerId: z.string(),
  }),
  outputSchema: z.object({
    contents: z.array(FileContent),
    parallelCount: z.number(),
  }),
  stateSchema: ParallelState,
  execute: async ({ inputData, state, setState }) => {
    const { files, ownerId } = inputData;
    const contents: Array<z.infer<typeof FileContent>> = [];
    const errors: Array<{ path: string; error: string }> = [];

    setState({ ...state, processedFiles: 0 });

    // PARALLEL EXECUTION: Read all files concurrently
    const readPromises = files.map(async (path) => {
      try {
        const result = await readFileTool.execute({
          context: { path, ownerId },
        });

        const fileContent = {
          path,
          content: result.content,
          language: result.language,
          size: result.content.length,
        };

        // Update state as files are processed
        // @ts-ignore - setState callback API may vary
        setState(prev => ({
          ...prev,
          processedFiles: prev.processedFiles + 1,
        }));

        return fileContent;
      } catch (error) {
        errors.push({
          path,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return null;
      }
    });

    // Wait for all parallel operations to complete
    const results = await Promise.all(readPromises);

    // Filter out nulls (failed reads)
    results.forEach(result => {
      if (result) {
        contents.push(result);
      }
    });

    // Update state with errors
    if (errors.length > 0) {
      // @ts-ignore - setState callback API may vary
      setState(prev => ({
        ...prev,
        errors: [...prev.errors, ...errors],
      }));
    }

    return {
      contents,
      parallelCount: files.length,
    };
  },
});

/**
 * Check syntax of multiple files in PARALLEL
 * 
 * Another example of parallel execution for independent operations
 */
export const checkSyntaxParallelStep = createStep({
  id: 'check-syntax-parallel',
  inputSchema: z.object({
    contents: z.array(FileContent),
  }),
  outputSchema: z.object({
    syntaxResults: z.array(z.object({
      path: z.string(),
      valid: z.boolean(),
      errors: z.array(z.string()).optional(),
    })),
    validCount: z.number(),
    invalidCount: z.number(),
  }),
  stateSchema: ParallelState,
  execute: async ({ inputData }) => {
    const { contents } = inputData;
    const syntaxResults = [];

    // PARALLEL EXECUTION: Check syntax of all files concurrently
    const syntaxPromises = contents.map(async (file) => {
      try {
        const language = file.language || 'typescript';
        // @ts-ignore - language may include typescript which is not in enum
        const result = await syntaxCheckTool.execute({
          context: {
            code: file.content,
            language: language as 'python' | 'typescript' | 'javascript',
          },
        });

        return {
          path: file.path,
          valid: result.valid,
          errors: result.errors,
        };
      } catch (error) {
        return {
          path: file.path,
          valid: false,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        };
      }
    });

    // Wait for all parallel syntax checks
    const results = await Promise.all(syntaxPromises);
    syntaxResults.push(...results);

    const validCount = results.filter(r => r.valid).length;
    const invalidCount = results.filter(r => !r.valid).length;

    return {
      syntaxResults,
      validCount,
      invalidCount,
    };
  },
});

/**
 * Generate parallel execution report
 */
export const reportStep = createStep({
  id: 'report',
  inputSchema: z.object({
    contents: z.array(FileContent),
    syntaxResults: z.array(z.object({
      path: z.string(),
      valid: z.boolean(),
      errors: z.array(z.string()).optional(),
    })),
    validCount: z.number(),
    invalidCount: z.number(),
    parallelCount: z.number(),
  }),
  outputSchema: z.object({
    report: z.string(),
    stats: z.object({
      totalFiles: z.number(),
      validFiles: z.number(),
      invalidFiles: z.number(),
      parallelExecutions: z.number(),
    }),
  }),
  stateSchema: ParallelState,
  execute: async ({ inputData }) => {
    const { contents, syntaxResults, validCount, invalidCount, parallelCount } = inputData;

    const report = `
# Parallel Execution Report

## Summary
- Total files processed: ${contents.length}
- Valid syntax: ${validCount}
- Invalid syntax: ${invalidCount}
- Parallel operations: ${parallelCount}

## File Details

${syntaxResults.map(r => `
### ${r.path}
- Status: ${r.valid ? '✅ Valid' : '❌ Invalid'}
${r.errors && r.errors.length > 0 ? `- Errors: ${r.errors.join(', ')}` : ''}
`).join('\n')}

## Performance
All files were processed in parallel, maximizing throughput.
    `.trim();

    return {
      report,
      stats: {
        totalFiles: contents.length,
        validFiles: validCount,
        invalidFiles: invalidCount,
        parallelExecutions: parallelCount,
      },
    };
  },
});

// ===========================================
// Workflow Definition with Parallel Execution
// ===========================================

/**
 * Parallel File Processing Workflow
 * 
 * Demonstrates parallel execution pattern:
 * 1. List files to process
 * 2. Read all files in PARALLEL
 * 3. Check syntax of all files in PARALLEL
 * 4. Generate report
 * 
 * Key benefits of parallel execution:
 * - Faster execution for independent operations
 * - Better resource utilization
 * - Reduced overall latency
 */
export const parallelWorkflow = createWorkflow({
  id: 'parallel-file-processing',
  // @ts-ignore - name is supported in some Mastra versions
  name: 'Parallel File Processing Workflow',
  inputSchema: ParallelInput,
  outputSchema: z.object({
    report: z.string(),
    stats: z.object({
      totalFiles: z.number(),
      validFiles: z.number(),
      invalidFiles: z.number(),
      parallelExecutions: z.number(),
    }),
  }),
  stateSchema: ParallelState,
  hooks: {
    beforeStart: async ({ input, runId }) => {
      console.log(`[Parallel Workflow] Starting (run: ${runId}) with ${input.paths?.length || 0} files`);
    },
    afterComplete: async ({ result, runId }) => {
      console.log(`[Parallel Workflow] Completed (run: ${runId}) - processed ${result.stats.totalFiles} files`);
    },
    onError: async ({ error, step, runId }) => {
      console.error(`[Parallel Workflow] Error (run: ${runId}) at step ${step?.id}:`, error);
    },
  },
})
  .then(listFilesStep)
  .then(readFilesParallelStep)
  .then(checkSyntaxParallelStep)
  .then(reportStep)
  .commit();

/**
 * Get parallel workflow by ID
 */
export function getParallelWorkflow() {
  return parallelWorkflow;
}
