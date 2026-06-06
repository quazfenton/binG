/**
 * Execution Router — Terminal Command Interception & Sandbox Routing
 *
 * Intercepts user-typed terminal commands in basic VM shells and auto-routes
 * non-trivial commands (npm install, python scripts, daemons, build tools)
 * to pre-warmed sandbox providers (E2B, Modal, Firecracker via Daytona, etc.).
 *
 * Architecture:
 *   User types command in terminal
 *     → Execution Router classifies command (trivial vs non-trivial)
 *     → Trivial: passes through to local PTY (ls, pwd, cat, echo...)
 *     → Non-trivial: routes to sandbox provider via SandboxOrchestrator
 *     → Output streams back to terminal transparently
 *
 * @see lib/sandbox/provider-router.ts — Provider selection
 * @see lib/sandbox/sandbox-orchestrator.ts — Sandbox lifecycle & execution
 * @see lib/terminal/commands/llm-bash-router.ts — LLM command routing (separate system)
 */

import { createLogger } from '@/lib/utils/logger';
import type { SandboxProviderType } from '@/lib/sandbox/providers';
import { latencyTracker } from '@/lib/sandbox/provider-router';

const logger = createLogger('ExecutionRouter');

// ============================================================================
// Command Classification
// ============================================================================

/**
 * Execution tier for a terminal command.
 */
export type ExecutionTier =
  | 'trivial'         // Run in local PTY — ls, pwd, cat, echo, cd, whoami
  | 'moderate'        // Route to sandbox — npm install, pip install, git clone
  | 'heavy'           // Route to sandbox — build tools, daemons, ML training
  | 'always-local';   // Must run locally — cd, source, export, alias, exit

/**
 * Classified command with routing decision.
 */
export interface ClassifiedCommand {
  /** Original command text */
  command: string;
  /** Base command (first word) */
  baseCommand: string;
  /** Execution tier */
  tier: ExecutionTier;
  /** Whether to route to a sandbox provider */
  routeToSandbox: boolean;
  /** Reason for the classification */
  reason: string;
  /** Detected command category for provider selection */
  category: CommandCategory;
  /** Whether this command requires filesystem sync back to local */
  requiresSync: boolean;
  /** Estimated duration category */
  estimatedDuration: 'short' | 'medium' | 'long';
}

export type CommandCategory =
  | 'package-install'
  | 'package-build'
  | 'script-execution'
  | 'daemon-service'
  | 'network-heavy'
  | 'build-compile'
  | 'git-operation'
  | 'database'
  | 'ml-training'
  | 'file-navigation'
  | 'file-read'
  | 'file-write'
  | 'system-info'
  | 'shell-builtin'
  | 'pid-translation'
  | 'unknown';

// ============================================================================
// Command Patterns — Trivial (always run locally)
// ============================================================================

/** Commands that are ALWAYS trivial — no sandbox needed */
const ALWAYS_LOCAL_COMMANDS = new Set([
  'cd', 'pwd', 'echo', 'clear', 'reset', 'exit', 'logout',
  'source', '.', 'alias', 'unalias', 'export', 'unset',
  'history', 'jobs', 'fg', 'bg', 'disown',
  'type', 'which', 'command', 'hash',
  'set', 'shopt', 'complete', 'compgen',
  'dirs', 'popd', 'pushd',
]);

/** Commands that are trivial UNLESS they have certain flags/patterns */
const TRIVIAL_READ_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more',
  'file', 'stat', 'wc', 'du', 'df',
  'tree', 'find', 'locate',
  'grep', 'egrep', 'fgrep', 'rg',
  'whoami', 'id', 'uname', 'hostname', 'date', 'uptime',
  'env', 'printenv', 'tty',
  'ps', 'pgrep', 'pidof',
  'free', 'vmstat', 'iostat',
  'ip', 'ifconfig', 'netstat', 'ss', 'ping',
  'dig', 'nslookup', 'host',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2', 'bunzip2',
  'sort', 'uniq', 'cut', 'tr', 'awk', 'sed',
  'diff', 'cmp', 'comm',
  'man', 'info', 'whatis', 'apropos',
]);

