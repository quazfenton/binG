/**
 * route.ts — Targeted fixes & improvements
 *
 * The file is too large to rewrite in full; this module documents every
 * change needed and provides drop-in replacements for the affected
 * functions / snippets.
 *
 * HOW TO APPLY
 * ─────────────
 * 1. Replace each section marked  ── REPLACE ──  with the code below it.
 * 2. The surrounding context is given so you can locate each site precisely.
 */

// ═══════════════════════════════════════════════════════════════════════════
// FIX 1 ── remove duplicate applyUnifiedDiff (route.ts already imports
//           parsePatch / applyPatch from 'diff' and re-implements the same
//           logic that already lives in file-diff-utils.ts)
//
// WHY:  Two implementations of the same algorithm can drift out of sync.
//       The version in file-diff-utils.ts is the canonical one.
//
// ── REPLACE (in route.ts around line ~2050) ──────────────────────────────
//
//   REMOVE this entire local function:
//
//   function applyUnifiedDiff(currentContent: string, targetPath: string, rawDiff: string): string {
//     const diffBody = rawDiff.endsWith('\n') ? rawDiff : `${rawDiff}\n`;
//     const unifiedDiff = `--- ${targetPath}\n+++ ${targetPath}\n${diffBody}`;
//     const parsedPatches = parsePatch(unifiedDiff);
//     if (parsedPatches.length === 0) throw new Error(...);
//     const patched = applyPatch(currentContent, parsedPatches[0]);
//     if (patched === false) throw new Error(...);
//     return patched;
//   }
//
// ── ADD at top of route.ts (or alongside other imports from file-diff-utils)
//
//   import { applyUnifiedDiffToContent } from '@/lib/chat/file-diff-utils';
//
// ── THEN replace every call-site from:
//
//   const patchedContent = applyUnifiedDiff(currentContent, targetPath, diffOperation.diff);
//
// ── TO:
//
//   const patchedContent = applyUnifiedDiffToContent(currentContent, targetPath, diffOperation.diff);
//   if (patchedContent === null) {
//     throw new Error(`Patch could not be applied for ${targetPath}`);
//   }
//
// ══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// FIX 2 ── isCodeOrAgenticRequest: build the weak-keyword RegExp once,
//           not inside the hot path on every request.
//
// WHY:  The current code creates N individual RegExp objects per call
//       (one per weak keyword) on every incoming request.
//
// ── REPLACE (module-level, outside any function) ─────────────────────────

