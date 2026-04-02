/**
 * Self-Healing Bash Layer
 * 
 * Automatic command repair on failure using LLM and diff-based patches
 * 
 * @see bash.md - Bash-native agent execution patterns
 */

import { BashFailureContext, CommandRepair, FixMemory } from './bash-event-schema';
import { executeBashCommand } from './bash-tool';
import { createLogger } from '@/lib/utils/logger';
import { virtualFilesystem } from '@/lib/virtual-filesystem/index.server';

const logger = createLogger('Bash:SelfHealing');

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Classify error type for targeted fixes
 */
export function classifyError(stderr: string): BashFailureContext['errorType'] {
  const lowerStderr = stderr.toLowerCase();

  if (lowerStderr.includes('command not found') || 
      lowerStderr.includes('no such file or directory') && stderr.includes('command')) {
    return 'missing_binary';
  }
  
  if (lowerStderr.includes('no such file') || 
      lowerStderr.includes('no such file or directory')) {
    return 'missing_file';
  }
  
  if (lowerStderr.includes('permission denied')) {
    return 'permissions';
  }
  
  if (lowerStderr.includes('syntax error') || 
      lowerStderr.includes('unexpected token')) {
    return 'syntax';
  }

  if (lowerStderr.includes('timed out')) {
    return 'timeout';
  }

  return 'unknown';
}

// ============================================================================
// Safety Layer
// ============================================================================

/**
 * Dangerous command patterns that should never be executed
 */
const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'rm -rf /*',
  'shutdown',
  'reboot',
  'halt',
  ':(){ :|:& };:', // Fork bomb
  'mkfs',
  'dd if=/dev/zero',
  'chmod -R 777 /',
  'chown -R root:root /',
  'wget.*\\|.*bash', // Download and execute
  'curl.*\\|.*bash',
  'rm.*--no-preserve-root',
];

/**
 * Check if command is safe to execute
 */
export function isCommandSafe(command: string): boolean {
  const lowerCommand = command.toLowerCase();
  
  return !DANGEROUS_PATTERNS.some(pattern => 
    new RegExp(pattern, 'i').test(lowerCommand)
  );
}

/**
 * Validate repair doesn't introduce dangerous patterns
 */
export function validateRepair(original: string, repaired: string): boolean {
  // Check if repair introduced dangerous patterns
  if (!isCommandSafe(repaired)) {
    logger.error('Repair introduced dangerous pattern', {
      original,
      repaired,
    });
    return false;
  }

  // Check for significant deviation (>50% change)
  const deviation = Math.abs(repaired.length - original.length) / original.length;
  if (deviation > 0.5) {
    logger.warn('Repair deviates too much from original', {
      original,
      repaired,
      deviation,
    });
    return false;
  }

  return true;
}

// ============================================================================
// Diff-Based Repair
// ============================================================================

/**
 * Generate diff-based repair using LLM
 */
export async function generateDiffRepair(
  failure: BashFailureContext
): Promise<CommandRepair | null> {
  // TODO: Integrate with LLM provider
  // For now, return null (no repair)
  
  logger.warn('LLM diff repair not yet integrated');
  return null;
}

/**
 * Apply diff patches to command
 */
export function applyDiff(command: string, diff: CommandRepair['diff']): string {
  if (!diff || diff.length === 0) {
    return command;
  }

  let updated = command;

  for (const patch of diff) {
    if (patch.type === 'replace') {
      updated = updated.replace(patch.target, patch.value!);
    } else if (patch.type === 'delete') {
      updated = updated.replace(patch.target, '');
    } else if (patch.type === 'insert') {
      updated += ' ' + patch.value;
    }
  }

  return updated;
}

/**
 * Check if change is minimal (safe)
 */
export function isMinimalChange(original: string, updated: string): boolean {
  const ratio = Math.abs(updated.length - original.length) / original.length;
  return ratio < 0.5; // Less than 50% change
}

// ============================================================================
// Targeted Fixes (Rule-Based)
// ============================================================================

/**
 * Configuration for self-healing behavior
 */
export interface SelfHealingConfig {
  /** Allow automatic sudo escalation for permission errors (default: false) */
  allowSudoEscalation?: boolean;
  /** Whitelist of commands safe to run with sudo (used when allowSudoEscalation is true) */
  safeSudoCommands?: string[];
}

// Safe commands that can be auto-escalated with sudo
const DEFAULT_SAFE_SUDO_COMMANDS = [
  'chmod',
  'chown',
  'mkdir',
  'touch',
  'apt-get',
  'apt',
  'yum',
  'dnf',
  'brew',
  'pip',
  'pip3',
  'npm',
  'pnpm',
  'yarn',
];

/**
 * Check if a command is safe to run with sudo
 */
