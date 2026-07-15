/**
 * MCP Integration for Both Architectures
 * 
 * Architecture 1: Main LLM Call Implementation (AI SDK)
 * Architecture 2: OpenCode CLI Agent (Containerized)
 * 
 * This module provides unified MCP tool access for both architectures
 */

import { mcpToolRegistry } from './registry'
import { parseMCPServerConfigs, initializeMCP, shutdownMCP, getMCPSettings, isMCPAvailable, getMCPToolCount } from './config'
import { callMCPorterTool, getMCPorterToolDefinitions, mcporterIntegration } from './mcporter-integration'
import { createHTTPTransport, isValidMCPURL, parseMCPURL, HTTPTransport, registerHTTPTransport, getRemoteMCPTools, callRemoteMCPTool, hasRemoteMCPServers, INIT_PROBE_TIMEOUT_MS } from './http-transport'
import { startHealthMonitoring } from './health-check'
import { createLogger } from '../utils/logger';
import { redactArgsForLogging } from '@/lib/errors/logging-utils';
import { zodToJsonSchema } from 'zod-to-json-schema';
// Pure planner type (see web/lib/tools/select-tool-plan.ts). When the
// active chat route passes the SELECTED plan as the taskFilter signal
// (instead of the raw user message string), the per-source filters
// below switch from substring matching to intent + source-permission
// gates. The original string taskFilter path is preserved for the 4
// other callers (unified-agent, opencode-direct, task-router,
// vercel-ai-tools) that pass a raw prompt string.
// Type-only import — erased after compilation so it cannot introduce
// a runtime circular dependency, even though `select-tool-plan.ts`
// itself imports nothing from `lib/mcp`.
import type { SelectToolPlanResult } from '@/lib/tools/select-tool-plan';
// Dynamically imported to avoid pulling Node.js-only deps (database/fs) into client bundle
import type { BlaxelProvider } from '../sandbox/providers/blaxel-provider'
import { ArcadeService, getArcadeService } from '../integrations/arcade-service'
import { nullclawMCPBridge } from './nullclaw-mcp-bridge'
import { initializeNullclaw, isNullclawAvailable, getNullclawMode } from '@bing/shared/agent/nullclaw-integration'
import { normalizeSessionId, getVfsScopeBasePath, getVfsScopePath } from '../virtual-filesystem/scope-utils';
// Tool caching for repeated operations
import { toolResultCache, toolCacheKey, contentHash } from '../utils/cache';
// VFS file events — broadcast mechanism for cache invalidation
import { onFileEvent } from '../virtual-filesystem/file-events';
// Dynamically imported to avoid pulling Node.js-only deps (fs, database) into client bundle
// import { standaloneGitTools } from '../tools/git-tools'

// Blaxel codegen tool definitions for LLM tool calling
const getBlaxelCodegenToolDefinitions = (): Array<{
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: any
  }
}> => [
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenCodebaseSearch',
      description: 'Semantic search to find relevant code snippets in a repository',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query string' },
          options: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
              limit: { type: 'number' },
              fileTypes: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenFileSearch',
      description: 'Fast fuzzy file path search',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'File path pattern (supports glob)' },
          options: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
              limit: { type: 'number' },
            },
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenGrepSearch',
      description: 'Exact regex search using ripgrep engine',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search' },
          options: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
              path: { type: 'string' },
              limit: { type: 'number' },
            },
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenListDir',
      description: 'List directory contents (quick discovery)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list' },
          options: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
              includePatterns: { type: 'array', items: { type: 'string' } },
              excludePatterns: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenReadFileRange',
      description: 'Read file contents within a specific line range (max 250 lines)',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to file' },
          startLine: { type: 'number', description: 'Start line number' },
          endLine: { type: 'number', description: 'End line number' },
          options: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
            },
          },
        },
        required: ['filePath', 'startLine', 'endLine'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenRerank',
      description: 'Performs semantic search/reranking on code files in a directory',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          directory: { type: 'string', description: 'Directory to search in' },
          options: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
              limit: { type: 'number' },
            },
          },
        },
        required: ['query', 'directory'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenParallelApply',
      description: 'Plan parallel edits across multiple file locations',
      parameters: {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                filePath: { type: 'string' },
                startLine: { type: 'number' },
                endLine: { type: 'number' },
                newContent: { type: 'string' },
              },
              required: ['filePath', 'startLine', 'endLine', 'newContent'],
            },
            description: 'Array of edits to apply',
          },
          options: {
            type: 'object',
            properties: {
              repoId: { type: 'string' },
              dryRun: { type: 'boolean' },
            },
          },
        },
        required: ['edits'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'blaxel_codegenReapply',
      description: 'Use smarter model to retry a failed edit',
      parameters: {
        type: 'object',
        properties: {
          editId: { type: 'string', description: 'ID of the failed edit to reapply' },
          options: {
            type: 'object',
            properties: {
              model: { type: 'string' },
              maxRetries: { type: 'number' },
            },
          },
        },
        required: ['editId'],
      },
    },
  },
]

const logger = createLogger('MCP:Integration')

// AI-SDK-only routing tools. choose_role (and its alias role_selection) are
// registered exclusively in the Vercel AI SDK toolset
// (/opt/bing/web/lib/chat/vercel-ai-tools.ts:553-555); they are NOT MCP
// tools. When the orchestrator/dispatcher fan-out attempts them via
// callMCPToolFromAI_SDK as a defensive fallback (see
// architecture-integration.ts:897 and 1448-1449 comments), the MCP registry
// lookup fails and produces spurious `success: false, duration: 0` log noise.
// The short-circuit below suppresses that noise — the AI SDK execute() path
// (/opt/bing/web/lib/chat/tools/choose-role-tool.ts → chooseRoleCapability)
// handles the role switch. Keep this list narrow: only tools whose canonical
// registration is in the Vercel AI SDK toolset.
const AI_SDK_ONLY_TOOLS = new Set(['choose_role', 'role_selection']);

// Redact sensitive or large fields from tool args for logging/tracing

// ── Zod → JSON Schema converter ───────────────────────────────────────────
// Used defensively for AI SDK tool() objects whose .parameters is a raw Zod
// schema. This ensures the parameters field is always a valid JSON Schema
// object when exported in OpenAI-compatible format, regardless of the source.
function convertToJsonSchema(schema: any): any {
  if (schema && typeof schema === 'object' && '_def' in schema) {
    const converted = zodToJsonSchema(schema, { target: 'openApi3' }) as any;
    return converted.$defs?.inner ?? converted;
  }
  return schema;
}

// ── Tool result cache invalidation ────────────────────────────────────────
// Module-level function extracted from the inline closure in callMCPToolFromAI_SDK
// so it can also be used by the file-event subscriber (registered below).
// Invalidates tool result cache entries for a given file path, including
// all parent directory listings and root list caches.
function invalidateToolResultCache(path?: string): void {
  if (path) {
    const pathKey = toolCacheKey.fileRead(path);
    toolResultCache.delete(pathKey);
    // Also invalidate parent directory listings
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const parentPath = segments.slice(0, i).join('/') || '.';
      toolResultCache.delete(toolCacheKey.fileList(parentPath));
    }
  }
  // Invalidate root list cache on any write
  toolResultCache.delete(toolCacheKey.fileList('.'));
  toolResultCache.delete(toolCacheKey.fileList('/'));
}

// ── VFS file-event subscriber for cache invalidation ─────────────────────
// This is the broadcast mechanism: ANY file change that emits a VFS event
// (via emitFileEvent in file-events.ts) will invalidate the toolResultCache
// for the affected path, regardless of how the file was modified.
// Coverage includes bash_execute, direct VFS APIs, OPFS sync, and more —
// without having to add manual invalidation to each code path.
let cacheInvalidationRegistered = false;
function ensureCacheInvalidationRegistered(): void {
  if (cacheInvalidationRegistered) return;
  cacheInvalidationRegistered = true;
  onFileEvent((event) => {
    invalidateToolResultCache(event.path);
  });
  logger.debug('[MCP-Cache] Registered VFS file-event subscriber for tool result cache invalidation');
}

// Guard to prevent redundant reinitialization on every /api/mcp/connect click
let mcpArch1Initialized = false;

let cachedMCPorterTools: Array<{
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: any
  }
}> = []

// Chat-hang-fix (mcporter): dedup + hard-timeout guard for the mcporter tool
// cache refresh. mcporter is a runtime/process-spawning architecture (it can
// `createRuntime()` + connect stdio/http servers). On the hosted web server a
// slow or hung mcporter runtime (e.g. an npx spawn, a dead remote URL, or a
// DESKTOP_MODE leak) must NEVER block the per-request tool assembly. This
// refresh is a *cache* fill, so it is safe to run in the background and let
// callers read whatever is currently cached (empty on first call, populated
// once a prior background refresh lands).
let mcporterRefreshInFlight: Promise<void> | null = null
const MCPORTER_REFRESH_TIMEOUT_MS = parseInt(
  process.env.MCPORTER_LIST_TIMEOUT_MS || '30000',
  10,
)

async function refreshMCPorterToolsCache(): Promise<void> {
  if (!mcporterIntegration.isEnabled()) {
    cachedMCPorterTools = []
    return
  }

  // Dedup concurrent refreshes — a single in-flight listTools() is shared by
  // all callers so a burst of chat requests doesn't spawn N mcporter runtimes.
  if (mcporterRefreshInFlight) {
    return mcporterRefreshInFlight
  }

  mcporterRefreshInFlight = (async () => {
    try {
      // Hard ceiling so a hung mcporter runtime (unbounded connect/listTools)
      // can't keep the in-flight promise — and thus a background timer — alive
      // forever. On timeout we keep the previous cache and move on.
      const defs = await Promise.race([
        getMCPorterToolDefinitions(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`mcporter refresh timed out after ${MCPORTER_REFRESH_TIMEOUT_MS}ms`)),
            MCPORTER_REFRESH_TIMEOUT_MS,
          ),
        ),
      ])
      cachedMCPorterTools = defs
    } catch (error: any) {
      logger.warn(`Failed to refresh mcporter tools: ${error?.message || 'unknown error'}`)
    } finally {
      mcporterRefreshInFlight = null
    }
  })()

  return mcporterRefreshInFlight
}

/**
 * Kick off an mcporter cache refresh WITHOUT awaiting it, so the caller's
 * critical path (per-request tool assembly) never blocks on the mcporter
 * runtime. The `.catch()` swallows any rejection (refreshMCPorterToolsCache
 * already logs+degrades internally; this is belt-and-suspenders so an unhandled
 * rejection can't crash the process).
 */
function scheduleMCPorterToolsRefresh(): void {
  if (!mcporterIntegration.isEnabled()) return
  void refreshMCPorterToolsCache().catch(() => {})
}

/**
 * Initialize MCP for Architecture 1 (Main LLM - AI SDK)
 *
 * Call this during app initialization to make MCP tools available
 * to the main LLM call implementation
 */
/**
 * Connect to all configured HTTP MCP servers in parallel, each bounded
 * by INIT_PROBE_TIMEOUT_MS (5s). Replaces the prior sequential for-loop
 * (Step C of the chat-hang-fix full plan).
 *
 * Failure semantics: a single dead transport reduces to one warn line;
 * healthy siblings still register. Partial MCP availability is preferred
 * over a hard-fail that kills all of initializeMCPForArchitecture1.
 */
