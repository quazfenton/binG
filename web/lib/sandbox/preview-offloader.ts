/**
 * Preview Offloader
 *
 * @deprecated This module is superseded by `lib/previews/live-preview-offloading.ts`,
 * which provides richer project detection (framework, bundler, entry point, port),
 * SSR/code transforms, and a wider set of preview modes (17 vs 2). The cost
 * estimation model has been migrated to `LivePreviewOffloading.getCostEstimate()`.
 *
 * New code should import from `@/lib/previews/live-preview-offloading` instead.
 * This module will be removed in a future release.
 *
 * Decision heuristics:
 *   - GUI/Desktop apps (Electron, Tauri) → daytona
 *   - Heavy frameworks (Next.js, Django, etc.) → daytona (fallback: codesandbox → e2b)
 *   - Large projects (>50 files) → daytona
 *   - Lightweight SPA (React, Vue, vanilla) → local
 *
 * Cost model (per-minute rates):
 *   - daytona:     $0.05/min
 *   - codesandbox: $0.02/min
 *   - vercel:      $0.01/min
 *   - e2b:         $0.03/min
 *   - local:       $0.00/min
 *
 * @module lib/sandbox/preview-offloader
 */

import { createLogger } from '@/lib/utils/logger';
import { getSandboxProvider, isProviderAvailable, type SandboxProviderType } from './providers';

const logger = createLogger('PreviewOffloader');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PreviewProvider = 'local' | 'daytona' | 'codesandbox' | 'vercel' | 'e2b';

/** Ordered list of cloud providers for fallback routing. First = preferred. */
const CLOUD_FALLBACK_CHAIN: PreviewProvider[] = ['daytona', 'codesandbox', 'e2b', 'vercel'];

export interface PreviewOffloadRequest {
  /** Map of file path → file content. Must not be empty for execute(). */
  files: Record<string, string>;
  /** Detected framework name (e.g. 'next.js', 'react', 'django'). */
  framework?: string;
  /** Maximum time in ms for the execute() call. Default: 30_000. */
  timeoutMs?: number;
}

export interface OffloadDecision {
  recommendedProvider: PreviewProvider;
  reason: string;
  estimatedCost: number;
  estimatedDuration: number; // seconds
}

