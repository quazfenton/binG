/**
 * Distributed Worker for Mastra Workflows
 *
 * Processes jobs from the queue and executes Mastra workflows.
 * Supports concurrent execution, automatic retries, and result storage.
 *
 * Usage:
 *   pnpm tsx worker/index.ts
 *
 * @see https://mastra.ai/docs/workflows/distributed-execution
 */

import { Worker, Job } from 'bullmq';
import { Mastra } from '@mastra/core';
import Redis from 'ioredis';
import { agentQueue, resultQueue, type JobData, type JobResult } from '@/infra/queue';
import { getMastra } from '@/lib/mastra';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Worker configuration
 */
const workerConfig = {
  connection: redis,
  concurrency: parseInt(process.env.MASTRA_WORKER_CONCURRENCY || '5'),
  limiter: {
    max: parseInt(process.env.MASTRA_WORKER_RATE_LIMIT || '10'),
    duration: parseInt(process.env.MASTRA_WORKER_RATE_DURATION || '1000'),
  },
};

/**
 * Process a workflow job
 */
async function processWorkflowJob(job: Job<JobData>): Promise<JobResult> {
  const startTime = Date.now();
  const { workflowId, inputData, ownerId } = job.data;

  try {
    // Update job progress
    await job.updateProgress(10);

    // Get Mastra instance
    const mastra = getMastra();

    // Get workflow
    const workflow = mastra.getWorkflow(workflowId!);

    if (!workflow) {
      throw new Error(`Workflow "${workflowId}" not found`);
    }

    // Update progress
    await job.updateProgress(30);

    // Create run
    const run = await workflow.createRun();

    // Update progress
    await job.updateProgress(50);

    // Execute workflow
    const result = await run.execute({ inputData });

    // Update progress
    await job.updateProgress(90);

    // Calculate duration
    const duration = Date.now() - startTime;

    // Return success result
    return {
      success: true,
      output: result,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    console.error(`[Worker] Job ${job.id} failed:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
      duration,
    };
  }
}

/**
 * Process a batch job
 */
async function processBatchJob(job: Job<JobData>): Promise<JobResult> {
  const startTime = Date.now();
  const { items, ownerId } = job.data.inputData;

  try {
    const results = [];
    const total = items.length;

    for (let i = 0; i < total; i++) {
      // Update progress
      const progress = Math.round(((i + 1) / total) * 100);
      await job.updateProgress(progress);

      // Process item
      results.push(items[i]);
    }

    const duration = Date.now() - startTime;

    return {
      success: true,
      output: { processed: results.length, total },
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    console.error(`[Worker] Batch job ${job.id} failed:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
      duration,
    };
  }
}

/**
 * Create and start the worker
 */
export async function startWorker(): Promise<Worker> {
  const worker = new Worker<JobData, JobResult>(
    'mastra-agent',
    async (job: Job<JobData>) => {
      console.log(`[Worker] Processing job ${job.id} type: ${job.data.type}`);

      let result: JobResult;

      // Process based on job type
      if (job.data.type === 'workflow') {
        result = await processWorkflowJob(job);
      } else if (job.data.type === 'batch') {
        result = await processBatchJob(job);
      } else {
        result = {
          success: false,
          error: `Unknown job type: ${job.data.type}`,
          duration: 0,
        };
      }

      // Store result in result queue
      if (result.success) {
        await resultQueue.add('store-result', {
          jobId: job.id,
          result,
          createdAt: Date.now(),
        });
      }

      return result;
    },
    workerConfig
  );

  // Event handlers
  worker.on('completed', (job: Job, result: JobResult) => {
    console.log(`[Worker] Job ${job.id} completed in ${result.duration}ms`);
  });

  worker.on('failed', (job: Job | undefined, error: Error) => {
    console.error(`[Worker] Job ${job?.id} failed:`, error.message);
  });

  worker.on('progress', (job: Job, progress: number) => {
    console.log(`[Worker] Job ${job.id} progress: ${progress}%`);
  });

  worker.on('error', (error: Error) => {
    console.error(`[Worker] Worker error:`, error.message);
  });

  console.log(`[Worker] Started with concurrency: ${workerConfig.concurrency}`);

  return worker;
}

/**
 * Stop the worker
 */
export async function stopWorker(worker: Worker): Promise<void> {
  console.log('[Worker] Stopping worker...');
  await worker.close();
  await redis.quit();
  console.log('[Worker] Stopped');
}

/**
 * Main entry point
 */
async function main() {
  const worker = await startWorker();

  // Handle shutdown signals
  process.on('SIGINT', async () => {
    console.log('[Worker] Received SIGINT, shutting down...');
    await stopWorker(worker);
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('[Worker] Received SIGTERM, shutting down...');
    await stopWorker(worker);
    process.exit(0);
  });
}

// Start worker if run directly
if (require.main === module) {
  main().catch(console.error);
}
