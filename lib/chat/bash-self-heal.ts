/**
 * Bash Self-Healing Layer
 * 
 * Automatic error recovery for failed bash commands.
 * When a command fails, the system:
 * 1. Classifies the error type
 * 2. Attempts rule-based fixes (fast, no LLM)
 * 3. Falls back to LLM-based repair for complex errors
 * 4. Validates fixes for safety before applying
 * 5. Retries with the fixed command
 * 
 * @see lib/tools/tool-integration/bash-tool.ts - Integration point
 * 
 * @example
 * ```typescript
 * const result = await executeWithHealing(
 *   (cmd) => sandbox.executeCommand(cmd),
 *   'jqq data.json',  // Typo: jqq instead of jq
 *   3  // max attempts
 * );
 * // Automatically fixes to: 'jq data.json'
 * ```
 */

import { createLogger } from '../utils/logger';
import { llmService } from '../chat/llm-providers';
import { z } from 'zod';

const logger = createLogger('Bash:SelfHeal');

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Structured failure information
 */
export interface BashFailure {
  /** Original command that failed */
  command: string;
  /** Standard error output */
  stderr: string;
  /** Standard output (if any) */
  stdout: string;
  /** Exit code from the failed command */
  exitCode: number;
  /** Which attempt this was (1-based) */
  attempt: number;
  /** Working directory where command was executed */
  cwd?: string;
  /** Sandbox ID for context */
  sandboxId?: string;
}

/**
 * Classified error types for targeted fixes
 */
export type ErrorType = 
  | 'command_not_found'     // e.g., "command not found: jqq"
  | 'file_not_found'        // e.g., "No such file or directory: data.json"
  | 'permission_denied'     // e.g., "permission denied: ./script.sh"
  | 'syntax_error'          // e.g., "syntax error near unexpected token"
  | 'timeout'               // e.g., "command timed out"
  | 'missing_dependency'    // e.g., "module not found" or "no such module"
  | 'invalid_argument'      // e.g., "invalid option --x"
  | 'unknown';              // Unclassified error

/**
 * Fix result from repair function
 */