/** Commands that need PID translation — virtual-to-real mapping for cross-provider process management */
const PID_TRANSLATION_COMMANDS = new Set([
  'ps', 'kill', 'pgrep', 'pidof', 'pkill',
]);

// ============================================================================
// Command Patterns — Non-Trivial (route to sandbox)
// ============================================================================

/** Package managers — always route to sandbox */
const PACKAGE_MANAGERS = new Set([
  'npm', 'npx', 'pnpm', 'yarn', 'bun',
  'pip', 'pip3', 'pipenv', 'poetry', 'conda',
  'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'brew',
  'gem', 'cargo', 'composer', 'nuget', 'dotnet',
  'go', 'stack', 'cabal',
]);

/** Build/compile tools — route to sandbox */
const BUILD_TOOLS = new Set([
  'make', 'cmake', 'ninja', 'bazel', 'meson',
  'gcc', 'g++', 'clang', 'clang++',
  'tsc', 'webpack', 'vite', 'rollup', 'esbuild', 'parcel',
  'next', 'nuxt', 'svelte-kit', 'remix',
  'docker', 'docker-compose', 'podman',
  'terraform', 'pulumi', 'ansible', 'ansible-playbook',
]);

/** Languages/interpreters that may run scripts */
const SCRIPT_EXECUTORS = new Set([
  'python', 'python3', 'node', 'ruby', 'perl', 'php',
  'deno', 'lua', 'racket', 'guile',
  'bash', 'sh', 'zsh', 'fish',
]);

/** Heavy network commands */
const NETWORK_HEAVY = new Set([
  'curl', 'wget', 'rsync', 'scp', 'sftp',
  'git',   // git clone/push/pull are heavy
  'svn', 'hg',
]);

/** Database clients */
const DATABASE_COMMANDS = new Set([
  'mysql', 'psql', 'sqlite3', 'mongo', 'mongosh',
  'redis-cli', 'pg_dump', 'pg_restore',
]);

// ============================================================================
// Flag patterns that indicate "this is non-trivial"
// ============================================================================

/** Flags that indicate a heavy/long-running operation */
const HEAVY_FLAGS = [
  /--build/, /--compile/, /--release/, /--production/,
  /--train/, /--fit/, /--epochs/,
  /--daemon/, /--detach/, /--background/,
  /--watch/, /--hot/,
];

/** Patterns indicating daemon/service launch */
const DAEMON_PATTERNS = [
  /&(\s*$|\s+)/,           // Background with &
  /nohup\s/,               // nohup prefix
  /systemctl\s+(start|restart|enable)/,
  /service\s+\w+\s+(start|restart)/,
  /pm2\s+(start|restart)/,
  /supervisorctl\s+/,
];

