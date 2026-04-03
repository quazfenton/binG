/**
 * Blaxel Module
 * 
 * Provides Blaxel integration for serverless functions and MCP hosting.
 */

export { blaxelAsyncManager, BlaxelAsyncManager, verifyWebhookFromRequest } from './blaxel-async';
export { BlaxelTrafficManager, createTrafficManager, quickCanaryDeploy, ScalingPresets } from './traffic-manager';
export { blaxelAgentHandoff, BlaxelAgentHandoffManager, createAgentHandoffManager } from './agent-handoff';
export { blaxelBatchJobs, BlaxelBatchJobsManager, createBatchJobsManager, quickBatchExecute } from './batch-jobs';

export type { AsyncTriggerConfig, AsyncExecutionResult, BlaxelWebhookPayload } from './blaxel-async';
export type { TrafficDistribution, TrafficSplitConfig, TrafficSplitResult, RevisionHealth } from './traffic-manager';
export type { HandoffState } from './agent-handoff';
export type { BatchTask, BatchJob, BatchJobStatus } from './batch-jobs';
