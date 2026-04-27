/**
 * Agent Binary Detection — Unified Exports
 *
 * Central exports for all CLI agent binary detection utilities.
 * Each agent has its own finder module that uses the shared base,
 * ensuring consistent OS-aware detection, caching, and env var overrides.
 */

// Shared base (for creating custom agent finders)
export {
  createBinaryFinders,
  resetBinaryCacheForTesting,
  type AgentBinaryConfig,
  type FindBinaryOptions,
} from './find-agent-binary-base';

// OpenCode
export {
  findOpencodeBinary,
  findOpencodeBinarySync,
} from './find-opencode-binary';

// Pi
export {
  findPiBinary,
  findPiBinarySync,
} from './find-pi-binary';

// Codex
export {
  findCodexBinary,
  findCodexBinarySync,
} from './find-codex-binary';

// Amp
export {
  findAmpBinary,
  findAmpBinarySync,
} from './find-amp-binary';

// Claude Code
export {
  findClaudeCodeBinary,
  findClaudeCodeBinarySync,
} from './find-claude-code-binary';

// Kilocode
export {
  findKilocodeBinary,
  findKilocodeBinarySync,
} from './find-kilocode-binary';

// Agent Filesystem (centralized desktop/web/remote FS handling)
export {
  createAgentFilesystem,
  detectDefaultFsMode,
  getDefaultAgentCwd,
  type AgentFilesystem,
  type AgentFsConfig,
  type AgentFsMode,
  type DirEntry,
} from './agent-filesystem';

// Security utilities
export {
  normalizeAndSecurePath,
  isSecretPath,
  isDangerousPath,
  filterSensitiveDirs,
  secureRead,
  secureWrite,
  getGitBackedVFS,
  getFileHistory,
  checkCommandSecurity,
  requiresConfirmation,
  CONFIRM_REQUIRED_COMMANDS,
  ALWAYS_CONFIRM_COMMANDS,
} from './security';