export interface ExecuteResult {
  provider: PreviewProvider;
  success: boolean;
  url?: string;
  error?: string;
  /** Sandbox handle ID when a cloud sandbox was created. */
  sandboxId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Frameworks that always require a cloud sandbox (full-stack / backend / desktop).
 * Keys are normalised (lowercase, dots/dashes removed) for matching.
 */
const CLOUD_ONLY_FRAMEWORKS = new Set([
  'nextjs',    // matches "next.js", "nextjs", "NextJS"
  'nuxt',
  'gatsby',
  'django',
  'flask',
  'fastapi',
  'express',
  'electron',
  'tauri',
]);

/** Per-minute cost in USD by provider. */
const COST_PER_MINUTE: Record<PreviewProvider, number> = {
  local: 0,
  daytona: 0.05,
  codesandbox: 0.02,
  vercel: 0.01,
  e2b: 0.03,
};

/** File-count threshold above which we force cloud offload. */
const LARGE_PROJECT_FILE_THRESHOLD = 50;

/** Map from canonical cloud provider name to the SandboxProviderType used by
 *  the provider registry. */
const PROVIDER_TYPE_MAP: Partial<Record<PreviewProvider, SandboxProviderType>> = {
  daytona: 'daytona',
  e2b: 'e2b',
  codesandbox: 'codesandbox',
  vercel: 'vercel-sandbox',
};

/** File extensions that indicate a desktop-app pattern worth scanning. */
const DESKTOP_CANDIDATE_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']);

/** Python frameworks — used by inferLanguage() to detect Python projects. */
const PYTHON_FRAMEWORKS = new Set(['django', 'flask', 'fastapi']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a framework string for matching: lowercase, strip dots and dashes.
 * "Next.js" → "nextjs", "next-js" → "nextjs", "FastAPI" → "fastapi"
 */
function normalizeFramework(framework: string): string {
  return framework.toLowerCase().replace(/[\.\-]/g, '');
}

/**
 * Check if a framework requires a cloud sandbox.
 * Uses exact match against normalised CLOUD_ONLY_FRAMEWORKS set — no substring
 * matching, which was a source of false positives (e.g. "taur" matching "tauri").
 */
function isHeavyFramework(framework: string): boolean {
  return CLOUD_ONLY_FRAMEWORKS.has(normalizeFramework(framework));
}

/**
 * Detect Electron / Tauri / native desktop patterns.
 * Optimised: only scans files whose extension looks like a candidate (JS/TS),
 * and checks file paths first before scanning content.
 */
function isGuiDesktopApp(files: Record<string, string>): boolean {
  // Quick path-based check: if a file references electron or tauri in its path
  const pathSignals = ['electron/', '@tauri-apps/', 'tauri.conf'];
  const filePaths = Object.keys(files);
  for (const p of filePaths) {
    const lower = p.toLowerCase();
    for (const sig of pathSignals) {
      if (lower.includes(sig)) return true;
    }
  }

  // Content-based check: only scan candidate files (JS/TS extensions)
  const contentPatterns = [
    /require\s*\(\s*['"]electron['"]\s*\)/,
    /from\s+['"]electron['"]/,
    /require\s*\(\s*['"]@tauri-apps/,
    /from\s+['"]@tauri-apps/,
  ];

  for (const [filePath, content] of Object.entries(files)) {
    const dot = filePath.lastIndexOf('.');
    if (dot < 0) continue; // No extension — skip
    const ext = filePath.slice(dot);
    if (!DESKTOP_CANDIDATE_EXTENSIONS.has(ext)) continue;
    for (const pat of contentPatterns) {
      if (pat.test(content)) return true;
    }
  }
  return false;
}

function estimateFileCount(files: Record<string, string>): number {
  return Object.keys(files).length;
}

/**
 * Infer the primary programming language from the framework name.
 * Falls back to scanning file extensions.
 */
function inferLanguage(framework: string | undefined, files: Record<string, string>): string {
  if (framework && PYTHON_FRAMEWORKS.has(normalizeFramework(framework))) {
    return 'python';
  }

  // Scan file extensions for majority language.
  // Limitation: in mixed-language monorepos (e.g. Next.js + Python API), this
  // heuristic may misfire if .py files outnumber .tsx files. The framework
  // signal above takes priority when available.
  const extCounts: Record<string, number> = {};
  for (const p of Object.keys(files)) {
    const dot = p.lastIndexOf('.');
    if (dot >= 0) {
      const ext = p.slice(dot).toLowerCase();
      extCounts[ext] = (extCounts[ext] || 0) + 1;
    }
  }

  const pyCount = (extCounts['.py'] || 0);
  const jsCount = (extCounts['.js'] || 0) + (extCounts['.ts'] || 0) +
                  (extCounts['.jsx'] || 0) + (extCounts['.tsx'] || 0);
  return pyCount > jsCount ? 'python' : 'typescript';
}

/**
 * Compute sandbox resources based on project size.
 * Small projects get 1 CPU / 2GB; large ones get 2 CPU / 4GB.
 */
function inferResources(fileCount: number): { cpu: number; memory: number } {
  // Resources scale at 30 files (lower than the 50-file offload threshold) because
  // even medium projects benefit from more CPU/RAM in the sandbox, and the cost
  // difference between 1/2 CPU is minimal for short-lived preview sessions.
  if (fileCount > 30) {
    return { cpu: 2, memory: 4 };
  }
  return { cpu: 1, memory: 2 };
}

/** Rough estimate of how long a cloud preview session will last (seconds). */
function estimateSessionDuration(files: Record<string, string>, framework?: string): number {
  const fileCount = estimateFileCount(files);
  const isHeavy = framework ? isHeavyFramework(framework) : false;

  if (isHeavy) return 120; // 2 min for heavy frameworks
  if (fileCount > 20) return 60;  // 1 min for medium projects
  return 30; // 30s for simple projects
}

/**
 * Pick the first available cloud provider from the fallback chain.
 * Checks the provider registry's availability flag; falls back to the first
 * entry if no availability info is known (registry may not be initialised yet).
 */
function pickAvailableCloudProvider(preferred: PreviewProvider): PreviewProvider {
  // If preferred provider is available, use it
  const preferredKey = PROVIDER_TYPE_MAP[preferred];
  if (preferredKey && isProviderAvailable(preferredKey)) {
    return preferred;
  }

  // Walk fallback chain
  for (const candidate of CLOUD_FALLBACK_CHAIN) {
    const registryKey = PROVIDER_TYPE_MAP[candidate];
    if (registryKey && isProviderAvailable(registryKey)) {
      logger.info(`Preferred provider ${preferred} unavailable, falling back to ${candidate}`);
      return candidate;
    }
  }

  // No availability info known — return preferred (best-effort)
  return preferred;
}

// ---------------------------------------------------------------------------
// PreviewOffloader class
// ---------------------------------------------------------------------------

/** @deprecated Use LivePreviewOffloading from @/lib/previews/live-preview-offloading instead */
class PreviewOffloader {
  // -----------------------------------------------------------------------
  // decide() — synchronous routing decision (may consult provider availability)
  // -----------------------------------------------------------------------

  decide(request: PreviewOffloadRequest): OffloadDecision {
    const { files, framework } = request;

    // --- Input validation ---
    if (!files || typeof files !== 'object') {
      return {
        recommendedProvider: 'local',
        reason: 'No files provided — defaulting to local preview',
        estimatedCost: 0,
        estimatedDuration: 0,
      };
    }

    const fileCount = estimateFileCount(files);

    // 1. GUI / Desktop apps → daytona
    if (framework?.toLowerCase() === 'electron' || isGuiDesktopApp(files)) {
      const duration = estimateSessionDuration(files, framework);
      const provider = pickAvailableCloudProvider('daytona');
      return {
        recommendedProvider: provider,
        reason: 'GUI/Desktop application requires cloud sandbox',
        estimatedCost: COST_PER_MINUTE[provider] * (duration / 60),
        estimatedDuration: duration,
      };
    }

    // 2. Heavy / full-stack frameworks → daytona (with fallback)
    if (framework && isHeavyFramework(framework)) {
      const duration = estimateSessionDuration(files, framework);
      const provider = pickAvailableCloudProvider('daytona');
      return {
        recommendedProvider: provider,
        reason: `${framework} requires cloud sandbox for server-side rendering`,
        estimatedCost: COST_PER_MINUTE[provider] * (duration / 60),
        estimatedDuration: duration,
      };
    }

    // 3. Large projects (>50 files) → daytona (with fallback)
    if (fileCount > LARGE_PROJECT_FILE_THRESHOLD) {
      const duration = estimateSessionDuration(files, framework);
      const provider = pickAvailableCloudProvider('daytona');
      return {
        recommendedProvider: provider,
        reason: `Large project (${fileCount} files) exceeds local preview capacity`,
        estimatedCost: COST_PER_MINUTE[provider] * (duration / 60),
        estimatedDuration: duration,
      };
    }

    // 4. Default: local preview
    const duration = estimateSessionDuration(files, framework);
    return {
      recommendedProvider: 'local',
      reason: 'Lightweight project suitable for local preview',
      estimatedCost: 0,
      estimatedDuration: duration,
    };
  }

  // -----------------------------------------------------------------------
  // execute() — async execution of the offload decision
  // -----------------------------------------------------------------------

  async execute(request: PreviewOffloadRequest): Promise<ExecuteResult> {
    // --- Input validation ---
    // Note: execute() calls decide() internally to get a fresh routing snapshot
    // at execution time, since provider availability may have changed.
    if (!request.files || typeof request.files !== 'object' || Object.keys(request.files).length === 0) {
      return {
        provider: 'local',
        success: false,
        error: 'No files provided for preview execution',
      };
    }

    const decision = this.decide(request);
    const timeoutMs = request.timeoutMs ?? 30_000;

    if (decision.recommendedProvider === 'local') {
      // Local preview — no sandbox needed
      return {
        provider: 'local',
        success: true,
      };
    }

    // Cloud preview — attempt to create sandbox
    const providerKey = PROVIDER_TYPE_MAP[decision.recommendedProvider];
    if (!providerKey) {
      return {
        provider: decision.recommendedProvider,
        success: false,
        error: `No sandbox provider mapping for ${decision.recommendedProvider}`,
      };
    }

    // Create an AbortController for timeout enforcement
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const provider = await getSandboxProvider(providerKey);

      // Infer language and resources from the project
      const fileCount = estimateFileCount(request.files);
      const language = inferLanguage(request.framework, request.files);
      const resources = inferResources(fileCount);

      const handle = await provider.createSandbox({
        language,
        envVars: {},
        resources,
      });

      // Write project files into the sandbox
      // On failure, destroy the sandbox to avoid leaking resources.
      let url: string | undefined;
      try {
        // NOTE: The abort check only fires between writeFile calls. If a single
        // writeFile call hangs, the timeout won't interrupt it until it returns.
        // Provider-level abort signal support would be needed for true cancellation.
        for (const [path, content] of Object.entries(request.files)) {
          if (ac.signal.aborted) throw new Error('Operation timed out');
          await handle.writeFile(path, content);
        }

        // Try to get a preview URL
        try {
          const preview = await handle.getPreviewLink?.(3000);
          url = preview?.url;
        } catch {
          // Preview link not available — that's OK
        }
      } catch (writeError: any) {
        // Sandbox created but files failed to write — clean up
        try { await provider.destroySandbox(handle.id); } catch {}
        throw writeError;
      }

      return {
        provider: decision.recommendedProvider,
        success: true,
        url,
        sandboxId: handle.id,
      };
    } catch (error: any) {
      if (ac.signal.aborted) {
        logger.warn(`Cloud preview timed out after ${timeoutMs}ms for ${decision.recommendedProvider}`);
        return {
          provider: decision.recommendedProvider,
          success: false,
          error: `Timed out after ${timeoutMs}ms`,
        };
      }
      logger.warn(`Cloud preview failed for ${decision.recommendedProvider}: ${error.message}`);
      return {
        provider: decision.recommendedProvider,
        success: false,
        error: error.message,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // -----------------------------------------------------------------------
  // getCostEstimate() — cost for a given provider and duration
  // -----------------------------------------------------------------------

  getCostEstimate(provider: string, durationMinutes: number): number {
    const rate = (COST_PER_MINUTE as Record<string, number>)[provider];
    if (rate === undefined) return 0;
    return rate * durationMinutes;
  }

  // -----------------------------------------------------------------------
  // getProviders() — list all known providers and their rates
  // -----------------------------------------------------------------------

  getProviders(): Array<{ name: PreviewProvider; costPerMinute: number }> {
    return (Object.entries(COST_PER_MINUTE) as [PreviewProvider, number][]).map(
      ([name, costPerMinute]) => ({ name, costPerMinute })
    );
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/** @deprecated Use livePreviewOffloading from @/lib/previews/live-preview-offloading instead */
export const previewOffloader = new PreviewOffloader();
