/**
 * Compat shim — tests and some legacy callers import from this path.
 *
 * The real implementation lives in `lib/session/session-manager.ts` (consolidated).
 * This file is kept for backward compatibility and should not be extended.
 *
 * @see lib/session/session-manager.ts
 */

export {
  openCodeV2SessionManager,
  sessionManager,
  SessionManager,
} from '@/lib/session/session-manager';

export type {
  Session as OpenCodeV2Session,
  SessionConfig as V2SessionConfig,
  SessionQuota as V2SessionQuota,
} from '@/lib/session/session-manager';