/** Patterns indicating a script is being executed (not just an interactive session) */
const SCRIPT_EXECUTION_PATTERNS = [
  /\.py(\s|$)/,      // python script.py
  /\.js(\s|$)/,      // node script.js
  /\.ts(\s|$)/,      // deno script.ts
  /\.rb(\s|$)/,      // ruby script.rb
  /\.sh(\s|$)/,      // bash script.sh
  /-c\s+['"]/,       // python -c "...", bash -c "..."
];

// ============================================================================
// Classifier
// ============================================================================

/**
 * Classify a terminal command to determine if it should be routed to a sandbox.
 */
export function classifyCommand(command: string): ClassifiedCommand {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      command: '',
      baseCommand: '',
      tier: 'trivial',
      routeToSandbox: false,
      reason: 'empty command',
      category: 'unknown',
      requiresSync: false,
      estimatedDuration: 'short',
    };
  }

  const parts = trimmed.split(/\s+/);
  const baseCmd = parts[0]?.toLowerCase() || '';
  const args = parts.slice(1).join(' ');

  // === Tier 1: Always-local (shell builtins) ===
  if (ALWAYS_LOCAL_COMMANDS.has(baseCmd)) {
    // EXCEPTION: if command has file redirects, treat as file-write (not always-local)
    // e.g., `echo "content" > file.txt` should route to sandbox
    if (/>|>>/.test(args)) {
      return {
        command: trimmed,
        baseCommand: baseCmd,
        tier: 'moderate',
        routeToSandbox: true,
        reason: `${baseCmd} with file redirection — routing to sandbox for safety`,
        category: 'file-write',
        requiresSync: true,
        estimatedDuration: 'short',
      };
    }

    return {
      command: trimmed,
      baseCommand: baseCmd,
      tier: 'always-local',
      routeToSandbox: false,
      reason: `${baseCmd} is a shell builtin — runs locally`,
      category: 'shell-builtin',
      requiresSync: false,
      estimatedDuration: 'short',
    };
  }

  // === Tier 1.5: PID translation commands (ps, kill, pgrep, pidof) ===
  // These need virtual→real PID translation for cross-provider transparency.
  // The gateway intercepts these and resolves vPIDs before execution.
  if (PID_TRANSLATION_COMMANDS.has(baseCmd)) {
    return {
      command: trimmed,
      baseCommand: baseCmd,
      tier: 'trivial',
      routeToSandbox: false,
      reason: `${baseCmd} — PID translation layer intercepts for cross-provider process management`,
      category: 'pid-translation',
      requiresSync: false,
      estimatedDuration: 'short',
    };
  }

  // === Tier 2: File navigation / read-only ===
  if (TRIVIAL_READ_COMMANDS.has(baseCmd)) {
    // Check if any heavy flags are present
    const hasHeavyFlag = HEAVY_FLAGS.some((pattern) => pattern.test(args));
    if (hasHeavyFlag) {
      return {
        command: trimmed,
        baseCommand: baseCmd,
        tier: 'moderate',
        routeToSandbox: true,
        reason: `${baseCmd} with heavy flags — routing to sandbox`,
        category: 'file-write',
        requiresSync: true,
        estimatedDuration: 'medium',
      };
    }

    // Check for redirects/overwrites (make it potentially destructive)
    if (/>|>>/.test(args)) {
      return {
        command: trimmed,
        baseCommand: baseCmd,
        tier: 'moderate',
        routeToSandbox: true,
        reason: `${baseCmd} with file redirection — routing to sandbox for safety`,
        category: 'file-write',
        requiresSync: true,
        estimatedDuration: 'short',
      };
    }

    return {
      command: trimmed,
      baseCommand: baseCmd,
      tier: 'trivial',
      routeToSandbox: false,
      reason: `${baseCmd} is a read-only file operation`,
      category: baseCmd === 'find' || baseCmd === 'grep' || baseCmd === 'rg'
        ? 'file-navigation' : 'file-read',
      requiresSync: false,
      estimatedDuration: 'short',
    };
  }

  // === Tier 3: Package managers → always sandbox ===
  if (PACKAGE_MANAGERS.has(baseCmd)) {
    // Running a package manager with version flag is trivial
    const isVersionCheck = /^(-v|--version|version)$/.test(args.trim());
    if (isVersionCheck) {
      return {
        command: trimmed,
        baseCommand: baseCmd,
        tier: 'trivial',
        routeToSandbox: false,
        reason: `${baseCmd} version check — runs locally`,
        category: 'system-info',
        requiresSync: false,
        estimatedDuration: 'short',
      };
    }

    return {
      command: trimmed,
      baseCommand: baseCmd,
      tier: 'heavy',
      routeToSandbox: true,
      reason: `${baseCmd} is a package manager — routing to sandbox`,
      category: baseCmd === 'npm' || baseCmd === 'pnpm' || baseCmd === 'yarn'
        ? (args.includes('run') ? 'package-build' : 'package-install')
        : 'package-install',
      requiresSync: true,
      estimatedDuration: 'medium',
    };
  }

  // === Tier 4: Build tools → always sandbox ===
  if (BUILD_TOOLS.has(baseCmd)) {
    return {
      command: trimmed,
      baseCommand: baseCmd,
      tier: 'heavy',
      routeToSandbox: true,
      reason: `${baseCmd} is a build tool — routing to sandbox`,
      category: 'build-compile',
      requiresSync: true,
      estimatedDuration: 'long',
    };
  }

  // === Tier 5: Script executors → sandbox if running a script ===
  if (SCRIPT_EXECUTORS.has(baseCmd)) {
    // Interactive session without arguments → run locally
    if (!args.trim()) {
      return {
        command: trimmed,
        baseCommand: baseCmd,
        tier: 'trivial',
        routeToSandbox: false,
        reason: `${baseCmd} interactive session — runs locally`,
        category: 'system-info',
        requiresSync: false,
        estimatedDuration: 'short',
      };
    }

    // Check if running an actual script file
    const isScript = SCRIPT_EXECUTION_PATTERNS.some((p) => p.test(args));
    const isInlineCode = /-c\s+['"]/.test(args);
    const isVersionCheck = /^(-v|--version|version)$/.test(args.trim());

    if (isVersionCheck) {
      return {
        command: trimmed,
        baseCommand: baseCmd,
        tier: 'trivial',
        routeToSandbox: false,
        reason: `${baseCmd} version check — runs locally`,
        category: 'system-info',
        requiresSync: false,
        estimatedDuration: 'short',
      };
    }

    if (isScript || isInlineCode) {
      return {
        command: trimmed,
        baseCommand: baseCmd,
        tier: 'heavy',
        routeToSandbox: true,
        reason: `${baseCmd} script execution — routing to sandbox`,
        category: 'script-execution',
        requiresSync: true,
        estimatedDuration: 'long',
      };
    }

    // Module/package execution (python -m ..., node -e ...)
    return {
      command: trimmed,
      baseCommand: baseCmd,
      tier: 'moderate',
      routeToSandbox: true,
      reason: `${baseCmd} module execution — routing to sandbox`,
      category: 'script-execution',
      requiresSync: true,
      estimatedDuration: 'medium',
    };
  }

  // === Tier 6: Network heavy → sandbox ===
  if (NETWORK_HEAVY.has(baseCmd)) {
    // Simple git status/diff are read-only
    if (baseCmd === 'git') {
      const subCmd = parts[1]?.toLowerCase() || '';
      const readOnlyGitOps = new Set([
        'status', 'log', 'diff', 'show', 'branch', 'tag',
        'remote', 'stash', 'blame', 'grep', 'ls-files',
        'rev-parse', 'rev-list', 'describe', 'config',
      ]);

      if (readOnlyGitOps.has(subCmd)) {
        return {
          command: trimmed,
          baseCommand: baseCmd,
          tier: 'trivial',
          routeToSandbox: false,
          reason: `git ${subCmd} is read-only — runs locally`,
          category: 'git-operation',
          requiresSync: false,
          estimatedDuration: 'short',
        };
      }

      // git clone, push, pull, fetch → sandbox
      return {
        command: trimmed,
        baseCommand: baseCmd,
        tier: 'moderate',
        routeToSandbox: true,
        reason: `git ${subCmd} requires network — routing to sandbox`,
        category: 'git-operation',
        requiresSync: true,
        estimatedDuration: 'medium',
      };
    }

    return {
      command: trimmed,
      baseCommand: baseCmd,
      tier: 'moderate',
      routeToSandbox: true,
      reason: `${baseCmd} is network-heavy — routing to sandbox`,
      category: 'network-heavy',
      requiresSync: true,
      estimatedDuration: 'medium',
    };
  }

  // === Tier 7: Database → sandbox ===
  if (DATABASE_COMMANDS.has(baseCmd)) {
    return {
      command: trimmed,
      baseCommand: baseCmd,
      tier: 'moderate',
      routeToSandbox: true,
      reason: `${baseCmd} database operation — routing to sandbox`,
      category: 'database',
      requiresSync: true,
      estimatedDuration: 'medium',
    };
  }

  // === Tier 8: Daemon detection ===
  const isDaemon = DAEMON_PATTERNS.some((p) => p.test(trimmed));
  if (isDaemon) {
    return {
      command: trimmed,
      baseCommand: baseCmd,
      tier: 'heavy',
      routeToSandbox: true,
      reason: 'daemon/service detected — routing to sandbox',
      category: 'daemon-service',
      requiresSync: false, // daemons run persistently in sandbox
      estimatedDuration: 'long',
    };
  }

  // === Tier 9: Default — moderate, route to sandbox for safety ===
  return {
    command: trimmed,
    baseCommand: baseCmd,
    tier: 'moderate',
    routeToSandbox: true,
    reason: `unknown command type '${baseCmd}' — routing to sandbox for safety`,
    category: 'unknown',
    requiresSync: true,
    estimatedDuration: 'medium',
  };
}

