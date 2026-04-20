/**
 * Tauri API Adapter
 *
 * Intercepts fetch() calls from web components and routes them to the
 * appropriate backend:
 *   - Tauri `invoke()` for file/system operations (instant, no network)
 *   - Secured sidecar HTTP for LLM/chat routes (need Node.js runtime)
 *
 * Usage: Replace `fetch(url, opts)` with `tauriFetch(url, opts)` in components.
 * Falls through to native `fetch()` when not running inside Tauri.
 */

// ---------------------------------------------------------------------------
// Route routing map — which API routes go through Tauri vs sidecar
// ---------------------------------------------------------------------------

/** Routes handled directly by Tauri commands (no sidecar needed) */
const TAURI_ROUTES = new Set([
  '/api/filesystem/read',
  '/api/filesystem/list',
  '/api/filesystem/write',
  '/api/filesystem/create-file',
  '/api/filesystem/delete',
  '/api/filesystem/mkdir',
  '/api/filesystem/move',
  '/api/filesystem/rename',
  '/api/filesystem/search',
  '/api/filesystem/commits',
  '/api/filesystem/rollback',
  '/api/filesystem/snapshot',
  '/api/filesystem/snapshot/restore',
  '/api/filesystem/diffs',
  '/api/filesystem/diffs/apply',
  '/api/filesystem/edits/accept',
  '/api/filesystem/edits/deny',
  '/api/filesystem/events/push',
  '/api/filesystem/context-pack',
  '/api/user/preferences',
  '/api/user/profile',
  '/api/providers',
  '/api/health',
  '/api/desktop',
]);

/** Routes that must go through the Node.js sidecar */
const SIDECAR_ROUTES = new Set([
  '/api/chat',
  '/api/chat/history',
  '/api/chat/modes',
  '/api/chat/spec-mode',
  '/api/chat/prewarm',
  '/api/chat-with-context',
  '/api/agent',
  '/api/agent/unified-agent',
  '/api/agent/stateful-agent',
  '/api/agent/v2/execute',
  '/api/agent/v2/session',
  '/api/agent/v2/sync',
  '/api/agent/v2/cloud/offload',
  '/api/agent/workflows',
  '/api/code/execute',
  '/api/code/snippets',
  '/api/sandbox/execute',
  '/api/sandbox/session',
  '/api/sandbox/terminal',
  '/api/sandbox/webcontainer',
  '/api/mcp',
  '/api/mcp/connect',
  '/api/mcp/init',
  '/api/mcp/store',
  '/api/mcp/store/sync',
  '/api/sandbox/provider/pty',
  '/api/terminal/local-pty',
  '/api/terminal/local-pty/input',
  '/api/terminal/local-pty/resize',
  '/api/speech-to-text',
  '/api/tts',
  '/api/image/generate',
  '/api/image/validate',
  '/api/image-proxy',
  '/api/music',
  '/api/models/compare',
  '/api/models/benchmarks',
  '/api/prompts',
  '/api/prompts/test',
  '/api/prompts/compare',
]);

// ---------------------------------------------------------------------------
// Sidecar configuration (set by Tauri on app startup via window property)
// ---------------------------------------------------------------------------

interface SidecarConfig {
  port: number;
  token: string;
}

function getSidecarConfig(): SidecarConfig | null {
  return (window as any).__OPENCODE_SIDECAR__ ?? null;
}

// ---------------------------------------------------------------------------
// Tauri command map — maps API routes to Tauri invoke commands
// ---------------------------------------------------------------------------

interface TauriRouteMapping {
  command: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Transform the parsed URL + body into the Tauri command args */
  args?: (url: URL, body: any, headers: Record<string, string>) => Record<string, any>;
  /** Transform the Tauri response back to a fetch-like Response */
  transformResponse?: (result: any) => { body: any; status?: number };
}

const TAURI_COMMAND_MAP: Record<string, TauriRouteMapping> = {
  // Filesystem routes
  '/api/filesystem/read': {
    command: 'read_file',
    args: (url) => ({ file_path: url.searchParams.get('path') || '' }),
  },
  '/api/filesystem/list': {
    command: 'list_directory',
    args: (url) => ({ dir_path: url.searchParams.get('path') || '' }),
  },
  '/api/filesystem/write': {
    command: 'write_file',
    args: async (_url, body) => {
      const data = typeof body === 'string' ? JSON.parse(body) : body;
      return { file_path: data.path || data.filePath || '', content: data.content || '' };
    },
  },
  '/api/providers': {
    command: 'execute_command',
    args: () => ({ command: 'echo providers', cwd: undefined }),
    transformResponse: () => ({ body: { success: true, providers: [] } }),
  },
  '/api/health': {
    command: 'execute_command',
    args: () => ({ command: 'echo ok', cwd: undefined }),
    transformResponse: () => ({ body: { status: 'ok' } }),
  },
};

// ---------------------------------------------------------------------------
// Core adapter function
// ---------------------------------------------------------------------------

/**
 * Drop-in replacement for `fetch()` that routes through Tauri when available.
 */
