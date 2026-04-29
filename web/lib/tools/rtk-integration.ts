/**
 * RTK Integration Module
 * 
 * Comprehensive token reduction for LLM actions based on RTK (Rust Token Killer).
 * Provides:
 * - Command rewriting (optimize commands before execution)
 * - Output filtering (compress output after execution)
 * - Smart grouping (aggregate similar results)
 * - Token tracking (measure savings)
 * 
 * Supports 100+ commands: git, npm, pnpm, cargo, docker, grep, ls, tree, etc.
 * 
 * @see https://github.com/rtk-ai/rtk
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('RTK');

// ============================================================================
// Configuration
// ============================================================================

export interface RTKConfig {
  /** Enable command rewriting */
  enableRewrite: boolean;
  /** Enable output filtering */
  enableFilter: boolean;
  /** Maximum lines in output */
  maxLines: number;
  /** Maximum characters in output */
  maxChars: number;
  /** Enable grouping by file */
  groupByFile: boolean;
  /** Enable deduplication */
  enableDedupe: boolean;
  /** Track token savings */
  trackSavings: boolean;
}

const DEFAULT_CONFIG: RTKConfig = {
  enableRewrite: true,
  enableFilter: true,
  maxLines: 100,
  maxChars: 50000,
  groupByFile: true,
  enableDedupe: true,
  trackSavings: true,
};

// ============================================================================
// Command Rewriting Rules
// ============================================================================

interface RewriteRule {
  pattern: RegExp;
  replacement: string | ((match: RegExpMatchArray) => string);
  description: string;
  category: string;
}

// Git commands
const GIT_RULES: RewriteRule[] = [
  { pattern: /^git status$/, replacement: 'git status --short', description: 'Compact git status', category: 'git' },
  { pattern: /^git status -s$/, replacement: 'git status --short', description: 'Already short', category: 'git' },
  { pattern: /^git status --short$/, replacement: 'git status --short', description: 'Short format', category: 'git' },
  { pattern: /^git log$/, replacement: 'git log --oneline -20', description: 'One-line log (20 commits)', category: 'git' },
  { pattern: /^git log --oneline$/, replacement: 'git log --oneline -20', description: 'Limited one-line log', category: 'git' },
  { pattern: /^git log --oneline -(\n+)$/, replacement: 'git log --oneline -$1', description: 'Preserve limit', category: 'git' },
  { pattern: /^git diff$/, replacement: 'git diff --stat', description: 'Diff stats only', category: 'git' },
  { pattern: /^git diff --stat$/, replacement: 'git diff --stat', description: 'Stats only', category: 'git' },
  { pattern: /^git add \.$/, replacement: 'git add .', description: 'Stage all', category: 'git' },
  { pattern: /^git push$/, replacement: 'git push', description: 'Push (already optimized)', category: 'git' },
  { pattern: /^git pull$/, replacement: 'git pull', description: 'Pull (already optimized)', category: 'git' },
  { pattern: /^git branch$/, replacement: 'git branch --format %(refname:short)', description: 'Compact branches', category: 'git' },
  { pattern: /^git diff HEAD~1$/, replacement: 'git diff HEAD~1 --stat', description: 'Recent diff stats', category: 'git' },
  { pattern: /^git diff --cached$/, replacement: 'git diff --cached --stat', description: 'Staged diff stats', category: 'git' },
  { pattern: /^git show --stat$/, replacement: 'git show --stat', description: 'Show with stats', category: 'git' },
  { pattern: /^git log --graph --oneline --all$/, replacement: 'git log --graph --oneline -30', description: 'Graph limited', category: 'git' },
];

