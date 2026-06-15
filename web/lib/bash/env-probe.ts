/**
 * Pre-flight environment probe (Bug #39 fix).
 *
 * Runs `which <bin>` for a fixed set of common developer binaries
 * (npx, node, npm, pnpm, yarn, python, python3, pip, pip3, ruby, go, java,
 * make, gcc, curl, wget, git, docker, podman) ONCE per process and caches
 * the result for 60 seconds. The probe:
 *
 * 1. Is exposed to the system prompt via `formatAvailableBinaries()` so the
 *    LLM knows what binaries are available BEFORE it picks a tool.
 * 2. Is exposed to the bash tool's ENOENT error path so the LLM gets a
 *    concrete list of alternatives on the FIRST failure (not the 5th).
 * 3. Tracks per-binary ENOENT retry counts via `incrementMissingBinaryRetry`
 *    so the 2nd retry for the same binary can be hard-blocked with a
 *    "use write_file / read_file instead" suggestion.
 *
 * Why this is module-level (not per-request):
 *   - `which` is cheap, but for a 60s window it's a no-op.
 *   - Cross-request visibility means a binary that's missing for one user
 *     is missing for the next, so the probe result is stable.
 *   - The retry counter is per-process (not per-session) so a persistent
 *     environment problem surfaces quickly. This is the same pattern used
 *     by `globalThis.__vfsDefensiveGuardLastWarnedAt__` in the #36 fix.
 *
 * Reset hooks for tests:
 *   - `_resetEnvProbeForTests()` clears the cache + retry counters.
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Bash:EnvProbe');

// Default binaries — covers the most common dev tools the LLM reaches for.
// Not exhaustive; extend via `probeAvailableBinaries(customList)` if needed.
const DEFAULT_BINARIES: readonly string[] = [
  'npx', 'node', 'npm', 'pnpm', 'yarn', 'bun',
  'python', 'python3', 'pip', 'pip3', 'uv', 'poetry',
  'ruby', 'go', 'java', 'rustc', 'cargo',
  'make', 'gcc', 'g++', 'cmake',
  'curl', 'wget', 'git', 'svn', 'hg',
  'docker', 'podman', 'kubectl', 'terraform',
  'ffmpeg', 'imagemagick', 'convert',
  'sqlite3', 'psql', 'mysql',
  'redis-cli', 'mongosh',
];

const CACHE_TTL_MS = 60_000; // Re-probe every 60 seconds (env doesn't change often)
const PROBE_TIMEOUT_MS = 1_500; // Per-binary timeout (don't block the system prompt build)

// ---------------------------------------------------------------------------
// Module-level state (survives Next.js hot-reload via globalThis persistence)
// ---------------------------------------------------------------------------

interface EnvProbeState {
  binariesToProbe: readonly string[];
  /** Map<bin, path|null> — null = binary not on $PATH */
  probeCache: Map<string, string | null>;
  /** Timestamp (ms since epoch) of the last probe */
  lastProbeAtMs: number;
  /** Map<bin, count> — number of ENOENT retries for this binary this process */
  enoentRetries: Map<string, number>;
  /** Last log line at warn level (for throttling) */
  lastWarnAtMs: number;
}

const STATE_KEY = '__bashEnvProbeState__';

function getState(): EnvProbeState {
  const g = globalThis as unknown as { [STATE_KEY]?: EnvProbeState };
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      binariesToProbe: DEFAULT_BINARIES,
      probeCache: new Map(),
      lastProbeAtMs: 0,
      enoentRetries: new Map(),
      lastWarnAtMs: 0,
    };
  }
  return g[STATE_KEY]!;
}

