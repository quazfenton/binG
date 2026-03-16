/**
 * Sandbox Execution Policies
 *
 * Defines how and where code should be executed based on risk level and requirements.
 * Replaces the simple noSandbox boolean with granular policy-based execution.
 */

/**
 * Execution policy determines sandbox requirements and provider selection
 */
export type ExecutionPolicy =
  /**
   * Local execution only - no cloud sandbox
   * Use for: Simple prompts, read-only operations, low-risk tasks
   * Provider: Local OpenCode CLI via npx
   */
  | 'local-safe'

  /**
   * Sandbox required - must use cloud sandbox
   * Use for: Code execution, bash commands, file writes
   * Provider: First available (daytona → e2b → sprites)
   */
  | 'sandbox-required'

  /**
   * Sandbox preferred but can fallback to local
   * Use for: Moderate-risk tasks that benefit from isolation
   * Provider: Try cloud first, fallback to local
   */
  | 'sandbox-preferred'

  /**
   * Heavy-duty sandbox with full resources
   * Use for: Full-stack apps, backend services, database operations
   * Provider: daytona (full desktop, computer use) or codesandbox
   */
  | 'sandbox-heavy'

  /**
   * Persistent sandbox with state preservation
   * Use for: Long-running services, multi-session work
   * Provider: sprites (auto-suspend, checkpoints) or codesandbox
   */
  | 'persistent-sandbox'

  /**
   * Desktop environment required
   * Use for: GUI apps, browser automation, computer use
   * Provider: daytona (computer use support)
   */
  | 'desktop-required';

/**
 * Execution policy configuration
 */
export interface ExecutionPolicyConfig {
  /** Policy name */
  policy: ExecutionPolicy;

  /** Allow fallback to local if cloud unavailable */
  allowLocalFallback: boolean;

  /** Maximum wait time for sandbox creation (seconds) */
  maxWaitTime?: number;

  /** Required provider capabilities */
  requiredCapabilities?: string[];

  /** Preferred providers (in order) */
  preferredProviders?: string[];

  /** Resource requirements */
  resources?: {
    cpu?: number;
    memory?: number;  // GB
    disk?: number;    // GB
  };
}

/**
 * Policy to configuration mapping
 */
export const EXECUTION_POLICY_CONFIGS: Record<ExecutionPolicy, ExecutionPolicyConfig> = {
  'local-safe': {
    policy: 'local-safe',
    allowLocalFallback: true,
    maxWaitTime: 5,
    requiredCapabilities: [],
    preferredProviders: [],
  },

  'sandbox-required': {
    policy: 'sandbox-required',
    allowLocalFallback: false,
    maxWaitTime: 30,
    requiredCapabilities: ['pty', 'preview'],
    preferredProviders: ['daytona', 'e2b', 'sprites'],
    resources: { cpu: 1, memory: 2 },
  },

  'sandbox-preferred': {
    policy: 'sandbox-preferred',
    allowLocalFallback: true,
    maxWaitTime: 20,
    requiredCapabilities: ['pty'],
    preferredProviders: ['daytona', 'e2b'],
    resources: { cpu: 1, memory: 2 },
  },

  'sandbox-heavy': {
    policy: 'sandbox-heavy',
    allowLocalFallback: false,
    maxWaitTime: 60,
    requiredCapabilities: ['pty', 'preview', 'services'],
    preferredProviders: ['daytona', 'codesandbox'],
    resources: { cpu: 2, memory: 4, disk: 20 },
  },

  'persistent-sandbox': {
    policy: 'persistent-sandbox',
    allowLocalFallback: false,
    maxWaitTime: 60,
    requiredCapabilities: ['pty', 'preview', 'snapshot', 'auto-suspend'],
    preferredProviders: ['sprites', 'codesandbox'],
    resources: { cpu: 2, memory: 4, disk: 50 },
  },

  'desktop-required': {
    policy: 'desktop-required',
    allowLocalFallback: false,
    maxWaitTime: 60,
    requiredCapabilities: ['pty', 'desktop', 'computer-use'],
    preferredProviders: ['daytona'],
    resources: { cpu: 2, memory: 4 },
  },
};

/**
 * Get configuration for execution policy
 */
export function getExecutionPolicyConfig(policy: ExecutionPolicy): ExecutionPolicyConfig {
  return EXECUTION_POLICY_CONFIGS[policy];
}

/**
 * Determine execution policy from task characteristics
 */
export function determineExecutionPolicy(options: {
  task?: string;
  requiresBash?: boolean;
  requiresFileWrite?: boolean;
  requiresBackend?: boolean;
  requiresDatabase?: boolean;
  requiresGUI?: boolean;
  isLongRunning?: boolean;
  fileCount?: number;
}): ExecutionPolicy {
  const {
    task = '',
    requiresBash = false,
    requiresFileWrite = false,
    requiresBackend = false,
    requiresDatabase = false,
    requiresGUI = false,
    isLongRunning = false,
    fileCount = 0,
  } = options;

  const taskLower = task.toLowerCase();

  // Desktop/GUI tasks
  if (requiresGUI || taskLower.includes('gui') || taskLower.includes('desktop') || taskLower.includes('browser')) {
    return 'desktop-required';
  }

  // Long-running with persistence needs
  if (isLongRunning || taskLower.includes('server') || taskLower.includes('service') || taskLower.includes('daemon')) {
    return 'persistent-sandbox';
  }

  // Heavy backend/database tasks
  if (requiresBackend || requiresDatabase || fileCount > 50) {
    return 'sandbox-heavy';
  }

  // Bash or file write operations
  if (requiresBash || requiresFileWrite) {
    return 'sandbox-required';
  }

  // Prefer sandbox for moderate tasks
  if (taskLower.includes('install') || taskLower.includes('build') || taskLower.includes('test')) {
    return 'sandbox-preferred';
  }

  // Default to local-safe for simple tasks
  return 'local-safe';
}

/**
 * Check if policy requires cloud sandbox
 */
export function requiresCloudSandbox(policy: ExecutionPolicy): boolean {
  return policy !== 'local-safe';
}

/**
 * Check if policy allows local fallback
 */
export function allowsLocalFallback(policy: ExecutionPolicy): boolean {
  return EXECUTION_POLICY_CONFIGS[policy].allowLocalFallback;
}

/**
 * Get preferred providers for policy
 */
export function getPreferredProviders(policy: ExecutionPolicy): string[] {
  return EXECUTION_POLICY_CONFIGS[policy].preferredProviders || [];
}