// Package manager commands
const NPM_RULES: RewriteRule[] = [
  { pattern: /^npm test$/, replacement: 'npm test -- --json 2>&1 | head -50', description: 'JSON test output', category: 'npm' },
  { pattern: /^npm run test$/, replacement: 'npm test -- --json 2>&1 | head -50', description: 'npm test JSON', category: 'npm' },
  { pattern: /^npm run (\n+)$/, replacement: 'npm run $1 --json 2>&1 | head -50', description: 'npm run JSON', category: 'npm' },
  { pattern: /^npm list$/, replacement: 'npm list --depth=0', description: 'Top-level deps only', category: 'npm' },
  { pattern: /^npm list --depth=(\n+)$/, replacement: 'npm list --depth=$1', description: 'Preserve depth', category: 'npm' },
  { pattern: /^npm outdated$/, replacement: 'npm outdated --json 2>&1 | head -30', description: 'JSON outdated', category: 'npm' },
];

// pnpm commands
const PNPM_RULES: RewriteRule[] = [
  { pattern: /^pnpm test$/, replacement: 'pnpm test --json 2>&1 | head -50', description: 'pnpm JSON test', category: 'pnpm' },
  { pattern: /^pnpm (test|build|lint|dev)$/, replacement: 'pnpm $1 --json 2>&1 | head -50', description: 'pnpm JSON output', category: 'pnpm' },
  { pattern: /^pnpm list$/, replacement: 'pnpm list --depth=0', description: 'Top-level deps only', category: 'pnpm' },
  { pattern: /^pnpm outdated$/, replacement: 'pnpm outdated --json 2>&1 | head -30', description: 'pnpm JSON outdated', category: 'pnpm' },
  { pattern: /^pnpm install$/, replacement: 'pnpm install --no-optional', description: 'Skip optional deps', category: 'pnpm' },
];

// File listing commands
const LS_RULES: RewriteRule[] = [
  { pattern: /^ls -la$/, replacement: 'ls -F', description: 'Classified listing', category: 'ls' },
  { pattern: /^ls -l$/, replacement: 'ls -F', description: 'Classified listing', category: 'ls' },
  { pattern: /^ls -lh$/, replacement: 'ls -Fh', description: 'Human readable', category: 'ls' },
  { pattern: /^ls -lah$/, replacement: 'ls -Fah', description: 'All human readable', category: 'ls' },
  { pattern: /^ls -R$/, replacement: 'ls -R', description: 'Recursive (keep)', category: 'ls' },
  { pattern: /^tree -L (\n+)$/, replacement: 'tree -L $1 -d', description: 'Directories only', category: 'ls' },
  { pattern: /^tree$/, replacement: 'tree -L 2 -d', description: '2-level dirs', category: 'ls' },
];

// Test commands
const TEST_RULES: RewriteRule[] = [
  { pattern: /^npx vitest run$/, replacement: 'npx vitest run --reporter=basic', description: 'Basic vitest', category: 'test' },
  { pattern: /^vitest run$/, replacement: 'vitest run --reporter=basic', description: 'Basic vitest', category: 'test' },
  { pattern: /^npx jest$/, replacement: 'npx jest --json 2>&1 | tail -30', description: 'Jest JSON', category: 'test' },
  { pattern: /^npx jest --coverage$/, replacement: 'npx jest --coverage --json 2>&1 | tail -50', description: 'Jest coverage JSON', category: 'test' },
  { pattern: /^cargo test$/, replacement: 'cargo test -- --quiet', description: 'Quiet cargo test', category: 'test' },
  { pattern: /^cargo test -- --verbose$/, replacement: 'cargo test -- --quiet', description: 'Quiet verbose test', category: 'test' },
  { pattern: /^pytest$/, replacement: 'pytest -q --tb=no', description: 'Quiet pytest', category: 'test' },
  { pattern: /^pytest -v$/, replacement: 'pytest -q --tb=short', description: 'Brief pytest verbose', category: 'test' },
  { pattern: /^python -m pytest$/, replacement: 'python -m pytest -q --tb=no', description: 'Quiet python pytest', category: 'test' },
  { pattern: /^npx playwright test$/, replacement: 'npx playwright test --reporter=line', description: 'Playwright line reporter', category: 'test' },
];