export async function probeAndRegisterRemoteMCPServers(
  httpServers: Array<{
    name: string
    url: string
    apiKey?: string
    bearerToken?: string
    headers?: Record<string, string>
  }>,
): Promise<void> {
  if (httpServers.length === 0) {
    logger.info('No HTTP MCP servers configured — remote MCP tools will be unavailable');
    return;
  }
  logger.debug('HTTP servers detected', { count: httpServers.length, servers: httpServers.map(s => s.name) });
  logger.info(`Connecting to ${httpServers.length} remote MCP server(s) via HTTP... (parallel probe, ${INIT_PROBE_TIMEOUT_MS}ms/server ceiling)`);

  await Promise.allSettled(
    httpServers.map(async (server) => {
      try {
        const transport = createHTTPTransport({
          url: server.url,
          apiKey: server.apiKey,
          bearerToken: server.bearerToken,
          headers: server.headers,
          transportType: 'streamable-http',
        });
        // Per-server probe ceiling. AbortSignal.timeout creates a one-shot
        // signal that flips at +INIT_PROBE_TIMEOUT_MS; combined with the
        // transport's internal 30s timeout via Step A's AbortSignal.any.
        await transport.listTools({ signal: AbortSignal.timeout(INIT_PROBE_TIMEOUT_MS) });
        registerHTTPTransport(server.name, transport);
        logger.info(`Connected to remote MCP server: ${server.name}`);
      } catch (error: any) {
        logger.warn(`Failed to connect to remote MCP server ${server.name}:`, error.message);
      }
    })
  );
}

export async function initializeMCPForArchitecture1(): Promise<void> {
  try {
    // Guard: Don't reinitialize if already done (prevents mcporter restart on every connect click)
    if (mcpArch1Initialized) {
      logger.debug('MCP for Architecture 1 already initialized — skipping redundant initialization');
      return;
    }
    mcpArch1Initialized = true;

    logger.info('Initializing MCP for Architecture 1 (AI SDK)...')

    // Initialize Nullclaw first (URL or container pool)
    if (process.env.NULLCLAW_ENABLED === 'true' || process.env.NULLCLAW_URL) {
      logger.info('Nullclaw detected, initializing...');
      await initializeNullclaw();
      const mode = getNullclawMode();
      const available = isNullclawAvailable();
      logger.info(`Nullclaw initialized: mode=${mode}, available=${available}`);
    }

    // CRITICAL: stdio (npx) MCP servers must ONLY be spawned in desktop mode.
    // In web mode, the Next.js server should NEVER spawn child processes for MCP.
    // Remote HTTP servers are fine in both modes.
    const isDesktop = process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true';

    const configs = parseMCPServerConfigs()

    if (configs.length === 0) {
      logger.info('No MCP servers configured. Set MCP_ENABLED=true or create mcp.config.json')
      return
    }

    // Separate HTTP (remote) from stdio (local) server configs
    const httpServers: Array<{ name: string; url: string; apiKey?: string; bearerToken?: string; headers?: Record<string, string> }> = []
    const stdioConfigs: typeof configs = []

    for (const config of configs) {
      // Check if it's a remote HTTP server (url lives inside transport config)
      const transportUrl = config.transport?.url;
      if (transportUrl && isValidMCPURL(transportUrl)) {
        const parsedUrl = parseMCPURL(transportUrl)
        httpServers.push({
          name: config.name,
          url: parsedUrl,
          apiKey: config.transport?.apiKey,
          bearerToken: config.transport?.bearerToken,
          headers: config.transport?.headers,
        })
        logger.info(`Remote MCP server detected: ${config.name} at ${parsedUrl}`)
      } else {
        // Local stdio server — ONLY register in desktop mode
        if (isDesktop) {
          stdioConfigs.push(config)
        } else {
          logger.debug(`Skipping stdio MCP server in web mode: ${config.name}`)
        }
      }
    }

    // Register and connect local stdio servers (desktop mode ONLY)
    if (stdioConfigs.length > 0) {
      for (const config of stdioConfigs) {
        mcpToolRegistry.registerServer(config)
      }

      logger.info(`Connecting to ${stdioConfigs.length} local MCP server(s)...`)
      await mcpToolRegistry.connectAll()
    } else if (!isDesktop) {
      logger.info('Web mode — local stdio MCP servers skipped (use remote HTTP servers instead)')
    }

    // Connect to remote HTTP servers (both desktop and web mode) via
    // probeAndRegisterRemoteMCPServers — parallel probe bounded by
    // INIT_PROBE_TIMEOUT_MS = 5000ms per server. Was sequential before;
    // with N dead servers the worst-case was N × 30s (the transport default).
    await probeAndRegisterRemoteMCPServers(httpServers);

    await refreshMCPorterToolsCache()

    const toolCount = getMCPToolCount()
    const mcporterTools = cachedMCPorterTools.length
    logger.info(`MCP initialized with ${toolCount} native tools and ${mcporterTools} mcporter tools available`)

    // Start health monitoring
    startHealthMonitoring(30000)

  } catch (error) {
    logger.error('Failed to initialize MCP for Architecture 1', error as Error)
    throw error
  }
}

/**
 * Get Composio MCP tools in AI SDK format
 *
 * Loads tools from Composio SDK with multiple fallback strategies
 *
 * @param userId - User identifier for session-based tool loading
 * @param requestedToolkits - Optional toolkit filters
 * @returns Array of tool definitions in AI SDK format
 */
export async function getComposioMCPTools(
  userId: string,
  requestedToolkits?: string[]
): Promise<Array<{
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: any
  }
}>> {
  try {
    const { Composio } = await import('@composio/core')
    const apiKey = process.env.COMPOSIO_API_KEY

    if (!apiKey) {
      logger.debug('Composio API key not configured, skipping tool loading')
      return []
    }

    const composio = new Composio({ apiKey })
    const requested = (requestedToolkits || []).map((t) => t.toLowerCase())

    const extractToolArray = (raw: any): any[] => {
      if (Array.isArray(raw)) return raw
      if (Array.isArray(raw?.items)) return raw.items
      if (Array.isArray(raw?.tools)) return raw.tools
      return []
    }

    const normalizeTool = (tool: any) => {
      const name = tool?.slug || tool?.name || tool?.toolSlug
      const description = tool?.description || tool?.deprecated?.displayName || `Tool ${name}`
      const parameters =
        tool?.inputParameters ||
        tool?.input_parameters ||
        tool?.parameters ||
        {
          type: 'object',
          properties: {},
          additionalProperties: true,
        }

      const toolkit =
        tool?.toolkit?.slug ||
        tool?.toolkitSlug ||
        tool?.appName ||
        (typeof name === 'string' ? String(name).split('_')[0]?.toLowerCase() : 'unknown')

      return { ...tool, name, description, parameters, toolkit }
    }

    const filterByToolkit = (tools: any[]) => {
      if (requested.length === 0) return tools
      return tools.filter((tool) => requested.includes(String(tool.toolkit || '').toLowerCase()))
    }

    let tools: any[] = []

    // Strategy 1: Direct tools.get() (newest SDK)
    if (typeof composio?.tools?.get === 'function') {
      try {
        const composioAny = composio as any;
        const result = await composioAny.tools.get(userId, {
          ...(requested.length > 0 ? { toolkits: requested } : {}),
          limit: 300,
          authConfigIds: [],
        } as any);
        tools = extractToolArray(result).map(normalizeTool)
        if (tools.length > 0) {
          logger.debug(`Loaded ${tools.length} Composio tools via tools.get()`)
          return filterByToolkit(tools).map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }))
        }
      } catch (err: any) {
        logger.debug('Composio tools.get() failed, trying fallback:', err?.message)
      }
    }

    // Strategy 2: tools.list() with various params
    if (typeof composio?.tools?.get === 'function') {
      const composioToolsAny = composio.tools as any;
      const tryParams = [
        requested.length > 0 ? { toolkit_slug: requested[0], limit: 300 } : { limit: 300 },
        requested.length > 0 ? { apps: requested.join(','), limit: 300 } : { limit: 300 },
        requested.length > 0 ? { toolkits: requested, limit: 300 } : { limit: 300 },
        undefined,
      ]
      for (const params of tryParams) {
        try {
          const result: any = params ? await composioToolsAny.list(params) : await composioToolsAny.list();
          tools = extractToolArray(result).map(normalizeTool)
          if (tools.length > 0) {
            logger.debug(`Loaded ${tools.length} Composio tools via tools.list()`)
            return filterByToolkit(tools).map((t) => ({
              type: 'function' as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            }))
          }
        } catch (err: any) {
          logger.debug('Composio tools.list() with params failed:', err?.message)
        }
      }
    }

    // Strategy 3: Session-based native tools
    if (typeof composio?.create === 'function') {
      try {
        const session = await composio.create(userId)
        if (typeof session?.tools === 'function') {
          const result = await session.tools()
          tools = extractToolArray(result).map(normalizeTool)
          if (tools.length > 0) {
            logger.debug(`Loaded ${tools.length} Composio tools via session.tools()`)
            return filterByToolkit(tools).map((t) => ({
              type: 'function' as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            }))
          }
        }
      } catch (err: any) {
        logger.debug('Composio session.tools() failed:', err?.message)
      }
    }

    // Strategy 4: Raw tools fallback
    if (typeof composio?.tools?.getRawComposioTools === 'function') {
      try {
        const result = await composio.tools.getRawComposioTools({
          limit: 300,
        } as any)
        tools = extractToolArray(result).map(normalizeTool)
        if (tools.length > 0) {
          logger.debug(`Loaded ${tools.length} Composio tools via getRawComposioTools()`)
          return filterByToolkit(tools).map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }))
        }
      } catch (err: any) {
        logger.debug('Composio getRawComposioTools() failed:', err?.message)
      }
    }

    logger.debug('No Composio tools loaded after trying all strategies')
    return []
  } catch (error: any) {
    logger.error('Failed to load Composio MCP tools:', error?.message)
    return []
  }
}

/**
 * Discriminated view of the taskFilter signal. Built once at the top of
 * `getMCPToolsForAI_SDK` and consumed by each per-source filter below —
 * keeps each branch a single `if (view.kind === 'plan')` /
 * `else if (view.kind === 'string')` test rather than re-doing the
 * type guard at every site.
 *
 *   - 'plan'   : the active chat route passed a `SelectToolPlanResult`
 *                (see web/lib/tools/select-tool-plan.ts). Per-source
 *                filters switch to intent-based + source-permission
 *                gating derived from the plan. Auth-gated sources
 *                (Composio, Arcade, integration.*) can be scoped by
 *                `requestedToolkits`. Resolves the substring-matcher
 *                defects identified in the active-route review (P1
 *                finding #6 — Arcade broad match, finding #7 —
 *                Composio fail-open for unknown names).
 *   - 'string' : legacy callers (unified-agent.ts, opencode-direct.ts,
 *                task-router.ts, vercel-ai-tools.ts) still pass a raw
 *                user-message string. Falls back to the original
 *                substring gates for backward compat.
 *   - 'none'   : no signal at all. Per-source filters return the
 *                unfiltered source catalog (behavior pre-planner).
 */
export type TaskFilterView =
  | {
      kind: 'plan';
      intents: ReadonlySet<string>;
      sourcePermissions: SelectToolPlanResult['sourcePermissions'];
      requestedToolkits: ReadonlyArray<string>;
      fallbackUsed: boolean;
    }
  | { kind: 'string'; taskLower: string }
  | { kind: 'none' };

function isSelectToolPlan(value: unknown): value is SelectToolPlanResult {
  // Duck-typing guard. We only check fields we actually consume
  // (intents + sourcePermissions). No deep validation — the plan is
  // built by the pure planner at web/lib/tools/select-tool-plan.ts.
  return (
    typeof value === 'object' &&
    value !== null &&
    'intents' in value &&
    Array.isArray((value as any).intents) &&
    'sourcePermissions' in value &&
    typeof (value as any).sourcePermissions === 'object' &&
    (value as any).sourcePermissions !== null
  );
}