// Compiled once at module load — not per request.
const STRONG_CODE_PATTERN =
  /\b(refactor|bug\s*fix|stack\s*trace|typescript|javascript|python|react|next\.js|vue\.js|angular|node\.?js|endpoint|database|schema|compile|lint|migrations?|docker|kubernetes|k8s|redis|mongodb|postgresql|mysql|sqlite|express|fastapi|flask|django|spring|rails|laravel|symfony|golang|rust|java|c\+\+|cpp|c#|dotnet|swift|kotlin|flutter|react\s*native|electron|code|build|implement|create\s+app|create\s+project|scaffold|generate\s+app)\b/i

const WEAK_CODE_KEYWORDS = [
  'app', 'project', 'component', 'file', 'api',
  'function', 'class', 'module', 'package', 'implement', 'build', 'develop',
] as const

// Pre-compile each weak-keyword pattern once.
const WEAK_CODE_PATTERNS = WEAK_CODE_KEYWORDS.map(
  kw => new RegExp(`\\b${kw}\\b`, 'i'),
)

export function isCodeOrAgenticRequest_FIXED(
  messages: import('@/lib/chat/llm-providers').LLMMessage[],
  attachedFiles: { path: string; content: string; language?: string }[],
): boolean {
  if (attachedFiles.length > 0) return true

  const lastUser = [...messages].reverse().find(m => m.role === 'user')
  const content =
    typeof lastUser?.content === 'string'
      ? lastUser.content
      : JSON.stringify(lastUser?.content ?? '')

  if (STRONG_CODE_PATTERN.test(content)) return true

  // Count distinct weak-keyword matches; ≥2 triggers
  let weakMatches = 0
  for (const re of WEAK_CODE_PATTERNS) {
    if (re.test(content) && ++weakMatches >= 2) return true
  }

  return false
}

// ══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// FIX 3 ── shouldUseContextPack: build the combined RegExp once.
//
// WHY:  The pattern is rebuilt (regex compilation) on every request.
//
// ── REPLACE (module-level) ───────────────────────────────────────────────

const CONTEXT_PACK_PATTERN = new RegExp(
  [
    'full project',
    'entire project',
    'whole project',
    'complete codebase',
    'full codebase',
    'entire codebase',
    'project structure',
    'codebase structure',
    'project overview',
    'codebase overview',
    'all files',
    'everything in',
    'context pack',
    'repomix',
    'gitingest',
    'bundle.*context',
    'pack.*files',
    'scaffold.*project',
    'understand.*project',
    'analyze.*project',
    'review.*codebase',
  ].join('|'),
  'i',
)

export function shouldUseContextPack_FIXED(
  messages: import('@/lib/chat/llm-providers').LLMMessage[],
): boolean {
  const lastUserMessage = [...messages]
    .reverse()
    .find(m => m.role === 'user')?.content
  if (typeof lastUserMessage !== 'string') return false
  return CONTEXT_PACK_PATTERN.test(lastUserMessage)
}

// ══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// FIX 4 ── pendingEvents accumulation memory leak
//
// WHY:  pendingEvents is pushed to even for non-streaming requests, and the
//       array is only cleared in the `finally` block for non-streaming paths.
//       Under load the array can grow large before the finally runs.
//       Additionally, the `placeholderEmit` closure captures the entire
//       `pendingEvents` array — it should be bounded.
//
// ── REPLACE the pendingEvents + placeholderEmit block with: ──────────────
//
//   const MAX_PENDING_EVENTS = 64;
//   const pendingEvents: Array<{ event: string; data: unknown; timestamp: number }> = [];
//
//   const placeholderEmit = (event: string, data: unknown) => {
//     if (emitRef.current) {
//       emitRef.current(event, data);
//     } else if (pendingEvents.length < MAX_PENDING_EVENTS) {
//       pendingEvents.push({ event, data, timestamp: Date.now() });
//     }
//     // silently drop if buffer full (background refinement, non-critical)
//   };
//
// ══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// FIX 5 ── validation cache: silent staleness on provider lookup miss
//
// WHY:  When the cache has expired the code falls through to re-validate, but
//       if the provider IS valid it caches again — good.  However, on the
//       *subsequent* provider/model lookup (selectedProvider below the cache
//       block) the code does PROVIDERS[provider] a second time without the
//       cache guard.  This is a minor redundancy but can be tidied.
//
// ── REPLACE the double selectedProvider lookup with a single const hoisted
//    to just after the validation block: ───────────────────────────────────
//
//   // After the cache/validation block (both branches ensure provider is valid):
//   const selectedProvider = PROVIDERS[provider as keyof typeof PROVIDERS];
//
// ══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// FIX 6 ── validateExtractedPath: pre-compiled RegExp
//
// WHY:  validateExtractedPath is called in a tight loop (once per extracted
//       file).  It compiles 7 regular expressions on every invocation.
//
// ── REPLACE (module-level constants) ─────────────────────────────────────

const PATH_CONTROL_CHARS_RE = /[\r\n\t\0]/
const PATH_HEREDOC_RE = /(<<<|>>>|===)/
const PATH_UNSAFE_CHARS_RE = /[<>"'`]/
const PATH_BAD_START_RE = /^[^\w./]/
const PATH_TOO_MANY_DOTS_RE = /^\.{3,}/
const PATH_TRAVERSAL_RE = /(?:^|\/)\.\.(?:\/|$)/
const PATH_COMMAND_RE = /\b(?:WRITE|PATCH|APPLY_DIFF|DELETE)\b/i

export function validateExtractedPath_FIXED(raw: string): string | null {
  const path = (raw ?? '').trim().replace(/^['"` ]|['"` ]$/g, '')
  if (!path || path.length > 300) return null
  if (PATH_CONTROL_CHARS_RE.test(path)) return null
  if (PATH_HEREDOC_RE.test(path)) return null
  if (PATH_UNSAFE_CHARS_RE.test(path)) return null
  if (PATH_BAD_START_RE.test(path)) return null
  if (PATH_TOO_MANY_DOTS_RE.test(path)) return null
  if (PATH_TRAVERSAL_RE.test(path)) return null
  if (PATH_COMMAND_RE.test(path)) return null
  return path
}

// ══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// FIX 7 ── extractApplyDiffOperations: `currentContent.replace(search, replace)`
//           only replaces the FIRST occurrence. Use replaceAll or a
//           global RegExp so that multi-occurrence search blocks work.
//
//           Also, the raw string passed to String.replace() is treated as a
//           regex pattern — special characters like $ or \ in search will
//           corrupt the replacement.
//
// ── REPLACE the search-and-replace block inside applyFilesystemEditsFromResponse
//    (around "const updatedContent = currentContent.replace(diffOp.search, diffOp.replace)")
//    WITH: ───────────────────────────────────────────────────────────────

export function applySearchReplace(
  content: string,
  search: string,
  replace: string,
): string {
  // Use indexOf + slice to avoid RegExp special-character issues.
  // Replaces only the first occurrence (matching typical LLM apply_diff intent).
  const idx = content.indexOf(search)
  if (idx === -1) return content
  return content.slice(0, idx) + replace + content.slice(idx + search.length)
}

// Call-site change:
//   const updatedContent = applySearchReplace(currentContent, diffOp.search, diffOp.replace);

// ══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// FIX 8 ── handleGatewayRequest polling: busy-loops with 1 s sleep but no
//           exponential back-off, and doesn't honour AbortSignal.
//           Provide a helper with bounded back-off.
//
// ── REPLACE the while poll loop with: ────────────────────────────────────

export async function pollWithBackoff<T>(
  fetcher: () => Promise<T | null>,
  isDone: (v: T) => boolean,
  options: { maxWaitMs: number; initialIntervalMs?: number; maxIntervalMs?: number },
): Promise<T> {
  const { maxWaitMs, initialIntervalMs = 500, maxIntervalMs = 5_000 } = options
  const deadline = Date.now() + maxWaitMs
  let interval = initialIntervalMs

  while (Date.now() < deadline) {
    const result = await fetcher()
    if (result !== null && isDone(result)) return result
    await new Promise(resolve => setTimeout(resolve, interval))
    interval = Math.min(interval * 1.5, maxIntervalMs)
  }

  throw new Error('Polling timed out')
}

// ══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// FIX 9 ── requiresThirdPartyOAuth: compile regex once at module level.
//
// ── REPLACE (module-level) ───────────────────────────────────────────────

const THIRD_PARTY_OAUTH_RE =
  /\b(my\s+)?gmail|(my\s+)?google\s+(drive|sheets|docs|calendar)|slack|discord|twitter|x\s*api|notion|zoom|hubspot|salesforce|shopify|stripe|pipedrive|airtable|jira|confluence|trello|dropbox|onedrive|box\s*file|aws\s*s3|s3\s*bucket|heroku|vercel|netlify|railway|render\s*static|cloudflare\s*pages|figma|miro|miroboard|(my|our)\s+github\s+(repo|branch|pr|issue|organization|team)/i

export function requiresThirdPartyOAuth_FIXED(
  messages: import('@/lib/chat/llm-providers').LLMMessage[],
): boolean {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')
  const content =
    typeof lastUser?.content === 'string'
      ? lastUser.content
      : JSON.stringify(lastUser?.content ?? '')
  return THIRD_PARTY_OAUTH_RE.test(content)
}

// ══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// FIX 10 ── sanitizeAssistantDisplayContent / sanitizeFileEditTags:
//            both functions are called on the same content in sequence,
//            resulting in redundant regex scans.
//
// WHY:  sanitizeAssistantDisplayContent calls sanitizeFileEditTags AND also
//       re-applies several of the same patterns independently.
//
// ── RECOMMENDATION ───────────────────────────────────────────────────────
//
//  Consolidate into a single pass by delegating ALL tag sanitization to
//  sanitizeFileEditTags (which already handles every format) and removing
//  the duplicated regex patterns from sanitizeAssistantDisplayContent.
//
//  Specifically, delete from sanitizeAssistantDisplayContent the blocks that
//  handle: <file_edit>, <file_write>, ws_action JSON, "file_edit" JSON,
//  <path>, fs-actions, WRITE/PATCH heredocs, apply_diff, tool_call, and
//  project/artifact tags — those are already covered by sanitizeFileEditTags.
//
//  Keep in sanitizeAssistantDisplayContent only:
//    • COMMANDS_START / COMMANDS_END envelope removal
//    • Spacing normalisation at the end
//
// ══════════════════════════════════════════════════════════════════════════