export async function tauriFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const isTauri = typeof (window as any).__TAURI_INTERNALS__ !== 'undefined'
    || typeof (window as any).__TAURI__ !== 'undefined';

  if (!isTauri) {
    // Not running inside Tauri — use the original (un-patched) fetch.
    // __ORIGINAL_FETCH__ is set by installTauriFetchInterceptor(); if the
    // interceptor hasn't been installed, native fetch is fine.
    const nativeFetch = (window as any).__ORIGINAL_FETCH__ ?? fetch;
    return nativeFetch(input, init);
  }

  // Handle Request objects — fall through to the original (un-patched)
  // fetch since we can't easily clone the body.
  // Use __ORIGINAL_FETCH__ if available to avoid recursive interception.
  if (input instanceof Request) {
    const nativeFetch = (window as any).__ORIGINAL_FETCH__ ?? fetch;
    return nativeFetch(input, init);
  }

  const url = typeof input === 'string'
    ? new URL(input, window.location.origin)
    : input;
  const pathname = url.pathname;
  const method = (init?.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {};

  // Parse headers
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) { headers[k] = v; }
    } else {
      Object.assign(headers, init.headers);
    }
  }

  // -----------------------------------------------------------------------
  // Route 1: Tauri command (filesystem, settings, etc.)
  // -----------------------------------------------------------------------
  if (TAURI_ROUTES.has(pathname) && TAURI_COMMAND_MAP[pathname]) {
    return await handleTauriRoute(pathname, url, init?.body, headers, TAURI_COMMAND_MAP[pathname]);
  }

  // -----------------------------------------------------------------------
  // Route 2: Try Tauri generic handler, then sidecar, then native fetch
  // -----------------------------------------------------------------------
  // Try generic Tauri handler first (works without sidecar)
  try {
    const { invoke } = await importTauri();
    const result = await invoke('handle_api_route', {
      route: pathname,
      method,
      body: init?.body,
      query: Object.fromEntries(url.searchParams),
      headers,
    });
    return jsonResponse(result);
  } catch {
    // Tauri handler not available for this route — try sidecar
    if (SIDECAR_ROUTES.has(pathname) || pathname.startsWith('/api/chat') || pathname.startsWith('/api/agent') || pathname.startsWith('/api/sandbox') || pathname.startsWith('/api/mcp') || pathname.startsWith('/api/terminal')) {
      try {
        return await handleSidecarRoute(pathname, url, init, headers);
      } catch {
        console.warn('[tauriFetch] Sidecar unavailable for', pathname, '— returning stub response');
        return jsonResponse({
          success: false,
          error: 'Sidecar not available — this route requires the Node.js server',
          hint: 'Ensure Node.js is installed and the app was built with `pnpm build`',
        }, 503);
      }
    }
    // Last resort: native fetch (will fail in production Tauri)
    // Use __ORIGINAL_FETCH__ to avoid recursive interception.
    console.warn('[tauriFetch] Falling back to native fetch for', pathname);
    const nativeFetch = (window as any).__ORIGINAL_FETCH__ ?? fetch;
    return nativeFetch(input, init);
  }
}

// ---------------------------------------------------------------------------
// Tauri route handler
// ---------------------------------------------------------------------------

async function handleTauriRoute(
  pathname: string,
  url: URL,
  body: BodyInit | null | undefined,
  headers: Record<string, string>,
  mapping: TauriRouteMapping,
): Promise<Response> {
  const { invoke } = await importTauri();

  let args: Record<string, any>;
  if (mapping.args) {
    args = mapping.args instanceof Function
      ? await mapping.args(url, body, headers)
      : mapping.args;
  } else {
    args = { path: url.searchParams.get('path') || '' };
  }

  try {
    const result = await invoke(mapping.command, args);

    if (mapping.transformResponse) {
      const { body: respBody, status = 200 } = mapping.transformResponse(result);
      return jsonResponse(respBody, status);
    }

    // Default: wrap result in a standard response
    return jsonResponse({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return jsonResponse(
      { success: false, error: error?.message || String(error) },
      500,
    );
  }
}

// ---------------------------------------------------------------------------
// Sidecar route handler
// -----------------------------------------------------------------------

async function handleSidecarRoute(
  pathname: string,
  url: URL,
  init: RequestInit | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  const config = getSidecarConfig();
  if (!config) {
    throw new Error('Sidecar not configured');
  }

  // Reconstruct the full URL pointing to the sidecar
  const sidecarUrl = `http://127.0.0.1:${config.port}${pathname}${url.search}`;

  const fetchInit: RequestInit = {
    ...init,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'X-Sidecar-Token': config.token,
    },
  };

  return fetch(sidecarUrl, fetchInit);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function importTauri() {
  // Tauri v2 uses @tauri-apps/api/core
  try {
    const mod = await import(/* @vite-ignore */ '@tauri-apps/api/core');
    return { invoke: mod.invoke };
  } catch {
    // Fallback: use global Tauri API
    return { invoke: (window as any).__TAURI_INTERNALS__?.invoke ?? (window as any).__TAURI__?.invoke };
  }
}

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Global fetch override (optional — call once at app bootstrap)
// ---------------------------------------------------------------------------

/**
 * Override global `fetch` to use the Tauri adapter.
 * Call this once at app startup when running inside Tauri.
 */
export function installTauriFetchInterceptor() {
  const isTauri = typeof (window as any).__TAURI_INTERNALS__ !== 'undefined'
    || typeof (window as any).__TAURI__ !== 'undefined';

  if (!isTauri) return;

  // Preserve the original fetch so tauriFetch can delegate to it for
  // non-intercepted routes (e.g. absolute URLs, Request objects).
  // Without this, tauriFetch's `return fetch(input, init)` fallback
  // would recursively call the patched version.
  const originalFetch = window.fetch;
  (window as any).__ORIGINAL_FETCH__ = originalFetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    return tauriFetch(input, init);
  };
}