function computeTaskFilterView(
  taskFilter: string | SelectToolPlanResult | undefined,
): TaskFilterView {
  if (isSelectToolPlan(taskFilter)) {
    return {
      kind: 'plan',
      intents: new Set(taskFilter.intents),
      sourcePermissions: taskFilter.sourcePermissions,
      requestedToolkits: taskFilter.requestedToolkits ?? [],
      fallbackUsed: !!taskFilter.fallbackUsed,
    };
  }
  if (typeof taskFilter === 'string' && taskFilter.length > 0) {
    return { kind: 'string', taskLower: taskFilter.toLowerCase() };
  }
  return { kind: 'none' };
}

// ── Per-source filter helpers (extracted for unit-test access) ────────────
//
// PURE functions: each takes the unfiltered upstream tool list (as
// returned by the per-source SDK call) plus the discriminating
// `TaskFilterView`, and returns the filtered tool list. NO module-
// level state, NO SDK calls — fully deterministic. Identical substring
// / plan-intent logic that was previously inlined in
// `getMCPToolsForAI_SDK`. Exported so the legacy-substring-contract
// test suite (`bing/web/__tests__/mcp/legacy-substring-contract.test.ts`)
// can invoke them directly, bypassing the vitest SDK-mock module-cache
// re-evaluation fragility observed across mock-pattern rewrites (which
// manifests as mock overrides on alias-keyed `vi.mock(...)` not
// propagating through the relative-path static imports inside
// `getMCPToolsForAI_SDK`).

export function filterBlaxelToolsByView(
  allBlaxelTools: ReadonlyArray<MCPSchema>,
  view: TaskFilterView,
): MCPSchema[] {
  if (view.kind === 'plan') {
    const hasCodeRead = view.intents.has('code.read');
    const hasCodeSearch = view.intents.has('code.search');
    const hasCodeEdit = view.intents.has('code.edit');
    return allBlaxelTools.filter(tool => {
      const name = (tool.function?.name || '').toLowerCase();
      if (name.includes('search') || name.includes('grep')) return hasCodeRead || hasCodeSearch;
      if (name.includes('apply') || name.includes('reapply')) return hasCodeEdit;
      return false;
    });
  }
  if (view.kind === 'string') {
    const taskLower = view.taskLower;
    const needsCodeSearch = taskLower.includes('search') || taskLower.includes('find') || taskLower.includes('codebase');
    const needsCodegen = taskLower.includes('generate') || taskLower.includes('create') || taskLower.includes('implement');
    return allBlaxelTools.filter(tool => {
      const name = (tool.function?.name || '').toLowerCase();
      if (name.includes('search') || name.includes('grep')) return needsCodeSearch;
      if (name.includes('apply') || name.includes('reapply')) return needsCodegen;
      return false;
    });
  }
  return [...allBlaxelTools];
}

export function filterNullclawToolsByView(
  allNullclawTools: ReadonlyArray<MCPSchema>,
  view: TaskFilterView,
): MCPSchema[] {
  // Strip the always-on status sentinel before category-gating.
  const stripped = allNullclawTools.filter(
    tool => (tool.function?.name || '').toLowerCase() !== 'nullclaw_status',
  );
  if (view.kind === 'plan') {
    const hasIntegration =
      view.intents.has('integration.gmail') ||
      view.intents.has('integration.slack') ||
      view.intents.has('integration.github');
    const hasWeb = view.intents.has('web.fetch') || view.intents.has('web.search');
    const hasShellOrComputer =
      view.intents.has('bash.run') ||
      view.intents.has('computer.use') ||
      view.intents.has('container.ops');
    return stripped.filter(tool => {
      const name = (tool.function?.name || '').toLowerCase();
      if (name.includes('discord') || name.includes('telegram') || name.includes('send')) return hasIntegration;
      if (name.includes('browse') || name.includes('automate')) return hasWeb;
      return hasShellOrComputer;
    });
  }
  if (view.kind === 'string') {
    const taskLower = view.taskLower;
    const needsMessaging =
      taskLower.includes('send') ||
      taskLower.includes('message') ||
      taskLower.includes('discord') ||
      taskLower.includes('telegram');
    const needsBrowse = taskLower.includes('browse') || taskLower.includes('web_automation');
    return stripped.filter(tool => {
      const name = (tool.function?.name || '').toLowerCase();
      if (name.includes('discord') || name.includes('telegram') || name.includes('send')) return needsMessaging;
      if (name.includes('browse') || name.includes('automate')) return needsBrowse;
      return false;
    });
  }
  return [...stripped];
}

export function filterArcadeToolsByView(
  allArcadeTools: ReadonlyArray<MCPSchema>,
  view: TaskFilterView,
): MCPSchema[] {
  if (view.kind === 'plan') {
    const arcadeGranted = view.sourcePermissions.arcade;
    const hasWeb = view.intents.has('web.fetch') || view.intents.has('web.search');
    const hasIntegration =
      view.intents.has('integration.gmail') ||
      view.intents.has('integration.slack') ||
      view.intents.has('integration.github');
    if (!(arcadeGranted && (hasWeb || hasIntegration))) return [];
    return allArcadeTools.filter(tool => {
      const name = (tool.function?.name || '').toLowerCase();
      if (hasWeb && (name.includes('web') || name.includes('browse') || name.includes('search'))) return true;
      if (hasIntegration && (name.includes('gmail') || name.includes('slack') || name.includes('github'))) return true;
      return false;
    });
  }
  if (view.kind === 'string') {
    const taskLower = view.taskLower;
    const needsWebAutomation =
      taskLower.includes('browse') || taskLower.includes('web') || taskLower.includes('automation');
    return allArcadeTools.filter(tool => {
      const name = (tool.function?.name || '').toLowerCase();
      return needsWebAutomation || name.includes('browse') || name.includes('web');
    });
  }
  return [...allArcadeTools];
}

export function filterComposioToolsByView(
  allComposioTools: ReadonlyArray<MCPSchema>,
  view: TaskFilterView,
): MCPSchema[] {
  // Plan-mode toolkit scope gating (auth + per-toolkit whitelist) is
  // applied ENVELOPE-WIDE in `getMCPToolsForAI_SDK` via the
  // `composioToolkitRequest` parameter passed to the SDK call (so the
  // SDK only returns tools in the requested prefix scope). The per-tool
  // filter below operates on tools the SDK already returned, applying
  // the secondary per-tool prefix match for plan-mode + the LEGACY
  // substring fall-through for 'string'-mode.
  if (view.kind === 'plan') {
    const composioGranted = view.sourcePermissions.composio;
    const requested = view.requestedToolkits;
    if (!(composioGranted && requested.length > 0)) return [];
    const requestedPrefixes = new Set(requested.map(t => t.toLowerCase()));
    return allComposioTools.filter(tool => {
      const name = (tool.function?.name || '').toLowerCase();
      const toolkit = String((tool as any).toolkit || '').toLowerCase();
      if (requestedPrefixes.has(toolkit)) return true;
      for (const prefix of requestedPrefixes) {
        if (name.startsWith(`${prefix}_`) || name.startsWith(`${prefix}-`)) return true;
      }
      return false;
    });
  }
  if (view.kind === 'string') {
    const taskLower = view.taskLower;
    const needsGmail = taskLower.includes('gmail') || taskLower.includes('email') || taskLower.includes('send mail');
    const needsSlack = taskLower.includes('slack') || taskLower.includes('message') || taskLower.includes('channel');
    const needsGoogleDrive = taskLower.includes('drive') || taskLower.includes('google drive') || taskLower.includes('upload file');
    const needsGithub = taskLower.includes('github') || taskLower.includes('git') || taskLower.includes('pull request') || taskLower.includes('issue');
    const needsNotion = taskLower.includes('notion') || taskLower.includes('page') || taskLower.includes('workspace');
    return allComposioTools.filter(tool => {
      const name = (tool.function?.name || '').toLowerCase();
      if (name.includes('gmail') || name.includes('email')) return needsGmail;
      if (name.includes('slack') || name.includes('message')) return needsSlack;
      if (name.includes('drive') || name.includes('google')) return needsGoogleDrive;
      if (name.includes('github') || name.includes('git')) return needsGithub;
      if (name.includes('notion')) return needsNotion;
      // LEGACY substring `return true` fall-through preserved verbatim
      // (the prior substring-mode contract — no fail-closed).
      return true;
    });
  }
  return [...allComposioTools];
}

export function filterProviderToolsByView(
  allProviderTools: ReadonlyArray<MCPSchema>,
  view: TaskFilterView,
): MCPSchema[] {
  if (view.kind === 'plan') {
    const hasComputerIntent = view.intents.has('computer.use');
    const hasAgentOrShellIntent =
      view.intents.has('bash.run') ||
      view.intents.has('container.ops') ||
      view.intents.has('computer.use');
    const hasSandboxIntent =
      view.intents.has('container.ops') ||
      view.intents.has('build.test') ||
      view.intents.has('bash.run');
    return allProviderTools.filter(tool => {
      const name = (tool.function?.name || '').toLowerCase();
      if (name.startsWith('daytona_')) return hasComputerIntent;
      if (name.startsWith('e2b_')) return hasAgentOrShellIntent;
      if (name.startsWith('codesandbox_')) return hasSandboxIntent;
      if (name.startsWith('sprites_')) return false;
      return false;
    });
  }
  if (view.kind === 'string') {
    const taskLower = view.taskLower;
    const needsComputerUse =
      taskLower.includes('screenshot') ||
      taskLower.includes('computer_use') ||
      taskLower.includes('desktop_automation');
    const needsAgentOffload =
      taskLower.includes('agent') || taskLower.includes('complex_task') || taskLower.includes('e2b');
    const needsSandbox = taskLower.includes('sandbox') || taskLower.includes('isolated');
    const needsCheckpoint = taskLower.includes('checkpoint') || taskLower.includes('sprite');
    return allProviderTools.filter(tool => {
      const name = (tool.function?.name || '').toLowerCase();
      if (name.startsWith('daytona_')) return needsComputerUse;
      if (name.startsWith('e2b_')) return needsAgentOffload;
      if (name.startsWith('codesandbox_')) return needsSandbox;
      if (name.startsWith('sprites_')) return needsCheckpoint;
      // LEGACY substring-mode `return true` fall-through preserved
      // (unrecognized name prefix passes through the substring gate).
      return true;
    });
  }
  return [...allProviderTools];
}

