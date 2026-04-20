/**
 * OpenCode Binary Detection — Backward Compatibility Re-export
 *
 * This module re-exports the shared agent-bins implementation.
 * All new code should import from `@/lib/agent-bins/find-opencode-binary` directly.
 *
 * This file exists solely so that existing imports from
 * `@/lib/opencode/find-opencode-binary` continue to work.
 */

export {
  findOpencodeBinary,
  findOpencodeBinarySync,
  resetBinaryCacheForTesting,
} from '@/lib/agent-bins/find-opencode-binary';

export {
  type FindBinaryOptions,
} from '@/lib/agent-bins/find-agent-binary-base';
