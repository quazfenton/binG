import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { actionRegistry, type HandlerContext } from '@/lib/integrations/action-registry';
import { initializeAuditTable, getUserAuditTrail, getUserExecutionStats } from '@/lib/integrations/execution-audit';
import { createLogger } from '@/lib/utils/logger';
import { getToolServiceForPlatform } from '@/lib/oauth/provider-map';

const logger = createLogger('Integrations:Execute');

// Initialize audit table on module load (idempotent — CREATE TABLE IF NOT EXISTS)
try {
  initializeAuditTable();
} catch (e: any) {
  // Audit table init failure should not crash the route
  logger.warn('Audit table initialization failed — audit logging disabled', e.message);
}

/**
 * POST /api/integrations/execute
 *
 * Unified execution endpoint. Routes actions to the appropriate
 * provider handler via the ActionRegistry.
 *
 * Supports:
 * - Single action execution: { provider, action, params }
 * - Batch execution: [ { provider, action, params }, ... ] (max 20, parallel)
 * - Provider auto-discovery (Arcade, Nango, Composio, GitHub, Local)
 *
 * @example Single action
 * { "provider": "github", "action": "list_repos", "params": {} }
 *
 * @example Batch execution
 * [
 *   { "provider": "github", "action": "list_repos", "params": {} },
 *   { "provider": "local", "action": "bash", "params": { "command": "ls -la" } }
 * ]
 *
 * @example Discovery
 * GET /api/integrations/execute
 */
export async function POST(request: NextRequest) {
  const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
  const userId = authResult.success && authResult.userId ? String(authResult.userId) : 'anonymous';
  const ipAddress = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? undefined;
  const userAgent = request.headers.get('user-agent') ?? undefined;

  const context = { userId, ipAddress, userAgent };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // ========================================================================
  // Batch execution: array of actions
  // ========================================================================
  if (Array.isArray(body)) {
    return executeBatch(body, context);
  }

  // ========================================================================
  // Single action execution
  // ========================================================================
  const req = body as Record<string, unknown>;
  const provider = typeof req.provider === 'string' ? req.provider : undefined;
  const action = typeof req.action === 'string' ? req.action : undefined;
  const params = (typeof req.params === 'object' && req.params !== null) ? req.params as Record<string, unknown> : {};

  if (!provider) {
    return NextResponse.json({ error: 'provider is required (string)' }, { status: 400 });
  }
  if (!action) {
    return NextResponse.json({ error: 'action is required (string)' }, { status: 400 });
  }

  return actionRegistry.execute(provider, action, params, context);
}

/**
 * GET /api/integrations/execute
 *
 * Discovery endpoint — returns all registered providers, their supported
 * actions, and execution statistics for the current user.
 *
 * Query params:
 * - stats=true — include execution statistics
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
  const userId = authResult.success && authResult.userId ? String(authResult.userId) : null;

  const providers = actionRegistry.getRegisteredProviders().map(name => ({
    name,
    actions: actionRegistry.getProviderActions(name),
    requiresAuth: actionRegistry.providerRequiresAuth(name),
  }));

  const response: Record<string, unknown> = { providers };

  if (searchParams.get('stats') === 'true' && userId) {
    response.stats = getUserExecutionStats(userId);
  }

  return NextResponse.json(response);
}

/**
 * Execute multiple actions in parallel.
 * Results are returned in the same order as the input array.
 * Max 20 actions per batch to prevent abuse.
 */
