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
 * 
 * KEY PRINCIPLE: Only trigger sandbox for ACTUAL CODE EXECUTION (bash commands),
 * NOT for code writing/generation prompts.
 * 
 * Sandbox should be triggered when:
 * - User explicitly asks to RUN/EXECUTE code
 * - User asks to run bash/shell commands
 * - User asks to install packages, run tests, start servers
 * 
 * Sandbox should NOT be triggered for:
 * - Writing/generating code files
 * - Explaining code
 * - Planning architecture
 * - Answering questions about code
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

  // Patterns that indicate ACTUAL EXECUTION (not just writing code)
  const executionPatterns = [
    // Explicit execution commands
    /\b(run|execute|start|launch|deploy)\b.*\b(code|script|app|server|bot)\b/i,
    /\b(run|execute|test)\b.*\b(python|node|npm|yarn|pnpm|bash|sh)\b/i,
    /\b(install|npm install|pip install|yarn add|pnpm add)\b/i,
    /\b(build|compile|bundle|webpack|vite)\b/i,
    /\b(serve|dev|start)\b.*\b(server|app|localhost)\b/i,
    // Bash/shell execution
    /\b(bash|sh|shell|terminal|command line)\b/i,
    /\b(execute|run)\b.*\b(command|script)\b/i,
    // Database operations that require running
    /\b(migrate|seed|psql|mysql|mongo)\b/i,
  ];

  // Patterns that indicate CODE WRITING (should NOT trigger sandbox)
  const codeWritingPatterns = [
    /\b(write|create|generate|make|build)\b.*\b(code|function|component|file|app)\b/i,
    /\b(write|create|generate)\b.*\b(\.ts|\.js|\.py|\.tsx|\.jsx|\.json)\b/i,
    /\b(show|display|give|provide)\b.*\b(code|example|snippet)\b/i,
    /\b(help|how)\b.*\b(write|create|make|build)\b/i,
    /\b(explain|describe|what|how)\b/i,
  ];

  // Desktop/GUI tasks - require sandbox with desktop
  if (requiresGUI || taskLower.includes('gui') || taskLower.includes('desktop') || taskLower.includes('browser')) {
    return 'desktop-required';
  }

  // Check if this is clearly a code writing task (should NOT use sandbox)
  const isCodeWriting = codeWritingPatterns.some(pattern => pattern.test(task));
  if (isCodeWriting && !requiresBash) {
    // Code writing without explicit bash execution = local-safe
    return 'local-safe';
  }

  // Long-running with persistence needs - requires sandbox
  if (isLongRunning || taskLower.includes('server') || taskLower.includes('service') || taskLower.includes('daemon')) {
    return 'persistent-sandbox';
  }

  // Heavy backend/database tasks - requires sandbox
  if (requiresBackend || requiresDatabase || fileCount > 50) {
    return 'sandbox-heavy';
  }

  // Check for explicit execution patterns (bash commands, running code)
  const isExecution = executionPatterns.some(pattern => pattern.test(task));
  if (isExecution || requiresBash) {
    // Actual code execution or bash = sandbox required
    return 'sandbox-required';
  }

  // Prefer sandbox for moderate tasks that might need execution
  if (taskLower.includes('install') || taskLower.includes('build') || taskLower.includes('test')) {
    return 'sandbox-preferred';
  }

  // Default to local-safe for simple tasks, code writing, explanations
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
