/**
 * Tool classification — single source of truth for read-only / write-style
 * tool name membership.
 *
 * Before this module was added, the same logical sets were duplicated in
 * three places with drift in three directions:
 *
 *   1. llm-continuation.ts
 *        - READ_ONLY_TOOL_HINTS (locally-scoped array)
 *        - READ_ONLY_FILE_PREFIX_TOOLS (locally-scoped array)
 *        - No WRITE_TOOL_NAMES — derived implicitly
 *   2. auto-continue-detector.ts
 *        - READ_ONLY_TOOL_NAMES (exported Set<string>)
 *        - WRITE_TOOL_NAMES (exported Set<string>)
 *   3. unified-agent-service.ts
 *        - READ_ONLY_TOOL_NAMES (locally-scoped Set<string>)
 *        - WRITE_TOOL_NAMES (locally-scoped Set<string>)
 *
 * Drift examples caught during consolidation:
 *   - llm-continuation had `read_url`, `list_files`, and the capability-style
 *     `file.search`, `web.search`, `web.fetch` — auto-continue-detector did
 *     not. So `read_url` calls were classified as read-only by the
 *     auto-continuation check but ALSO as read-only by the hint loop; the
 *     asymmetry was fine, but adding new names would silently drift.
 *   - unified-agent-service had dropped `repo.search`. Capability-style
 *     `repo.search` calls would be classified as read by auto-continue
 *     but neither read nor write by unified-agent's stall heuristic,
 *     producing opposite detour decisions on the same input.
 *   - WRITE_TOOL_NAMES differed in whether `bash.execute` was at the
 *     dot-boundary form. Now consistent.
 *
 * This module is the single source of truth — consumers import from
 * `@bing/shared/agent/tool-classification`. If you need to add or remove
 * a tool name, do it here only; downstream sets rebuild automatically.
 */

/**
 * Canonical read-only tool names \u2014 info-gathering tools that don't mutate
 * state. Membership test via Set.has() after lower-casing and
 * hyphen-to-underscore normalization (callers can pre-normalize for speed).
 */
export const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  // canonical snake_case filesystem reads
  'read_file',
  'read_url',
  'list_files',
  'list_directory',
  'list_dir',
  'ls',
  // search / grep family
  'search_files',
  'grep',
  'glob',
  'find',
  'search_code',
  'grep_code',
  // web fetches / searches
  'web_search',
  'web_fetch',
  // Canonical capability-style dotted names
  'file.read',
  'file.list',
  'file.search',
  'repo.search',
  'web.search',
  'web.fetch',
]);

/**
 * Canonical write-tool names \u2014 tools that mutate state OR execute
 * commands (commands are treated as write-side because they can mutate
 * via shell side effects even if the immediate payload is a read).
 *
 * Note: `bash.*` and any `execute_bash` / `execute_command` / `terminal`
 * variant is treated as write-side. If you need to classify a tool that
 * executes only-read commands, model it as a separate read-only tool name.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  // canonical snake_case writes
  'write_file',
  'edit_file',
  'apply_diff',
  'applydiff',
  'delete_file',
  'batch_write',
  'write_files',
  'batchwrite',
  'writefiles',
  'str_replace',
  'replace_in_file',
  // shell / command execution
  'execute_bash',
  'execute_command',
  'execute',
  'bash',
  'shell',
  'terminal',
  'run',
  // sandbox execution
  'sandbox_execute',
  'sandbox_shell',
  'sandbox_session',
  // mcp tool invocations
  'mcp_tool',
  'mcp_execute',
  // Canonical capability-style dotted names
  'file.write',
  'file.delete',
  'file.batch_write',
  'bash.execute',
]);

/**
 * Capability-style dotted read-only prefixes: `domain.action`,
 * drawn from the snake_case entries in READ_ONLY_TOOL_NAMES above.
 * Matched via direct equality (the dotted form is preserved during
 * normalization — we do NOT replace `.` with `_`) so the dotted-match
 * path in consumers can short-circuit with `.has()` without paying
 * the lower-case + hyphen-to-underscore cost of normalizeToolName().
 * The Set contents are an inline subset of the dotted members of
 * READ_ONLY_TOOL_NAMES; always derive from the array literal below,
 * not from a count remembered in this JSDoc.
 */
export const CAPABILITY_PREFIX_TOOLS: ReadonlySet<string> = new Set<string>([  'file.read',
  'file.list',
  'file.search',
  'repo.search',
  'web.search',
  'web.fetch',
]);

/**
 * Normalize a tool name to its canonical form: lower-case, hyphens to
 * underscores. Dotted names (`file.read`) are preserved verbatim because
 * `.` is meaningful; only `-` is collapsed.
 */
export function normalizeToolName(name: string): string {
  return (name ?? '').toString().toLowerCase().replace(/-/g, '_');
}

/**
 * True if the given tool name is in the read-only set. Pass an
 * un-normalized name and the helper normalizes for you; callers running
 * this in a hot loop should normalize once and call directly with the
 * pre-normalized string.
 */
export function isReadOnlyTool(name: string): boolean {
  if (!name) return false;
  const canonical = normalizeToolName(name);
  return READ_ONLY_TOOL_NAMES.has(canonical);
}

/**
 * True if the given tool name is in the write set.
 */
export function isWriteTool(name: string): boolean {
  if (!name) return false;
  const canonical = normalizeToolName(name);
  return WRITE_TOOL_NAMES.has(canonical);
}

/**
 * True if the given tool name ends with a mutation-capable suffix
 * (`.write`, `.create`, `.delete`, `.edit`). This is the broader
 * heuristic unified-agent-service.ts uses for unknown future tools.
 */
export function hasMutationSuffix(name: string): boolean {
  if (!name) return false;
  const canonical = normalizeToolName(name);
  return (
    canonical.endsWith('.write') ||
    canonical.endsWith('.create') ||
    canonical.endsWith('.delete') ||
    canonical.endsWith('.edit')
  );
}

/**
 * True if the given tool name ends with a read-only suffix (`.read`,
 * `.list`, `.search`).
 */
export function hasReadSuffix(name: string): boolean {
  if (!name) return false;
  const canonical = normalizeToolName(name);
  return (
    canonical.endsWith('.read') ||
    canonical.endsWith('.list') ||
    canonical.endsWith('.search')
  );
}
