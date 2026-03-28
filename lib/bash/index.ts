/**
 * Bash-Native Execution Module
 *
 * Provides shell-native execution primitives for LLM agents
 *
 * @see bash.md - Bash-native agent execution patterns
 */

// Event schemas
export * from './bash-event-schema';

// Bash tool execution
export * from './bash-tool';

// DAG compilation and execution
export * from './dag-compiler';
export * from './dag-executor';

// Self-healing layer (explicit exports to avoid conflicts)
export {
  classifyError,
  validateRepair,
  generateDiffRepair,
  applyDiff,
  isMinimalChange,
  applyTargetedFix,
  normalizeCommand,
  findKnownFix,
  storeFix,
} from './self-healing';