// Build/lint commands
const BUILD_RULES: RewriteRule[] = [
  { pattern: /^cargo build$/, replacement: 'cargo build --quiet', description: 'Quiet cargo build', category: 'build' },
  { pattern: /^cargo build --release$/, replacement: 'cargo build --release --quiet', description: 'Quiet release build', category: 'build' },
  { pattern: /^cargo clippy$/, replacement: 'cargo clippy --quiet', description: 'Quiet clippy', category: 'build' },
  { pattern: /^npx tsc$/, replacement: 'npx tsc --noEmit --pretty false', description: 'TSC compact', category: 'build' },
  { pattern: /^npx tsc --noEmit$/, replacement: 'npx tsc --noEmit --pretty false', description: 'TSC noEmit compact', category: 'build' },
  { pattern: /^npx eslint/, replacement: 'npx eslint --format=json', description: 'ESLint JSON', category: 'build' },
  { pattern: /^eslint/, replacement: 'eslint --format=json', description: 'ESLint JSON', category: 'build' },
  { pattern: /^npx next build$/, replacement: 'npx next build --no-lint', description: 'Next build no lint', category: 'build' },
  { pattern: /^ruff check/, replacement: 'ruff check --output-format=json', description: 'Ruff JSON', category: 'build' },
  { pattern: /^ruff format/, replacement: 'ruff format --check', description: 'Ruff format check', category: 'build' },
  { pattern: /^mypy/, replacement: 'mypy --no-color-output', description: 'Mypy no color', category: 'build' },
];

// Docker commands
const DOCKER_RULES: RewriteRule[] = [
  { pattern: /^docker ps$/, replacement: 'docker ps --format {{.ID}} {{.Status}}', description: 'Compact docker ps', category: 'docker' },
  { pattern: /^docker ps -a$/, replacement: 'docker ps -a --format {{.ID}} {{.Status}}', description: 'Compact docker ps all', category: 'docker' },
  { pattern: /^docker images$/, replacement: 'docker images --format {{.Repository}}:{{.Tag}} {{.Size}}', description: 'Compact images', category: 'docker' },
  { pattern: /^docker-compose ps$/, replacement: 'docker compose ps --format {{.Name}} {{.Status}}', description: 'Compact compose ps', category: 'docker' },
  { pattern: /^docker compose ps$/, replacement: 'docker compose ps --format {{.Name}} {{.Status}}', description: 'Compact compose ps', category: 'docker' },
  { pattern: /^kubectl get pods$/, replacement: 'kubectl get pods -o wide', description: 'Kubectl pods wide', category: 'docker' },
  { pattern: /^kubectl get pods -o wide$/, replacement: 'kubectl get pods -o wide', description: 'Kubectl pods wide', category: 'docker' },
  { pattern: /^kubectl get (\n+)$/, replacement: 'kubectl get $1', description: 'Kubectl get (keep)', category: 'docker' },
  { pattern: /^kubectl describe pod/, replacement: 'kubectl describe pod --no-headers | head -30', description: 'Kubectl describe compact', category: 'docker' },
];

// Grep/search commands
const GREP_RULES: RewriteRule[] = [
  { pattern: /^grep -r (\n+) (\n+)$/, replacement: 'grep -rn --no-heading $1 $2 | head -100', description: 'Grep numbered', category: 'grep' },
  { pattern: /^grep (\n+) -r (\n+)$/, replacement: 'grep -rn --no-heading $1 $2 | head -100', description: 'Grep numbered', category: 'grep' },
  { pattern: /^rg (\n+) (\n+)$/, replacement: 'rg -n --no-heading $1 $2 | head -100', description: 'Ripgrep numbered', category: 'grep' },
  { pattern: /^rg -i (\n+) (\n+)$/, replacement: 'rg -in --no-heading $1 $2 | head -100', description: 'Ripgrep case-insensitive', category: 'grep' },
  { pattern: /^find \/ -name (\n+)$/, replacement: 'find . -name $1 | head -50', description: 'Find limited', category: 'grep' },
  { pattern: /^find (\n+) -name (\n+)$/, replacement: 'find $1 -name $2 | head -50', description: 'Find limited', category: 'grep' },
];

