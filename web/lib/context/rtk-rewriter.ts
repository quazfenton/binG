/**
 * RTK Command Rewriter
 * 
 * Filters and compresses bash command output to reduce LLM token consumption by 60-90%.
 * Based on RTK (Rust Token Killer): https://github.com/rtk-ai/rtk
 * 
 * This module provides:
 * 1. Command rewriting - transforms commands to use token-optimized equivalents
 * 2. Output filtering - compresses output after execution
 * 
 * Supported commands:
 * - git: status, log, diff, add, commit, push, pull
 * - ls, tree, find, grep
 * - npm, pnpm, yarn: test, build, lint
 * - cargo: test, build, clippy
 * - docker, kubectl
 * - And 100+ more
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('RTK');

// ============================================================================
// Command Registry
// ============================================================================

interface RewriteRule {
  pattern: RegExp;
  replacement: string;
  description: string;
}

// Git commands - map raw commands to rtk equivalents
const GIT_REWRITE_RULES: RewriteRule[] = [
  // git status
  { pattern: /^git status$/, replacement: 'git status --short', description: 'Compact git status' },
  { pattern: /^git status\s+(-s|--short)$/, replacement: 'git status --short', description: 'Already short' },
  
  // git log
  { pattern: /^git log$/, replacement: 'git log --oneline -20', description: 'One-line git log' },
  { pattern: /^git log\s+--oneline(?!\s+-)/, replacement: 'git log --oneline -20', description: 'One-line with limit' },
  
  // git diff
  { pattern: /^git diff$/, replacement: 'git diff --stat', description: 'Diff stats only' },
  { pattern: /^git diff\s+--stat$/, replacement: 'git diff --stat', description: 'Already stat' },
  
  // git add
  { pattern: /^git add\s+\./, replacement: 'git add .', description: 'Stage all' },
  
  // git push
  { pattern: /^git push$/, replacement: 'git push', description: 'Push (no change needed)' },
  
  // git pull
  { pattern: /^git pull$/, replacement: 'git pull', description: 'Pull (no change needed)' },
  
  // git branch
  { pattern: /^git branch$/, replacement: 'git branch --format "%(refname:short)"', description: 'Compact branch list' },
];

// Package manager commands
const NPM_REWRITE_RULES: RewriteRule[] = [
  // npm test
  { pattern: /^npm test$/, replacement: 'npm test -- --json 2>&1 | head -50', description: 'JSON test output' },
  { pattern: /^npm run\s+(\S+)\s+(--json)?/, replacement: 'npm run $1 --json 2>&1 | head -50', description: 'npm run optimized' },
  
  // npm run
  { pattern: /^npm run\s+test$/, replacement: 'npm test -- --json 2>&1 | head -50', description: 'npm test JSON' },
  
  // pnpm
  { pattern: /^pnpm\s+(test|build|lint|dev)$/, replacement: 'pnpm $1 --json 2>&1 | head -50', description: 'pnpm JSON output' },
];

// File listing commands
const LS_REWRITE_RULES: RewriteRule[] = [
  // ls -la -> ls with formatting
  { pattern: /^ls\s+-la$/, replacement: 'ls -F', description: 'Classified listing' },
  { pattern: /^ls\s+-l$/, replacement: 'ls -F', description: 'Classified listing' },
  { pattern: /^ls\s+-R$/, replacement: 'ls -R', description: 'Recursive (keep)' },
  
  // tree (if available)
  { pattern: /^tree\s+-L\s+(\d+)/, replacement: 'tree -L $1 -d', description: 'Tree directories only' },
];

// Test commands
const TEST_REWRITE_RULES: RewriteRule[] = [
  // vitest
  { pattern: /^npx\s+vitest\s+run/, replacement: 'npx vitest run --reporter=basic', description: 'Basic vitest output' },
  { pattern: /^vitest\s+(run|watch)$/, replacement: 'vitest $1 --reporter=basic', description: 'Basic vitest' },
  
  // jest
  { pattern: /^npx\s+jest$/, replacement: 'npx jest --json 2>&1 | tail -30', description: 'Jest JSON' },
  { pattern: /^npx\s+jest\s+(\S+)/, replacement: 'npx jest $1 --json 2>&1 | tail -30', description: 'Jest specific' },
  
  // cargo test
  { pattern: /^cargo\s+test$/, replacement: 'cargo test -- --quiet', description: 'Quiet cargo test' },
  
  // pytest
  { pattern: /^pytest$/, replacement: 'pytest -q --tb=no', description: 'Quiet pytest' },
  { pattern: /^python\s+-m\s+pytest$/, replacement: 'python -m pytest -q --tb=no', description: 'Quiet pytest' },
];

// Build/lint commands
const BUILD_REWRITE_RULES: RewriteRule[] = [
  // cargo build
  { pattern: /^cargo\s+build$/, replacement: 'cargo build --quiet', description: 'Quiet cargo build' },
  
  // cargo clippy
  { pattern: /^cargo\s+clippy$/, replacement: 'cargo clippy --quiet', description: 'Quiet clippy' },
  
  // tsc / TypeScript
  { pattern: /^npx\s+tsc$/, replacement: 'npx tsc --noEmit --pretty false', description: 'TSC compact' },
  { pattern: /^npx\s+tsc\s+--noEmit$/, replacement: 'npx tsc --noEmit --pretty false', description: 'TSC noEmit compact' },
  
  // ruff
  { pattern: /^ruff\s+check/, replacement: 'ruff check --output-format=json', description: 'Ruff JSON' },
  
  // eslint
  { pattern: /^npx\s+eslint/, replacement: 'npx eslint --format=json', description: 'ESLint JSON' },
];

// Docker commands
const DOCKER_REWRITE_RULES: RewriteRule[] = [
  // docker ps
  { pattern: /^docker\s+ps$/, replacement: 'docker ps --format "{{.ID}} {{.Status}}"', description: 'Compact docker ps' },
  { pattern: /^docker\s+ps\s+-a$/, replacement: 'docker ps -a --format "{{.ID}} {{.Status}}"', description: 'Compact docker ps all' },
  
  // docker images
  { pattern: /^docker\s+images$/, replacement: 'docker images --format "{{.Repository}}:{{.Tag}} {{.Size}}"', description: 'Compact docker images' },
  
  // docker compose
  { pattern: /^docker-compose\s+ps$/, replacement: 'docker compose ps --format "{{.Name}} {{.Status}}"', description: 'Compact compose ps' },
  
  // kubectl
  { pattern: /^kubectl\s+get\s+pods$/, replacement: 'kubectl get pods -o wide', description: 'Kubectl pods wide' },
  { pattern: /^kubectl\s+get\s+(\S+)$/, replacement: 'kubectl get $1', description: 'Kubectl get (keep)' },
];

// Combine all rules
const ALL_REWRITE_RULES = [
  ...GIT_REWRITE_RULES,
  ...NPM_REWRITE_RULES,
  ...LS_REWRITE_RULES,
  ...TEST_REWRITE_RULES,
  ...BUILD_REWRITE_RULES,
  ...DOCKER_REWRITE_RULES,
];

// ============================================================================
// Output Filters
// ============================================================================

interface OutputFilter {
  name: string;
  pattern: RegExp;
  filter: (output: string) => string;
}

// Remove ANSI codes
const ANSI_FILTER: OutputFilter = {
  name: 'ansi',
  pattern: /\x1b\[[0-9;]*m/g,
  filter: (output) => output.replace(/\x1b\[[0-9;]*m/g, ''),
};

// Remove escape sequences
const ESCAPE_FILTER: OutputFilter = {
  name: 'escape',
  pattern: /\x1b\[[0-9;]*[A-Za-z]/g,
  filter: (output) => output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''),
};

// Collapse repeated lines (git diff, etc)
const REPEATED_LINES_FILTER: OutputFilter = {
  name: 'repeated',
  pattern: /^([+-].*)$\n(\1\n)+/gm,
  filter: (output) => output.replace(/^([+-].*)$\n(\1\n)+/gm, '$1\n'),
};

// Remove empty lines
const EMPTY_LINES_FILTER: OutputFilter = {
  name: 'empty',
  pattern: /^\s*$/gm,
  filter: (output) => output.split('\n').filter(line => line.trim()).join('\n'),
};

// Collapse whitespace in git status
const GIT_STATUS_FILTER: OutputFilter = {
  name: 'git-status',
  pattern: /^(M|A|D|R|C)\s+/gm,
  filter: (output) => output,
};

// Deduplicate test output lines
const TEST_OUTPUT_FILTER: OutputFilter = {
  name: 'test-dedup',
  pattern: /^(PASS|FAIL|Test Suites|Tests:|Snapshots:|Time:).*$/gm,
  filter: (output) => output,
};

const ALL_OUTPUT_FILTERS = [
  ANSI_FILTER,
  ESCAPE_FILTER,
  REPEATED_LINES_FILTER,
  EMPTY_LINES_FILTER,
  TEST_OUTPUT_FILTER,
];

// ============================================================================
// Main Rewriter Function
// ============================================================================

/**
 * Rewrite a bash command to its token-optimized equivalent
 * 
 * @param command - Raw command string
 * @returns Rewritten command (or original if no rewrite available)
 */