// ============================================================================
// Provider Selection
// ============================================================================

/**
 * Map a command category to the optimal sandbox provider type.
 *
 * Phase 8: Delegates to Runtime Broker for cost/latency/capacity-aware
 * selection instead of hardcoded category→provider mappings.
 *
 * Falls back to static mapping when the broker is unavailable.
 */
export async function selectProviderForCategory(
  category: CommandCategory,
  options?: { workspaceId?: string; costSensitivity?: 'low' | 'medium' | 'high' },
): Promise<SandboxProviderType> {
  try {
    const { getRuntimeBroker } = await import('../sandbox/runtime-broker');
    const broker = getRuntimeBroker();

    // Map command category to resource requirements for broker
    const request = categoryToBrokerRequest(category);
    if (options?.workspaceId) {
      request.workspaceId = options.workspaceId;
    }
    if (options?.costSensitivity) {
      request.costSensitivity = options.costSensitivity;
    }

    const decision = await broker.selectProvider(request);
    if (decision.provider !== 'local') {
      return decision.provider as SandboxProviderType;
    }

    // Broker chose local — fall through to static mapping for cloud default
  } catch (err: any) {
    // Broker unavailable — use static fallback
  }

  return selectProviderForCategoryStatic(category);
}

/**
 * Static fallback for provider selection (legacy hardcoded mapping).
 * Used when Runtime Broker is unavailable.
 */