// ── Phase 2 partial-success-safe deadline wrapper ─────────────────────────
//
// Lifts Phase 2 out of the original all-or-nothing `Promise.race` against
// the route-level signal (L920-L1015 of the prior version) into per-source
// race-and-fallback wrappers. P1 finding #5 from the prior review —
// "Phase 2 timeout is all-or-nothing" — is the rationale: when the route
// signal fired mid-Phase-2, the prior `Promise.race` rejection cascaded
// to a `.catch` that returned [EMPTY, EMPTY, EMPTY, {}] for ALL 4 source
// slots — wiping successful siblings (e.g. Composio + Remote + Mem0 tools
// that already resolved while Arcade was the slow source).
//
// `fetchWithDeadline<T>` accepts (a) the underlying fetch promise for a
// source, (b) a fallback value to return on failure, (c) a per-source
// deadline, and (d) the optional route-level signal. It races the fetch
// against BOTH the deadline AND the signal — whichever wins, the wrapper
// resolves with either the real result (winner = fetch) OR the fallback
// (winner = deadline or signal). The outer `Promise.all([4 wrappers])`
// then reaps whatever resolved successfully; partial successes are
// preserved exactly when the prior race-then-catch chain would have
// erased them.
//
// Per-source timer + signal listener are cleared in `finally` so a fetch
// that resolves first does not leak its deadline timer (Node would keep
// it alive in `lib/internal/timers.js` until the original ms elapsed).
function fetchWithDeadline<T>(
  sourceName: string,
  promise: Promise<T>,
  fallback: T,
  timeoutMs: number,
  routeSignal?: AbortSignal | null,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutFailure = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[${sourceName}] timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  // The signal failure promise is built early so its reject listener is
  // attached BEFORE the function returns; otherwise a synchronous abort
  // (already-aborted signal) would race against the wrapper's cleanup
  // and the wrapper could settle to fallback before the listener fires.
  // Two sub-cases:
  //   - signal already aborted at entry → reject immediately so the race
  //     resolves to fallback in the same microtask.
  //   - signal pending → attach the listener; reject runs only when the
  //     signal actually aborts.
  let signalFailure: Promise<never> | null = null;
  let signalListener: (() => void) | undefined;
  if (routeSignal) {
    if (routeSignal.aborted) {
      // Synchronously-rejected promise. No `.catch` swallow needed: the
      // race below includes this slot and the wrapper's own
      // `.catch((err) => fallback)` already handles the rejection.
      signalFailure = Promise.reject(
        new Error(`[${sourceName}] aborted by route signal`),
      );
    } else {
      signalFailure = new Promise<never>((_, reject) => {
        signalListener = () =>
          reject(new Error(`[${sourceName}] aborted by route signal`));
        routeSignal.addEventListener('abort', signalListener, { once: true });
      });
    }
  }

  const cleanup = () => {
    // Cleanup runs ON the Promise's settlement — NOT synchronously on
    // return. The earlier `try { return Promise.race().catch() } finally
    // { ... }` pattern was wrong: the `finally` block fires the moment
    // the return expression evaluates (i.e. synchronously, BEFORE the
    // race settled), so the timer was cleared and the signal listener
    // detached before either could resolve the race. Hung sources then
    // hung the outer Promise.all forever because the deadline / abort
    // paths were dead. The fix is to defer cleanup to the promise chain.
    if (timer) clearTimeout(timer);
    if (signalListener && routeSignal) {
      routeSignal.removeEventListener('abort', signalListener);
    }
  };

  const race: Array<Promise<T | never>> = [promise, timeoutFailure];
  if (signalFailure) race.push(signalFailure);

  return Promise.race<T>(race)
    .catch((err: any) => {
      // Per-source failure surfaces at WARN — operators can chart which
      // source is partial-degraded without scraping the assembled tool
      // list shape. A successful sibling's slot keeps its full result
      // (the per-source wrapper keeps its own state; siblings are
      // governed by their own wrapper).
      logger.warn(
        `[MCP-Tools] Phase 2 source ${sourceName} degraded to empty: ${err?.message || err}`,
      );
      return fallback;
    })
    .finally(cleanup);
}

// ── Normalize / dedup / cap pipeline (audit remediation step #5) ─────────
//
// Replaces the prior flat-concat spread at the bottom of
// getMCPToolsForAI_SDK. The new pipeline is a strict 3-stage contract:
//
//   1. Build a SOURCE-LABELLED bundle per upstream tool source. The
//      origin label propagates into rejection telemetry so operators can
//      see WHICH source's tool lost the dedup race.
//   2. Sort bundles by SOURCE_PRECEDENCE_ORDER (static — operator-curated
//      and in-process fixtures outrank async-discovered SDK catalogs
//      on `tool.function.name` collision). Walk in that order, set
//      map[name] = {tool, origin}. First occurrence wins; collisions are
//      recorded in `rejectedByName`.
//   3. Apply a hard cap (default 25, env MCP_TOOLS_MAX_TOTAL). The cap
//      EXEMPTS the workflow-companion set so the unified-agent execution
//      loop is never stranded (write_file, bash_execute, etc. retain
//      even when the rest of the list is full). Excess non-exempt
//      entries are recorded in `rejectedByBudget`.

type MCPSchema = { type: 'function'; function: { name: string; description?: string; parameters: any } };

type ToolOrigin =
  | 'native'    // operator-curated MCP registry connections
  | 'mcporter'  // cached mcporter runtimes
  | 'blaxel'    // Blaxel codegen SDK
  | 'arcade'    // Arcade SDK (auth-gated)
  | 'provider'  // E2B / Daytona / CodeSandbox / Sprites
  | 'nullclaw'  // Nullclaw MCP bridge (browser/desktop)
  | 'composio'  // Composio SDK (auth-gated)
  | 'git'       // git shadow-commit (currently empty)
  | 'vfs'       // in-process VFS filesystem
  | 'bash'      // in-process shell
  | 'mem0'      // Mem0 memory SDK
  | 'remote'    // HTTP MCP transport (operator-configured)
  | 'web_search'; // synthetic search fallback

interface ToolBundle {
  origin: ToolOrigin;
  tools: MCPSchema[];
}

// Static precedence. FIRST occurrence wins on `tool.function.name`
// collision. Order rationale:
//   - native FIRST: operator-curated MCP registry connections are the
//     most-trusted surface; they should never be silently shadowed by
//     an async-discovered SDK duplicate.
//   - vfs + bash early: in-process fixtures, low-latency, fully under
//     the unified-agent control loop. Their names typically match
//     executor capabilities (write_file, bash_execute) so a duplicate
//     from a third-party SDK is suppressed under this ordering.
//   - composio + arcade + remote mid: auth-gated SDK results /
//     configured HTTP transports — useful but lower priority than
//     in-process.
//   - mem0 + provider + nullclaw + blaxel + mcporter + web_search + git
//     low: async-best-effort fills; their duplicates lose.
//
// Audit ordering rationale (remediation step #5): "Establish source
// precedence for duplicate names" — first-wins is the simplest
// deterministic contract, no per-tool scoring to maintain, fully
// table-testable. Score-based dedup was evaluated and rejected: per-
// source weights drift when a source's reliability changes, and the
// resulting weight-table churn propagates into test fixtures across
// the codebase.
const SOURCE_PRECEDENCE_ORDER: ReadonlyArray<ToolOrigin> = [
  'native',
  'vfs',
  'bash',
  'composio',
  'arcade',
  'remote',
  'mem0',
  'provider',
  'nullclaw',
  'blaxel',
  'web_search',  // synthetic search fallback (SearXNG/DuckDuckGo/Nullclaw-injected) — operator-essential, beats async-best-effort
  'mcporter',    // async-best-effort cache; cullable when the budget runs out
  'git',         // currently empty; placeholder for forward-compat
];

// Workflow companions — never dropped by the cap so the
// unified-agent execution loop continues to have the minimum tool set
// the orchestrator dispatcher fans out. Aligned to the AI SDK toolset
// at /opt/bing/web/lib/chat/vercel-ai-tools.ts and the VFS surface at
// /opt/bing/web/lib/mcp/vfs-mcp-tools.ts. choose_role / role_selection
// are AI-SDK-only and registered separately by the Vercel toolset — NOT
// included here because they're not MCP tools.
const WORKFLOW_COMPANIONS = new Set<string>([
  'write_file',
  'apply_diff',
  'batch_write',
  'delete_file',
  'move_file',
  'read_file',
  'list_files',
  'search_files',
  'bash_execute',
  'web_search',
]);

// Per-call env-var read (NOT module-level const). Module-level exposure
// would lock the cap at module-load value, defeating per-test env
// mutation (vitest tests like CAP-isolation and TELEMETRY-suite set
// `process.env.MCP_TOOLS_MAX_TOTAL = 'N'` AFTER importing the module;
// a const would silently keep the load-time fallback 25 and the test
// asserts would fail because no cap ever engaged).
function getToolsMaxTotal(): number {
  return parseInt(process.env.MCP_TOOLS_MAX_TOTAL || '25', 10);
}

function normalizeAndCapTools(
  bundles: ReadonlyArray<ToolBundle>,
  options: { maxBudget: number; exempt: ReadonlySet<string> },
): {
  kept: MCPSchema[];
  rejectedByName: Array<{ name: string; winner: ToolOrigin; loser: ToolOrigin }>;
  rejectedByBudget: string[];
} {
  // 1. Sort bundles by precedence (insertion-time stable; alphabetical
  //    not required because Map iteration preserves insertion order).
  const precedenceIdx = (o: ToolOrigin): number => SOURCE_PRECEDENCE_ORDER.indexOf(o);
  const sorted = bundles
    .filter((b) => Array.isArray(b.tools))
    .sort((a, b) => precedenceIdx(a.origin) - precedenceIdx(b.origin));

  // 2. Dedup by `tool.function.name`. First occurrence wins; collisions
  //    surface in `rejectedByName` with both `winner` (kept) and
  //    `loser` (dropped) origin attribution.
  const map = new Map<string, { tool: MCPSchema; origin: ToolOrigin }>();
  const rejectedByName: Array<{ name: string; winner: ToolOrigin; loser: ToolOrigin }> = [];
  for (const bundle of sorted) {
    for (const tool of bundle.tools) {
      const name = tool?.function?.name;
      if (!name || typeof name !== 'string') continue;
      const existing = map.get(name);
      if (existing) {
        rejectedByName.push({ name, winner: existing.origin, loser: bundle.origin });
        continue;
      }
      map.set(name, { tool, origin: bundle.origin });
    }
  }

  // 3. Apply cap. Workflow companions are exempt.
  //    Iteration order through map preserves precedence (we inserted
  //    bundles in precedence-sorted order above), so exempt entries
  //    appear first in the kept list and budget-fills come from the
  //    higher-precedence end of the non-exempt pool.
  const exemptEntries: Array<{ tool: MCPSchema; origin: ToolOrigin }> = [];
  const budgetedEntries: Array<{ tool: MCPSchema; origin: ToolOrigin }> = [];
  for (const [, entry] of map) {
    if (options.exempt.has(entry.tool.function.name)) {
      exemptEntries.push(entry);
    } else {
      budgetedEntries.push(entry);
    }
  }
  const budgetForNonExempt = Math.max(options.maxBudget - exemptEntries.length, 0);
  const kept: MCPSchema[] = [
    ...exemptEntries.map((e) => e.tool),
    ...budgetedEntries.slice(0, budgetForNonExempt).map((e) => e.tool),
  ];
  const rejectedByBudget = budgetedEntries
    .slice(budgetForNonExempt)
    .map((e) => e.tool.function.name);

  return { kept, rejectedByName, rejectedByBudget };
}

/**
 * Get MCP tools in AI SDK format for Architecture 1
 *
 * Use this in your chat/agent implementation to get MCP tools
 * in the format expected by AI SDK's tool calling
 *
 * NOTE: This is called lazily on each chat request, NOT on web startup.
 * Tool sources are initialized/configured at startup, but the actual
 * tool list is assembled per-request to reflect current state.
 *
 * @param userId - User ID for session-scoped tools
 * @param taskFilter - Optional task type to filter tools. Accepts:
 *                     - A raw prompt string (legacy callers — substring-gated
 *                       source filtering, original behavior).
 *                     - A `SelectToolPlanResult` from `selectToolPlan()`
 *                       (active route — intent + source-permission gated
 *                       source filtering; toolkits scoped via
 *                       `requestedToolkits`).
 *                     When provided, only tools relevant to the request
 *                     are included.
 */