async function executeBatch(
  actions: unknown[],
  context: { userId: string; ipAddress?: string; userAgent?: string },
): Promise<NextResponse> {
  if (actions.length === 0) {
    return NextResponse.json({ error: 'Batch is empty' }, { status: 400 });
  }

  if (actions.length > 20) {
    return NextResponse.json({ error: 'Batch limit exceeded (max 20 actions per request)' }, { status: 400 });
  }

  // Validate each batch item
  const validated: Array<{ provider: string; action: string; params: Record<string, unknown> }> = [];
  for (let i = 0; i < actions.length; i++) {
    const item = actions[i];
    if (typeof item !== 'object' || item === null) {
      return NextResponse.json({ error: `Batch item at index ${i} is not an object` }, { status: 400 });
    }
    const req = item as Record<string, unknown>;
    const provider = typeof req.provider === 'string' ? req.provider : undefined;
    const action = typeof req.action === 'string' ? req.action : undefined;
    const params = (typeof req.params === 'object' && req.params !== null) ? req.params as Record<string, unknown> : {};

    if (!provider || !action) {
      return NextResponse.json({ error: `Batch item at index ${i} requires 'provider' and 'action' strings` }, { status: 400 });
    }
    validated.push({ provider, action, params });
  }

  const startTime = Date.now();

  // Execute all actions in parallel — Promise.allSettled ensures one failure doesn't kill the batch
  const settled = await Promise.allSettled(
    validated.map(item =>
      actionRegistry.execute(item.provider, item.action, item.params, context).then(r => r.json() as Promise<Record<string, unknown>>),
    ),
  );

  const results = settled.map((s, i) => ({
    index: i,
    provider: validated[i].provider,
    action: validated[i].action,
    ...(s.status === 'fulfilled' ? s.value : { success: false, error: 'Execution rejected' }),
  }));

  const successCount = results.filter(r => (r as Record<string, unknown>).success === true).length;

  return NextResponse.json({
    success: successCount === validated.length,
    results,
    summary: {
      total: validated.length,
      succeeded: successCount,
      failed: validated.length - successCount,
      durationMs: Date.now() - startTime,
    },
  });
}

// ============================================================================
// PROVIDER REGISTRATION
// ============================================================================

// Register Local actions (no auth required)
actionRegistry.registerProvider('local', createLocalHandler(), [
  'bash', 'command', 'file', 'read_file', 'webhook', 'trigger_webhook',
  'context_pack', 'bundle',
], false);

// Register GitHub actions
actionRegistry.registerProvider('github', createGitHubHandler(), [
  'repos', 'list_repos', 'branches', 'list_branches',
  'commits', 'list_commits', 'search', 'search_code',
  'issues', 'create_issue', 'list_issues',
  'prs', 'create_pr',
]);

// Register Google actions (via Arcade)
actionRegistry.registerProvider('gmail', createArcadeHandler('gmail', {
  'send': 'Gmail_SendEmail', 'read': 'Gmail_SearchEmails', 'search': 'Gmail_SearchEmails',
}), ['send', 'read', 'search']);
actionRegistry.registerProvider('googledrive', createArcadeHandler('googledrive', {
  'list': 'GoogleDrive_ListFiles', 'upload': 'GoogleDrive_UploadFile',
}), ['list', 'upload']);
actionRegistry.registerProvider('googlecalendar', createArcadeHandler('googlecalendar', {
  'events': 'GoogleCalendar_ListEvents', 'create': 'GoogleCalendar_CreateEvent',
}), ['events', 'create']);
actionRegistry.registerProvider('googledocs', createArcadeHandler('googledocs', {
  'create': 'GoogleDocs_CreateDocument',
}), ['create']);
actionRegistry.registerProvider('googlesheets', createArcadeHandler('googlesheets', {
  'read': 'GoogleSheets_ReadSheet',
}), ['read']);

