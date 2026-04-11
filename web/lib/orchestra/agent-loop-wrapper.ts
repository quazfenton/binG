/**
 * Agent Loop Wrapper — Wraps CapabilityRouter with agent-specific policy enforcement
 *
 * Preserves all unique agent-loop logic while routing execution through the
 * centralized CapabilityRouter. This ensures:
 * - Rate limiting per-user, per-bucket (commands, fileOps, codeExecution, gitOps, processOps)
 * - HITL (Human-in-the-Loop) enforcement for risky commands
 * - Command validation (schema + blocked patterns)
 * - Background process registry tracking
 * - Bootstrapped agency learning integration
 *
 * All actual capability execution goes through CapabilityRouter.
 */

import { getCapabilityRouter } from '@/lib/tools/router';
import { createSandboxRateLimiter } from '@/lib/sandbox/providers/rate-limiter';
import { evaluateActiveWorkflow, type ApprovalContext } from '@/lib/orchestra/stateful-agent';
import { validateCommand as validateBlockedCommand } from '@/lib/sandbox/security';
import {
  validateToolInput,
  ExecShellSchema,
  WriteFileSchema,
  validateShellCommand,
} from '@/lib/sandbox/validation-schemas';
import { createBootstrappedAgency } from '@bing/shared/agent/bootstrapped-agency';
import { createLogger } from '@/lib/utils/logger';
import type { SandboxHandle } from '@/lib/sandbox/providers/sandbox-provider';

const log = createLogger('AgentLoop:Wrapper');

/**
 * Tracked background process
 */
export interface TrackedProcess {
  pid?: string;
  command: string;
  startedAt: Date;
  sandboxId: string;
  logFile?: string;
}

/**
 * Background process registry (exported for agent-loop.ts compatibility)
 */
const processRegistry = new Map<string, TrackedProcess[]>();

export function registerProcess(sandboxId: string, process: TrackedProcess): void {
  const existing = processRegistry.get(sandboxId) || [];
  existing.push(process);
  processRegistry.set(sandboxId, existing);
}

export function getProcessesForSandbox(sandboxId: string): TrackedProcess[] {
  return processRegistry.get(sandboxId) || [];
}

export function removeProcess(sandboxId: string, pidOrName: string): void {
  const tracked = processRegistry.get(sandboxId) || [];
  const filtered = tracked.filter(p => p.pid !== pidOrName && !p.command.includes(pidOrName));
  if (filtered.length !== tracked.length) {
    processRegistry.set(sandboxId, filtered);
  }
}

export { processRegistry };

/**
 * Agent loop wrapper — wraps CapabilityRouter with agent-specific policies
 */
export class AgentLoopWrapper {
  private readonly rateLimiter = createSandboxRateLimiter();
  private readonly agency: ReturnType<typeof createBootstrappedAgency>;
  private sandboxHandle: SandboxHandle;
  private sandboxId: string;
  private userId?: string;

  constructor(options: {
    sandboxHandle: SandboxHandle;
    sandboxId: string;
    userId?: string;
  }) {
    this.sandboxHandle = options.sandboxHandle;
    this.sandboxId = options.sandboxId;
    this.userId = options.userId;

    // Initialize bootstrapped agency for learning
    this.agency = createBootstrappedAgency({
      sessionId: this.sandboxId,
      userId: this.userId,  // Pass real user ID — prevents 'agency' phantom workspace
      enableLearning: true,
      maxHistorySize: 500,
      enablePatternRecognition: true,
      enableAdaptiveSelection: true,
    });
  }

  /**
   * Execute a capability with all agent-loop policies enforced
   */
  async execute(
    capabilityId: string,
    args: Record<string, any>,
  ): Promise<{ success: boolean; output: any; exitCode: number; error?: string }> {
    const rateLimitKey = this.userId || 'anonymous';

    // 1. Rate limiting
    const rateBucket = this.getRateBucket(capabilityId);
    const rateLimitResult = await this.rateLimiter.check(rateLimitKey, rateBucket);
    if (!rateLimitResult.allowed) {
      return {
        success: false,
        output: `Rate limit exceeded: ${rateLimitResult.message}`,
        exitCode: 1,
      };
    }

    // 2. HITL enforcement for risky capabilities
    const hitlResult = this.evaluateHITL(capabilityId, args);
    if (hitlResult.blocked) {
      return {
        success: false,
        output: hitlResult.reason,
        exitCode: 1,
        error: hitlResult.reason,
      };
    }

    // 3. Command validation for shell capabilities
    if (capabilityId === 'sandbox.shell' || capabilityId === 'process.start') {
      const cmdValidation = this.validateCommand(args);
      if (!cmdValidation.valid) {
        return {
          success: false,
          output: cmdValidation.reason || 'Command validation failed',
          exitCode: 1,
        };
      }
    }

    // 4. Execute through CapabilityRouter
    const router = getCapabilityRouter();
    try {
      const result = await router.execute(capabilityId, args, {
        userId: this.userId,
        sessionId: this.sandboxId,
      } as any);

      // 5. Record successful rate limit
      await this.rateLimiter.record(rateLimitKey, rateBucket);

      // 6. Track background processes
      if (capabilityId === 'process.start' && result.success) {
        this.trackProcess(args.command, result);
      }

      return {
        success: result.success,
        output: result.output,
        exitCode: result.success ? 0 : 1,
        error: result.error,
      };
    } catch (error: any) {
      log.error('CapabilityRouter execution failed', { capabilityId, error: error.message });
      return {
        success: false,
        output: error.message,
        exitCode: 1,
        error: error.message,
      };
    }
  }