export async function getMCPToolsForAI_SDK(
  userId?: string,
  taskFilter?: string | SelectToolPlanResult,
  signal?: AbortSignal,
) {
  const view = computeTaskFilterView(taskFilter);
  const callStart = Date.now();

  // =============================================================================
  // Top 5 Quick Win #5 — parallelize the 4 dynamic imports + the 4 conditional
  // async fetches in two Promise.all phases (audit
  // /opt/bing/docs/async-parallelization-opportunities.md , 2026-06-20).
  // Latency mask: ~90–210ms/request on cold path. Phase 1 = max-of-4 imports
  // (~30–60ms) instead of sum-of-4 imports (~80–200ms). Phase 2 = max-of-4
  // conditional fetches (~50–150ms) instead of sum-of-4 (~120–400ms).
  //
  // The scope-utils import in the prior bash-tools block is dropped (its
  // `normalizeSessionId` export is already statically imported at the top
  // of this file; `getVfsScopeBasePath`/`getVfsScopePath` are likewise
  // static — the dynamic import was redundant).
  // =============================================================================  // Phase-1 PA + conditional mcporter cache refresh (audit 2026-07-03,
  // conditional-guard pattern mirroring Phase 2). The 5th slot folds the
  // previously-sequential refreshMCPorterToolsCache() into the 4 imports;
  // mcporterIntegration.isEnabled() is a sync predicate; the
  // Promise.resolve() branch keeps the destructure index stable at 5.
  // assignment-before-read for cachedMCPorterTools preserved (only read
  // downstream after this PA resolves). ~5-30ms/request saved when
  // mcporter is enabled; zero overhead when disabled.
  // Chat-hang-fix (mcporter): the mcporter cache refresh is NO LONGER awaited
  // in this critical path. It was previously the 5th slot of this Promise.all,
  // which meant a slow/hung mcporter runtime (createRuntime + connect/listTools
  // has no built-in ceiling) blocked the ENTIRE per-request tool assembly. When
  // getMCPToolsForAI_SDK is wrapped by the chat route's Promise.race timeout,
  // that block caused the route to discard ALL tools — including the static VFS
  // file-edit tools that need no network/subprocess — leaving the model with
  // zero tools (root cause of the "intro text then indefinite stall" hang).
  // The refresh now runs in the background (bounded + deduped) and callers read
  // whatever `cachedMCPorterTools` currently holds. Empty on first request,
  // populated on subsequent ones once the background refresh lands.
  scheduleMCPorterToolsRefresh();

  const [
    providerToolDefs,
    vfsToolDefs,
    bashToolBundle,
    mem0Importer,
  ] = await Promise.all([
    import('./provider-advanced-tools'),
    import('./vfs-mcp-tools'),
    import('../bash/bash-tool'),
    import('../powers/mem0-power'),
    // NEW-C3 (2026-07-07, /opt/bing/docs/async-parallelization-opportunities.md
    // §NEW-1 followup-c NEW-C3): pre-flight module-cache warming for the 2
    // lazy-init singletons hoisted from getBlaxelProviderInstance (L1018) +
    // getArcadeServiceInstance (L1026). The .then(() => {}) discard pattern
    // returns Promise<void> so the 4-element destructure above is unaffected
    // (slots 6+7 are wallclock-only side-effects, not consumption points —
    // the resolved module namespace is discarded after the cache is warm).
    // Net wallclock saving: ~5-15ms cold-cache (single-process, first-time-
    // only); the warmth fires at the Phase-1 PA boundary so the first tool-
    // creation call hits a warm module cache and skips the dynamic-import
    // cost. Effective only when ARCADE_API_KEY (for arcade-service) or
    // BLAXEL_API_KEY (for blaxel-provider) trigger the lazy-init on this
    // request — both paths used by Tier 1 Win #5 tool-source fetches.
    // Caveat on Arcade: getArcadeService() returns a singleton whose class
    // body (ArcadeService.initialize()) does an ADDITIONAL inner
    // await import('@arcadeai/arcadejs') — that nested lazy-import is NOT
    // warmed by this fold (only the outer arcade-service.ts module is).
    // Blaxel's fold is the full win because blaxel-provider.ts is the
    // singleton+constructor and its module cache is the only cache hit
    // needed; the constructor itself runs sync post-import.
    import('../sandbox/providers/blaxel-provider').then(() => {}),
    import('../integrations/arcade-service').then(() => {}),
  ]);

  // Phase 1 derives (sync post-await — no extra latency).
  const providerTools = providerToolDefs.getAllProviderAdvancedTools();
  const vfsTools = vfsToolDefs.getVFSToolDefinitions().map(t => ({
    type: 'function' as const,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));

  const nativeTools = isMCPAvailable() ? mcpToolRegistry.getToolDefinitions() : [];

  // ----- Blaxel codegen tools (sync) -----
  let blaxelTools: Array<{
    type: 'function';
    function: { name: string; description?: string; parameters: any };
  }> = [];
  if (process.env.BLAXEL_API_KEY) {
    // Filter logic extracted to `filterBlaxelToolsByView` for unit-test
    // access. Same plan/string/none branching as before.
    blaxelTools = filterBlaxelToolsByView(getBlaxelCodegenToolDefinitions(), view);
  }

  // ----- Nullclaw tools (sync) -----
  let nullclawTools: Array<{
    type: 'function';
    function: { name: string; description?: string; parameters: any };
  }> = [];
  if (process.env.NULLCLAW_ENABLED === 'true') {
    // Filter logic extracted to `filterNullclawToolsByView` for
    // unit-test access. Status sentinel stripping + plan/string/none
    // branching preserved verbatim.
    nullclawTools = filterNullclawToolsByView(nullclawMCPBridge.getToolDefinitions(), view);
  }

  // =============================================================================
  // Phase 2: 4 conditional async fetches in one Promise.all. Each lambda is
  // gated by its env-var / isConfigured predicate; the per-op try/catch logic
  // is preserved internally (each fn returns empty array/dict on guard-failure
  // or internal error). Promise.all rejection semantics preserved — same
  // failure behavior as the prior sequential await chain.
  //
  // Chat-hang-fix #4 PR-4: if a `signal` was provided by the caller
  // (route.ts sets AbortSignal.timeout(MCP_TOOLS_TIMEOUT_MS) at 1s), wrap
  // the whole Phase 2 in a race against the signal so the underlying fetch
  // (notably getRemoteMCPTools → MCP HTTP transport on a dead socket like
  // localhost:8261) aborts immediately rather than holding the route's
  // Promise.race ceiling open. The .catch() in the race returns EMPTY for
  // any of the 4 tool lists that didn't resolve before the signal fired,
  // so the chat route still gets a usable (possibly-degraded) tool set.
  // =============================================================================
  type ArcadeShape = Array<{ type: 'function'; function: { name: string; description?: string; parameters: any } }>;
  const EMPTY: ArcadeShape = [];
  // Composio Phase-2 toolkit scoping: when the plan signals an explicit
  // list of integration toolkits (e.g. `['gmail']`, `['slack']`,
  // `['github']`) and grants `composio` source permission, scope the
  // SDK call to those toolkits so the cache+registry don't have to be
  // walked for the full ~800-tool catalog. Auth gating remains the
  // planner's responsibility (plan.sourcePermissions.composio is
  // false for unauthenticated callers) — but the SDK call also
  // requires `userId`, so we keep the existing `userId` guard intact.
  // Composite sentinel logic for the Composio Phase-2 SDK call:
  //   - `string[]` (non-null): scope the SDK call to this list. Plan
  //     mode only — when composio permission is granted AND at least
  //     one toolkit slug was requested, scope the SDK call so we
  //     don't fan-out to the full ~800-tool catalog.
  //   - `null`: SKIP the SDK call. Plan mode only — composio was
  //     denied (unauthenticated / no grant) OR granted but no
  //     toolkits requested. Skipping avoids a wasted SDK import +
  //     fetch. The post-Phase-2 composioTools filter then sees an
  //     EMPTY array and produces an EMPTY result — which is the
  //     correct fail-closed behavior (P1 finding #7).
  //   - `undefined`: legacy 'string' / 'none' paths. Pass-through
  //     to the SDK with NO toolkits so it returns its full catalog
  //     and the legacy substring filter downstream can reduce it
  //     to the matching subset.
  let composioToolkitRequest: string[] | null | undefined;
  if (view.kind === 'plan') {
    composioToolkitRequest = (view.sourcePermissions.composio && view.requestedToolkits.length > 0)
      ? [...view.requestedToolkits]
      : null;
  }
  // Legacy / no-filter paths leave composioToolkitRequest as `undefined`
  // — the SDK is then called with no toolkit scope and returns the full
  // catalog, which the post-Phase-2 substring filter trims down.

  // Per-source deadline for Phase 2 dynamic fetches. Configurable via
  // env var so ops can tune for known-slow sources (e.g. remote MCP
  // pointing at a busy gateway). Default 800ms — intentionally LESS
  // than the route-level MCP_TOOLS_TIMEOUT_MS (1000ms by default in
  // route.ts) so per-source warns fire BEFORE the route blanket-aborts
  // and operators see which source actually hung. With both deadlines
  // armed at their defaults the per-source timer wins ~200ms ahead of
  // the route signal, surfacing per-source diagnostics the route-level
  // blanket would have suppressed.
  const PHASE2_SOURCE_TIMEOUT_MS = parseInt(
    process.env.MCP_PHASE2_SOURCE_TIMEOUT_MS || '800',
    10,
  );

  // Partial-success-safe Phase 2 fan-out. Each of the 4 dynamic fetches
  // is wrapped in `fetchWithDeadline`, which races the underlying
  // promise against BOTH a per-source deadline AND the route-level
  // `signal` (if any). On any race-loss the wrapper resolves to a
  // per-source `fallback` value (EMPTY for tool lists, `{}` for Mem0);
  // sources that resolved successfully are preserved by the outer
  // Promise.all reaping whatever didn't fail. P1 finding #5 from the
  // prior review ("Phase 2 timeout is all-or-nothing") is fixed: a
  // hung Arcade no longer erases Composio / Remote / Mem0 results
  // that already resolved. See `fetchWithDeadline` doc above for the
  // full partial-success contract.
  const [
    allArcadeTools,
    allComposioTools,
    fetchedRemoteTools,
    mem0ToolMap,
  ] = await Promise.all([
    process.env.ARCADE_API_KEY
      ? fetchWithDeadline(
          'Arcade',
          getArcadeToolDefinitions(),
          EMPTY,
          PHASE2_SOURCE_TIMEOUT_MS,
          signal ?? null,
        )
      : Promise.resolve(EMPTY),
    (process.env.COMPOSIO_API_KEY && userId && composioToolkitRequest !== null)
      ? fetchWithDeadline(
          'Composio',
          getComposioMCPTools(userId, composioToolkitRequest),
          EMPTY,
          PHASE2_SOURCE_TIMEOUT_MS,
          signal ?? null,
        )
      : Promise.resolve(EMPTY),
    hasRemoteMCPServers()
      ? fetchWithDeadline(
          'RemoteMCP',
          getRemoteMCPTools(false, { signal }),
          EMPTY,
          PHASE2_SOURCE_TIMEOUT_MS,
          signal ?? null,
        )
      : Promise.resolve(EMPTY),
    mem0Importer.isMem0Configured()
      ? fetchWithDeadline(
          'Mem0',
          mem0Importer.buildMem0Tools({ userId, sessionId: userId }),
          {} as Record<string, any>,
          PHASE2_SOURCE_TIMEOUT_MS,
          signal ?? null,
        )
      : Promise.resolve({} as Record<string, any>),
  ]);

  let remoteTools: ArcadeShape = fetchedRemoteTools;  // Arcade filter (sync after Phase 2).
  let arcadeTools: ArcadeShape = [];
  if (process.env.ARCADE_API_KEY) {
    // Filter logic extracted to `filterArcadeToolsByView` for unit-test
    // access. Same plan/string/none branching preserved verbatim.
    arcadeTools = filterArcadeToolsByView(allArcadeTools, view);
  }

  // Composio filter (sync after Phase 2 — Phase-2 SDK call was already
  // toolkit-scoped above when `view.kind === 'plan'` AND requestedToolkits
  // were non-empty; this pass just enforces per-tool slug parity when
  // the SDK call returned the unfiltered catalog).
  let composioTools: ArcadeShape = [];
  if (process.env.COMPOSIO_API_KEY && userId) {
    // Filter logic extracted to `filterComposioToolsByView` for
    // unit-test access. Same plan/string/none branching preserved
    // (including the LEGACY `return true` substring-mode fall-through).
    composioTools = filterComposioToolsByView(allComposioTools, view);
  }

  // Provider-tools taskFilter (sync; providerTools is a Phase 1 let-bound result).
  // Filter logic extracted to `filterProviderToolsByView` for unit-test
  // access. providerTools is `const` (Phase 1 let-bound result), so we
  // splice the helper's return value into the existing array. The
  // helper handles plan / string / none branches internally; 'none'
  // passes through unchanged.
  providerTools.splice(0, providerTools.length, ...filterProviderToolsByView(providerTools, view));

  // Git shadow-commit is omitted from the default tool list — audit rationale preserved.
  const gitTools: Array<{ type: 'function'; function: { name: string; description?: string; parameters: any } }> = [];

  // ----- Bash shell tool (sync; registerVFSSyncHook side-effect before createBashTool) -----
  let bashTools: Array<{ type: 'function'; function: { name: string; description?: string; parameters: any } }> = [];
  try {
    bashToolBundle.registerVFSSyncHook();

    const sessionId = userId ? normalizeSessionId(userId) : undefined;
    const scopePath = getVfsScopeBasePath(sessionId);

    const bashToolMap = bashToolBundle.createBashTool({
      workingDir: scopePath,
      enableSelfHealing: true,
      persistToVFS: true,
    });

    bashTools = Object.entries(bashToolMap).map(([name, toolDef]: [string, any]) => ({
      type: 'function' as const,
      function: {
        name: name,
        description: toolDef.description,
        parameters: convertToJsonSchema(toolDef.parameters || (toolDef as any).inputSchema || {}),
      },
    }));

    if (bashTools.length > 0) {
      logger.debug(`Bash shell tool available: ${bashTools.length} tool(s), scoped to ${scopePath}`);
    }
  } catch (error: any) {
    logger.debug('Bash shell tool not available:', error.message);
  }

  // ----- Mem0 tools (sync after Phase 2 buildMem0Tools resolved) -----
  let mem0Tools: Array<{ type: 'function'; function: { name: string; description?: string; parameters: any } }> = [];
  if (mem0Importer.isMem0Configured() && mem0ToolMap && mem0ToolMap !== null && typeof mem0ToolMap === 'object') {
    mem0Tools = Object.entries(mem0ToolMap).map(([name, toolDef]: [string, any]) => ({
      type: 'function' as const,
      function: {
        name: `mem0_${name}`,
        description: toolDef.description || `Mem0 operation: ${name}`,
        parameters: convertToJsonSchema(toolDef.parameters || (toolDef as any).inputSchema || {}),
      },
    }));
    logger.debug(`Mem0 memory tools available: ${mem0Tools.length} tools`);
  }

  // ----- webSearchTools (sync) -----
  const hasNullclawSearch = nullclawTools.some((t: any) => t?.function?.name === 'nullclaw:search' || t?.function?.name === 'web.search' || t?.function?.name === 'web_search');
  const hasSearchProvider = !!process.env.SEARXNG_URL || !!process.env.DUCKDUCKGO_API_KEY || hasNullclawSearch;
  const webSearchTools: Array<{ type: 'function'; function: { name: string; description?: string; parameters: any } }> = hasSearchProvider ? [{
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: 'Search the web for information. Returns titles, URLs, and snippets from search results.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Maximum number of results to return (default: 10)' },
        },
        required: ['query'],
      },
    },
  }] : [];

  if (!hasSearchProvider) {
    logger.warn('[MCP-Tools] web_search omitted — no search backend available (Nullclaw has no container, no SearXNG/DuckDuckGo configured)');
  }

  // Audit step #5: source-bundled normalize/dedup/cap pipeline.
  // Replaces the prior flat-concat spread. Each source contributes one
  // labelled bundle; normalizeAndCapTools re-orders by SOURCE_PRECEDENCE_ORDER
  // (operator-curated and in-process fixtures outrank async-discovered SDK
  // catalogs on `tool.function.name` collision).
  // Workflow companions (write_file, bash_execute, web_search, etc.) are
  // exempt from the cap so the unified-agent execution loop is never
  // stranded. Telemetry surfaces candidate/selected/rejected counts.
  const bundles: ToolBundle[] = [
    { origin: 'native', tools: nativeTools },
    { origin: 'mcporter', tools: cachedMCPorterTools },
    { origin: 'blaxel', tools: blaxelTools },
    { origin: 'arcade', tools: arcadeTools },
    { origin: 'provider', tools: providerTools },
    { origin: 'nullclaw', tools: nullclawTools },
    { origin: 'composio', tools: composioTools },
    { origin: 'git', tools: gitTools },
    { origin: 'vfs', tools: vfsTools },
    { origin: 'bash', tools: bashTools },
    { origin: 'mem0', tools: mem0Tools },
    { origin: 'remote', tools: remoteTools },
    { origin: 'web_search', tools: webSearchTools },
  ];

  const normalization = normalizeAndCapTools(bundles, {
    maxBudget: getToolsMaxTotal(),
    exempt: WORKFLOW_COMPANIONS,
  });
  const tools = normalization.kept;

  const elapsed = Date.now() - callStart;

  if (tools.length === 0) {
    logger.debug('[MCP-Tools] No tools available');
    return [];
  }

  // candidate = sum across all source bundles (pre-dedup). selected =
  // post-dedup, post-cap. rejectedByName/rejectedByBudget feed the audit's
  // telemetry contract. Sample sizes are bounded to keep individual log
  // lines readable for grep workflows; full lists live in-memory and
  // can be fetched via deeper metrics paths if needed.
  //   - rejectedByNameSample: 8 — operators can spot the surprising wins/losses
  //   - rejectedByBudgetSample: 8 — cap-cull is more visible than dedup,
  //     slightly larger sample helps diagnose which tools the floor is excluding
  //   - selectedNamesSample:  12 — the LLM-facing floor; this many suffice
  //     to identify which capabilities reached the model
  const candidateCount = bundles.reduce((sum, b) => sum + b.tools.length, 0);
  const maxTotal = getToolsMaxTotal();
  logger.info(
    `[MCP-Tools] Assembled ${tools.length}/${candidateCount} candidates in ${elapsed}ms (max=${maxTotal})`,
    {
      selectedCount: tools.length,
      candidateCount,
      rejectedByNameCount: normalization.rejectedByName.length,
      rejectedByBudgetCount: normalization.rejectedByBudget.length,
      rejectedByNameSample: normalization.rejectedByName.slice(0, 8),
      rejectedByBudgetSample: normalization.rejectedByBudget.slice(0, 8),
      selectedNamesSample: tools
        .slice(0, 12)
        .map((t) => t?.function?.name)
        .filter((n): n is string => typeof n === 'string'),
    },
  );

  return tools;
}

