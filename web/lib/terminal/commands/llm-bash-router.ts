/**
 * LLM Bash Command Router
 * 
 * Strategically routes bash commands from LLM to:
 * 1. Simulated execution (read-only, no side effects)
 * 2. Sandbox execution (writes, deletes, dangerous ops)
 * 3. Confirmation required (mv/rm with conflicts)
 * 
 * Uses existing local-filesystem-executor.ts for simulation
 * Uses terminal-security.ts for safety checks
 */

import { checkCommandSecurity, type SecurityCheckResult } from '../security/terminal-security';

export type ExecutionMode = 'simulate' | 'sandbox' | 'confirm' | 'blocked';

export interface CommandRoute {
  mode: ExecutionMode;
  reason?: string;
  needsConfirmation?: boolean;
  conflictingPaths?: string[];
  originalCommand: string;
}

export interface LLMBashRouterConfig {
  /** Callback to write output to terminal */
  onOutput?: (text: string) => void;
  /** Callback to request confirmation (returns true if confirmed) */
  onConfirm?: (message: string) => Promise<boolean>;
  /** Get current filesystem state */
  getFilesystem: () => Record<string, { content?: string; isDirectory?: boolean }>;
  /** Scope path for session */
  scopePath?: string;
}

/**
 * Commands that can be safely simulated (read-only, no side effects)
 */
const SIMULATABLE_COMMANDS = new Set([
  'ls', 'pwd', 'cat', 'head', 'tail', 'tree', 'find', 'grep', 'wc',
  'whoami', 'date', 'echo', 'history', 'which', 'type', 'man',
  // Read-only variants
  'ls -la', 'ls -l', 'ls -a', 'ls -R', 'ls --color=auto',
  'cat -n', 'cat -b', 'cat -s',
  'head -n', 'tail -n',
  // Find variants
  'find .', 'find . -name', 'find . -type', 'find /',
]);

/**
 * Commands that ALWAYS require sandbox (side effects)
 */
const SANDBOX_ONLY_COMMANDS = new Set([
  'apt', 'apt-get', 'yum', 'dnf', 'pip', 'npm', 'yarn', 'pnpm',
  'curl', 'wget', 'ssh', 'scp', 'rsync', 'git',
  'chmod', 'chown', 'ln', 'nc', 'ncat',
]);

/**
 * Commands that are ALWAYS blocked — even sandbox execution is too dangerous
 * (CRIT-2 fix: prevents bash -c "malicious" and sh -c "malicious" bypass)
 */
const BLOCKED_COMMANDS = new Set([
  'bash', 'sh', 'zsh', 'csh', 'tcsh', 'dash', 'ksh', 'fish',
]);

/**
 * Dangerous flags for SANDBOX_ONLY_COMMANDS that enable arbitrary execution
 * e.g., curl -d @/etc/passwd (data exfiltration), ssh -R (reverse tunnel)
 */
const DANGEROUS_FLAGS: Record<string, RegExp[]> = {
  curl: [/--data\s+@/, /-d\s+@/, /--form[--]?\s+@/, /-F\s+@/, /--upload-file/, /-T\s+@/, /@[-\/]/],
  wget: [/--post-data/, /--post-file/, /--input-file/],
  ssh: [/-R\s/, /-L\s/, /-W\s/, /-o\s*StrictHostKeyChecking/],
  nc: [/-e\s/, /--exec/, /--sh-exec/],
  ncat: [/-e\s/, /--exec/, /--sh-exec/, /--ssl/],
};

/**
 * Commands that need confirmation (destructive or can overwrite)
 */
const CONFIRM_MAYBE_COMMANDS = new Set([
  'rm', 'rmdir', 'mv', 'cp',
]);

/**
 * Commands that DEFINITELY need confirmation (very destructive)
 */
const CONFIRM_ALWAYS_COMMANDS = new Set([
  'rm -rf', 'rm -r', 'rmdir -r',
  'dd', 'mkfs', 'fdisk',
]);

function parseCommand(command: string): { cmd: string; args: string[]; flags: string[] } {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0] || '';
  const args = parts.slice(1);
  
  // Extract flags (strings starting with -)
  const flags: string[] = [];
  const cleanArgs: string[] = [];
  for (const arg of args) {
    if (arg.startsWith('-') && arg !== '--') {
      flags.push(arg);
    } else {
      cleanArgs.push(arg);
    }
  }
  
  return { cmd, args: cleanArgs, flags };
}

