/**
 * Identity Utilities — Barrel Export
 *
 * @example
 * ```typescript
 * import {
 *   parseCompositeSessionId,
 *   buildToolContextIdentity,
 *   buildScopePath,
 * } from '@/lib/identity';
 * ```
 */

export {
  // Core types
  CompositeSessionId,
  ToolContextIdentity,

  // Parsing & construction
  parseCompositeSessionId,
  buildCompositeSessionId,
  extractSimpleSessionId,
  extractUserIdFromComposite,

  // Path construction
  buildScopePath,
  buildScopedFilePath,

  // Validation
  isValidSessionId,
  isCompositeSessionId,

  // Database query helpers
  buildShadowCommitKey,
  extractShadowCommitKey,

  // Tool context helpers
  buildToolContextIdentity,
} from './composite-session-id';