function isSafeSudoCommand(command: string, safeCommands: string[] = DEFAULT_SAFE_SUDO_COMMANDS): boolean {
  const baseCommand = command.split(/\s+/)[0].toLowerCase();
  return safeCommands.some(safe => baseCommand === safe || baseCommand.endsWith(`/${safe}`));
}

/**
 * Apply targeted fix based on error type
 */
export function applyTargetedFix(
  command: string,
  errorType: BashFailureContext['errorType'],
  stderr: string,
  config?: SelfHealingConfig
): string | null {
  switch (errorType) {
    case 'missing_binary': {
      // Extract binary name from error
      const match = stderr.match(/command not found:\s*(\S+)/);
      if (match) {
        const binary = match[1];

        // Suggest common alternatives
        const alternatives: Record<string, string> = {
          'jqq': 'jq',
          'pythn': 'python',
          'pyhton': 'python',
          'npde': 'node',
          'nod': 'node',
        };
        
        if (alternatives[binary]) {
          return command.replace(binary, alternatives[binary]);
        }
      }
      break;
    }

    case 'missing_file': {
      // Extract filename from error
      const match = stderr.match(/No such file or directory:\s*(\S+)/);
      if (match) {
        const file = match[1];
        
        // Suggest looking in workspace
        if (!file.startsWith('/workspace') && !file.startsWith('./')) {
          return command.replace(file, `./${file}`);
        }
      }
      break;
    }

    case 'permissions': {
      // SECURITY: Only auto-escalate with sudo if explicitly allowed and command is safe
      const allowSudo = config?.allowSudoEscalation ?? false;
      const safeCommands = config?.safeSudoCommands || DEFAULT_SAFE_SUDO_COMMANDS;
      
      if (!command.startsWith('sudo ')) {
        if (allowSudo && isSafeSudoCommand(command, safeCommands)) {
          // Safe to auto-escalate
          return `sudo ${command}`;
        } else {
          // Don't auto-escalate - provide user guidance instead
          // Return null to indicate no automatic fix available
          // The error will be reported to the user with suggestions
          logger.warn('Permission error requires manual intervention', {
            command,
            suggestion: 'Try running with sudo or fix file permissions',
            safeSudoCommands: safeCommands,
          });
          return null;
        }
      }
      break;
    }

    case 'syntax': {
      // Common syntax fixes
      if (command.includes('||') && !command.includes('&&')) {
        // Maybe they meant && instead of ||
        return command.replace('||', '&&');
      }
      break;
    }
  }

  return null;
}

// ============================================================================
// Reinforcement Memory
// ============================================================================

/**
 * Normalize command for pattern matching
 */
export function normalizeCommand(cmd: string): string {
  return cmd
    .replace(/\d+/g, 'N') // Replace numbers
    .replace(/https?:\/\/\S+/g, 'URL') // Replace URLs
    .replace(/"[^"]*"/g, '"STR"') // Replace strings
    .replace(/'[^']*'/g, "'STR'")
    .trim()
    .toLowerCase();
}

/**
 * Find known fix from memory
 */
export async function findKnownFix(
  command: string,
  error: string
): Promise<FixMemory | null> {
  try {
    const pattern = normalizeCommand(command);
    const errorSnippet = error.slice(0, 50).toLowerCase();

    // Read fix memory from VFS
    const agentId = 'system'; // System-wide fixes
    const memoryPath = '/workspace/.bash-fixes/memory.json';

    let memories: FixMemory[] = [];
    
    try {
      const file = await virtualFilesystem.readFile(agentId, memoryPath);
      memories = JSON.parse(file.content);
    } catch (error: any) {
      // File doesn't exist yet
      return null;
    }

    // Find matching fixes
    const matches = memories.filter(
      m => m.pattern === pattern && m.error.toLowerCase().includes(errorSnippet)
    );

    if (matches.length > 0) {
      // Return best fix (highest success rate)
      return matches.sort((a, b) => b.successRate - a.successRate)[0];
    }

    return null;
  } catch (error: any) {
    logger.warn('Failed to find known fix', error.message);
    return null;
  }
}

/**
 * Store fix in memory
 */