function checkPathConflict(args: string[], filesystem: LLMBashRouterConfig['getFilesystem']): string[] {
  const conflicts: string[] = [];
  const fs = filesystem();
  
  // Check arguments that look like paths
  for (const arg of args) {
    if (arg.includes('/') || arg.endsWith('.txt') || arg.endsWith('.ts') || arg.endsWith('.js')) {
      if (fs[arg]) {
        conflicts.push(arg);
      }
    }
  }
  
  return conflicts;
}

/**
 * Route a command from LLM to appropriate execution path
 */
export function routeLLMCommand(
  command: string,
  config: LLMBashRouterConfig
): CommandRoute {
  const { cmd, args, flags } = parseCommand(command);
  const fullCmd = flags.length > 0 ? `${cmd} ${flags.join(' ')}` : cmd;
  const fullWithArgs = args.length > 0 ? `${fullCmd} ${args.join(' ')}` : fullCmd;
  
  // Step 1: Security check first (block dangerous regardless of type)
  const security = checkCommandSecurity(fullWithArgs);
  if (!security.allowed) {
    return {
      mode: 'blocked',
      reason: security.reason || 'Command blocked by security',
      originalCommand: command,
    };
  }
  
  // Step 2 (CRIT-2 fix): Block shell commands entirely — bash/sh/zsh with -c bypass sandbox isolation
  if (BLOCKED_COMMANDS.has(cmd)) {
    return {
      mode: 'blocked',
      reason: `Shell command '${cmd}' is blocked — use individual commands instead of shell invocation`,
      originalCommand: command,
    };
  }
  
  // Step 2b (CRIT-2 fix): Check for dangerous flags on sandbox-only commands
  const dangerousFlags = DANGEROUS_FLAGS[cmd];
  if (dangerousFlags) {
    const fullArgString = args.join(' ') + ' ' + flags.join(' ');
    for (const flagPattern of dangerousFlags) {
      if (flagPattern.test(fullArgString)) {
        return {
          mode: 'blocked',
          reason: `Dangerous flag for '${cmd}' blocked — potential data exfiltration or remote access`,
          originalCommand: command,
        };
      }
    }
  }
  
  // Step 2c: Check for dangerous patterns
  if (CONFIRM_ALWAYS_COMMANDS.has(fullCmd) || CONFIRM_ALWAYS_COMMANDS.has(fullWithArgs)) {
    return {
      mode: 'confirm',
      reason: 'This command may cause data loss',
      needsConfirmation: true,
      conflictingPaths: checkPathConflict(args, config.getFilesystem),
      originalCommand: command,
    };
  }
  
  // Step 3: Check if simulatable (read-only commands)
  if (SIMULATABLE_COMMANDS.has(fullCmd) || SIMULATABLE_COMMANDS.has(fullWithArgs) || SIMULATABLE_COMMANDS.has(cmd)) {
    return {
      mode: 'simulate',
      reason: 'Read-only command - simulated locally',
      originalCommand: command,
    };
  }
  
  // Step 4: Check sandbox-only (needs real execution)
  if (SANDBOX_ONLY_COMMANDS.has(cmd)) {
    return {
      mode: 'sandbox',
      reason: 'Requires real execution environment',
      originalCommand: command,
    };
  }
  
  // Step 5: Check destructive commands with potential conflicts
  if (CONFIRM_MAYBE_COMMANDS.has(cmd)) {
    const conflicts = checkPathConflict(args, config.getFilesystem);
    if (conflicts.length > 0) {
      return {
        mode: 'confirm',
        reason: `Target file(s) already exist: ${conflicts.join(', ')}`,
        needsConfirmation: true,
        conflictingPaths: conflicts,
        originalCommand: command,
      };
    }
    // rm without conflicts is okay to run in sandbox
    return {
      mode: 'sandbox',
      reason: 'Destructive command - runs in sandbox',
      originalCommand: command,
    };
  }
  
  // Step 6: Default - sandbox for unknown commands
  return {
    mode: 'sandbox',
    reason: 'Unknown command type - running in sandbox',
    originalCommand: command,
  };
}

/**
 * Execute routed command based on route decision
 */
