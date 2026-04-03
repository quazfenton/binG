/**
 * Mastra Instance Configuration
 *
 * Main Mastra instance that orchestrates agents, workflows, and tools.
 * Reuses existing database and telemetry infrastructure.
 *
 * Updated for Mastra 1.x API
 * @see https://mastra.ai/docs/getting-started/manual-install
 */

import { Mastra } from '@mastra/core/mastra';
import { codeAgentWorkflow } from './workflows/code-agent-workflow';
import { hitlWorkflow } from './workflows/hitl-workflow';
import { parallelWorkflow } from './workflows/parallel-workflow';

// PostgreSQL storage for Mastra 1.x
// @ts-ignore - PostgreSQLStorage type may vary across Mastra versions
let PostgreSQLStorage: any;
try {
  PostgreSQLStorage = require('@mastra/pg').PostgreSQLStorage;
} catch {
  console.warn('PostgreSQLStorage not available, Mastra will use default storage');
}

/**
 * Mastra instance configuration
 *
 * Uses composite storage pattern for Mastra 1.x:
 * - PostgreSQL for workflows persistence
 * - PostgreSQL for scores/observability
 * - Memory for temporary storage (fallback)
 *
 * Requires @mastra/pg package:
 *   pnpm add @mastra/pg
 */
export const mastra = new Mastra({
  // Mastra 1.x uses composite storage
  // @ts-ignore - storage configuration is version-specific
  storage: PostgreSQLStorage
    ? new PostgreSQLStorage({
        connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/bing',
        connectionConfig: {
          max: 20,
          idleTimeoutMillis: 30000,
        },
        schema: process.env.MASTRA_SCHEMA || 'mastra',
      })
    : undefined,
  // Telemetry configuration removed - not supported in current Mastra version
  // Register workflows
  workflows: {
    codeAgent: codeAgentWorkflow,
    hitlCodeReview: hitlWorkflow,
    parallelProcessing: parallelWorkflow,
  },
});

/**
 * Get Mastra instance
 *
 * @returns Configured Mastra instance
 */
export function getMastra(): Mastra {
  return mastra;
}

/**
 * Alternative: Composite Storage (Advanced)
 * 
 * For production, use composite storage with @mastra/pg:
 * 
 * ```typescript
 * import { MastraCompositeStore } from '@mastra/core/storage';
 * import { WorkflowsPG, ScoresPG } from '@mastra/pg';
 * 
 * const storage = new MastraCompositeStore({
 *   id: 'composite',
 *   domains: {
 *     workflows: new WorkflowsPG({ 
 *       connectionString: process.env.DATABASE_URL 
 *     }),
 *     scores: new ScoresPG({ 
 *       connectionString: process.env.DATABASE_URL 
 *     }),
 *   },
 * });
 * 
 * export const mastra = new Mastra({ storage });
 * ```
 */
