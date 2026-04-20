/**
 * Type declarations for @/lib/virtual-filesystem/scope-utils
 * Stub for agent-worker — mirrors real exports from web/lib/virtual-filesystem/scope-utils.ts
 *
 * ⚠️ KEEP IN SYNC: If the real module's exports change, this stub must be updated
 * to match. Otherwise TS errors will silently disappear while runtime breaks.
 */

export function stripWorkspacePrefixes(rawPath: string): string;
export function normalizeScopePath(scopePath?: string): string;
export function resolveScopedPath(requestedPath: string, scopePath?: string): string;
export function extractSessionIdFromPath(scopePath?: string): string | null;
export function sanitizeScopePath(scopePath?: string): string;
export function extractScopePath(filePath: string): string;
export function normalizeSessionId(sessionId: string): string;
export function normalizeSessionPath(sessionId: string, subPath?: string): string;