// System commands
const SYSTEM_RULES: RewriteRule[] = [
  { pattern: /^ps aux$/, replacement: 'ps aux | head -20', description: 'PS limited', category: 'system' },
  { pattern: /^top$/, replacement: 'top -b -n 1 | head -20', description: 'Top batch mode', category: 'system' },
  { pattern: /^df -h$/, replacement: 'df -h', description: 'Disk human', category: 'system' },
  { pattern: /^du -sh (\n+)$/, replacement: 'du -sh $1', description: 'Dir size human', category: 'system' },
  { pattern: /^curl -v/, replacement: 'curl -s', description: 'Curl silent', category: 'system' },
  { pattern: /^wget/, replacement: 'wget -q', description: 'Wget quiet', category: 'system' },
  { pattern: /^env$/, replacement: 'env | head -30', description: 'Env limited', category: 'system' },
];

// Combine all rules
const ALL_REWRITE_RULES: RewriteRule[] = [
  ...GIT_RULES,
  ...NPM_RULES,
  ...PNPM_RULES,
  ...LS_RULES,
  ...TEST_RULES,
  ...BUILD_RULES,
  ...DOCKER_RULES,
  ...GREP_RULES,
  ...SYSTEM_RULES,
];

// ============================================================================
// Output Filters
// ============================================================================

interface OutputFilter {
  name: string;
  filter: (output: string) => string;
}