/**
 * Startup health check — logs what MCP sources are available at boot time.
 * Call this once from server.ts or similar startup entry point.
 */
export async function logMCPStartupHealth(): Promise<void> {
  logger.info('═══════════════════════════════════════════════════');
  logger.info('[MCP-HTTP] ┌─ MCP Tool Sources ──────────────────');

  // Native MCP registry
  const registryStatus = mcpToolRegistry.getAllServerStatuses();
  const connectedServers = registryStatus.filter(s => s.info.state === 'connected');
  logger.info(`[MCP-HTTP] │ Native MCP servers: ${registryStatus.length} (${connectedServers.length} connected)`);
  for (const server of registryStatus) {
    const status = server.info.state === 'connected' ? '✅' : server.info.state === 'connecting' ? '🔄' : '❌';
    logger.info(`[MCP-HTTP] │   ${status} ${server.name} (${server.id})`);
  }

  // MCPorter
  logger.info(`[MCP-HTTP] │ MCPorter: ${mcporterIntegration.isEnabled() ? '✅ enabled' : '❌ disabled'}`);

  // Blaxel
  const blaxelKey = !!process.env.BLAXEL_API_KEY;
  logger.info(`[MCP-HTTP] │ Blaxel: ${blaxelKey ? '✅ configured' : '❌ not configured'}`);

  // Arcade
  const arcadeKey = !!process.env.ARCADE_API_KEY;
  logger.info(`[MCP-HTTP] │ Arcade: ${arcadeKey ? '✅ configured' : '❌ not configured'}`);

  // Provider tools (E2B, Daytona, CodeSandbox, Sprites)
  const { getAllProviderAdvancedTools } = await import('./provider-advanced-tools');
  const providerTools = getAllProviderAdvancedTools();
  logger.info(`[MCP-HTTP] │ Provider tools: ${providerTools.length} loaded`);

  // Nullclaw
  const nullclawEnabled = process.env.NULLCLAW_ENABLED === 'true';
  logger.info(`[MCP-HTTP] │ Nullclaw: ${nullclawEnabled ? '✅ enabled' : '❌ disabled'}`);

  // Composio
  const composioKey = !!process.env.COMPOSIO_API_KEY;
  logger.info(`[MCP-HTTP] │ Composio: ${composioKey ? '✅ configured' : '❌ not configured'}`);

  // Git tools
  logger.info(`[MCP-HTTP] │ Git tools: ✅ always available`);

  // VFS tools
  logger.info(`[MCP-HTTP] │ VFS tools: ✅ always available`);

  // Bash shell (stdio)
  logger.info(`[MCP-HTTP] │ Bash shell: ✅ stdio (session-scoped, self-healing)`);

  // Mem0
  const mem0Configured = !!process.env.MEM0_API_KEY;
  logger.info(`[MCP-HTTP] │ Mem0 memory: ${mem0Configured ? '✅ configured (cloud API)' : '❌ not configured (set MEM0_API_KEY)'}`);

  // Remote MCP servers
  const remoteCount = hasRemoteMCPServers() ? '✅' : '❌';
  logger.info(`[MCP-HTTP] │ Remote MCP servers: ${remoteCount}`);

  logger.info('[MCP-HTTP] └─────────────────────────────────────');
  logger.info('═══════════════════════════════════════════════════');
}

// Cached Blaxel provider instance for tool execution
let cachedBlaxelProvider: BlaxelProvider | null = null

// Cached Arcade service instance
let cachedArcadeService: ArcadeService | null = null

async function getBlaxelProviderInstance(): Promise<BlaxelProvider> {
  if (!cachedBlaxelProvider) {
    const { BlaxelProvider } = await import('../sandbox/providers/blaxel-provider')
    cachedBlaxelProvider = new BlaxelProvider()
  }
  return cachedBlaxelProvider
}

function getArcadeServiceInstance(): ArcadeService | null {
  if (!cachedArcadeService) {
    cachedArcadeService = getArcadeService()
  }
  return cachedArcadeService
}

// Sanitize tool name: replace dots and invalid chars with underscores
const sanitizeToolName = (name: string): string => {
  return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

// Get Arcade tool definitions for LLM tool calling
async function getArcadeToolDefinitions(): Promise<Array<{
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: any
  }
}>> {
  const arcade = getArcadeServiceInstance()
  if (!arcade) {
    return []
  }

  try {
    // Get all available tools from Arcade
    const tools = await arcade.getTools({ limit: 100 })

    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: `arcade_${sanitizeToolName(tool.name)}`,
        description: tool.description,
        parameters: tool.inputSchema || {
          type: 'object',
          properties: {},
        },
      },
    }))
  } catch (error: any) {
    logger.warn(`Failed to get Arcade tools: ${error.message}`)
    return []
  }
}