export function _resetEnvProbeForTests(): void {
  const g = globalThis as unknown as { [STATE_KEY]?: EnvProbeState };
  delete g[STATE_KEY];
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

/**
 * Run `which <bin>` for every binary in the list (in parallel, bounded by
 * the per-binary timeout). Returns a fresh `Map<bin, path|null>` where
 * `path=null` means the binary is NOT on $PATH.
 *
 * Uses `child_process.execFile` to avoid shell injection.
 */
export async function probeAvailableBinaries(
  binaries?: readonly string[],
): Promise<Map<string, string | null>> {
  const state = getState();
  const list = binaries || state.binariesToProbe;
  const now = Date.now();

  // If the cache is fresh AND covers this exact list, return it.
  if (
    !binaries &&
    state.probeCache.size > 0 &&
    (now - state.lastProbeAtMs) < CACHE_TTL_MS
  ) {
    return state.probeCache;
  }

  const fresh = new Map<string, string | null>();
  const { execFile } = await import('child_process');

  await Promise.all(
    list.map(
      (bin) =>
        new Promise<void>((resolve) => {
          try {
            execFile(
              'which',
              [bin],
              { timeout: PROBE_TIMEOUT_MS, shell: false },
              (err, stdout) => {
                if (err) {
                  fresh.set(bin, null);
                } else {
                  const out = String(stdout || '').trim().split('\n')[0]?.trim() || '';
                  fresh.set(bin, out.length > 0 ? out : null);
                }
                resolve();
              },
            );
          } catch {
            fresh.set(bin, null);
            resolve();
          }
        }),
    ),
  );

  if (!binaries) {
    state.probeCache = fresh;
    state.lastProbeAtMs = now;
  }

  return fresh;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Build the system-prompt fragment that lists available binaries. Empty
 * if the probe hasn't run yet (callers should await `probeAvailableBinaries()`
 * first OR call the awaited `formatAvailableBinariesAsync()`).
 *
 * Format (terse, fits the system-prompt budget):
 *
 *   ### Available Binaries (env probe)
 *   - npx → /usr/local/bin/npx
 *   - node → /usr/local/bin/node
 *   - npm → /usr/local/bin/npm
 *   - python3 → /usr/bin/python3
 *   - python → NOT FOUND (use python3)
 *   ...
 *
 *   If a binary is NOT FOUND above, do NOT call it. Use write_file / read_file
 *   for file operations, or use an alternative that IS available.
 */
export function formatAvailableBinaries(
  probe: Map<string, string | null>,
): string {
  if (probe.size === 0) return '';

  const found: string[] = [];
  const missing: string[] = [];

  // Stable order: by binary name (alphabetical)
  const sorted = Array.from(probe.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [bin, path] of sorted) {
    if (path) {
      found.push(`- ${bin} → ${path}`);
    } else {
      missing.push(`- ${bin} → NOT FOUND`);
    }
  }

  const lines: string[] = [];
  lines.push('### Available Binaries (env probe — do NOT call binaries not listed below as available)');
  lines.push(...found);
  if (missing.length > 0) {
    lines.push('### Missing Binaries (env probe — these are NOT installed; do NOT call them)');
    lines.push(...missing);
    lines.push('');
    lines.push('If a binary is in the missing list, do NOT call it. Use write_file / read_file / apply_diff for file operations, or use an alternative that IS in the available list.');
  }
  return lines.join('\n');
}

/**
 * Awaited convenience: run the probe (or use the cache) and return the
 * formatted system-prompt fragment. NEVER throws — returns an empty string
 * on probe failure so the system-prompt build never blocks.
 */
export async function formatAvailableBinariesAsync(): Promise<string> {
  try {
    const probe = await probeAvailableBinaries();
    return formatAvailableBinaries(probe);
  } catch (err: any) {
    logger.debug('env probe failed (non-fatal)', { error: err?.message });
    return '';
  }
}

// ---------------------------------------------------------------------------
// Per-binary ENOENT retry tracking (for the 2nd-retry hard-block)
// ---------------------------------------------------------------------------

/**
 * Increment the ENOENT retry counter for a binary and return the new count.
 * The bash tool calls this on every ENOENT error so the 2nd retry can be
 * hard-blocked with a "use write_file / read_file" suggestion.
 */
export function incrementMissingBinaryRetry(baseCmd: string): number {
  const state = getState();
  const key = baseCmd.toLowerCase();
  const next = (state.enoentRetries.get(key) ?? 0) + 1;
  state.enoentRetries.set(key, next);
  return next;
}

/**
 * Read the current retry count without mutating. Used to decide whether the
 * next attempt is the 2nd retry (=> hard-block).
 */
export function getMissingBinaryRetryCount(baseCmd: string): number {
  const state = getState();
  return state.enoentRetries.get(baseCmd.toLowerCase()) ?? 0;
}

/**
 * Reset the retry counter for a specific binary. Called when a successful
 * invocation of the binary is observed (so the LLM isn't permanently blocked
 * after recovering from a transient PATH issue).
 */
export function resetMissingBinaryRetry(baseCmd: string): void {
  const state = getState();
  state.enoentRetries.delete(baseCmd.toLowerCase());
}

// ---------------------------------------------------------------------------
// Sandbox-aware probe
// ---------------------------------------------------------------------------

/**
 * Run the env probe inside a sandbox, using the sandbox's `which` command
 * instead of the host's. Returns the same Map<bin, path|null> format.
 *
 * When a sandbox session is active, binaries available inside that sandbox
 * (e.g. node, python3, npx) are reported as found — even if they are NOT
 * installed on the host.
 *
 * MUST be called with a valid `sandboxId`. If the sandbox executeCommand
 * fails, falls back to the host probe so there's always SOME result.
 */
// Conservative whitelist for binary names interpolated into a sandbox shell
// command. The probe historically built the command via template literal
// (`which ${bin} ...`), which is a shell-injection vector if a caller ever
// passes an untrusted string. Restrict to the realistic set of characters
// a binary name can contain: alphanumerics, dot, underscore, plus, hyphen.
// Anything else is treated as "not found" without ever being spliced.
const SAFE_BINARY_NAME_RE = /^[A-Za-z0-9._+-]+$/;

export async function probeAvailableBinariesInSandbox(
  sandboxId: string,
  binaries?: readonly string[],
): Promise<Map<string, string | null>> {
  const list = binaries || DEFAULT_BINARIES;
  const fresh = new Map<string, string | null>();

  let sandboxBridge: any;
  try {
    const mod = await import('@/lib/sandbox/sandbox-service-bridge');
    sandboxBridge = mod.sandboxBridge;
  } catch {
    // Sandbox module not available — fall through to host probe
    return probeAvailableBinaries(list);
  }

  // Probe every requested binary in parallel, but if a single
  // executeCommand call rejects (sandbox session dead, transport gone,
  // etc.), DO NOT just record per-binary nulls — the entire map would
  // be useless to the prompt builder. Fall back to the host probe so
  // the caller always gets a real result.
  let sandboxFailed = false;
  await Promise.all(
    list.map(
      (bin) =>
        new Promise<void>(async (resolve) => {
          // Validate `bin` before splicing it into the shell command.
          // A caller-supplied list with a crafted entry (`bin=foo;rm -rf /`)
          // would otherwise execute arbitrary shell inside the sandbox.
          if (!SAFE_BINARY_NAME_RE.test(bin)) {
            fresh.set(bin, null);
            resolve();
            return;
          }
          try {
            const result = await sandboxBridge.executeCommand(
              sandboxId,
              // `which --` prevents a binary named `--help` (or any future
              // hyphen-prefixed binary) from being interpreted as a flag.
              `which -- ${bin} 2>/dev/null || echo "__NOT_FOUND__"`,
              '/workspace',
              3000,
            );
            const stdout = (result as any)?.stdout || '';
            const out = stdout.trim().split('\n')[0]?.trim() || '';
            if (out && out !== '__NOT_FOUND__') {
              fresh.set(bin, out);
            } else {
              fresh.set(bin, null);
            }
          } catch {
            // Per-binary failures (timeouts, individual command errors) are
            // expected for missing binaries. Mark the sandbox as failed
            // ONLY if the bridge itself is missing or unusable — those are
            // detected by the outer try/catch below, not here.
            fresh.set(bin, null);
          }
          resolve();
        }),
    ),
  ).catch(() => {
    // One of the per-binary promises rejected outright (rejected before the
    // inner catch could run, e.g. the bridge call hung and the await threw
    // past the try/catch boundary). Treat the whole probe as failed.
    sandboxFailed = true;
  });

  if (sandboxFailed) {
    return probeAvailableBinaries(list);
  }
  return fresh;
}

/**
 * Format the env probe result into a system-prompt fragment, with an
 * optional sandbox hint that tells the LLM it's probing a sandbox.
 */
export function formatAvailableBinariesWithSource(
  probe: Map<string, string | null>,
  source: 'host' | 'sandbox',
  sandboxId?: string,
): string {
  const header = source === 'sandbox'
    ? `### Available Binaries (env probe — sandbox${sandboxId ? ` ${sandboxId.slice(0, 12)}` : ''} — do NOT call binaries not listed below as available)`
    : '### Available Binaries (env probe — do NOT call binaries not listed below as available)';

  const found: string[] = [];
  const missing: string[] = [];

  const sorted = Array.from(probe.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [bin, path] of sorted) {
    if (path) {
      found.push(`- ${bin} → ${path}`);
    } else {
      missing.push(`- ${bin} → NOT FOUND`);
    }
  }

  const lines: string[] = [];
  lines.push(header);
  lines.push(...found);
  if (missing.length > 0) {
    lines.push('### Missing Binaries (env probe — these are NOT installed; do NOT call them)');
    lines.push(...missing);
    lines.push('');
    lines.push('If a binary is in the missing list, do NOT call it. Use write_file / read_file / apply_diff for file operations, or use an alternative that IS in the available list.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