function selectProviderForCategoryStatic(category: CommandCategory): SandboxProviderType {
  switch (category) {
    case 'package-install':
      return 'e2b';
    case 'package-build':
    case 'build-compile':
      return 'daytona';
    case 'script-execution':
      return 'e2b';
    case 'daemon-service':
      return 'sprites';
    case 'network-heavy':
      return 'daytona';
    case 'git-operation':
      return 'e2b';
    case 'database':
      return 'daytona';
    case 'ml-training':
      return 'modal-com';
    case 'file-write':
      return 'e2b';
    case 'file-navigation':
    case 'file-read':
    case 'system-info':
    case 'shell-builtin':
      return 'e2b';
    default:
      return 'e2b';
  }
}

/**
 * Convert a command category to a RuntimeBrokerRequest.
 */
function categoryToBrokerRequest(category: CommandCategory): {
  interactive: boolean;
  cpu: number;
  memory: number;
  gpu: boolean;
  expectedDuration: number;
  commandCategory: string;
  workspaceId?: string;
  costSensitivity?: 'low' | 'medium' | 'high';
} {
  switch (category) {
    case 'package-install':
      return { interactive: false, cpu: 2, memory: 1, gpu: false, expectedDuration: 120, commandCategory: category };
    case 'package-build':
    case 'build-compile':
      return { interactive: false, cpu: 4, memory: 2, gpu: false, expectedDuration: 300, commandCategory: category };
    case 'script-execution':
      return { interactive: false, cpu: 2, memory: 1, gpu: false, expectedDuration: 60, commandCategory: category };
    case 'daemon-service':
      return { interactive: true, cpu: 2, memory: 1, gpu: false, expectedDuration: 3600, commandCategory: category };
    case 'network-heavy':
      return { interactive: false, cpu: 1, memory: 0.5, gpu: false, expectedDuration: 60, commandCategory: category };
    case 'git-operation':
      return { interactive: false, cpu: 1, memory: 0.5, gpu: false, expectedDuration: 30, commandCategory: category };
    case 'database':
      return { interactive: true, cpu: 2, memory: 2, gpu: false, expectedDuration: 600, commandCategory: category };
    case 'ml-training':
      return { interactive: false, cpu: 8, memory: 16, gpu: true, expectedDuration: 3600, commandCategory: category };
    case 'file-write':
      return { interactive: false, cpu: 1, memory: 0.5, gpu: false, expectedDuration: 5, commandCategory: category };
    case 'file-navigation':
    case 'file-read':
    case 'system-info':
    case 'shell-builtin':
      return { interactive: true, cpu: 1, memory: 0.5, gpu: false, expectedDuration: 5, commandCategory: category };
    default:
      return { interactive: true, cpu: 1, memory: 0.5, gpu: false, expectedDuration: 30, commandCategory: 'unknown' };
  }
}