export async function executeRoutedCommand(
  route: CommandRoute,
  config: LLMBashRouterConfig
): Promise<string> {
  const { getFilesystem } = config;
  
  switch (route.mode) {
    case 'blocked':
      return `[BLOCKED] ${route.reason}`;
       
    case 'simulate':
      return simulateCommand(route.originalCommand, getFilesystem);
       
    case 'confirm':
      if (config.onConfirm) {
        const confirmed = await config.onConfirm(
          route.reason || 'Proceed with this command?'
        );
        if (!confirmed) {
          return '[CANCELLED] User declined confirmation';
        }
        // After confirm, proceed to sandbox
        return '[CONFIRMED] Proceeding to sandbox...';
      }
      return `[CONFIRM REQUIRED] ${route.reason}`;
      
    case 'sandbox':
    default:
      return '[SANDBOX] Running in sandbox environment...';
  }
}

/**
 * Simulate a read-only command using filesystem state
 * Returns output string - caller handles streaming to terminal
 */
function simulateCommand(
  command: string,
  getFilesystem: LLMBashRouterConfig['getFilesystem']
): string {
  const { cmd, args } = parseCommand(command);
  const fs = getFilesystem() || {};
  
  switch (cmd) {
    case 'pwd':
      return '/workspace';
      
    case 'whoami':
      return 'user';
      
    case 'date':
      return new Date().toUTCString();
      
    case 'ls': {
      const targetDir = args[0] ? args[0].replace(/^\.?\/?/, '') : '.';
      
      // Get all paths that are direct children of the target directory
      const targetPrefix = targetDir === '.' ? '' : targetDir + '/';
      const targetDepth = targetDir === '.' ? 0 : targetDir.split('/').length;
      
      const entries = Object.keys(fs)
        .filter(path => {
          if (targetDir === '.' || targetDir === '') {
            // Root: include top-level only (no / in path)
            return !path.includes('/') || path.split('/').length === 1;
          }
          // Direct children: path starts with prefix and has no additional slashes
          return path.startsWith(targetPrefix) && 
            (path.split('/').length === targetDepth + 1 || 
             (path === targetPrefix.slice(0, -1)));
        })
        .map(path => {
          const isDir = fs[path]?.isDirectory || path.endsWith('/');
          return `${isDir ? 'd' : '-'}rwxr-xr-x 1 user user ${isDir ? '0' : '100'} Jan  1 00:00 ${path.split('/').pop()}`;
        })
        .join('\n') || '';
      return entries || '(empty)';
    }
    
    case 'cat': {
      const filePath = args[0];
      if (!filePath) return 'Usage: cat <file>';
      const file = fs[filePath];
      if (!file) return `cat: ${filePath}: No such file or directory`;
      const content = file.content || '';
      return content || '(empty file)';
    }
    
    case 'echo': {
      // echo "text" [>> file]
      const text = args[0] || '';
      const append = command.includes('>>');
      const writePath = args[args.length - 1];
      
      if (append && writePath) {
        return `[WOULD WRITE] ${text} >> ${writePath}`;
      }
      return text.replace(/^["']|["']$/g, '');
    }
    
    case 'tree': {
      // Simple tree output
      const indent = (depth: number) => '  '.repeat(depth);
      let result = '';
      const sortedPaths = Object.keys(fs).sort();
      for (const path of sortedPaths) {
        const depth = path.split('/').length - 1;
        const name = path.split('/').pop() || path;
        const isDir = fs[path]?.isDirectory;
        result += `${indent(depth)}${isDir ? '📁 ' : '📄 '}${name}\n`;
      }
      return result || '(empty)';
    }
    
    case 'find': {
      // Simple find - returns all matching files
      const pattern = args[0]?.replace('*', '.*') || '.*';
      const regex = new RegExp(pattern);
      const matches = Object.keys(fs).filter(p => regex.test(p));
      return matches.join('\n') || 'No matches found';
    }
    
    case 'grep': {
      const pattern = args[0];
      const filePath = args[1];
      if (!pattern) return 'Usage: grep <pattern> <file>';
      
      if (filePath) {
        const file = fs[filePath];
        if (!file) return `grep: ${filePath}: No such file`;
        const content = file.content || '';
        const lines = content.split('\n').filter(line => 
          line.toLowerCase().includes(pattern.toLowerCase())
        );
        return lines.join('\n') || '(no matches)';
      }
      
      // Search all files
      let result = '';
      for (const [path, file] of Object.entries(fs)) {
        const content = file?.content || '';
        if (content.toLowerCase().includes(pattern.toLowerCase())) {
          result += `${path}: ${content.slice(0, 100)}\n`;
        }
      }
      return result || 'No matches found';
    }
    
    default:
      return `[SIMULATE] ${cmd}: command not implemented in simulation`;
  }
}

export const llmBashRouter = {
  route: routeLLMCommand,
  execute: executeRoutedCommand,
};