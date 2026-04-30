/**
 * Local Bash Executor for CLI
 * 
 * Standalone bash execution for CLI without requiring web server.
 * Similar to desktop's Rust Command::new() implementation.
 * 
 * Features:
 * - Direct shell command execution via child_process
 * - RTK integration for LLM consumption (not terminal display)
 * - Workspace path validation (like desktop's validate_workspace_path)
 * - PTY support for interactive terminals
 * - Token savings tracking
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface ExecuteResult {
  success: boolean;
  output: string;
  exitCode: number;
  error?: string;
  duration?: number;
}

export interface ExecuteOptions {
  cwd?: string;
  timeout?: number;
  shell?: string;
  env?: Record<string, string>;
  // RTK options for LLM consumption
  rtkOptions?: {
    rewriteCommand?: boolean;
    filterForLLM?: boolean;
    groupGrepOutput?: boolean;
    maxLines?: number;
    maxChars?: number;
    trackSavings?: boolean;
  };
}

export interface RTKStats {
  originalTokens: number;
  filteredTokens: number;
  savedTokens: number;
  savingsPercent: number;
}

// ============================================================================
// Workspace Path Validation (like desktop's Rust implementation)
// ============================================================================

const ALLOWED_PREFIXES = [
  process.cwd(),
  process.env.HOME || process.env.USERPROFILE || '',
  '/tmp',
  process.env.TMPDIR || '',
].filter(Boolean);

const BLOCKED_PATTERNS = [
  /\/\/\//,  // Multiple consecutive slashes
  /^\\\\/,   // UNC path start
  /^[A-Z]:\\..|^\/..|^\/\\../, // Parent directory escape patterns
  /^[A-Z]:[^\\s]+:[^\\s]+/,   // Paths with multiple colons (possible injection)
];

function validateWorkspacePath(filePath: string, workspaceRoot?: string): boolean {
  if (!filePath) return true; // Allow empty paths
  
  // Check for blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(filePath)) {
      return false;
    }
  }
  
  // If workspace root is specified, ensure path is within it
  if (workspaceRoot) {
    try {
      // CRIT fix: Resolve symlinks via realpathSync before containment check.
      // This prevents "symlink escape" attacks where a path looks like it is
      // in the workspace but actually points outside.
      const fullPath = path.resolve(workspaceRoot, filePath);
      const normalizedRoot = fs.realpathSync(path.resolve(workspaceRoot));
      
      // If path doesn't exist yet, check its parent directory instead
      let currentPath = fullPath;
      while (currentPath !== path.parse(currentPath).root) {
        try {
          const real = fs.realpathSync(currentPath);
          const normalized = path.normalize(real);
          const rootPrefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
          return normalized === normalizedRoot || normalized.startsWith(rootPrefix);
        } catch (e: any) {
          if (e.code === 'ENOENT') {
            currentPath = path.dirname(currentPath);
            continue;
          }
          throw e;
        }
      }
      return false;
    } catch (e) {
      // If realpath fails (e.g. permission denied or invalid path), fail closed
      return false;
    }
  }
  
  // Check against allowed prefixes (without symlink resolution, as these are generic)
  for (const prefix of ALLOWED_PREFIXES) {
    if (prefix && filePath.startsWith(prefix)) {
      return true;
    }
  }
  
  // Allow relative paths (will be resolved to cwd)
  return !path.isAbsolute(filePath) || filePath.startsWith(process.cwd());
}

// ============================================================================
// RTK Integration (from web/lib/tools/rtk-integration.ts)
// ============================================================================

// Inline RTK functions for standalone CLI use
// These should be imported from the shared RTK module in production

interface RewriteRule {
  pattern: RegExp;
  replacement: string;
  description: string;
  category: string;
}

const GIT_RULES: RewriteRule[] = [
  { pattern: /^git status$/, replacement: 'git status --short', description: 'Compact git status', category: 'git' },
  { pattern: /^git log$/, replacement: 'git log --oneline -20', description: 'One-line log', category: 'git' },
  { pattern: /^git diff$/, replacement: 'git diff --stat', description: 'Diff stats only', category: 'git' },
  { pattern: /^git branch$/, replacement: 'git branch --format %(refname:short)', description: 'Compact branches', category: 'git' },
  { pattern: /^git add \/$/, replacement: 'git add .', description: 'Stage all', category: 'git' },
];

const NPM_RULES: RewriteRule[] = [
  { pattern: /^npm test$/, replacement: 'npm test -- --json 2>&1 | head -50', description: 'JSON test output', category: 'npm' },
  { pattern: /^npm list$/, replacement: 'npm list --depth=0', description: 'Top-level deps', category: 'npm' },
];

const LS_RULES: RewriteRule[] = [
  { pattern: /^ls -la$/, replacement: 'ls -F', description: 'Classified listing', category: 'ls' },
  { pattern: /^ls -l$/, replacement: 'ls -F', description: 'Classified listing', category: 'ls' },
  { pattern: /^tree -L (\d+)$/, replacement: 'tree -L $1 -d', description: 'Directories only', category: 'ls' },
];

const TEST_RULES: RewriteRule[] = [
  { pattern: /^npx vitest run$/, replacement: 'npx vitest run --reporter=basic', description: 'Basic vitest', category: 'test' },
  { pattern: /^pytest$/, replacement: 'pytest -q --tb=no', description: 'Quiet pytest', category: 'test' },
  { pattern: /^cargo test$/, replacement: 'cargo test -- --quiet', description: 'Quiet cargo test', category: 'test' },
];

const BUILD_RULES: RewriteRule[] = [
  { pattern: /^cargo build$/, replacement: 'cargo build --quiet', description: 'Quiet cargo build', category: 'build' },
  { pattern: /^npx tsc$/, replacement: 'npx tsc --noEmit --pretty false', description: 'TSC compact', category: 'build' },
];

const DOCKER_RULES: RewriteRule[] = [
  { pattern: /^docker ps$/, replacement: 'docker ps --format {{.ID}} {{.Status}}', description: 'Compact docker ps', category: 'docker' },
  { pattern: /^kubectl get pods$/, replacement: 'kubectl get pods -o wide', description: 'Kubectl pods wide', category: 'docker' },
];

const GREP_RULES: RewriteRule[] = [
  { pattern: /^grep -rn? (\S+) ?(\S*)$/, replacement: 'grep -rn --no-heading $1 $2 | head -100', description: 'Grep numbered', category: 'grep' },
  { pattern: /^rg -n? (\S+) ?(\S*)$/, replacement: 'rg -n --no-heading $1 $2 | head -100', description: 'Ripgrep numbered', category: 'grep' },
];

const ALL_RULES = [
  ...GIT_RULES,
  ...NPM_RULES,
  ...LS_RULES,
  ...TEST_RULES,
  ...BUILD_RULES,
  ...DOCKER_RULES,
  ...GREP_RULES,
];

function rewriteCommand(command: string): string {
  const trimmed = command.trim();
  for (const rule of ALL_RULES) {
    if (rule.pattern.test(trimmed)) {
      const rewritten = trimmed.replace(rule.pattern, rule.replacement);
      if (rewritten !== trimmed) {
        console.debug(`[RTK] Command rewritten: ${command} → ${rewritten}`);
        return rewritten;
      }
    }
  }
  return command;
}

function canRewrite(command: string): boolean {
  return ALL_RULES.some(rule => rule.pattern.test(command.trim()));
}

function filterOutput(output: string, command: string, options: {
  maxLines?: number;
  maxChars?: number;
  groupByFile?: boolean;
} = {}): string {
  const { maxLines = 100, maxChars = 50000, groupByFile = true } = options;
  
  let filtered = output;
  
  // Remove ANSI codes and escape sequences
  filtered = filtered.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  filtered = filtered.replace(/\x1b[\x00-\x1f]/g, '');
  
  // Deduplicate repeated lines
  const lines = filtered.split('\n');
  const deduped: string[] = [];
  let prevLine = '';
  let repeatCount = 0;
  
  for (const line of lines) {
    if (line === prevLine && line.trim()) {
      repeatCount++;
    } else {
      if (repeatCount > 3) {
        deduped.push(`[repeated ${repeatCount}x]`);
      }
      deduped.push(line);
      prevLine = line;
      repeatCount = 1;
    }
  }
  // Flush final accumulated repeats if file ends with repeated lines
  if (repeatCount > 3) { deduped.push(`[repeated ${repeatCount}x]`); }
  
  filtered = deduped.join('\n');
  
  // Group grep output by file
  if (groupByFile && (command.includes('grep') || command.includes('rg'))) {
    filtered = groupGrepOutputLocal(filtered);
  }
  
  // Truncate to limits
  const truncatedLines = filtered.split('\n');
  if (truncatedLines.length > maxLines) {
    const kept = truncatedLines.slice(0, maxLines);
    const removed = truncatedLines.length - maxLines;
    filtered = kept.join('\n') + `\n\n... [+${removed} lines]`;
  }
  
  if (filtered.length > maxChars) {
    filtered = filtered.slice(0, maxChars) + '\n\n... [output truncated]';
  }
  
  return filtered;
}

function groupGrepOutputLocal(output: string): string {
  const lines = output.split('\n');
  const byFile = new Map<string, string[]>();
  let totalMatches = 0;
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Match grep output: filepath:linenum:content
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    if (match) {
      const file = match[1];
      if (!byFile.has(file)) {
        byFile.set(file, []);
      }
      byFile.get(file)!.push(`  ${match[2]}: ${match[3]}`);
      totalMatches++;
    }
  }
  
  if (totalMatches === 0) return output;
  
  const result: string[] = [];
  result.push(`${totalMatches} matches in ${byFile.size} files:\n`);
  
  for (const [file, matches] of byFile) {
    const compactPath = file.length > 50 ? '...' + file.slice(-47) : file;
    result.push(`[file] ${compactPath} (${matches.length}):`);
    result.push(...matches.slice(0, 10));
    if (matches.length > 10) {
      result.push(`  +${matches.length - 10}`);
    }
    result.push('');
  }
  
  return result.join('\n');
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ============================================================================
// RTK Function Exports
// ============================================================================

// Export RTK functions for external use
export { rewriteCommand, canRewrite, estimateTokens, filterOutput };
export { groupGrepOutputLocal as groupGrepOutput };

// ============================================================================
// Main Executor
// ============================================================================

export class LocalBashExecutor {
  private workspaceRoot?: string;
  private shell: string;
  
  constructor(options?: { workspaceRoot?: string; shell?: string }) {
    this.workspaceRoot = options?.workspaceRoot || process.cwd();
    this.shell = options?.shell || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
  }
  
  /**
   * Execute a command with optional RTK token reduction for LLM consumption
   */
  async execute(
    command: string,
    options: ExecuteOptions = {}
  ): Promise<ExecuteResult & { rtkStats?: RTKStats }> {
    const startTime = Date.now();
    
    // Validate workspace paths in command
    if (!this.validateCommand(command)) {
      return {
        success: false,
        output: '',
        exitCode: 1,
        error: 'Command contains invalid paths outside workspace',
        duration: 0,
      };
    }
    
    // Apply RTK command rewriting for LLM consumption
    let rewrittenCommand = command;
    
    if (options.rtkOptions?.rewriteCommand && canRewrite(command)) {
      rewrittenCommand = rewriteCommand(command);
    }
    
    // Execute command
    const result = await this.executeRaw(rewrittenCommand, {
      cwd: options.cwd || this.workspaceRoot,
      timeout: options.timeout,
      shell: options.shell || this.shell,
      env: options.env,
    });
    
    // Apply RTK output filtering for LLM consumption (NOT for terminal display)
    let output = result.output;
    let rtkStats: RTKStats | undefined;
    
    if (options.rtkOptions?.filterForLLM && result.success && output) {
      const filtered = filterOutput(output, rewrittenCommand, {
        maxLines: options.rtkOptions.maxLines || 100,
        maxChars: options.rtkOptions.maxChars || 50000,
        groupByFile: options.rtkOptions.groupGrepOutput !== false,
      });
      
      if (filtered !== output) {
        output = filtered;
        
        if (options.rtkOptions.trackSavings) {
          const origTokens = estimateTokens(result.output);
          const filteredTokens = estimateTokens(filtered);
          const savedTokens = origTokens - filteredTokens;
          
          rtkStats = {
            originalTokens: origTokens,
            filteredTokens,
            savedTokens,
            savingsPercent: Math.round((savedTokens / origTokens) * 100),
          };
          
          console.debug(`[RTK] Token savings: ${savedTokens} tokens (${rtkStats.savingsPercent}%)`);
        }
      }
    }
    
    return {
      success: result.success,
      output,
      exitCode: result.exitCode,
      error: result.error,
      duration: Date.now() - startTime,
      rtkStats,
    };
  }
  
  /**
   * Execute command without RTK (for terminal display - raw output)
   */
  async executeRaw(
    command: string,
    options: {
      cwd?: string;
      timeout?: number;
      shell?: string;
      env?: Record<string, string>;
    } = {}
  ): Promise<ExecuteResult> {
    return new Promise((resolve) => {
      const cwd = options.cwd || this.workspaceRoot;
      const timeout = options.timeout || 30000;
      const shell = options.shell || this.shell;
      
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      
      // Determine shell arguments based on platform and shell type
      const shellArgs = process.platform === 'win32' && shell.toLowerCase().includes('powershell')
        ? ['-Command', command]
        : ['-c', command];
      
      // Execute via shell with appropriate flags
      const child = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeout);
      
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          success: code === 0 && !timedOut,
          output: stdout,
          exitCode: code ?? 1,
          error: timedOut ? 'Command timed out' : (stderr || undefined),
        });
      });
      
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          output: stdout,
          exitCode: 1,
          error: err.message,
        });
      });
    });
  }
  
  /**
   * Validate command doesn't escape workspace
   */
  private validateCommand(command: string): boolean {
    // Extract file paths from common patterns
    const pathPatterns = [
      /(-o|--output|--out|-d|--dir)\b[=\\s]+([^\/\n]+)/g,
      /([a-zA-Z]:[^\n\\s]+|[/\\.][^\n\\s]+)/g,
    ];
    
    for (const pattern of pathPatterns) {
      const matches = command.matchAll(pattern);
      for (const match of matches) {
        const filePath = match[2] || match[1];
        if (!validateWorkspacePath(filePath, this.workspaceRoot)) {
          return false;
        }
      }
    }
    
    return true;
  }
  
  /**
   * Set workspace root for path validation
   */
  setWorkspaceRoot(path: string): void {
    this.workspaceRoot = path;
  }
  
  /**
   * Get current workspace root
   */
  getWorkspaceRoot(): string | undefined {
    return this.workspaceRoot;
  }
}

// ============================================================================
// Default Export
// ============================================================================

export const localBashExecutor = new LocalBashExecutor();

export default LocalBashExecutor;