export interface FixResult {
  /** The fixed command */
  fixedCommand: string;
  /** Explanation of what was fixed */
  explanation: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Fix type: rule-based or LLM */
  fixType: 'rule' | 'llm';
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Classify bash error type from stderr output
 * 
 * @param stderr - Standard error output from failed command
 * @returns Classified error type
 * 
 * @example
 * classifyError('command not found: jqq') 
 * // returns 'command_not_found'
 */
export function classifyError(stderr: string): ErrorType {
  const lowerStderr = stderr.toLowerCase();
  
  // Command not found errors
  if (
    lowerStderr.includes('command not found') ||
    lowerStderr.includes('not found') && lowerStderr.includes('command') ||
    lowerStderr.includes('no such file or directory') && lowerStderr.includes('command')
  ) {
    return 'command_not_found';
  }
  
  // File not found errors
  if (
    lowerStderr.includes('no such file') ||
    lowerStderr.includes('does not exist') ||
    lowerStderr.includes('file not found') ||
    lowerStderr.includes('cannot access')
  ) {
    return 'file_not_found';
  }
  
  // Permission denied errors
  if (
    lowerStderr.includes('permission denied') ||
    lowerStderr.includes('eacces') ||
    lowerStderr.includes('not permitted') ||
    lowerStderr.includes('operation not permitted')
  ) {
    return 'permission_denied';
  }
  
  // Syntax errors
  if (
    lowerStderr.includes('syntax error') ||
    lowerStderr.includes('unexpected token') ||
    lowerStderr.includes('parse error') ||
    lowerStderr.includes('invalid syntax')
  ) {
    return 'syntax_error';
  }
  
  // Timeout errors
  if (
    lowerStderr.includes('timed out') ||
    lowerStderr.includes('timeout') ||
    lowerStderr.includes('took too long')
  ) {
    return 'timeout';
  }
  
  // Missing dependency errors
  if (
    lowerStderr.includes('module not found') ||
    lowerStderr.includes('no such module') ||
    lowerStderr.includes('dependency not found') ||
    lowerStderr.includes('missing dependency') ||
    lowerStderr.includes('import error')
  ) {
    return 'missing_dependency';
  }
  
  // Invalid argument errors
  if (
    lowerStderr.includes('invalid option') ||
    lowerStderr.includes('invalid argument') ||
    lowerStderr.includes('unrecognized option') ||
    lowerStderr.includes('unknown option')
  ) {
    return 'invalid_argument';
  }
  
  // Unknown error type
  return 'unknown';
}

// ============================================================================
// Rule-Based Fix Generators
// ============================================================================

/**
 * Generate fix based on error type using rule-based approach
 * Fast, deterministic fixes without LLM
 * 
 * @param failure - Failure information
 * @param errorType - Classified error type
 * @returns Fixed command or null if no rule-based fix available
 */
export function generateFix(failure: BashFailure, errorType: ErrorType): string | null {
  switch (errorType) {
    case 'command_not_found':
      return fixCommandNotFound(failure);
    case 'file_not_found':
      return fixFileNotFound(failure);
    case 'permission_denied':
      return fixPermissionDenied(failure);
    case 'invalid_argument':
      return fixInvalidArgument(failure);
    case 'missing_dependency':
      return fixMissingDependency(failure);
    case 'syntax_error':
      return null; // Needs LLM for syntax errors
    case 'timeout':
      return null; // Needs different handling (increase timeout)
    default:
      return genericFix(failure);
  }
}

/**
 * Fix command not found errors (typos, missing binaries)
 */
function fixCommandNotFound(failure: BashFailure): string | null {
  // Extract missing command from error message
  const match = failure.stderr.match(/command not found:\s*(\w+)/i);
  if (!match) {
    // Try alternative pattern
    const altMatch = failure.stderr.match(/'(\w+)' command not found/i);
    if (!altMatch) return null;
    return fixMissingCommand(altMatch[1], failure.command);
  }
  
  return fixMissingCommand(match[1], failure.command);
}

/**
 * Fix a missing command (typo or needs installation)
 */
function fixMissingCommand(missingCmd: string, command: string): string | null {
  // Common typo mappings
  const typoMappings: Record<string, string> = {
    'jqq': 'jq',
    'grepp': 'grep',
    'sedd': 'sed',
    'awwk': 'awk',
    'catt': 'cat',
    'lsd': 'ls',
    'cdd': 'cd',
    'mddir': 'mkdir',
    'rmdirr': 'rmdir',
    'cpc': 'cp',
    'mvm': 'mv',
    'chmodd': 'chmod',
    'chownn': 'chown',
    'psql': 'psql',  // This is actually correct, but sometimes flagged
    'nodejs': 'node',
    'python3': 'python',
    'pip3': 'pip',
  };
  
  // Check for typos
  if (typoMappings[missingCmd]) {
    const fixedCmd = typoMappings[missingCmd];
    logger.info('Fixing command typo', { from: missingCmd, to: fixedCmd });
    return command.replace(new RegExp(`\\b${missingCmd}\\b`, 'g'), fixedCmd);
  }
  
  // Check for common command alternatives
  const alternatives: Record<string, string[]> = {
    'curl': ['wget'],
    'wget': ['curl'],
    'less': ['more', 'cat'],
    'more': ['less', 'cat'],
    'cat': ['less', 'head', 'tail'],
    'find': ['locate', 'grep -r'],
    'grep': ['egrep', 'fgrep'],
  };
  
  if (alternatives[missingCmd]) {
    // Suggest alternative command
    const alt = alternatives[missingCmd][0];
    logger.info('Suggesting command alternative', { from: missingCmd, to: alt });
    return command.replace(new RegExp(`\\b${missingCmd}\\b`, 'g'), alt);
  }
  
  return null;
}

/**
 * Fix file not found errors (wrong paths, missing files)
 */
function fixFileNotFound(failure: BashFailure): string | null {
  // Extract missing file path from error message
  const match = failure.stderr.match(/(?:no such file|does not exist|cannot access):\s*['"]?([^\s\n'"]+)['"]?/i);
  if (!match) return null;
  
  const missingFile = match[1];
  
  // Common path corrections
  const pathCorrections: Record<string, string> = {
    'result.json': '/output/result.json',
    'data.json': '/workspace/data.json',
    'output.txt': '/output/output.txt',
    'input.txt': '/workspace/input.txt',
    'config.json': '/workspace/config.json',
    'package.json': '/workspace/package.json',
    'index.js': '/workspace/index.js',
    'index.ts': '/workspace/index.ts',
    'app.js': '/workspace/app.js',
    'app.ts': '/workspace/app.ts',
  };
  
  // Check for common path corrections
  const basename = missingFile.split('/').pop() || missingFile;
  if (pathCorrections[basename]) {
    const correctedPath = pathCorrections[basename];
    logger.info('Correcting file path', { from: missingFile, to: correctedPath });
    return failure.command.replace(missingFile, correctedPath);
  }
  
  // Check if file might be in workspace directory
  if (!missingFile.startsWith('/') && !missingFile.startsWith('./')) {
    const workspacePath = `/workspace/${missingFile}`;
    logger.info('Suggesting workspace path', { from: missingFile, to: workspacePath });
    return failure.command.replace(missingFile, workspacePath);
  }
  
  return null;
}

/**
 * Fix permission denied errors (add sudo, fix permissions)
 */
function fixPermissionDenied(failure: BashFailure): string | null {
  // Check if already using sudo
  if (failure.command.trim().startsWith('sudo')) {
    // Already using sudo, can't fix with permission approach
    return null;
  }
  
  // Add sudo to command
  const trimmedCommand = failure.command.trim();
  
  // Special handling for pipes and chains
  if (trimmedCommand.includes('|') || trimmedCommand.includes('&&') || trimmedCommand.includes(';')) {
    // For complex commands, just add sudo to the beginning
    return `sudo ${trimmedCommand}`;
  }
  
  // Simple command: add sudo after any initial variable assignments
  const varAssignMatch = trimmedCommand.match(/^([A-Za-z_][A-Za-z0-9_]*=\S+\s+)/);
  if (varAssignMatch) {
    return trimmedCommand.replace(varAssignMatch[0], `${varAssignMatch[0]}sudo `);
  }
  
  return `sudo ${trimmedCommand}`;
}

/**
 * Fix invalid argument errors (remove bad flags, correct options)
 */
function fixInvalidArgument(failure: BashFailure): string | null {
  // Extract invalid option from error
  const match = failure.stderr.match(/invalid option[:\s]+(-?\w+)/i);
  if (match) {
    const invalidOption = match[1];
    logger.info('Removing invalid option', { option: invalidOption });
    // Remove the invalid option
    return failure.command.replace(new RegExp(`\\s*${invalidOption}\\b`, 'g'), '');
  }
  
  // Try removing unrecognized options
  const unrecognizedMatch = failure.stderr.match(/unrecognized option[:\s]+(-?\w+)/i);
  if (unrecognizedMatch) {
    const badOption = unrecognizedMatch[1];
    logger.info('Removing unrecognized option', { option: badOption });
    return failure.command.replace(new RegExp(`\\s*${badOption}\\b`, 'g'), '');
  }
  
  return null;
}

/**
 * Fix missing dependency errors (suggest installation)
 */
function fixMissingDependency(failure: BashFailure): string | null {
  // Extract missing module/package from error
  const match = failure.stderr.match(/(?:module|package|dependency) not found[:\s]+['"]?([^\s'"]+)['"]?/i);
  if (!match) return null;
  
  const missingModule = match[1];

  // Suggest installation based on command type
  if (failure.command.includes('python') || failure.command.includes('pip')) {
    return `pip install ${missingModule} && ${failure.command}`;
  }

  if (failure.command.includes('node') || failure.command.includes('npm') || failure.command.includes('pnpm')) {
    // Use pnpm (repo standard) but fall back to npm if pnpm not available
    return `pnpm add ${missingModule} || npm install ${missingModule} && ${failure.command}`;
  }

  if (failure.command.includes('apt') || failure.command.includes('apt-get')) {
    return `apt-get install -y ${missingModule} && ${failure.command}`;
  }

  if (failure.command.includes('yum')) {
    return `yum install -y ${missingModule} && ${failure.command}`;
  }

  if (failure.command.includes('brew')) {
    return `brew install ${missingModule} && ${failure.command}`;
  }

  // Generic: try apt-get (most common in containers)
  return `apt-get install -y ${missingModule} && ${failure.command}`;
}

/**
 * Generic fix: try simplifying the command
 */
function genericFix(failure: BashFailure): string | null {
  // Try removing flags that might be problematic
  const simplified = failure.command
    .replace(/\s+-[a-zA-Z]+\s+/g, ' ')  // Remove single-dash flags
    .replace(/\s+--[a-zA-Z-]+\s+/g, ' ') // Remove double-dash flags
    .replace(/\s+/g, ' ')                 // Normalize whitespace
    .trim();
  
  if (simplified !== failure.command && simplified.length > 0) {
    logger.info('Simplified command by removing flags', { original: failure.command.substring(0, 50), simplified: simplified.substring(0, 50) });
    return simplified;
  }
  
  return null;
}

// ============================================================================
// LLM-Based Repair
// ============================================================================

/**
 * LLM-based repair for complex errors that rule-based fixes can't handle
 * 
 * @param failure - Failure information
 * @returns Fixed command or null if repair failed
 */
export async function repairWithLLM(failure: BashFailure): Promise<string | null> {
  try {
    logger.info('Attempting LLM-based repair', {
      command: failure.command.substring(0, 100),
      error: failure.stderr.substring(0, 200),
    });

    const response = await llmService.generateResponse({
      provider: 'openrouter',
      model: 'gpt-4o-mini',  // Fast, cheap for simple fixes
      messages: [
        {
          role: 'system',
          content: `You are a shell debugging expert. Your task is to fix broken bash commands.

Rules:
- Return ONLY the fixed command, no explanation
- Make minimal changes - preserve the original intent
- Do not add unrelated steps or commands
- If the command is dangerous or cannot be safely fixed, return "UNSAFE"
- Keep the same command structure when possible`,
        },
        {
          role: 'user',
          content: `Fix this bash command:

Command: ${failure.command}
Error: ${failure.stderr}
Exit Code: ${failure.exitCode}
Working Directory: ${failure.cwd || '/workspace'}

Return ONLY the fixed command:`,
        },
      ],
      maxTokens: 100,  // Keep response short
      temperature: 0.1,  // Low temperature for deterministic fixes
    });

    const fixedCommand = response.content?.trim();
    
    if (!fixedCommand) {
      logger.warn('LLM returned empty response');
      return null;
    }
    
    // Check for unsafe marker
    if (fixedCommand.toUpperCase() === 'UNSAFE') {
      logger.warn('LLM marked fix as unsafe');
      return null;
    }
    
    // Safety check - don't apply if completely different command
    if (fixedCommand.length > failure.command.length * 3) {
      logger.warn('LLM fix too different from original', {
        original: failure.command.substring(0, 50),
        fixed: fixedCommand.substring(0, 50),
      });
      return null;
    }
    
    // Additional safety validation
    if (!isSafe(fixedCommand)) {
      logger.warn('LLM fix failed safety check', { fixed: fixedCommand });
      return null;
    }
    
    logger.info('LLM repair successful', {
      original: failure.command.substring(0, 50),
      fixed: fixedCommand.substring(0, 50),
    });
    
    return fixedCommand;
  } catch (error: any) {
    logger.error('LLM repair failed', error);
    return null;
  }
}

// ============================================================================
// Safety Layer
// ============================================================================

/**
 * Dangerous command patterns to reject
 */
const DANGEROUS_PATTERNS = [
  // Filesystem destruction
  'rm -rf /',
  'rm -rf /*',
  'rm -rf ~',
  'rm -rf $HOME',
  '> /dev/sda',
  'dd if=/dev/zero',
  'mkfs',
  'mke2fs',
  
  // System commands
  'shutdown',
  'reboot',
  'init 0',
  'init 6',
  'telinit 0',
  'telinit 6',
  'systemctl poweroff',
  'systemctl reboot',
  
  // Fork bombs
  ':(){ :|:& };:',
  'fork() { fork() { } }',
  
  // Network attacks
  'nmap -sS',
  'hping3',
  'ddos',
  
  // Privilege escalation attempts
  'chmod 777 /',
  'chmod -R 777 /',
  'chown -R root:root /',
  
  // Data exfiltration
  'curl -X POST -d @/etc/passwd',
  'curl -X POST -d @/etc/shadow',
  'scp /etc/shadow',
];

/**
 * Check if a command is safe to execute
 * 
 * @param command - Command to validate
 * @returns true if safe, false if dangerous
 */
export function isSafe(command: string): boolean {
  const lowerCommand = command.toLowerCase();
  
  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (lowerCommand.includes(pattern.toLowerCase())) {
      logger.warn('Dangerous command pattern detected', {
        command: command.substring(0, 100),
        pattern,
      });
      return false;
    }
  }
  
