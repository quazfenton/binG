/**
 * Sandbox Execution Policies
 *
 * Defines how and where code should be executed based on risk level and requirements.
 * Replaces the simple noSandbox boolean with granular policy-based execution.
 */

/**
 * Tool execution result
 */
export interface ToolResult {
  /** Whether tool execution was successful */
  success: boolean;
  /** Tool output */
  output?: string;
  /** Binary output (base64 encoded) */
  binary?: string;
  /** Error message if failed */
  error?: string;
  /** Tool name */
  toolName?: string;
  /** Execution time in milliseconds */
  executionTime?: number;
  /** Exit code (0 for success, non-zero for failure) */
  exitCode?: number;
}

/**
 * Preview link information
 */
export interface PreviewInfo {
  /** Port number */
  port: number;
  /** Preview URL */
  url: string;
  /** Access token (if required) */
  token?: string;
  /** When preview was opened */
  openedAt?: number;
}

/**
 * Agent message for communication
 */
export interface AgentMessage {
  type: 'text' | 'tool' | 'error' | 'status';
  content: string;
  timestamp?: number;
  metadata?: Record<string, any>;
}

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
  | 'desktop-required'

  /**
   * Cloud sandbox with auto-scaling for resource-intensive tasks
   * Use for: ML training, large builds, production deployments
   * Provider: e2b or daytona with high resources
   */
  | 'cloud-sandbox';

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

  'cloud-sandbox': {
    policy: 'cloud-sandbox',
    allowLocalFallback: false,
    maxWaitTime: 120,
    requiredCapabilities: ['pty', 'preview', 'high-resources'],
    preferredProviders: ['e2b', 'daytona'],
    resources: { cpu: 4, memory: 8, disk: 50 },
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

// ============================================================================
// Risk Assessment
// ============================================================================

/**
 * Risk level for command/code execution
 */
export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Individual risk factor
 */
export interface RiskFactor {
  /** Factor name */
  name: string;
  /** Risk contribution (0-100) */
  severity: number;
  /** Description of the risk */
  description: string;
  /** Pattern that matched */
  pattern?: string;
}

/**
 * Risk assessment result
 */
export interface RiskAssessment {
  /** Overall risk level */
  level: RiskLevel;
  /** Risk score (0-100) */
  score: number;
  /** Detected risk factors */
  factors: RiskFactor[];
  /** Recommended execution policy */
  recommendedPolicy: ExecutionPolicy;
  /** Whether execution should be blocked */
  shouldBlock: boolean;
  /** Reason for blocking (if applicable) */
  blockReason?: string;
}

/**
 * Risk detection patterns
 */
export const RISK_PATTERNS: Record<string, { pattern: RegExp; severity: number; description: string }> = {
  // Critical - Block immediately
  'fork-bomb': {
    pattern: /:\(\)\{\s*:\|:\s*&\s*\};\s*:/,
    severity: 100,
    description: 'Fork bomb detected',
  },
  'rm-root': {
    pattern: /rm\s+(-[rf]+\s+)?\/(\s|$)/,
    severity: 100,
    description: 'Attempt to delete root filesystem',
  },
  'sudo-rm': {
    pattern: /sudo\s+rm\s+(-[rf]+\s+)?\/?$/,
    severity: 100,
    description: 'Sudo delete root',
  },
  'crypto-miner': {
    pattern: /xmrig|cryptonight|monero|minerd/i,
    severity: 100,
    description: 'Cryptocurrency miner detected',
  },

  // High - Require sandbox-heavy
  'network-curl': {
    pattern: /curl\s+.*\|.*(?:sh|bash)/,
    severity: 80,
    description: 'Curl pipe to shell (potential supply chain attack)',
  },
  'network-wget': {
    pattern: /wget\s+.*\|.*(?:sh|bash)/,
    severity: 80,
    description: 'Wget pipe to shell',
  },
  'env-access': {
    pattern: /process\.env|os\.environ|getenv/i,
    severity: 70,
    description: 'Environment variable access',
  },
  'file-delete': {
    pattern: /rm\s+-rf|unlink|rmdir\s+-p/i,
    severity: 75,
    description: 'Recursive delete operation',
  },
  'chmod-recursive': {
    pattern: /chmod\s+-R\s+777/i,
    severity: 80,
    description: 'Recursive chmod 777 (security risk)',
  },

  // Medium - Require sandbox-preferred
  'npm-install': {
    pattern: /npm\s+install|yarn\s+add|pnpm\s+add/i,
    severity: 50,
    description: 'Package installation (network + script execution)',
  },
  'pip-install': {
    pattern: /pip\s+install|pip3\s+install/i,
    severity: 50,
    description: 'Python package installation',
  },
  'docker-command': {
    pattern: /docker\s+(build|run|exec)/i,
    severity: 60,
    description: 'Docker command (container escape risk)',
  },
  'git-clone': {
    pattern: /git\s+clone/i,
    severity: 40,
    description: 'Git clone (network + disk usage)',
  },
  'database-access': {
    pattern: /mysql|postgres|mongodb|redis/i,
    severity: 55,
    description: 'Database connection',
  },

  // Low - Can use local-safe with monitoring
  'file-read': {
    pattern: /fs\.readFile|open\(|\.read\(/i,
    severity: 20,
    description: 'File read operation',
  },
  'file-write': {
    pattern: /fs\.writeFile|\.write\(/i,
    severity: 30,
    description: 'File write operation',
  },
  'child-process': {
    pattern: /child_process|exec\(|spawn\(/i,
    severity: 45,
    description: 'Child process execution',
  },
};

/**
 * Risk thresholds for policy selection
 */
export const RISK_THRESHOLDS: Record<RiskLevel, { min: number; max: number; policy: ExecutionPolicy }> = {
  'safe': { min: 0, max: 20, policy: 'local-safe' },
  'low': { min: 21, max: 40, policy: 'sandbox-preferred' },
  'medium': { min: 41, max: 60, policy: 'sandbox-required' },
  'high': { min: 61, max: 80, policy: 'sandbox-heavy' },
  'critical': { min: 81, max: 100, policy: 'cloud-sandbox' },
};

/**
 * Assess risk of a command or code snippet
 */
export function assessRisk(input: string, context?: {
  userId?: string;
  source?: 'llm' | 'user' | 'automated';
  previousCommands?: string[];
}): RiskAssessment {
  const factors: RiskFactor[] = [];
  let totalScore = 0;

  // Check against all risk patterns
  for (const [name, { pattern, severity, description }] of Object.entries(RISK_PATTERNS)) {
    if (pattern.test(input)) {
      factors.push({
        name,
        severity,
        description,
        pattern: pattern.source,
      });
      totalScore = Math.max(totalScore, severity);
    }
  }

  // Context-based risk adjustments
  if (context?.source === 'user') {
    // User-entered commands get slight trust boost
    totalScore = Math.floor(totalScore * 0.9);
  }

  // Check for command chaining (increases risk)
  if (/[;&|]|\|\||&&/.test(input) && factors.length > 1) {
    totalScore = Math.min(100, totalScore + 10);
    factors.push({
      name: 'command-chaining',
      severity: 10,
      description: 'Multiple commands chained together',
    });
  }

  // Determine risk level
  let level: RiskLevel = 'safe';
  for (const [riskLevel, threshold] of Object.entries(RISK_THRESHOLDS)) {
    if (totalScore >= threshold.min && totalScore <= threshold.max) {
      level = riskLevel as RiskLevel;
      break;
    }
  }

  // Critical risks should be blocked
  const shouldBlock = level === 'critical' && factors.some(f => f.severity >= 100);
  const blockReason = shouldBlock
    ? `Blocked: ${factors.filter(f => f.severity >= 100).map(f => f.description).join(', ')}`
    : undefined;

  // Get recommended policy
  const recommendedPolicy = RISK_THRESHOLDS[level].policy;

  return {
    level,
    score: totalScore,
    factors,
    recommendedPolicy,
    shouldBlock,
    blockReason,
  };
}

/**
 * Workspace session - represents an active sandbox workspace
 * Legacy type for backwards compatibility
 */
export interface WorkspaceSession {
  sessionId: string;
  sandboxId: string;
  userId: string;
  ptySessionId?: string;
  cwd: string;
  createdAt: string;
  lastActive: string;
  status: 'creating' | 'ready' | 'active' | 'suspended' | 'closed';
}

/**
 * Sandbox configuration - legacy type for backwards compatibility
 */
export interface SandboxConfig {
  provider?: string;
  language?: string;
  template?: string;
  resources?: {
    cpu?: number;
    memory?: number;
    disk?: number;
  };
  env?: Record<string, string>;
}