// Remove ANSI escape codes
function removeAnsi(output: string): string {
  return output.replace(/\u001b\u001b\//g, '').replace(/\u001b\/\//g, '');
}

// Remove ANSI codes (various formats)
const ANSI_FILTER: OutputFilter = {
  name: 'ansi',
  filter: (output) => output.replace(/\u001b\u001b\//g, '').replace(/\u001b\/\//g, '').replace(/\u001b\/\//g, ''),
};

// Remove escape sequences
const ESCAPE_FILTER: OutputFilter = {
  name: 'escape',
  filter: (output) => output.replace(/\u001b\/\//g, ''),
};

// Collapse repeated lines (keep first 3, show count)
function collapseRepeatedLines(output: string): string {
  const lines = output.split('\n');
  const result: string[] = [];
  let count = 1;
  
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && lines[i] === lines[i - 1] && lines[i].trim() !== '') {
      count++;
    } else {
      if (count > 1 && count <= 10) {
        result.push(`[repeated ${count}x]`);
      } else if (count > 10) {
        result.push(`[repeated ${count}x]`);
      }
      result.push(lines[i]);
      count = 1;
    }
  }
  
  if (count > 1 && count <= 10) {
    result.push(`[repeated ${count}x]`);
  } else if (count > 10) {
    result.push(`[repeated ${count}x]`);
  }
  
  return result.join('\n');
}

// Remove empty/blank lines
const EMPTY_LINES_FILTER: OutputFilter = {
  name: 'empty-lines',
  filter: (output) => output.split('\n').filter(line => line.trim() !== '').join('\n'),
};

// Git status cleanup
function cleanGitStatus(output: string): string {
  // Remove leading whitespace from status characters
  return output.replace(/^(\\s+)(M|A|D|R|C|U)\b/gm, '$2');
}

// Remove progress bars
function removeProgressBars(output: string): string {
  // Remove common progress bar patterns
  return output
    .replace(/(\u2588|\u2591|\u2592|\u2593){3,}/g, '')
    .replace(/^\u2500+\n/gm, '')
    .replace(/^\u2502+\n/gm, '');
}

// Normalize whitespace
function normalizeWhitespace(output: string): string {
  return output
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

// ============================================================================
// RTK Core Functions
// ============================================================================

/**
 * Rewrite a command to its token-optimized equivalent
 */
export function rewriteCommand(command: string, config: Partial<RTKConfig> = {}): string {
  if (!config.enableRewrite && config.enableRewrite !== undefined) {
    return command;
  }

  const trimmed = command.trim();
  if (!trimmed) return command;

  for (const rule of ALL_REWRITE_RULES) {
    const match = trimmed.match(rule.pattern);
    if (match) {
      const rewritten = typeof rule.replacement === 'function'
        ? rule.replacement(match)
        : trimmed.replace(rule.pattern, rule.replacement);
      
      if (rewritten !== trimmed) {
        logger.debug('Command rewritten', {
          original: trimmed,
          rewritten,
          description: rule.description,
          category: rule.category,
        });
        return rewritten;
      }
    }
  }

  return command;
}

/**
 * Check if a command can be rewritten
 */
export function canRewrite(command: string): boolean {
  const trimmed = command.trim();
  return ALL_REWRITE_RULES.some(rule => rule.pattern.test(trimmed));
}

/**
 * Get the category of a command
 */
export function getCommandCategory(command: string): string | null {
  const trimmed = command.trim();
  for (const rule of ALL_REWRITE_RULES) {
    if (rule.pattern.test(trimmed)) {
      return rule.category;
    }
  }
  return null;
}

/**
 * Filter and compress output
 */
export interface FilterOptions {
  maxLines?: number;
  maxChars?: number;
  groupByFile?: boolean;
  enableDedupe?: boolean;
  enableAnsiFilter?: boolean;
  contextLines?: number;
}

export function filterOutput(
  output: string,
  command: string,
  options: FilterOptions = {}
): string {
  const {
    maxLines = 100,
    maxChars = 50000,
    groupByFile = true,
    enableDedupe = true,
    enableAnsiFilter = true,
  } = options;

  let filtered = output;

  // Apply ANSI filter
  if (enableAnsiFilter) {
    filtered = ANSI_FILTER.filter(filtered);
    filtered = ESCAPE_FILTER.filter(filtered);
  }

  // Remove progress bars
  filtered = removeProgressBars(filtered);

  // Deduplicate repeated lines
  if (enableDedupe) {
    filtered = collapseRepeatedLines(filtered);
  }

  // Clean git status
  if (command.includes('git status')) {
    filtered = cleanGitStatus(filtered);
  }

  // Group by file for grep-like output
  if (groupByFile && (command.includes('grep') || command.includes('rg'))) {
    filtered = groupGrepOutput(filtered);
  }

  // Normalize whitespace
  filtered = normalizeWhitespace(filtered);

  // Remove excessive empty lines
  filtered = filtered.replace(/\n{3,}/g, '\n\n');

  // Truncate to limits
  const lines = filtered.split('\n');
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const removed = lines.length - maxLines;
    filtered = kept.join('\n') + `\n\n... [+${removed} lines]`;
  }

  if (filtered.length > maxChars) {
    filtered = filtered.slice(0, maxChars) + '\n\n... [output truncated]';
  }

  return filtered;
}

/**
 * Group grep output by file (RTK-style)
 */
export function groupGrepOutput(output: string): string {
  const lines = output.split('\n');
  const byFile = new Map<string, string[]>();
  let currentFile = '';
  let totalMatches = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    // Try to detect file path from line (file:line:content format)
    const match = line.match(/^([^:\n]+):(\n+):(.*)$/);
    if (match) {
      currentFile = match[1];
      const lineNum = match[2];
      const content = match[3];

      if (!byFile.has(currentFile)) {
        byFile.set(currentFile, []);
      }
      byFile.get(currentFile)!.push(`  ${lineNum}: ${content}`);
      totalMatches++;
    } else if (line.includes(':')) {
      // Fallback: try to split by first colon
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0 && colonIdx < 50) {
        const potentialFile = line.slice(0, colonIdx);
        const rest = line.slice(colonIdx + 1);
        
        // Check if rest looks like line:content
        const contentMatch = rest.match(/^(\n+):(.*)$/);
        if (contentMatch) {
          currentFile = potentialFile;
          if (!byFile.has(currentFile)) {
            byFile.set(currentFile, []);
          }
          byFile.get(currentFile)!.push(`  ${contentMatch[1]}: ${contentMatch[2]}`);
          totalMatches++;
          continue;
        }
      }
      
      // Not a file:line:content format, just add as-is
      if (!byFile.has(currentFile)) {
        byFile.set(currentFile, []);
      }
      byFile.get(currentFile)!.push(`  ${line}`);
    } else {
      // No colon, add to current file or as orphan
      if (!byFile.has(currentFile)) {
        byFile.set('[unknown]', []);
      }
      byFile.get(currentFile)!.push(`  ${line}`);
    }
  }

  if (totalMatches === 0) {
    return output;
  }

  // Build grouped output
  const result: string[] = [];
  result.push(`${totalMatches} matches in ${byFile.size}F:\n`);

  for (const [file, matches] of byFile) {
    const compactPath = compactFilePath(file);
    result.push(`[file] ${compactPath} (${matches.length}):`);
    result.push(...matches.slice(0, 10)); // Limit per file
    if (matches.length > 10) {
      result.push(`  +${matches.length - 10}`);
    }
    result.push('');
  }

  return result.join('\n');
}