/**
 * Get a human-readable description of why a command was routed.
 */
export function getRoutingDescription(classified: ClassifiedCommand): string {
  if (!classified.routeToSandbox) {
    return `▶ Running locally: ${classified.reason}`;
  }
  // Phase 8: Use static fallback for routing description (async broker
  // resolution would require refactoring this sync helper).
  const provider = selectProviderForCategoryStatic(classified.category);
  return `⚡ Routed to ${provider} sandbox: ${classified.reason}`;
}

// ============================================================================
// Execution Bridge
// ============================================================================

export interface ExecutionRouteResult {
  /** Whether the command was routed to a sandbox */
  routed: boolean;
  /** The provider used (if routed) */
  provider?: SandboxProviderType;
  /** The classification result */
  classification: ClassifiedCommand;
  /** Command output (stdout + stderr) */
  output: string;
  /** Exit code */
  exitCode: number;
  /** Execution duration in ms */
  duration: number;
  /** Whether the sandbox was pre-warmed (instant) vs cold start */
  wasPreWarmed: boolean;
  /** If this is a daemon-class command, the created workspace service ID */
  serviceId?: string;
}

export interface ExecutionRouterConfig {
  /** User identifier for sandbox sessions */
  userId: string;
  /** Conversation identifier for session reuse */
  conversationId: string;
  /** Working directory to sync to sandbox */
  workingDir?: string;
  /** Whether execution routing is enabled */
  enabled: boolean;
  /** Callback for streaming output while command runs */
  onOutput?: (text: string) => void;
  /** Callback for routing notifications */
  onRoute?: (message: string) => void;
  /** Optional: workspace ID for service registration (used for daemon commands) */
  workspaceId?: string;
}

/**
 * Execute a terminal command, automatically routing non-trivial commands
 * to pre-warmed sandbox providers via the SandboxOrchestrator.
 *
 * Trivial commands (ls, cat, cd, etc.) return { routed: false } — the caller
 * should execute them locally in the PTY.
 *
 * Non-trivial commands are routed to sandbox providers and return the result.
 */