  /**
   * Get learned capabilities from bootstrapped agency
   */
  getLearnedCapabilities(task: string, limit: number = 8): string[] {
    return this.agency.getLearnedCapabilities(task, limit);
  }

  /**
   * Record execution with agency for learning
   */
  recordExecution(task: string, success: boolean, capabilities?: string[]): void {
    this.agency.execute({
      task,
      capabilities: capabilities || this.getLearnedCapabilities(task, 8),
      chain: (capabilities?.length || 0) > 1,
    }).catch(() => {});
  }

  /**
   * Map capability ID to rate limit bucket
   */
  private getRateBucket(capabilityId: string): 'commands' | 'fileOps' | 'codeExecution' | 'gitOps' | 'processOps' {
    if (capabilityId.startsWith('sandbox.shell') || capabilityId.startsWith('process.')) return 'commands';
    if (capabilityId.startsWith('file.') || capabilityId.startsWith('code.ast_diff') || capabilityId.startsWith('code.syntax_check')) return 'fileOps';
    if (capabilityId.startsWith('code.run') || capabilityId.startsWith('sandbox.execute')) return 'codeExecution';
    if (capabilityId.startsWith('repo.')) return 'gitOps';
    return 'processOps';
  }

  /**
   * Evaluate HITL for a capability execution
   */
  private evaluateHITL(capabilityId: string, args: Record<string, any>): { blocked: boolean; reason?: string } {
    const enforceHitl = process.env.ENFORCE_HITL === 'true';

    if (capabilityId === 'sandbox.shell' || capabilityId === 'process.start') {
      const cmd = args.command || '';
      const riskLevel = cmd.includes('rm -rf') || cmd.includes('sudo') ? 'high' : 'medium';

      const approvalContext: ApprovalContext = { riskLevel, userId: this.userId };
      const execEval = evaluateActiveWorkflow('exec_shell', { command: cmd }, approvalContext);

      if (execEval.requiresApproval && enforceHitl) {
        return {
          blocked: true,
          reason: `Command blocked: requires approval (rule: ${execEval.matchedRule?.name || 'default'}). ${execEval.reason || ''}`,
        };
      }
    }

    if (capabilityId === 'file.write') {
      const path = args.path || '';
      const riskLevel = path.includes('.env') || path.includes('secret') ? 'high' : 'low';

      const approvalContext: ApprovalContext = { filePath: path, riskLevel, userId: this.userId };
      const writeEval = evaluateActiveWorkflow('write_file', { path, content: args.content }, approvalContext);

      if (writeEval.requiresApproval && enforceHitl) {
        return {
          blocked: true,
          reason: `File write blocked: requires approval (rule: ${writeEval.matchedRule?.name || 'default'}). ${writeEval.reason || ''}`,
        };
      }
    }

    return { blocked: false };
  }

  /**
   * Validate command for shell/process capabilities
   */
  private validateCommand(args: Record<string, any>): { valid: boolean; reason?: string } {
    try {
      const validated = validateToolInput(ExecShellSchema, args, 'exec_shell');
      const commandValidation = validateShellCommand(validated.command, validateBlockedCommand);
      if (!commandValidation.valid) {
        return { valid: false, reason: commandValidation.reason || 'Command validation failed' };
      }
      return { valid: true };
    } catch {
      return { valid: false, reason: 'Command schema validation failed' };
    }
  }

  /**
   * Track a background process in the registry
   */
  private trackProcess(command: string, result: any): void {
    const pid = typeof result.output === 'string'
      ? result.output.match(/PID:\s*(\d+)/)?.[1]
      : undefined;

    registerProcess(this.sandboxId, {
      pid,
      command,
      startedAt: new Date(),
      sandboxId: this.sandboxId,
    });
  }
}

/**
 * Factory function
 */
export function createAgentLoopWrapper(options: {
  sandboxHandle: SandboxHandle;
  sandboxId: string;
  userId?: string;
}): AgentLoopWrapper {
  return new AgentLoopWrapper(options);
}