  // Check for suspicious patterns
  const suspiciousPatterns = [
    /eval\s*\(/,
    /exec\s*\(/,
    /\$\(/,  // Command substitution (can be legitimate, but watch for nesting)
    /`[^`]+`/,  // Backtick execution
  ];
  
  // Count suspicious patterns - allow 1-2 but flag many
  let suspiciousCount = 0;
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(command)) {
      suspiciousCount++;
    }
  }
  
  if (suspiciousCount > 3) {
    logger.warn('Command has many suspicious patterns', {
      command: command.substring(0, 100),
      suspiciousCount,
    });
    return false;
  }
  
  return true;
}

/**
 * Validate that a fix is minimal (doesn't change command intent)
 * 
 * @param original - Original command
 * @param fixed - Fixed command
 * @param threshold - Maximum allowed change ratio (default 0.5 = 50%)
 * @returns true if change is minimal
 */
export function isMinimalChange(original: string, fixed: string, threshold: number = 0.5): boolean {
  const lengthRatio = Math.abs(fixed.length - original.length) / original.length;
  return lengthRatio < threshold;
}

// ============================================================================
// Main Execution Wrapper
// ============================================================================

/**
 * Execute bash command with self-healing
 * 
 * Wraps command execution with automatic error recovery:
 * 1. Execute command
 * 2. If fails, classify error
 * 3. Generate fix (rule-based or LLM)
 * 4. Validate fix for safety
 * 5. Retry with fixed command
 * 6. Repeat until success or max attempts
 * 
 * @param executeFn - Function to execute command
 * @param command - Command to execute
 * @param maxAttempts - Maximum retry attempts (default: 3)
 * @returns Execution result with stdout/stderr/exitCode
 * 
 * @example
 * ```typescript
 * const result = await executeWithHealing(
 *   (cmd) => sandbox.executeCommand(cmd),
 *   'jqq data.json',  // Will auto-fix to 'jq data.json'
 *   3
 * );
 * ```
 */
export async function executeWithHealing(
  executeFn: (command: string) => Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
  }>,
  command: string,
  maxAttempts: number = 3
): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  attempts: number;
  fixesApplied: Array<{ attempt: number; original: string; fixed: string; fixType: 'rule' | 'llm' }>;
}> {
  let currentCommand = command;
  let lastError: string | null = null;
  const fixesApplied: Array<{ attempt: number; original: string; fixed: string; fixType: 'rule' | 'llm' }> = [];
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    logger.debug('Execution attempt', {
      attempt,
      maxAttempts,
      command: currentCommand.substring(0, 100),
    });
    
    try {
      const result = await executeFn(currentCommand);
      
      if (result.success) {
        logger.info('Command executed successfully', {
          attempt,
          command: currentCommand.substring(0, 100),
        });
        
        return {
          ...result,
          attempts: attempt,
          fixesApplied,
        };
      }
      
      // Command failed - prepare for retry
      lastError = result.stderr;
      
      // Classify error
      const errorType = classifyError(result.stderr);
      logger.warn('Bash execution failed', {
        attempt,
        command: currentCommand.substring(0, 100),
        errorType,
        exitCode: result.exitCode,
      });
      
      // Don't retry certain errors
      if (errorType === 'timeout') {
        logger.warn('Timeout error - not retrying');
        return {
          ...result,
          attempts: attempt,
          fixesApplied,
        };
      }
      
      // Try rule-based fix first (fast, no LLM cost)
      let fix = generateFix({
        command: currentCommand,
        stderr: result.stderr,
        stdout: result.stdout,
        exitCode: result.exitCode,
        attempt,
      }, errorType);
      
      let fixType: 'rule' | 'llm' = 'rule';
      
      // If no rule-based fix, try LLM for syntax errors
      if (!fix && errorType === 'syntax_error') {
        fix = await repairWithLLM({
          command: currentCommand,
          stderr: result.stderr,
          stdout: result.stdout,
          exitCode: result.exitCode,
          attempt,
        });
        fixType = 'llm';
      }
      
      // Apply fix if available
      if (fix) {
        // Safety check
        if (!isSafe(fix)) {
          logger.warn('Unsafe fix rejected', {
            original: currentCommand.substring(0, 50),
            fix: fix.substring(0, 50),
          });
          break;  // Stop retrying
        }
        
        // Minimal change check
        if (!isMinimalChange(currentCommand, fix)) {
          logger.warn('Fix too different from original', {
            original: currentCommand.substring(0, 50),
            fix: fix.substring(0, 50),
          });
          break;  // Stop retrying
        }
        
        logger.info('Applying fix', {
          attempt,
          fixType,
          original: currentCommand.substring(0, 50),
          fixed: fix.substring(0, 50),
        });
        
        fixesApplied.push({
          attempt,
          original: currentCommand,
          fixed: fix,
          fixType,
        });
        
        currentCommand = fix;
      } else {
        logger.warn('No fix available, stopping retry', {
          attempt,
          errorType,
        });
        break;  // No fix available, stop retrying
      }
    } catch (error: any) {
      lastError = error.message;
      logger.error('Bash execution error', {
        attempt,
        error: error.message,
      });
      
      // Don't retry on execution errors (sandbox issues, etc.)
      break;
    }
  }
  
  // All attempts failed
  logger.error('All healing attempts failed', {
    originalCommand: command.substring(0, 100),
    finalCommand: currentCommand.substring(0, 100),
    fixesApplied: fixesApplied.length,
  });
  
  return {
    success: false,
    stdout: '',
    stderr: lastError || 'Unknown error',
    exitCode: -1,
    attempts: maxAttempts,
    fixesApplied,
  };
}
