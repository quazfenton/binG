/**
 * Type declarations for @/lib/sandbox/provider-router
 * Stub for agent-worker — mirrors real exports from web/lib/sandbox/provider-router.ts
 *
 * ⚠️ KEEP IN SYNC: If the real module's exports change, this stub must be updated
 * to match. Otherwise TS errors will silently disappear while runtime breaks.
 */

export type SandboxProviderType =
  | 'daytona' | 'e2b' | 'sprites' | 'codesandbox' | 'microsandbox'
  | 'blaxel' | 'opensandbox' | 'mistral' | 'vercel-sandbox' | 'zeroboot'
  | 'modal' | 'modal-com' | 'webcontainer' | 'agentfs' | string;

export type TaskType =
  | 'code-interpreter' | 'agent' | 'fullstack-app' | 'frontend-app'
  | 'batch-job' | 'computer-use' | 'lsp-intelligence' | 'persistent-service'
  | 'ci-cd' | 'ml-training' | 'general';

export type TaskDuration = 'short' | 'medium' | 'long' | 'persistent';

export type ProviderService =
  | 'pty' | 'preview' | 'snapshot' | 'batch' | 'agent' | 'computer-use'
  | 'lsp' | 'object-storage' | 'persistent-fs' | 'auto-suspend' | 'services' | 'desktop';

export interface TaskContext {
  type: TaskType;
  duration?: TaskDuration;
  requiresPersistence?: boolean;
  requiresBackend?: boolean;
  requiresGPU?: boolean;
  fileCount?: number;
  needsServices?: ProviderService[];
  preferredRegion?: string;
  costSensitivity?: 'low' | 'medium' | 'high';
  performancePriority?: 'latency' | 'throughput' | 'balanced';
}

export interface ProviderSelectionResult {
  provider: SandboxProviderType;
  confidence: number;
  matchedServices: ProviderService[];
  missingServices: ProviderService[];
  alternatives: SandboxProviderType[];
  reason: string;
  quotaRemaining?: number;
}

declare class LatencyTracker {
  record(provider: SandboxProviderType, latencyMs: number): void;
  getMetrics(provider: SandboxProviderType): any;
  getProvidersByLatency(): SandboxProviderType[];
  isLatencyAcceptable(provider: SandboxProviderType, thresholdMs?: number): boolean;
  getLatencyTier(provider: SandboxProviderType): 'low' | 'medium' | 'high';
}

declare class ProviderRouter {
  selectOptimalProvider(context: TaskContext): Promise<SandboxProviderType>;
  selectWithServices(context: TaskContext & { needsServices: ProviderService[] }): Promise<ProviderSelectionResult>;
  getRecommendations(context: TaskContext): Promise<{
    primary: SandboxProviderType;
    alternatives: Array<{ provider: SandboxProviderType; reason: string }>;
  }>;
  selectByExecutionPolicy(policy: any): Promise<{
    provider: SandboxProviderType | 'local';
    confidence: number;
    reason: string;
  }>;
}

export const latencyTracker: LatencyTracker;
export const providerRouter: ProviderRouter;