/**
 * Execute a Blaxel codegen tool
 */
async function executeBlaxelCodegenTool(
  toolName: string,
  args: Record<string, any>
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const blaxel = await getBlaxelProviderInstance()

    // Map tool name to method
    const methodName = toolName.replace(/^blaxel_/, '')
    const method = (blaxel as any)[methodName]

    if (!method || typeof method !== 'function') {
      return {
        success: false,
        output: '',
        error: `Blaxel tool method not found: ${methodName}`,
      }
    }

    // Extract parameters based on tool
    let result: any
    switch (methodName) {
      case 'codegenCodebaseSearch':
        result = await blaxel.codegenCodebaseSearch(args.query, args.options)
        break
      case 'codegenFileSearch':
        result = await blaxel.codegenFileSearch(args.pattern, args.options)
        break
      case 'codegenGrepSearch':
        result = await blaxel.codegenGrepSearch(args.pattern, args.options)
        break
      case 'codegenListDir':
        result = await blaxel.codegenListDir(args.path, args.options)
        break
      case 'codegenReadFileRange':
        result = await blaxel.codegenReadFileRange(args.filePath, args.startLine, args.endLine, args.options)
        break
      case 'codegenRerank':
        result = await blaxel.codegenRerank(args.query, args.directory, args.options)
        break
      case 'codegenParallelApply':
        result = await blaxel.codegenParallelApply(args.edits, args.options)
        break
      case 'codegenReapply':
        result = await blaxel.codegenReapply(args.editId, args.options)
        break
      default:
        return {
          success: false,
          output: '',
          error: `Unknown Blaxel tool: ${methodName}`,
        }
    }

    return {
      success: true,
      output: JSON.stringify(result),
    }
  } catch (error: any) {
    logger.error(`Blaxel codegen tool failed: ${toolName}`, error)
    return {
      success: false,
      output: '',
      error: error.message || 'Blaxel tool execution failed',
    }
  }
}

/**
 * Execute a provider-specific advanced tool (E2B, Daytona, CodeSandbox, Sprites)
 */
async function executeProviderAdvancedTool(
  toolName: string,
  args: Record<string, any>
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const { callProviderTool } = await import('./provider-advanced-tools')
    const result = await callProviderTool(toolName, args)

    return {
      success: result.success,
      output: result.output,
      error: result.error,
    }
  } catch (error: any) {
    logger.error(`Provider advanced tool failed: ${toolName}`, error)
    return {
      success: false,
      output: '',
      error: error.message || 'Provider tool execution failed',
    }
  }
}

/**
 * Execute an Arcade tool
 */
async function executeArcadeTool(
  toolName: string,
  args: Record<string, any>,
  userId: string  // Required, no default
): Promise<{ success: boolean; output: string; error?: string }> {
  // Validate userId is a real user ID, not default/fake
  if (!userId || userId === 'default' || userId.length < 10) {
    logger.warn(`Invalid userId for Arcade tool: ${userId}`)
    return {
      success: false,
      output: '',
      error: 'Invalid or missing user authentication',
    }
  }

  const arcade = getArcadeServiceInstance()
  if (!arcade) {
    return {
      success: false,
      output: '',
      error: 'Arcade service not available',
    }
  }

  try {
    // Remove 'arcade_' prefix to get actual tool name
    const actualToolName = toolName.replace(/^arcade_/, '')
    const result = await arcade.executeTool(actualToolName, args, userId)

    if (result.requiresAuth && result.authUrl) {
      return {
        success: false,
        output: '',
        error: `Authorization required. Please visit: ${result.authUrl}`,
      }
    }

    if (!result.success) {
      return {
        success: false,
        output: '',
        error: result.error || 'Arcade tool execution failed',
      }
    }

    return {
      success: true,
      output: JSON.stringify(result.output),
    }
  } catch (error: any) {
    logger.error(`Arcade tool failed: ${toolName}`, error)
    return {
      success: false,
      output: '',
      error: error.message || 'Arcade tool execution failed',
    }
  }
}

/**
 * Call MCP tool from Architecture 1 (AI SDK)
 *
 * Use this when the LLM requests a tool call
 * 
 * Caching strategy:
 * - list_files: fully cached (TTL 30s)
 * - search_files: fully cached (TTL 30s)  
 * - read_file: cached with content-hash validation (skip cache if file changed)
 * - write/modify operations: never cached
 */