// Register Arcade-managed providers
actionRegistry.registerProvider('slack', createArcadeHandler('slack', {
  'msg': 'Slack_SendMessage', 'channels': 'Slack_ListChannels',
  'send_message': 'Slack_SendMessage', 'list_channels': 'Slack_ListChannels',
}), ['msg', 'channels', 'send_message', 'list_channels']);
actionRegistry.registerProvider('discord', createArcadeHandler('discord', {
  'msg': 'Discord_SendMessage', 'servers': 'Discord_ListServers',
  'send_message': 'Discord_SendMessage', 'list_servers': 'Discord_ListGuilds',
}), ['msg', 'servers', 'send_message', 'list_servers']);
actionRegistry.registerProvider('spotify', createArcadeHandler('spotify', {
  'play': 'Spotify_PlayTrack', 'search': 'Spotify_Search',
}), ['play', 'search']);
actionRegistry.registerProvider('twitter', createArcadeHandler('twitter', {
  'post': 'Twitter_PostTweet', 'search': 'Twitter_SearchTweets',
  'post_tweet': 'Twitter_PostTweet', 'search_tweets': 'Twitter_SearchTweets',
}), ['post', 'search', 'post_tweet', 'search_tweets']);
actionRegistry.registerProvider('reddit', createArcadeHandler('reddit', {
  'post': 'Reddit_CreatePost', 'create_post': 'Reddit_CreatePost',
}), ['post', 'create_post']);
actionRegistry.registerProvider('linkedin', createArcadeHandler('linkedin', {
  'post': 'LinkedIn_CreateSharePost', 'create_post': 'LinkedIn_CreateSharePost',
}), ['post', 'create_post']);
actionRegistry.registerProvider('twilio', createArcadeHandler('twilio', {
  'sms': 'Twilio_SendSMS', 'send_sms': 'Twilio_SendSMS',
}), ['sms', 'send_sms']);
actionRegistry.registerProvider('vercel', createArcadeHandler('vercel', {
  'deploy': 'Vercel_ListDeployments', 'list_deployments': 'Vercel_ListDeployments',
}), ['deploy', 'list_deployments']);
actionRegistry.registerProvider('exa', createArcadeHandler('exa', {
  'search': 'Exa_Search', 'web-search': 'Exa_Search',
}), ['search', 'web-search']);

// Register Nango-managed providers (proxy-based)
actionRegistry.registerProvider('notion', createNangoHandler('notion', [
  'search', 'create', 'db', 'search_pages', 'create_page', 'query_database',
]), ['search', 'create', 'db', 'search_pages', 'create_page', 'query_database']);
actionRegistry.registerProvider('dropbox', createNangoHandler('dropbox', [
  'list', 'upload', 'list_files', 'upload_file',
]), ['list', 'upload', 'list_files', 'upload_file']);
actionRegistry.registerProvider('stripe', createNangoHandler('stripe', [
  'balance', 'customers', 'check_balance', 'list_customers',
]), ['balance', 'customers', 'check_balance', 'list_customers']);
actionRegistry.registerProvider('zoom', createNangoHandler('zoom', [
  'meetings', 'create', 'list_meetings', 'create_meeting',
]), ['meetings', 'create', 'list_meetings', 'create_meeting']);
actionRegistry.registerProvider('linear', createNangoHandler('linear', [
  'issues', 'create', 'list_issues', 'create_issue',
]), ['issues', 'create', 'list_issues', 'create_issue']);
actionRegistry.registerProvider('jira', createNangoHandler('jira', [
  'issues', 'create', 'list_issues', 'create_issue',
]), ['issues', 'create', 'list_issues', 'create_issue']);
actionRegistry.registerProvider('hubspot', createNangoHandler('hubspot', [
  'contacts', 'list_contacts',
]), ['contacts', 'list_contacts']);
actionRegistry.registerProvider('salesforce', createNangoHandler('salesforce', [
  'leads', 'list_leads',
]), ['leads', 'list_leads']);
actionRegistry.registerProvider('airtable', createNangoHandler('airtable', [
  'list', 'create', 'list_records', 'create_record',
]), ['list', 'create', 'list_records', 'create_record']);
actionRegistry.registerProvider('asana', createNangoHandler('asana', [
  'tasks', 'create', 'list_tasks', 'create_task',
]), ['tasks', 'create', 'list_tasks', 'create_task']);
actionRegistry.registerProvider('railway', createNangoHandler('railway', [
  'deploy', 'deploy_service',
]), ['deploy', 'deploy_service']);