export async function executeWithRouting(
  command: string,
  config: ExecutionRouterConfig,
): Promise<ExecutionRouteResult> {
  const classification = classifyCommand(command);

  // If routing is disabled or command is trivial, skip
  if (!config.enabled || !classification.routeToSandbox) {
    return {
      routed: false,
      classification,
      output: '',
      exitCode: 0,
      duration: 0,
      wasPreWarmed: false,
    };
  }

  const provider = await selectProviderForCategory(classification.category, {
    workspaceId: config.workspaceId,
  });
  const startTime = Date.now();

  // Notify the user
  const routeMsg = getRoutingDescription(classification);
  logger.info('Routing command to sandbox', {
    command: command.slice(0, 100),
    tier: classification.tier,
    provider,
    reason: classification.reason,
  });
  config.onRoute?.(routeMsg + '\r\n');

  try {
    // Dynamically import the sandbox orchestrator (avoids circular deps)
    const { sandboxOrchestrator } = await import('@/lib/sandbox/sandbox-orchestrator');

    // Use workspaceId as the conversationId for affinity when available.
    // This ties the sandbox affinity key (userId:workspaceId) to the
    // workspaceServiceManager's workspace namespace, ensuring daemon
    // services (npm run dev, etc.) benefit from affinity-based cache warmth.
    const effectiveConversationId = config.workspaceId || config.conversationId;

    // Get or create a sandbox session (uses warm pool if available)
    const session = await sandboxOrchestrator.getSandbox({
      userId: config.userId,
      conversationId: effectiveConversationId,
      task: command,
      policy: classification.tier === 'heavy' ? 'sandbox-heavy' : 'sandbox-preferred',
    });

    // Execute the command in the sandbox
    const result = await sandboxOrchestrator.executeInSandbox(
      session.logicalId,
      command,
      {
        timeout: classification.estimatedDuration === 'long' ? 300000 : 120000,
        onProgress: (metrics) => {
          // Could stream resource usage to terminal if desired
          logger.debug('Sandbox execution progress', {
            cpu: metrics.cpuUsage,
            memory: metrics.memoryUsage,
          });
        },
      },
    );

    const duration = Date.now() - startTime;

    // Stream output to the terminal
    if (result.output && config.onOutput) {
      config.onOutput(result.output);
    }

    // Phase 8: Feed real execution latency back into the latency tracker
    // so the RuntimeBroker's latency scores improve over time from actual data.
    latencyTracker.record(provider, duration);

    logger.info('Sandbox execution complete', {
      command: command.slice(0, 100),
      provider,
      exitCode: result.exitCode,
      duration,
      wasPreWarmed: session.isWarm,
    });

    // If this is a daemon-class command, create a workspace service
    let serviceId: string | undefined;
    if (classification.category === 'daemon-service' && config.workspaceId) {
      try {
        const { workspaceServiceManager } = await import('@/lib/terminal/workspace-service-manager');
        const service = workspaceServiceManager.createService(
          config.workspaceId,
          config.userId,
          command,
          config.workingDir || '/workspace',
          { autoRestart: true },
        );
        // Phase 8: Set sandbox provider/id so preview URLs can be generated
        service.sandboxProvider = session.provider;
        service.sandboxId = session.sessionId;
        workspaceServiceManager.updateStatus(
          service.id,
          config.workspaceId,
          result.exitCode === 0 ? 'running' : 'crashed',
          result.exitCode,
        );
        // Phase 10: When a daemon service crashes, workspaceServiceManager.updateStatus()
        // automatically triggers workspace graph diagnostics via autoDiagnoseCrash().
        // The diagnostics (service status, port availability, process traces) are
        // logged at error level for immediate visibility.
        if (result.output) {
          workspaceServiceManager.feedOutput(service.id, config.workspaceId, result.output);
        }
        serviceId = service.id;
        logger.info('Workspace service created from daemon command', {
          serviceId,
          command: command.slice(0, 80),
          workspaceId: config.workspaceId,
        });
      } catch (svcErr: any) {
        logger.warn('Failed to create workspace service', { error: svcErr.message });
      }
    }

    return {
      routed: true,
      provider,
      classification,
      output: result.output,
      exitCode: result.exitCode,
      duration,
      wasPreWarmed: session.isWarm,
      serviceId,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;

    // Record the failed attempt too — high latency on failure signals
    // provider degradation to the RuntimeBroker's latency scorer.
    latencyTracker.record(provider, duration);

    logger.error('Sandbox execution failed, falling back to local', {
      command: command.slice(0, 100),
      provider,
      error: error.message,
    });

    // Fallback: return { routed: false } so caller executes locally
    if (config.onRoute) {
      config.onRoute?.(`⚠️  Sandbox unavailable (${error.message}) — running locally\r\n`);
    }

    return {
      routed: false,
      classification,
      output: '',
      exitCode: 0,
      duration,
      wasPreWarmed: false,
    };
  }
}

// ============================================================================
// Quick Classification Helpers
// ============================================================================

/**
 * Check if a command is trivial (can run locally).
 */
export function isTrivialCommand(command: string): boolean {
  const result = classifyCommand(command);
  return !result.routeToSandbox;
}

/**
 * Check if a command should be routed to a sandbox.
 */
export function shouldRouteCommand(command: string): boolean {
  const result = classifyCommand(command);
  return result.routeToSandbox;
}

/**
 * Get the recommended provider for a command without executing it.
 */
export async function getRecommendedProvider(command: string): Promise<SandboxProviderType | null> {
  const result = classifyCommand(command);
  if (!result.routeToSandbox) return null;
  return selectProviderForCategory(result.category);
}