export async function callMCPToolFromAI_SDK(
  toolName: string,
  args: Record<string, any>,
  userId: string,  // Required for Arcade tools
  scopePath?: string,  // VFS scope path for session-scoped file operations
  recentFailures?: string[],  // Recent tool execution errors (≥2 biases toward debugger in role_selection)
  options?: { signal?: AbortSignal },  // External watchdog plumbing (chat-hang-fix). Forwarded to remote MCP HTTP transport only.
): Promise<{ success: boolean; output: string; error?: string; __aiSdkOnly?: boolean }> {
  try {
    // Bug #37 (regression): canonicalize LLM-invented tool names (e.g.
    // 'list_directory' → 'list_files') BEFORE any registry/cache lookup.
    // This entry path bypasses normalizeToolCall, so without this the AI-SDK
    // path failed with "Bare tool name not found in any MCP server".
    const { canonicalizeMcpToolName } = await import('./vfs-mcp-tools');
    const canonicalToolName = canonicalizeMcpToolName(toolName);
    if (canonicalToolName !== toolName) {
      logger.info(`[MCP] Tool name aliased: "${toolName}" → "${canonicalToolName}"`, { from: toolName, to: canonicalToolName });
      toolName = canonicalToolName;
    }
    logger.debug(`Calling MCP tool: ${toolName}`, { args })

    // AI-SDK-only routing tools (choose_role + role_selection alias) live in
    // the Vercel AI SDK toolset, not the MCP tool assembly. Skip the MCP
    // registry lookup so the typical
    //   `MCP tool result: <tool> { success: false, duration: 0 }`
    // log noise doesn't mislead operators. The AI SDK execute() path
    // (/opt/bing/web/lib/chat/tools/choose-role-tool.ts → chooseRoleCapability)
    // handles the role switch — see canonical registration at
    // /opt/bing/web/lib/chat/vercel-ai-tools.ts:553-555. The fail-safe
    // fallback chain still operates over other tools (the canonical chain in
    // non-union routing); we only skip the misleading log noise here.
    if (AI_SDK_ONLY_TOOLS.has(canonicalToolName)) {
      logger.debug(`[MCP] Hand-off to AI SDK toolset: ${canonicalToolName} (skipping MCP registry lookup)`, {
        requestedName: toolName,
        canonicalName: canonicalToolName,
      });
      return {
        success: true,
        // Explicit sentinel so future consumers (analytics, telemetry,
        // operator dashboards) can distinguish a real MCP success from a
        // deliberate MCP-skip hand-off. Downstream code that doesn't know
        // about this flag treats the result as a normal success.
        __aiSdkOnly: true,
        output: JSON.stringify({
          routedTo: 'ai_sdk_toolset',
          tool: canonicalToolName,
          note: 'Hand-off to Vercel AI SDK toolset; MCP path is intentionally not used.',
        }),
      };
    }

    // Tools that should never be cached but trigger invalidation
    const writeTools = ['write_file', 'batch_write', 'apply_diff', 'delete_file', 'move_file'];
    const cacheEnabled = !writeTools.includes(toolName);
    
    
    // Ensure VFS file-event subscriber is registered (first MCP tool call only)
    ensureCacheInvalidationRegistered();

    // Build cache key at function scope for read-only operations
    let cacheKey: string | null = null;
    if (cacheEnabled) {
      if (toolName === 'list_files') {
        cacheKey = toolCacheKey.fileList(args.path || '.');
      } else if (toolName === 'search_files' || toolName === 'glob') {
        cacheKey = toolCacheKey.fileSearch(args.pattern || args.query || '', args.path);
      } else if (toolName === 'read_file' && args.path) {
        cacheKey = toolCacheKey.fileRead(args.path, args.hash);
      }

      // Check cache hit for read-only operations
      if (cacheKey) {
        const cached = toolResultCache.get(cacheKey);
        if (cached !== null) {
          // For read_file: validate content hash if provided
          if (toolName === 'read_file' && args.hash) {
            const cachedData = typeof cached === 'string' ? cached : JSON.stringify(cached);
            const cachedHash = contentHash(cachedData);
            if (cachedHash !== args.hash) {
              // Content changed - skip cache
              toolResultCache.delete(cacheKey);
            } else {
              logger.debug(`Cache hit for ${toolName}: ${cacheKey}`);
              return { success: true, output: cachedData };
            }
          } else {
            // Fully cacheable: list_files, search_files
            logger.debug(`Cache hit for ${toolName}: ${cacheKey}`);
            return {
              success: true,
              output: typeof cached === 'string' ? cached : JSON.stringify(cached),
            };
          }
        }
      }
    }

    // Check if it's a Blaxel codegen tool
    if (toolName.startsWith('blaxel_') && process.env.BLAXEL_API_KEY) {
      const result = await executeBlaxelCodegenTool(toolName, args)
      if (cacheEnabled && cacheKey) toolResultCache.set(cacheKey, result.output, 60000);
      return result;
    }

    // Check if it's an Arcade tool
    if (toolName.startsWith('arcade_') && process.env.ARCADE_API_KEY) {
      const result = await executeArcadeTool(toolName, args, userId);
      if (cacheEnabled && cacheKey) toolResultCache.set(cacheKey, result.output, 60000);
      return result;
    }

    // NEW: Check if it's a provider-specific advanced tool
    if (
      toolName.startsWith('e2b_') ||
      toolName.startsWith('daytona_') ||
      toolName.startsWith('codesandbox_') ||
      toolName.startsWith('sprites_')
    ) {
      return executeProviderAdvancedTool(toolName, args)
    }

    // NEW: Check if it's a Nullclaw tool
    if (toolName.startsWith('nullclaw_') && process.env.NULLCLAW_ENABLED === 'true') {
      return nullclawMCPBridge.executeTool(toolName, args, userId)
    }

    // NEW: Check if it's a remote MCP tool (from HTTP transport servers)
    if (hasRemoteMCPServers()) {
      // Check if tool name matches any remote server prefix
      const remoteServerNames = (await import('./http-transport')).getHTTPTransportNames();
      for (const serverName of remoteServerNames) {
        if (toolName.startsWith(`${serverName}_`)) {
          return callRemoteMCPTool(toolName, args, { signal: options?.signal });
        }
      }
    }

    // NEW: Check if it's a VFS filesystem tool (write_file, read_file, apply_diff, etc.)
    // These are defined in vfs-mcp-tools.ts and execute directly against the VFS.
    const { vfsTools, runWithToolContext, getVFSTool } = await import('./vfs-mcp-tools');
    const vfsTool = getVFSTool(toolName);
    if (vfsTool) {
      // Pre-validate common VFS tool arguments to avoid malformed invocations
      const validationErrors: string[] = [];
      if (toolName === 'write_file') {
        if (!args || !args.path) validationErrors.push('path: Required');
        if (!args || (!args.content && !args.files)) validationErrors.push('content: Required');
      }
      if (toolName === 'batch_write') {
        if (!args || (!args.files && !Array.isArray(args.files))) validationErrors.push('files: Required (array)');
      }
      if (toolName === 'apply_diff') {
        if (!args || !args.path) validationErrors.push('path: Required');
        if (!args || !args.diff) validationErrors.push('diff: Required');
      }

      if (validationErrors.length) {
        logger.warn('[VFS MCP] Input validation failed for ' + toolName, {
          errors: validationErrors.join('; '),
          inputKeys: Object.keys(args || {}),
        });
        return {
          success: false,
          output: '',
          error: validationErrors.join('; '),
        };
      }

      // Redacted payload dump for tracing origin of malformed tool calls
      try {
        const redacted = redactArgsForLogging(args || {}, { deep: true });
        logger.debug('[VFS MCP] Tool payload (redacted)', { payload: redacted });
      } catch (e) {
        logger.debug('[VFS MCP] Failed to redact payload for logging', { error: (e as any)?.message || e });
      }

      // Explicit logging for VFS MCP tool invocation (safe path extraction)
      logger.info('[VFS MCP] Tool invoked (AI_SDK path)', {
        tool: toolName,
        userId,
        args: Object.keys(args || {}),
        path: args?.path || (Array.isArray(args?.files) ? args.files.map((f: any) => f.path).join(', ') : undefined),
      });

      // Run inside request-scoped context so the tool gets the right userId and scopePath
      // Compute session-aware scopePath - use passed scopePath first (from executeToolCapability config)
      const sessionIdFromConv = normalizeSessionId(args.conversationId || '');
      const computedScopePath = getVfsScopePath({
        scopePath: scopePath && scopePath !== 'workspace' ? scopePath : undefined,
        sessionId: sessionIdFromConv || undefined,
      });

      const result = await runWithToolContext(
        {
          userId,
          sessionId: args.sessionId ?? sessionIdFromConv ?? 'anonymous',
          scopePath: computedScopePath, // Use session-aware scope path
        },
        async () => vfsTool.execute(args || {}, {
          messages: [],
          toolCallId: crypto.randomUUID(),
        })
      );

      const resultOutput = typeof (result as any)?.output === 'string' ? (result as any).output : JSON.stringify(result);
      
      // Invalidate caches after write operations
      if (!cacheEnabled && (result as any)?.success !== false) {
        const affectedPath = args?.path || args?.files?.[0]?.path;
        invalidateToolResultCache(affectedPath);
      } else if (cacheEnabled && cacheKey) {
        // Cache read-only operations
        const ttl = (toolName === 'read_file') ? 10000 : 60000;
        toolResultCache.set(cacheKey, resultOutput, ttl);
      }

      return {
        success: (result as any)?.success !== false,
        output: resultOutput,
        error: (result as any)?.error,
      };
    }

    // Check if it's the web_search tool
    // Note: role_selection is handled by choose_role in the AI SDK toolset (vercel-ai-tools.ts),
    // not via the MCP path. The route handler maps both names, so choose_role goes through
    // the AI SDK execute path, not through callMCPToolFromAI_SDK.
    if (toolName === 'web_search') {
      logger.info('[WebSearch] Tool invoked', { query: args.query, limit: args.limit });
      try {
        // Try SearXNG first if configured
        if (process.env.SEARXNG_BASE_URL) {
          const searxngUrl = process.env.SEARXNG_BASE_URL.replace(/\/$/, '');
          const searchUrl = `${searxngUrl}/search?q=${encodeURIComponent(args.query)}&format=json&language=en`;
          
          const headers: Record<string, string> = {
            'Accept': 'application/json',
          };
          if (process.env.SEARXNG_API_KEY) {
            headers['Authorization'] = `Bearer ${process.env.SEARXNG_API_KEY}`;
          }

          const response = await fetch(searchUrl, { headers });
          if (response.ok) {
            const data = await response.json();
            const results = (data.results || []).slice(0, args.limit || 10).map((r: any) => ({
              title: r.title || 'No title',
              url: r.url || '',
              snippet: r.content || r.snippet || '',
            }));
            return {
              success: true,
              output: JSON.stringify({ results, query: args.query, source: 'searxng' }),
            };
          }
        }

        // Fallback to DuckDuckGo via web.search capability
        const { getCapabilityRouter } = await import('../tools/router');
        const router = getCapabilityRouter();
        const result = await router.execute('web.search', { query: args.query, limit: args.limit }, {
          userId,
          conversationId: args.conversationId,
        } as any);

        return {
          success: true,
          output: JSON.stringify({ ...result, source: 'duckduckgo' }),
        };
      } catch (error: any) {
        logger.error('[WebSearch] Failed', { error: error.message });
        return {
          success: false,
          output: '',
          error: error.message || 'Web search failed',
        };
      }
    }

    // NEW: Check if it's a bash/stdio shell tool (bash_execute)
    if (toolName === 'bash_execute') {
      const { createBashTool } = await import('../bash/bash-tool');
      // Bug fix (was silently falling back to '000'): the previous code
      // used `args.conversationId || userId || '000'` which masked
      // missing-userId bugs by substituting the literal string '000' as
      // the session id. That string then propagated as the VFS ownerId
      // (visible as `[VFS] getWorkspaceVersion called { ownerId: '000' }`
      // in the logs) and caused cross-session workspace contamination.
      // Throw loudly so the missing-userId case is fixed at the call
      // site instead of being papered over downstream.
      const sessionIdSource = args.conversationId || userId;
      if (!sessionIdSource) {
        throw new Error(
          '[architecture-integration] bash_execute requires a userId or conversationId; ' +
          'both are missing. This is a caller bug — the tool dispatcher must pass ' +
          'an authenticated identity.'
        );
      }
      const sessionId = normalizeSessionId(sessionIdSource);
      const scopePath = `workspace/sessions/${sessionId}`;

      // Get filesystem state for command routing
      let filesystemState: Record<string, { content?: string; isDirectory?: boolean }> = {};
      // Note: This fetches state once per tool call - in production, cache this at session level
      try {
        const { virtualFilesystem: vfs } = await import('../virtual-filesystem/index.server');
        const listing = await vfs.listDirectory(userId, '/');
        for (const node of listing.nodes || []) {
          const nodePath = `/${node.name}`;
          const file = await vfs.readFile(userId, nodePath).catch(() => null);
          filesystemState[nodePath] = {
            content: file?.content || '',
            isDirectory: node.type === 'directory',
          };
        }
      } catch {
        // VFS unavailable - continue without routing
      }

      const bashToolMap = createBashTool({
        workingDir: scopePath,
        enableSelfHealing: true,
        persistToVFS: true,
        getFilesystemState: () => filesystemState,
        // onTerminalOutput would be wired from TerminalPanel context
      });

      const bashTool = bashToolMap['bash_execute' as keyof typeof bashToolMap];

      if (bashTool) {
        logger.info('[Bash] Tool invoked (AI_SDK path)', {
          tool: toolName,
          command: args?.command?.slice(0, 100),
          workingDir: scopePath,
        });

        const result = await bashTool.execute(args || {}, {
          messages: [],
          toolCallId: crypto.randomUUID(),
          threadId: sessionId,
        } as any);

        return {
          success: (result as any)?.success !== false,
          output: (result as any)?.output || JSON.stringify(result),
          error: (result as any)?.error,
        };
      }
    }

    // Bare tool names need server-prefix qualification for MCP registry lookup
    let qualifiedName = toolName;
    if (!toolName.includes(':')) {
      const allTools = mcpToolRegistry.getAllTools();
      const matched = allTools.find(t => t.tool.name === toolName);
      if (matched) {
        qualifiedName = `${matched.serverId}:${toolName}`;
      } else {
        logger.warn(`[MCP] Bare tool name "${toolName}" not found in any MCP server — will fail registry lookup`, { toolName, availableTools: allTools.map(t => t.tool.name) });
      }
    }
    const nativeResult = await mcpToolRegistry.callTool(qualifiedName, args)
    if (nativeResult.success || !nativeResult.isError || !nativeResult.content.includes('Tool not found')) {
      logger.debug(`MCP tool result: ${toolName}`, {
        success: nativeResult.success,
        duration: nativeResult.duration,
      })

      // Invalidate caches after native tool writes
      if (!cacheEnabled && nativeResult.success) {
        invalidateToolResultCache(args?.path);
      }

      return {
        success: nativeResult.success,
        output: nativeResult.content,
        error: nativeResult.isError ? nativeResult.content : undefined,
      }
    }

    const mcporterResult = await callMCPorterTool(toolName, args);
    
    // Invalidate caches after mcporter tool writes  
    if (!cacheEnabled && mcporterResult.success) {
      invalidateToolResultCache(args?.path);
    }
    logger.debug(`mcporter tool result: ${toolName}`, { success: mcporterResult.success })
    return mcporterResult
  } catch (error: any) {
    logger.error(`MCP tool call failed: ${toolName}`, error)
    return {
      success: false,
      output: '',
      error: error.message || 'Tool call failed',
    }
  }
}

/**
 * Initialize MCP for Architecture 2 (OpenCode CLI Agent)
 * 
 * For OpenCode CLI, we expose MCP tools via a local HTTP endpoint
 * that the CLI agent can call
 */
export async function initializeMCPForArchitecture2(port: number = 8888): Promise<void> {
  try {
    logger.info(`Initializing MCP for Architecture 2 (OpenCode CLI) on port ${port}...`)
    
    // Initialize MCP (same as Architecture 1)
    await initializeMCPForArchitecture1()
    
    // Start HTTP server for CLI agent to call
    const { createMCPServerForCLI } = await import('./mcp-http-server')
    await createMCPServerForCLI(port)
    
    logger.info(`MCP HTTP server for CLI agent running on http://localhost:${port}`)
    
  } catch (error) {
    logger.error('Failed to initialize MCP for Architecture 2', error as Error)
    throw error
  }
}

/**
 * Get MCP server URL for Architecture 2
 * 
 * OpenCode CLI agent can use this URL to discover and call MCP tools
 */
export function getMCPServerURL(): string {
  const port = process.env.MCP_CLI_PORT || '8888'
  return `http://localhost:${port}`
}

/**
 * Generate OpenCode CLI configuration for MCP
 * 
 * This creates a config file that tells OpenCode CLI
 * where to find MCP tools
 */
export function generateOpenCodeCLIConfig(): string {
  const url = getMCPServerURL()
  
  return JSON.stringify({
    mcp: {
      enabled: true,
      serverUrl: url,
      autoDiscover: true,
      timeout: 60000,
    },
    tools: {
      preferMCP: true,
      fallback: 'builtin',
    },
  }, null, 2)
}

/**
 * Shutdown MCP connections
 * 
 * Call this on app shutdown to clean up MCP connections
 */
export async function shutdownMCPConnections(): Promise<void> {
  try {
    logger.info('Shutting down MCP connections...')
    await shutdownMCP()
    logger.info('MCP connections shut down successfully')
  } catch (error) {
    logger.error('Failed to shutdown MCP connections', error as Error)
  }
}

/**
 * Check MCP health and availability
 */
export function checkMCPHealth(): {
  available: boolean
  toolCount: number
  serverStatuses: Array<{ id: string; name: string; connected: boolean; info?: any }>
} {
  const available = isMCPAvailable()
  const toolCount = getMCPToolCount()
  const rawStatuses = mcpToolRegistry.getAllServerStatuses()
  
  const serverStatuses = rawStatuses.map(s => {
    const state = s.info?.state;
    const connected = state === 'connected';
    return {
      id: s.id,
      name: s.name,
      connected,
      info: s.info,
    };
  })
  
  return {
    available,
    toolCount,
    serverStatuses,
  }
}

/**
 * MCP Health Endpoint Handler
 * 
 * Use this in your API route for health checks
 */
export async function handleMCPHealthCheck() {
  const health = checkMCPHealth()
  
  return {
    status: health.available ? 'healthy' : 'degraded',
    mcp: health,
    timestamp: new Date().toISOString(),
  }
}