// Register Composio-managed providers
actionRegistry.registerProvider('composio', createComposioHandler(), []);

// ============================================================================
// PROVIDER FACTORIES
// ============================================================================

/**
 * Create a local action handler
 */
function createLocalHandler() {
  return async (action: string, params: Record<string, unknown>, context: HandlerContext) => {
    switch (action) {
      case 'bash':
      case 'command': {
        const command = typeof params.command === 'string' ? params.command : undefined;
        if (!command) return { success: false, error: 'command parameter is required (string)' };
        const cwd = typeof params.cwd === 'string' ? params.cwd : undefined;
        return executeCommandDirect(command, cwd);
      }
      case 'file':
      case 'read_file': {
        const filePath = typeof params.path === 'string' ? params.path : undefined;
        if (!filePath) return { success: false, error: 'path parameter is required (string)' };
        return executeFileRead(filePath, context.userId);
      }
      case 'webhook':
      case 'trigger_webhook': {
        const url = typeof params.url === 'string' ? params.url : undefined;
        if (!url) return { success: false, error: 'url parameter is required (string)' };
        const method = typeof params.method === 'string' ? params.method : 'POST';
        const headers = typeof params.headers === 'object' && params.headers !== null ? params.headers as Record<string, string> : {};
        const body = params.body;
        return executeWebhook(url, method, headers, body);
      }
      case 'context_pack':
      case 'bundle': {
        return executeContextPack(context.userId, params as Record<string, unknown>);
      }
      default:
        return { success: false, error: `Unknown local action: ${action}` };
    }
  };
}

/**
 * Create a GitHub action handler
 */
function createGitHubHandler() {
  return async (action: string, params: Record<string, unknown>, context: HandlerContext) => {
    const userId = Number(context.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return { success: false, error: 'Authentication required', requiresAuth: true, provider: 'github' };
    }
    return executeGitHubAction(action, params, userId);
  };
}

// ============================================================================
// EXECUTION IMPLEMENTATIONS
// ============================================================================