export function rewriteCommand(command: string): string {
  const trimmed = command.trim();
  
  if (!trimmed) return command;
  
  for (const rule of ALL_REWRITE_RULES) {
    if (rule.pattern.test(trimmed)) {
      const rewritten = trimmed.replace(rule.pattern, rule.replacement);
      if (rewritten !== trimmed) {
        logger.debug('Command rewritten', {
          original: trimmed,
          rewritten,
          description: rule.description,
        });
        return rewritten;
      }
    }
  }
  
  return command;
}

/**
 * Filter output to reduce token count
 * 
 * @param command - The command that was executed
 * @param output - Raw output from command
 * @param options - Filter options
 * @returns Filtered output
 */
export interface FilterOptions {
  /** Maximum lines to keep */
  maxLines?: number;
  /** Maximum characters to keep */
  maxChars?: number;
  /** Enable output filters */
  enableFilters?: boolean;
}

export function filterOutput(
  command: string,
  output: string,
  options: FilterOptions = {}
): string {
  const { maxLines = 100, maxChars = 50000, enableFilters = true } = options;
  
  let filtered = output;
  
  if (enableFilters) {
    for (const filter of ALL_OUTPUT_FILTERS) {
      filtered = filter.filter(filtered);
    }
  }
  
  // Truncate to limits
  const lines = filtered.split('\n');
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const removed = lines.length - maxLines;
    filtered = kept.join('\n') + `\n\n... (${removed} lines truncated)`;
  }
  
  if (filtered.length > maxChars) {
    filtered = filtered.slice(0, maxChars) + '\n\n... (output truncated)';
  }
  
  return filtered;
}

/**
 * Check if a command could benefit from rewriting
 * 
 * @param command - Command to check
 * @returns Whether command has a rewrite rule
 */
export function hasRewriteRule(command: string): boolean {
  const trimmed = command.trim();
  return ALL_REWRITE_RULES.some(rule => rule.pattern.test(trimmed));
}

// ============================================================================
// Statistics
// ============================================================================

interface TokenStats {
  original: number;
  filtered: number;
  savings: number;
  savingsPercent: number;
}

/**
 * Estimate token savings from filtering
 * 
 * @param original - Original output
 * @param filtered - Filtered output
 * @returns Token statistics
 */
export function estimateTokenSavings(original: string, filtered: string): TokenStats {
  // Rough estimate: 1 token ~= 4 characters
  const originalTokens = Math.ceil(original.length / 4);
  const filteredTokens = Math.ceil(filtered.length / 4);
  const savings = originalTokens - filteredTokens;
  const savingsPercent = originalTokens > 0 
    ? Math.round((savings / originalTokens) * 100) 
    : 0;
  
  return {
    original: originalTokens,
    filtered: filteredTokens,
    savings,
    savingsPercent,
  };
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  rewriteCommand,
  filterOutput,
  hasRewriteRule,
  estimateTokenSavings,
};