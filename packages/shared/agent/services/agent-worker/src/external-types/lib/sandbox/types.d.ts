/**
 * Type declarations for @/lib/sandbox/types
 * Stub for agent-worker — mirrors real exports from web/lib/sandbox/types.ts
 *
 * ⚠️ KEEP IN SYNC: If the real module's exports change, this stub must be updated
 * to match. Otherwise TS errors will silently disappear while runtime breaks.
 */

export type ExecutionPolicy =
  | 'local-safe' | 'sandbox-required' | 'sandbox-preferred' | 'sandbox-heavy'
  | 'persistent-sandbox' | 'desktop-required' | 'cloud-sandbox' | 'isolated-code-exec';

export interface ExecutionPolicyConfig {
  policy: ExecutionPolicy;
  allowLocalFallback: boolean;
  maxWaitTime?: number;
  requiredCapabilities?: string[];
  preferredProviders?: string[];
  resources?: { cpu?: number; memory?: number; disk?: number };
}

export function determineExecutionPolicy(options: {
  task?: string;
  requiresBash?: boolean;
  requiresFileWrite?: boolean;
  requiresBackend?: boolean;
  requiresDatabase?: boolean;
  requiresGUI?: boolean;
  isLongRunning?: boolean;
  fileCount?: number;
}): ExecutionPolicy;

export function getExecutionPolicyConfig(policy: ExecutionPolicy): ExecutionPolicyConfig;
export function requiresCloudSandbox(policy: ExecutionPolicy): boolean;
export function allowsLocalFallback(policy: ExecutionPolicy): boolean;
export function getPreferredProviders(policy: ExecutionPolicy): string[];