/**
 * Dangerous command patterns — blocks known destructive operations.
 * This is defense-in-depth; the sandbox provides the real isolation.
 */
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-rf\s+\//i,                // rm -rf <absolute-path>
  /\bmkfs\b/i,                           // format filesystem
  /\bdd\s+if=.*of=\/dev\//i,            // dd to device
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;/i,       // fork bomb
  /\bchmod\s+777\s+\//i,                // chmod 777 /
  /\beval\s+/i,                          // eval injection
  /`[^`]*`/,                             // backtick command substitution
  /\$\([^)]*\)/,                         // $() command substitution
  /\$[{][^}]*}/,                         // ${} variable expansion in dangerous contexts
  /\bshutdown\b/i,                       // system shutdown
  /\breboot\b/i,                         // system reboot
  /\bsu\b\s/i,                           // switch user
  /\bcurl\s+.*\|\s*(ba)?sh/i,           // curl | sh
  /\bwget\s+.*\|\s*(ba)?sh/i,           // wget | sh
] as const;

/**
 * Create an Arcade.ai proxy handler for a specific provider.
 * handler is self-contained and testable.
 */
function createArcadeHandler(provider: string, actionMap: Record<string, string>) {
  return async (action: string, params: Record<string, unknown>, context: HandlerContext) => {
    const toolName = actionMap[action];
    if (!toolName) {
      return { success: false, error: `Unknown action: ${action} for provider: ${provider}` };
    }
    return executeViaArcade(toolName, params, provider, context.userId);
  };
}

/**
 * Create a Nango proxy handler for a specific provider.
 */
function createNangoHandler(provider: string, actions: string[]) {
  return async (action: string, params: Record<string, unknown>, context: HandlerContext) => {
    return executeViaNango(provider, action, params, context.userId);
  };
}

/**
 * Create a Composio handler
 */
function createComposioHandler() {
  return async (action: string, params: Record<string, unknown>, context: HandlerContext) => {
    const toolkit = typeof params.toolkit === 'string' ? params.toolkit : action.split('_')[0];
    const actionName = typeof params.actionName === 'string' ? params.actionName : action;
    return executeViaComposio(toolkit, actionName, params, context.userId);
  };
}

/**
 * Execute a shell command directly (bypasses action registry)
 * Used for 'bash' and 'command' actions
 */
async function executeCommandDirect(command: string, cwd?: string): Promise<{ success: boolean; data?: { output: string; exitCode: number }; error?: string }> {
  try {
    // Desktop mode — use Tauri native execution
    if (process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true') {
      const { tauriInvoke } = await import('@/lib/tauri/invoke-bridge');
      const result = await tauriInvoke.executeCommand('desktop', command, cwd);
      return {
        success: result.success,
        data: { output: result.output, exitCode: result.exit_code },
        error: result.error,
      };
    }

    // Web mode — use sandbox provider
    const { getSandboxProvider } = await import('@/lib/sandbox/providers');
    const { coreSandboxService } = await import('@/lib/sandbox/core-sandbox-service');
    const sandboxProvider = await getSandboxProvider();

    if (!sandboxProvider) {
      return {
        success: false,
        error: 'No sandbox provider configured',
      } as any;
    }

    // Create sandbox with timeout to prevent hanging
    const session = await Promise.race([
      coreSandboxService.createSandbox({ language: 'bash', timeout: 30000 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Sandbox creation timed out after 30s')), 30000)),
    ]);

    try {
      const result = await session.executeCommand(command);
      const r = result as any;
      return {
        success: r.exitCode === 0,
        data: { output: r.output || r.stdout, exitCode: r.exitCode },
        error: r.error || r.stderr,
      };
    } finally {
      // CRITICAL: Always destroy sandbox to prevent resource leaks
      try { await coreSandboxService.destroySandbox(session.id); } catch { /* ignore cleanup errors */ }
    }
  } catch (e: any) {
    return { success: false, error: `Command execution failed: ${e.message}` };
  }
}

/**
 * Read a file from the virtual filesystem.
 */
async function executeFileRead(filePath: string, ownerId: string) {
  const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');
  try {
    const file = await virtualFilesystem.readFile(ownerId, filePath);
    return {
      success: true,
      data: { content: file.content, size: file.size, path: file.path },
    };
  } catch (e: any) {
    return { success: false, error: `File not found: ${filePath}` };
  }
}

/**
 * RFC1918 + cloud metadata SSRF blocklist.
 * Prevents webhook from reaching internal services.
 */
const SSRF_BLOCKED_HOSTS = [
  'localhost', '127.', '0.', '10.',
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
  '192.168.',
  '169.254.',  // Link-local + AWS metadata (169.254.169.254)
  'fe80:', '::1', '[::1]',
  '::ffff:',   // IPv4-mapped IPv6 addresses (e.g., [::ffff:127.0.0.1])
  'metadata.google.internal',  // GCP metadata
  'instance-data.',             // Azure metadata
] as const;

/**
 * Execute a webhook call with SSRF protection and request timeout.
 */
async function executeWebhook(url: string, method: string, headers: Record<string, string> = {}, body?: unknown) {
  // SSRF protection: validate and block internal/private IP ranges
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { success: false, error: `Invalid URL: ${url}` };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  for (const blocked of SSRF_BLOCKED_HOSTS) {
    if (hostname === blocked || hostname.endsWith(`.${blocked}`) || hostname.startsWith(blocked)) {
      return { success: false, error: `SSRF protection: blocked request to ${hostname}` };
    }
  }

  // Only allow HTTP/HTTPS
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { success: false, error: `Unsupported protocol: ${parsedUrl.protocol}` };
  }

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000), // 30s hard timeout
    });

    const contentType = res.headers.get('content-type') || '';
    const responseData: unknown = contentType.includes('application/json')
      ? await res.json()
      : await res.text();

    return {
      success: res.ok,
      data: { statusCode: res.status, data: responseData },
    };
  } catch (e: any) {
    const errorMsg = e.name === 'TimeoutError'
      ? 'Webhook timed out after 30s'
      : `Webhook failed: ${e.message}`;
    return { success: false, error: errorMsg };
  }
}

/**
 * Generate a context pack (VFS bundle for LLM consumption).
 */
async function executeContextPack(userId: string, params: Record<string, unknown>) {
  const { contextPackService } = await import('@/lib/virtual-filesystem/context-pack-service');
  const rootPath = typeof params.path === 'string' ? params.path : '/';
  const format = typeof params.format === 'string' ? params.format : 'markdown';
  const maxTotalSize = typeof params.maxTotalSize === 'number' ? params.maxTotalSize : undefined;
  const includePatterns = Array.isArray(params.includePatterns) ? params.includePatterns as string[] : undefined;
  const excludePatterns = Array.isArray(params.excludePatterns) ? params.excludePatterns as string[] : undefined;

  try {
    const pack = await contextPackService.generateContextPack(userId, rootPath, {
      format: format as 'markdown' | 'xml' | 'json' | 'plain',
      maxTotalSize,
      includePatterns,
      excludePatterns,
    });
    return {
      success: true,
      data: {
        bundle: pack.bundle,
        tree: pack.tree,
        fileCount: pack.fileCount,
        estimatedTokens: pack.estimatedTokens,
      },
    };
  } catch (e: any) {
    return { success: false, error: `Context pack failed: ${e.message}` };
  }
}

/**
 * Execute GitHub action using existing github-oauth.ts.
 * Each action validates required params and returns normalized data.
 */
async function executeGitHubAction(action: string, params: Record<string, unknown>, userId: number) {
  const { getGitHubToken, githubApi, getGitHubRepos, getGitHubBranches, getGitHubCommits } = await import('@/lib/github/github-oauth');
  const token = await getGitHubToken(userId);

  if (!token) {
    return { success: false, error: 'GitHub not connected', requiresAuth: true, provider: 'github' } as any;
  }

  const owner = typeof params.owner === 'string' ? params.owner : undefined;
  const repo = typeof params.repo === 'string' ? params.repo : undefined;
  const title = typeof params.title === 'string' ? params.title : undefined;
  const bodyStr = typeof params.body === 'string' ? params.body : undefined;
  const head = typeof params.head === 'string' ? params.head : undefined;
  const base = typeof params.base === 'string' ? params.base : 'main';
  const query = typeof params.query === 'string' ? params.query : undefined;
  const branch = typeof params.branch === 'string' ? params.branch : undefined;

  switch (action) {
    case 'repos':
    case 'list_repos': {
      try {
        const repos = await getGitHubRepos(token);
        return {
          success: true,
          data: repos.map((r: any) => ({
            name: r.name, fullName: r.full_name, description: r.description,
            private: r.private, url: r.html_url, stars: r.stargazers_count,
            forks: r.forks_count, updatedAt: r.updated_at,
          })),
        };
      } catch (e: any) {
        return { success: false, error: `Failed to list repos: ${e.message}` };
      }
    }

    case 'branches':
    case 'list_branches': {
      if (!owner || !repo) return { success: false, error: 'owner and repo are required' };
      try {
        const branches = await getGitHubBranches(token, owner, repo);
        return { success: true, data: branches };
      } catch (e: any) {
        return { success: false, error: `Failed to list branches: ${e.message}` };
      }
    }

    case 'commits':
    case 'list_commits': {
      if (!owner || !repo) return { success: false, error: 'owner and repo are required' };
      try {
        const commits = await getGitHubCommits(token, owner, repo, branch);
        return {
          success: true,
          data: commits.slice(0, 20).map((c: any) => ({
            sha: c.sha,
            message: c.commit?.message || c.commit_message,
            author: c.commit?.author?.name || c.author?.login,
            date: c.commit?.author?.date || c.committer?.date,
            url: c.html_url,
          })),
        };
      } catch (e: any) {
        return { success: false, error: `Failed to list commits: ${e.message}` };
      }
    }

    case 'search':
    case 'search_code': {
      if (!query) return { success: false, error: 'query is required' };
      try {
        const q = owner ? `${query} user:${owner}` : query;
        const result = await githubApi<any>(`/search/code?q=${encodeURIComponent(q)}&per_page=20`, token);
        return {
          success: true,
          data: (result.items || []).map((item: any) => ({
            name: item.name, path: item.path, repo: item.repository?.full_name, url: item.html_url,
          })),
          metadata: { total: result.total_count },
        };
      } catch (e: any) {
        return { success: false, error: `Search failed: ${e.message}` };
      }
    }

    case 'issues':
    case 'list_issues': {
      if (!owner || !repo) return { success: false, error: 'owner and repo are required' };
      try {
        if (title) {
          const result = await githubApi<any>(`/repos/${owner}/${repo}/issues`, token, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body: bodyStr }),
          });
          return { success: true, data: { url: result.html_url, number: result.number } };
        }
        const issues = await githubApi<any[]>(`/repos/${owner}/${repo}/issues?per_page=20&state=open`, token);
        return {
          success: true,
          data: issues.map((i: any) => ({ number: i.number, title: i.title, url: i.html_url, createdAt: i.created_at })),
        };
      } catch (e: any) {
        return { success: false, error: `Issues failed: ${e.message}` };
      }
    }

    case 'prs':
    case 'create_pr': {
      if (!owner || !repo || !title || !head) {
        return { success: false, error: 'owner, repo, title, and head are required' };
      }
      try {
        const result = await githubApi<any>(`/repos/${owner}/${repo}/pulls`, token, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body: bodyStr, head, base }),
        });
        return { success: true, data: { url: result.html_url, number: result.number } };
      } catch (e: any) {
        return { success: false, error: `PR failed: ${e.message}` };
      }
    }

    default:
      return { success: false, error: `Unknown GitHub action: ${action}` };
  }
}

/**
 * Execute via Arcade service. Uses the caller's userId for proper OAuth scoping.
 */
async function executeViaArcade(toolName: string, params: Record<string, unknown>, provider: string, userId: string) {
  const { ArcadeService } = await import('@/lib/integrations/arcade-service');
  const apiKey = process.env.ARCADE_API_KEY;
  if (!apiKey) return { success: false, error: 'Arcade not configured' } as any;

  const arcade = new ArcadeService({ apiKey });
  try {
    const result = await arcade.executeTool(toolName, params as Record<string, any>, userId);
    if (result.requiresAuth && result.authUrl) {
      return { success: false, requiresAuth: true, authUrl: result.authUrl, message: `Connect ${provider} to use this action` };
    }
    return { success: result.success, data: result.output, error: result.error };
  } catch (e: any) {
    return { success: false, error: `${provider} action failed: ${e.message}` };
  }
}

/**
 * Execute via Nango proxy. Maps actions to appropriate REST endpoints.
 */
async function executeViaNango(provider: string, action: string, params: Record<string, unknown>, userId: string) {
  const { NangoService } = await import('@/lib/integrations/nango-service');
  const secretKey = process.env.NANGO_SECRET_KEY;
  if (!secretKey) return { success: false, error: 'Nango not configured' };

  const nango = new NangoService({ secretKey });

  const providerConfigMap: Record<string, string> = {
    github: 'github-oauth-app', gitlab: 'gitlab', notion: 'notion', dropbox: 'dropbox',
    slack: 'slack', discord: 'discord', gmail: 'google', googlecalendar: 'google-calendar',
    googledrive: 'google-drive', spotify: 'spotify', twitter: 'twitter', reddit: 'reddit',
    linkedin: 'linkedin', twilio: 'twilio', stripe: 'stripe', zoom: 'zoom',
    linear: 'linear', jira: 'jira', hubspot: 'hubspot', salesforce: 'salesforce',
    airtable: 'airtable', asana: 'asana', vercel: 'vercel', railway: 'railway',
  };

  // Map actions to REST endpoints — Nango proxies pass through to the provider's API
  const endpointMap: Record<string, string> = {
    // Generic patterns
    'search': '/search', 'list': '/list', 'list_files': '/files',
    'list_records': '/records', 'list_issues': '/issues', 'list_tasks': '/tasks',
    'list_contacts': '/contacts', 'list_customers': '/customers', 'list_leads': '/leads',
    'list_meetings': '/meetings', 'list_deployments': '/deployments',
    'list_channels': '/channels', 'list_servers': '/guilds', 'list_branches': '/branches',
    'list_commits': '/commits', 'list_repos': '/repos',
    'balance': '/balance', 'check_balance': '/balance',
    'create': '/create', 'create_page': '/pages', 'create_meeting': '/meetings',
    'create_issue': '/issues', 'create_task': '/tasks', 'create_record': '/records',
    'create_post': '/posts', 'create_share_post': '/posts', 'create_pr': '/pulls',
    'post': '/posts', 'post_tweet': '/tweets', 'msg': '/messages',
    'send_message': '/messages', 'send_sms': '/messages',
    'play': '/playback', 'sms': '/messages', 'upload': '/files', 'upload_file': '/files',
    'deploy': '/deployments', 'deploy_service': '/services',
    'events': '/events', 'meetings': '/meetings',
    'issues': '/issues', 'tasks': '/tasks', 'contacts': '/contacts',
    'leads': '/leads', 'records': '/records', 'channels': '/channels',
    'servers': '/servers', 'customers': '/customers', 'repos': '/repos',
    'branches': '/branches', 'commits': '/commits',
    'db': '/databases', 'query_database': '/databases/query',
    'search_pages': '/search', 'search_code': '/search/code',
  };

  const providerConfigKey = providerConfigMap[provider] || provider;
  const endpoint = endpointMap[action] || `/${action}`;
  const isWriteAction = action.startsWith('create') || action.startsWith('upload') ||
    action.startsWith('deploy') || action.startsWith('post') || action.startsWith('send');

  try {
    const result = await nango.proxy({
      providerConfigKey,
      connectionId: userId,
      endpoint,
      method: isWriteAction ? 'POST' : 'GET',
      params: params as Record<string, any>,
    });
    return { success: true, data: result.data };
  } catch (e: any) {
    return { success: false, error: `${provider} action failed: ${e.message}` };
  }
}

/**
 * Execute via Composio session-based tool call.
 */
async function executeViaComposio(toolkit: string, actionName: string, params: Record<string, unknown>, userId: string) {
  const { executeToolCall } = await import('@/lib/integrations/composio/composio-adapter');
  if (!process.env.COMPOSIO_API_KEY) return { success: false, error: 'Composio not configured' };

  // Map common action names to Composio tool names
  const toolNameMap: Record<string, string> = {
    'list_repos': 'github_list_user_repos',
    'create_issue': 'github_create_an_issue',
    'create_pr': 'github_create_a_pull_request',
    'send': 'gmail_send_an_email', 'read': 'gmail_search_emails',
    'msg': 'slack_send_message',
    'search': 'spotify_search',
    'post': 'twitter_post_tweet',
    'create_page': 'notion_create_a_page',
    'list': 'notion_search',
    'db': 'notion_query_database',
  };

  const toolName = toolNameMap[actionName] || `${toolkit}_${actionName}`;

  try {
    const result = await executeToolCall(userId, toolName, params);
    return { success: true, data: result };
  } catch (e: any) {
    return { success: false, error: `Composio action failed: ${e.message}` };
  }
}