/**
 * Compact long file paths for display
 */
export function compactFilePath(path: string, maxLen = 50): string {
  if (path.length <= maxLen) return path;

  const parts = path.split(/[\/\\]/);
  if (parts.length <= 3) return path;

  return `${parts[0]}/.../${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

// ============================================================================
// Smart Context / Summarization
// ============================================================================

export interface SummaryOptions {
  maxLines?: number;
  includeSignatures?: boolean;
  includeImports?: boolean;
  language?: string;
}

/**
 * Generate a smart summary of code content (heuristic-based)
 */
export function summarizeCode(
  content: string,
  options: SummaryOptions = {}
): string {
  const { maxLines = 30, includeSignatures = true, includeImports = true, language } = options;

  const lines = content.split('\n');
  
  // Priority lines to keep:
  // 1. Import/require statements
  // 2. Function/class signatures
  // 3. Type definitions
  // 4. Important comments (docstrings)
  
  const priorityLines: string[] = [];
  const skippedLines: string[] = [];
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Handle block comments
    if (trimmed.startsWith('/*') || trimmed.startsWith('*/')) {
      inBlockComment = !inBlockComment && !trimmed.endsWith('*/');
      if (inBlockComment || trimmed === '*/') {
        priorityLines.push(line);
        continue;
      }
    }

    // Docstrings
    if (trimmed.startsWith('///') || trimmed.startsWith('##') || trimmed.startsWith('<!--')) {
      priorityLines.push(line);
      continue;
    }

    // Imports
    if (includeImports && (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('require(') ||
      trimmed.startsWith('from ') ||
      trimmed.startsWith('use ') ||
      trimmed.startsWith('#include')
    )) {
      priorityLines.push(line);
      continue;
    }

    // Function/class signatures
    if (includeSignatures && (
      /^(export )?(async )?(function|const|let|var|class|interface|struct|enum|trait|fn|def|pub)\b/.test(trimmed) ||
      /^(export )?interface \n+/.test(trimmed) ||
      /^(export )?type \n+/.test(trimmed) ||
      /=>\b/.test(trimmed)
    )) {
      priorityLines.push(line);
      continue;
    }

    // Type definitions
    if (/^(type|interface|enum)\b/.test(trimmed)) {
      priorityLines.push(line);
      continue;
    }

    // Keep first maxLines of actual code
    if (priorityLines.length < maxLines) {
      priorityLines.push(line);
    } else {
      skippedLines.push(line);
    }
  }

  // Build summary
  const summary: string[] = [];
  
  if (skippedLines.length > 0) {
    summary.push(`... [${skippedLines.length} lines omitted] ...\n`);
  }
  
  summary.push(...priorityLines);

  return summary.join('\n');
}

/**
 * Generate a summary of command output (heuristic-based)
 */
export function summarizeOutput(output: string, type: 'test' | 'build' | 'git' | 'grep' | 'generic' = 'generic'): string {
  const lines = output.split('\n').filter(l => l.trim());
  
  switch (type) {
    case 'test': {
      // Extract test summary
      const passMatch = output.match(/(\n+)\u2714|passed|ok|PASS/);
      const failMatch = output.match(/(\n+)\u2718|failed|FAIL|error:|ERROR/);
      const summaryMatch = output.match(/Tests:.*/);
      
      if (summaryMatch) {
        return summaryMatch[0];
      }
      
      // Count results
      const passed = (output.match(/passed|ok|PASS/g) || []).length;
      const failed = (output.match(/failed|FAIL|error:|ERROR/g) || []).length;
      
      if (passed > 0 || failed > 0) {
        return `Tests: ${passed} passed, ${failed} failed`;
      }
      
      return lines.slice(0, 10).join('\n');
    }
    
    case 'build': {
      // Extract build summary
      const timeMatch = output.match(/Finished|built|compiled|compiled in.*s/i);
      const errorMatch = output.match(/error:|ERROR|failed to compile/i);
      const warningMatch = output.match(/warning:/i);
      
      if (errorMatch) {
        return output.split('\n').filter(l => /error:|ERROR|failed/.test(l)).slice(0, 5).join('\n');
      }
      
      if (timeMatch) {
        return output.split('\n').filter(l => /Finished|built|compiled|warning/.test(l)).join('\n');
      }
      
      return lines.slice(0, 10).join('\n');
    }
    
    case 'git': {
      // Compact git output
      const statusMatch = output.match(/^[MADRCU]\b|^\n+/gm);
      const commitMatch = output.match(/[a-f0-9]{7,}\b.*$/m);
      
      if (commitMatch) {
        return lines.slice(0, 5).join('\n');
      }
      
      if (statusMatch) {
        return output.match(/^[MADRCU]\b.*$/gm)?.join('\n') || output;
      }
      
      return lines.slice(0, 10).join('\n');
    }
    
    case 'grep': {
      // Group by file and show counts
      return groupGrepOutput(output);
    }
    
    default:
      return lines.slice(0, 20).join('\n');
  }
}

// ============================================================================
// Token Tracking
// ============================================================================

interface TokenStats {
  originalTokens: number;
  filteredTokens: number;
  savedTokens: number;
  savingsPercent: number;
  command: string;
  timestamp: number;
}

const tokenHistory: TokenStats[] = [];
const MAX_HISTORY = 1000;

/**
 * Estimate token count from text (rough approximation: 4 chars = 1 token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Track token savings from filtering
 */
export function trackSavings(
  command: string,
  originalOutput: string,
  filteredOutput: string
): TokenStats {
  const originalTokens = estimateTokens(originalOutput);
  const filteredTokens = estimateTokens(filteredOutput);
  const savedTokens = Math.max(0, originalTokens - filteredTokens);
  const savingsPercent = originalTokens > 0 
    ? Math.round((savedTokens / originalTokens) * 100) 
    : 0;

  const stats: TokenStats = {
    originalTokens,
    filteredTokens,
    savedTokens,
    savingsPercent,
    command,
    timestamp: Date.now(),
  };

  tokenHistory.push(stats);
  if (tokenHistory.length > MAX_HISTORY) {
    tokenHistory.shift();
  }

  logger.debug('Token savings tracked', stats);

  return stats;
}

/**
 * Get overall token savings summary
 */
export function getSavingsSummary(): {
  totalCommands: number;
  totalOriginalTokens: number;
  totalFilteredTokens: number;
  totalSavedTokens: number;
  avgSavingsPercent: number;
  topCommands: Array<{ command: string; count: number; savedTokens: number }>;
} {
  const totalOriginalTokens = tokenHistory.reduce((sum, s) => sum + s.originalTokens, 0);
  const totalFilteredTokens = tokenHistory.reduce((sum, s) => sum + s.filteredTokens, 0);
  const totalSavedTokens = tokenHistory.reduce((sum, s) => sum + s.savedTokens, 0);
  const avgSavingsPercent = tokenHistory.length > 0
    ? Math.round(tokenHistory.reduce((sum, s) => sum + s.savingsPercent, 0) / tokenHistory.length)
    : 0;

  // Group by command
  const commandCounts = new Map<string, { count: number; savedTokens: number }>();
  for (const stat of tokenHistory) {
    const existing = commandCounts.get(stat.command) || { count: 0, savedTokens: 0 };
    commandCounts.set(stat.command, {
      count: existing.count + 1,
      savedTokens: existing.savedTokens + stat.savedTokens,
    });
  }

  const topCommands = Array.from(commandCounts.entries())
    .map(([command, data]) => ({ command, ...data }))
    .sort((a, b) => b.savedTokens - a.savedTokens)
    .slice(0, 10);

  return {
    totalCommands: tokenHistory.length,
    totalOriginalTokens,
    totalFilteredTokens,
    totalSavedTokens,
    avgSavingsPercent,
    topCommands,
  };
}

/**
 * Clear token history
 */
export function clearHistory(): void {
  tokenHistory.splice(0, tokenHistory.length);
}

// ============================================================================
// RTK Service (Main Integration Point)
// ============================================================================

export class RTKService {
  private config: RTKConfig;

  constructor(config: Partial<RTKConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Process a command: rewrite if needed
   */
  processCommand(command: string): string {
    return rewriteCommand(command, this.config);
  }

  /**
   * Filter command output
   */
  filterOutput(output: string, command: string): string {
    return filterOutput(output, command, this.config);
  }

  /**
   * Full pipeline: rewrite command, execute, filter output
   */
  async executeWithRTK(
    command: string,
    executeFn: () => Promise<{ stdout: string; stderr: string; exitCode: number }>
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    rewrittenCommand?: string;
    filteredOutput?: string;
    stats?: TokenStats;
  }> {
    // Rewrite command
    const rewrittenCommand = this.processCommand(command);
    const wasRewritten = rewrittenCommand !== command;

    // Execute
    const result = await executeFn();

    // Filter stdout
    const filteredOutput = this.config.enableFilter 
      ? this.filterOutput(result.stdout, rewrittenCommand)
      : result.stdout;

    // Track savings
    let stats: TokenStats | undefined;
    if (this.config.trackSavings && wasRewritten) {
      stats = trackSavings(command, result.stdout, filteredOutput);
    }

    return {
      ...result,
      stdout: filteredOutput,
      rewrittenCommand: wasRewritten ? rewrittenCommand : undefined,
      filteredOutput: wasRewritten ? filteredOutput : undefined,
      stats,
    };
  }

  /**
   * Summarize output based on command type
   */
  summarize(output: string, type: 'test' | 'build' | 'git' | 'grep' | 'generic'): string {
    return summarizeOutput(output, type);
  }

  /**
   * Summarize code content
   */
  summarizeCode(content: string, options?: SummaryOptions): string {
    return summarizeCode(content, options);
  }

  /**
   * Get token savings summary
   */
  getSummary() {
    return getSavingsSummary();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RTKConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ============================================================================
// Default Export
// ============================================================================

export const rtkService = new RTKService();

export default {
  rewriteCommand,
  filterOutput,
  canRewrite,
  getCommandCategory,
  groupGrepOutput,
  compactFilePath,
  summarizeCode,
  summarizeOutput,
  trackSavings,
  getSavingsSummary,
  clearHistory,
  estimateTokens,
  RTKService,
  rtkService,
};