export async function storeFix(
  original: string,
  fixed: string,
  error: string,
  success: boolean
): Promise<void> {
  try {
    const agentId = 'system';
    const memoryPath = '/workspace/.bash-fixes/memory.json';

    // Read existing memories
    let memories: FixMemory[] = [];
    
    try {
      const file = await virtualFilesystem.readFile(agentId, memoryPath);
      memories = JSON.parse(file.content);
    } catch (error: any) {
      // File doesn't exist yet
    }

    const pattern = normalizeCommand(original);
    const errorSnippet = error.slice(0, 50).toLowerCase();

    // Find existing entry
    const existing = memories.find(
      m => m.pattern === pattern && m.error.toLowerCase().includes(errorSnippet)
    );

    if (existing) {
      // Update existing
      const newUses = existing.uses + 1;
      existing.successRate = (existing.successRate * existing.uses + (success ? 1 : 0)) / newUses;
      existing.uses = newUses;
      existing.lastUsed = Date.now();
    } else {
      // Create new entry
      const newMemory: FixMemory = {
        id: `fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        pattern,
        error: errorSnippet,
        originalCommand: original,
        fixedCommand: fixed,
        successRate: success ? 1 : 0,
        uses: 1,
        lastUsed: Date.now(),
        errorType: classifyError(error),
      };
      memories.push(newMemory);
    }

    // Persist
    await virtualFilesystem.writeFile(agentId, memoryPath, JSON.stringify(memories, null, 2));

    logger.debug('Stored fix in memory', {
      pattern,
      success,
      totalMemories: memories.length,
    });
  } catch (error: any) {
    logger.warn('Failed to store fix', error.message);
  }
}

// ============================================================================
// Main Self-Healing Execution
// ============================================================================

/**
 * Execute bash command with self-healing
 */
export async function executeWithHealing(
  command: string,
  options: {
    workingDir?: string;
    maxRetries?: number;
    env?: Record<string, string>;
    timeout?: number;
    /** Self-healing configuration for security controls */
    healingConfig?: SelfHealingConfig;
  } = {}
): Promise<any> {
  const maxRetries = options.maxRetries || 3;
  let attempt = 0;
  let currentCommand = command;
  let lastError: string | null = null; // Track the last error for fix memory

  logger.info('Starting self-healing execution', {
    command,
    maxRetries,
    allowSudoEscalation: options.healingConfig?.allowSudoEscalation ?? false,
  });

  while (attempt < maxRetries) {
    try {
      logger.info('Executing command', {
        command: currentCommand,
        attempt: attempt + 1,
      });

      const result = await executeBashCommand(currentCommand, {
        workingDir: options.workingDir,
        env: options.env,
        timeout: options.timeout,
      });

      if (result.success) {
        logger.info('Command succeeded', {
          attempt: attempt + 1,
          duration: result.duration,
        });

        // Store success in memory - use the error that was fixed
        if (attempt > 0 && lastError) {
          await storeFix(command, currentCommand, lastError, true);
        }

        return result;
      }

      // Command failed, prepare for repair
      throw new Error(result.stderr);
    } catch (error: any) {
      attempt++;
      lastError = error.stderr || error.message; // Track error for potential future fix

      if (attempt >= maxRetries) {
        logger.error('Max retries exceeded', {
          command: currentCommand,
          attempts: attempt,
        });

        // Store failure in memory
        await storeFix(command, currentCommand, lastError, false);

        throw error;
      }

      // Build failure context
      const stderrMsg = error.stderr || error.message;
      const failure: BashFailureContext = {
        command: currentCommand,
        stderr: stderrMsg,
        stdout: error.stdout || '',
        exitCode: error.exitCode || -1,
        workingDir: options.workingDir || '/workspace',
        files: [], // TODO: Get VFS snapshot
        attempt,
        errorType: classifyError(stderrMsg),
      };

      logger.info('Command failed', { 
        errorType: failure.errorType,
        stderr: failure.stderr.slice(0, 200),
      });

      // Step 1: Try known fixes from memory
      const knownFix = await findKnownFix(currentCommand, failure.stderr);
      if (knownFix) {
        logger.info('Using known fix from memory', {
          fixId: knownFix.id,
          successRate: knownFix.successRate,
        });

        if (isCommandSafe(knownFix.fixedCommand)) {
          currentCommand = knownFix.fixedCommand;
          continue;
        }
      }

      // Step 2: Try targeted rule-based fixes
      const targetedFix = applyTargetedFix(
        currentCommand,
        failure.errorType,
        failure.stderr,
        options.healingConfig
      );

      if (targetedFix && isCommandSafe(targetedFix)) {
        logger.info('Applied targeted fix', {
          errorType: failure.errorType,
          original: currentCommand,
          fixed: targetedFix,
        });
        currentCommand = targetedFix;
        continue;
      }

      // Step 3: Try LLM-based diff repair
      const diffRepair = await generateDiffRepair(failure);
      if (diffRepair && diffRepair.confidence >= 0.6) {
        const fixedCommand = diffRepair.diff 
          ? applyDiff(currentCommand, diffRepair.diff)
          : diffRepair.fixedCommand;

        if (isCommandSafe(fixedCommand) && isMinimalChange(currentCommand, fixedCommand)) {
          logger.info('Applied LLM diff repair', {
            confidence: diffRepair.confidence,
            explanation: diffRepair.explanation,
          });
          currentCommand = fixedCommand;
          continue;
        }
      }

      // No repair available or safe
      logger.warn('No safe repair available', {
        attempt,
        errorType: failure.errorType,
      });
      throw error;
    }
  }

  throw new Error('Unexpected: loop exited without result or error');
}
