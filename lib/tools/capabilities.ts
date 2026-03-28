/**
 * Capability Layer - High-level tool capabilities
 *
 * Instead of exposing raw tools like:
 *   - filesystem.read_file
 *   - nullclaw_browse
 *   - blaxel_codegenSearch
 *
 * We expose semantic capabilities:
 *   - file.read
 *   - file.write
 *   - web.browse
 *   - repo.search
 *   - sandbox.execute
 *   - automation.discord
 *
 * Each capability can have multiple implementations (providers).
 * The router automatically selects the best one based on context.
 *
 * Tool Layer Stack:
 *   Agent → Capability Layer → Router → Tool Providers
 */

import { z } from 'zod';

// ============================================================================
// Capability Definitions
// ============================================================================

export type CapabilityCategory = 'file' | 'sandbox' | 'web' | 'repo' | 'memory' | 'automation';

export type ToolLatency = 'low' | 'medium' | 'high';
export type ToolCost = 'low' | 'medium' | 'high';

/**
 * Tool metadata for intelligent routing
 */
export interface ToolMetadata {
  /** Expected latency: low (<100ms), medium (100ms-1s), high (>1s) */
  latency?: ToolLatency;
  /** Relative cost: low (free/cheap), medium, high (expensive API calls) */
  cost?: ToolCost;
  /** Historical reliability score (0.0 - 1.0) */
  reliability?: number;
  /** Tags for additional filtering */
  tags?: string[];
}

export interface CapabilityDefinition {
  /** Unique capability identifier (e.g., 'file.read', 'web.browse') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category for grouping */
  category: CapabilityCategory;
  /** Detailed description */
  description: string;
  /** Input schema for capability */
  inputSchema: z.ZodSchema;
  /** Output schema for capability */
  outputSchema?: z.ZodSchema;
  /** Priority list of providers (first available is used) */
  providerPriority: string[];
  /** Whether this capability requires authentication */
  requiresAuth?: boolean;
  /** Tags for discovery */
  tags: string[];
  /** Tool metadata for intelligent routing (latency, cost, reliability) */
  metadata?: ToolMetadata;
  /** Required permissions for this capability */
  permissions?: string[];
}

// ============================================================================
// File Capabilities
// ============================================================================

export const FILE_READ_CAPABILITY: CapabilityDefinition = {
  id: 'file.read',
  name: 'Read File',
  category: 'file',
  description: 'Read contents of a file from the filesystem. Supports various encodings and can return raw content or parsed data.',
  inputSchema: z.object({
    path: z.string().describe('File path to read'),
    encoding: z.enum(['utf-8', 'base64', 'binary']).optional().default('utf-8'),
    maxBytes: z.number().optional().describe('Maximum bytes to read'),
  }),
  outputSchema: z.object({
    content: z.string(),
    encoding: z.string(),
    size: z.number(),
    exists: z.boolean(),
  }),
  providerPriority: ['mcp-filesystem', 'local-fs', 'vfs'],
  tags: ['file', 'read', 'filesystem', 'io'],
};

export const FILE_WRITE_CAPABILITY: CapabilityDefinition = {
  id: 'file.write',
  name: 'Write File',
  category: 'file',
  description: 'Write content to a file. Creates new file or overwrites existing. Supports atomic writes and backup.',
  inputSchema: z.object({
    path: z.string().describe('File path to write'),
    content: z.string().describe('Content to write'),
    encoding: z.enum(['utf-8', 'base64', 'binary']).optional().default('utf-8'),
    createDirs: z.boolean().optional().default(true),
    atomic: z.boolean().optional().default(false),
    append: z.boolean().optional().default(false).describe('Append to file instead of overwrite'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    path: z.string(),
    bytesWritten: z.number(),
  }),
  providerPriority: ['mcp-filesystem', 'local-fs', 'vfs'],
  tags: ['file', 'write', 'filesystem', 'io', 'create'],
};

export const FILE_APPEND_CAPABILITY: CapabilityDefinition = {
  id: 'file.append',
  name: 'Append File',
  category: 'file',
  description: 'Append content to an existing file. Creates file if it does not exist.',
  inputSchema: z.object({
    path: z.string().describe('File path to append to'),
    content: z.string().describe('Content to append'),
    encoding: z.enum(['utf-8', 'base64', 'binary']).optional().default('utf-8'),
    createDirs: z.boolean().optional().default(true),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    path: z.string(),
    bytesWritten: z.number(),
  }),
  providerPriority: ['mcp-filesystem', 'local-fs', 'vfs'],
  tags: ['file', 'append', 'filesystem', 'io'],
};

export const FILE_DELETE_CAPABILITY: CapabilityDefinition = {
  id: 'file.delete',
  name: 'Delete File',
  category: 'file',
  description: 'Delete a file or directory. Supports recursive deletion for directories.',
  inputSchema: z.object({
    path: z.string().describe('Path to delete'),
    recursive: z.boolean().optional().default(false),
    force: z.boolean().optional().default(false),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    path: z.string(),
  }),
  providerPriority: ['mcp-filesystem', 'local-fs', 'vfs'],
  tags: ['file', 'delete', 'filesystem', 'remove'],
};

export const FILE_LIST_CAPABILITY: CapabilityDefinition = {
  id: 'file.list',
  name: 'List Directory',
  category: 'file',
  description: 'List contents of a directory with optional filtering and sorting.',
  inputSchema: z.object({
    path: z.string().describe('Directory path to list'),
    pattern: z.string().optional().describe('Glob pattern to filter'),
    recursive: z.boolean().optional().default(false),
    includeHidden: z.boolean().optional().default(false),
  }),
  outputSchema: z.array(z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(['file', 'directory', 'symlink']),
    size: z.number().optional(),
    modified: z.string().optional(),
  })),
  providerPriority: ['mcp-filesystem', 'local-fs', 'vfs'],
  tags: ['file', 'list', 'directory', 'filesystem', 'ls'],
};

export const FILE_SEARCH_CAPABILITY: CapabilityDefinition = {
  id: 'file.search',
  name: 'Search Files',
  category: 'file',
  description: 'Search for files by name pattern, content, or metadata.',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    path: z.string().optional().describe('Root path to search'),
    type: z.enum(['name', 'content', 'both']).optional().default('name'),
    maxResults: z.number().optional().default(50),
  }),
  outputSchema: z.array(z.object({
    path: z.string(),
    matches: z.array(z.object({
      line: z.number(),
      content: z.string(),
    })).optional(),
  })),
  providerPriority: ['ripgrep', 'blaxel', 'local-fs'],
  tags: ['file', 'search', 'find', 'grep'],
};

// ============================================================================
// Sandbox Capabilities
// ============================================================================

export const SANDBOX_EXECUTE_CAPABILITY: CapabilityDefinition = {
  id: 'sandbox.execute',
  name: 'Execute Code',
  category: 'sandbox',
  description: 'Execute code in an isolated sandbox environment. Supports multiple languages and provides execution context.',
  inputSchema: z.object({
    code: z.string().describe('Code to execute'),
    language: z.enum(['javascript', 'typescript', 'python', 'bash', 'rust', 'go']).describe('Programming language'),
    timeout: z.number().optional().default(30000),
    context: z.object({
      dependencies: z.array(z.string()).optional(),
      envVars: z.record(z.string()).optional(),
      workingDir: z.string().optional(),
    }).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
    exitCode: z.number(),
    duration: z.number(),
  }),
  // Provider priority aligned with provider-router.ts profiles
  // Best for: code-interpreter, agent, ml-training
  providerPriority: [
    'opencode-v2',      // Local OpenCode (primary)
    'e2b',              // Best for code-interpreter, agent
    'daytona',          // Full-stack with LSP
    'codesandbox',      // Batch execution
    'blaxel',           // Agent support
    'microsandbox',     // Lightweight code execution
    'opensandbox',      // General code-interpreter
    'mistral',          // Code-interpreter
    'sprites',          // Persistent service
    'webcontainer',     // Frontend-focused
  ],
  tags: ['sandbox', 'execute', 'code', 'run', 'eval'],
};

export const SANDBOX_SHELL_CAPABILITY: CapabilityDefinition = {
  id: 'sandbox.shell',
  name: 'Run Shell Command',
  category: 'sandbox',
  description: 'Execute a shell command in the sandbox environment with full terminal access.',
  inputSchema: z.object({
    command: z.string().describe('Shell command to execute'),
    cwd: z.string().optional().describe('Working directory'),
    env: z.record(z.string()).optional().describe('Environment variables'),
    timeout: z.number().optional().default(60000),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
  }),
  // Provider priority aligned with provider-router.ts profiles
  // Best for: fullstack-app, computer-use, general
  providerPriority: [
    'opencode-v2',      // Local OpenCode (primary)
    'daytona',          // Best for fullstack, computer-use
    'e2b',              // Desktop support
    'sprites',          // Persistent with services
    'codesandbox',      // Full-stack support
    'microsandbox',     // General purpose
    'opensandbox',      // General purpose
    'mistral',          // General purpose
    'blaxel',           // Batch/agent
    'webcontainer',     // Limited shell
  ],
  tags: ['sandbox', 'shell', 'bash', 'terminal', 'exec'],
};

export const SANDBOX_SESSION_CAPABILITY: CapabilityDefinition = {
  id: 'sandbox.session',
  name: 'Manage Sandbox Session',
  category: 'sandbox',
  description: 'Create, manage, and destroy sandbox sessions for persistent working environments.',
  inputSchema: z.object({
    action: z.enum(['create', 'resume', 'pause', 'destroy', 'status']).describe('Session action'),
    sessionId: z.string().optional().describe('Session ID for resume/pause/destroy'),
    config: z.object({
      language: z.string().optional(),
      resources: z.object({ cpu: z.number(), memory: z.number() }).optional(),
      timeout: z.number().optional(),
    }).optional(),
  }),
  outputSchema: z.object({
    sessionId: z.string(),
    status: z.string(),
    created: z.boolean(),
  }),
  // Provider priority aligned with provider-router.ts profiles
  // Best for: persistent-service (sprites), full-stack (daytona, codesandbox)
  providerPriority: [
    'opencode-v2',      // Local OpenCode (primary)
    'sprites',          // Best for persistent-service, auto-suspend
    'codesandbox',      // Persistent with snapshots
    'daytona',          // Full-stack persistent
    'e2b',              // Agent sessions
    'blaxel',           // Agent support
    'opensandbox-nullclaw', // Agent support
    'microsandbox',     // Lightweight sessions
    'opensandbox',      // General sessions
    'mistral',          // General sessions
    'webcontainer',     // Browser-based sessions
  ],
  tags: ['sandbox', 'session', 'container', 'workspace'],
};

// ============================================================================
// Web Capabilities
// ============================================================================

export const WEB_BROWSE_CAPABILITY: CapabilityDefinition = {
  id: 'web.browse',
  name: 'Browse URL',
  category: 'web',
  description: 'Fetch and parse web pages. Supports JavaScript rendering, content extraction, and interaction.',
  inputSchema: z.object({
    url: z.string().describe('URL to browse'),
    action: z.enum(['fetch', 'extract', 'click', 'screenshot']).optional().default('fetch'),
    selector: z.string().optional().describe('CSS selector for content extraction'),
    waitFor: z.string().optional().describe('Wait for selector or timeout'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    content: z.string().optional(),
    title: z.string().optional(),
    url: z.string(),
    screenshot: z.string().optional(),
  }),
  providerPriority: ['nullclaw', 'mcp-browser', 'puppeteer'],
  tags: ['web', 'browse', 'scrape', 'fetch', 'http'],
};

export const WEB_SEARCH_CAPABILITY: CapabilityDefinition = {
  id: 'web.search',
  name: 'Web Search',
  category: 'web',
  description: 'Search the web for information using search engines.',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    engine: z.enum(['google', 'bing', 'ddg']).optional().default('ddg'),
    limit: z.number().optional().default(10),
  }),
  outputSchema: z.array(z.object({
    title: z.string(),
    url: z.string(),
    snippet: z.string(),
  })),
  providerPriority: ['nullclaw', 'mcp-search'],
  tags: ['web', 'search', 'google', 'find'],
};

// ============================================================================
// Repo Capabilities
// ============================================================================

export const REPO_SEARCH_CAPABILITY: CapabilityDefinition = {
  id: 'repo.search',
  name: 'Search Repository',
  category: 'repo',
  description: 'Search codebase using multiple methods: text search (ripgrep), semantic search (embeddings), or tool-based search (blaxel).',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    path: z.string().optional().describe('Path to search in'),
    method: z.enum(['text', 'semantic', 'tool', 'auto']).optional().default('auto'),
    type: z.enum(['file', 'code', 'docs', 'all']).optional().default('all'),
    limit: z.number().optional().default(20),
  }),
  outputSchema: z.array(z.object({
    path: z.string(),
    line: z.number().optional(),
    content: z.string(),
    score: z.number().optional(),
    type: z.enum(['file', 'function', 'class', 'text']),
  })),
  providerPriority: ['blaxel', 'ripgrep', 'embedding-search', 'local-fs'],
  tags: ['repo', 'search', 'grep', 'semantic', 'code-search'],
};

export const REPO_GIT_CAPABILITY: CapabilityDefinition = {
  id: 'repo.git',
  name: 'Git Operations',
  category: 'repo',
  description: 'Perform Git operations: commit, push, pull, branch, status, diff, etc.',
  inputSchema: z.object({
    command: z.enum(['status', 'diff', 'commit', 'push', 'pull', 'branch', 'log', 'stash']).describe('Git command'),
    args: z.record(z.union([z.string(), z.array(z.string())])).optional(),
    message: z.string().optional().describe('Commit message'),
    files: z.array(z.string()).optional().describe('Files to stage'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
  }),
  providerPriority: ['opencode-v2', 'git-helper', 'local-fs'],
  tags: ['repo', 'git', 'version-control', 'commit'],
};

export const REPO_CLONE_CAPABILITY: CapabilityDefinition = {
  id: 'repo.clone',
  name: 'Clone Repository',
  category: 'repo',
  description: 'Clone a Git repository into the workspace.',
  inputSchema: z.object({
    url: z.string().describe('Repository URL'),
    path: z.string().optional().describe('Destination path'),
    username: z.string().optional().describe('Username for auth'),
    password: z.string().optional().describe('Password/token for auth'),
    branch: z.string().optional().describe('Branch to checkout'),
    depth: z.number().optional().describe('Clone depth (shallow)'),
    recursive: z.boolean().optional().default(false).describe('Clone submodules'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    path: z.string(),
    error: z.string().optional(),
  }),
  providerPriority: ['git-helper', 'opencode-v2'],
  tags: ['repo', 'git', 'clone', 'clone'],
};

export const REPO_COMMIT_CAPABILITY: CapabilityDefinition = {
  id: 'repo.commit',
  name: 'Git Commit',
  category: 'repo',
  description: 'Commit changes to the repository.',
  inputSchema: z.object({
    message: z.string().describe('Commit message'),
    authorName: z.string().optional().describe('Author name'),
    authorEmail: z.string().optional().describe('Author email'),
    files: z.array(z.string()).optional().describe('Files to commit'),
    cwd: z.string().optional().describe('Working directory'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    hash: z.string().optional(),
    error: z.string().optional(),
  }),
  providerPriority: ['git-helper', 'opencode-v2'],
  tags: ['repo', 'git', 'commit'],
};

export const REPO_PUSH_CAPABILITY: CapabilityDefinition = {
  id: 'repo.push',
  name: 'Git Push',
  category: 'repo',
  description: 'Push commits to remote repository.',
  inputSchema: z.object({
    remote: z.string().optional().default('origin').describe('Remote name'),
    branch: z.string().optional().describe('Branch name'),
    username: z.string().optional().describe('Username for auth'),
    password: z.string().optional().describe('Password/token for auth'),
    force: z.boolean().optional().default(false).describe('Force push'),
    cwd: z.string().optional().describe('Working directory'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    error: z.string().optional(),
  }),
  providerPriority: ['git-helper', 'opencode-v2'],
  tags: ['repo', 'git', 'push'],
};

export const REPO_PULL_CAPABILITY: CapabilityDefinition = {
  id: 'repo.pull',
  name: 'Git Pull',
  category: 'repo',
  description: 'Pull changes from remote repository.',
  inputSchema: z.object({
    cwd: z.string().optional().describe('Working directory'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  providerPriority: ['git-helper', 'opencode-v2'],
  tags: ['repo', 'git', 'pull'],
};

export const REPO_SEMANTIC_SEARCH_CAPABILITY: CapabilityDefinition = {
  id: 'repo.semantic-search',
  name: 'Semantic Code Search',
  category: 'repo',
  description: 'Search codebase using semantic similarity (embeddings-based).',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    path: z.string().optional().describe('Path to search in'),
    limit: z.number().optional().default(10),
    similarityThreshold: z.number().optional().describe('Minimum similarity score'),
  }),
  outputSchema: z.array(z.object({
    content: z.string(),
    score: z.number(),
    source: z.string().optional(),
  })),
  providerPriority: ['embedding-search', 'blaxel'],
  tags: ['repo', 'search', 'semantic', 'embedding', 'ai-search'],
};

export const WORKSPACE_GET_CHANGES_CAPABILITY: CapabilityDefinition = {
  id: 'workspace.getChanges',
  name: 'Get Workspace Changes',
  category: 'memory',
  description: 'Get git-style diffs for client sync after agent execution. Returns file changes with unified diff format.',
  inputSchema: z.object({
    maxFiles: z.number().optional().default(50).describe('Maximum number of files to return'),
    ownerId: z.string().optional().describe('Owner/user ID (defaults to context)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    ownerId: z.string(),
    count: z.number(),
    files: z.array(z.object({
      path: z.string(),
      diff: z.string(),
      changeType: z.enum(['create', 'update', 'delete']),
    })),
  }),
  providerPriority: ['vfs'],
  tags: ['workspace', 'changes', 'diff', 'sync', 'client'],
};

export const PROJECT_BUNDLE_CAPABILITY: CapabilityDefinition = {
  id: 'project.bundle',
  name: 'Bundle Project',
  category: 'memory',
  description: 'Generate a project context bundle (like Repomix) for LLM consumption.',
  inputSchema: z.object({
    path: z.string().optional().describe('Project path'),
    format: z.enum(['markdown', 'xml', 'json', 'plain']).optional().default('markdown'),
    maxFileSize: z.number().optional().describe('Max file size in bytes'),
    maxTotalSize: z.number().optional().describe('Max total bundle size'),
    includePatterns: z.array(z.string()).optional().describe('File patterns to include'),
    excludePatterns: z.array(z.string()).optional().describe('File patterns to exclude'),
    includeContents: z.boolean().optional().default(true),
    includeTree: z.boolean().optional().default(true),
    maxLinesPerFile: z.number().optional(),
    lineNumbers: z.boolean().optional().default(false),
  }),
  outputSchema: z.object({
    bundle: z.string(),
    tree: z.string(),
    files: z.array(z.any()),
    fileCount: z.number(),
    estimatedTokens: z.number(),
    totalSize: z.number(),
    format: z.string(),
    hasTruncation: z.boolean(),
    warnings: z.array(z.string()),
  }),
  providerPriority: ['context-pack', 'vfs'],
  tags: ['project', 'bundle', 'context', 'repomix', 'export'],
};

export const REPO_ANALYZE_CAPABILITY: CapabilityDefinition = {
  id: 'repo.analyze',
  name: 'Analyze Repository',
  category: 'repo',
  description: 'Analyze repository structure, dependencies, and code quality.',
  inputSchema: z.object({
    path: z.string().describe('Repository path'),
    depth: z.number().optional().default(3),
    includeStats: z.boolean().optional().default(true),
  }),
  outputSchema: z.object({
    languageBreakdown: z.record(z.number()),
    fileCount: z.number(),
    complexity: z.number(),
    dependencies: z.array(z.object({
      name: z.string(),
      version: z.string(),
    })),
  }),
  providerPriority: ['blaxel', 'local-fs'],
  tags: ['repo', 'analyze', 'stats', 'dependencies'],
};

// ============================================================================
// Memory Capabilities
// ============================================================================

export const MEMORY_STORE_CAPABILITY: CapabilityDefinition = {
  id: 'memory.store',
  name: 'Store Memory',
  category: 'memory',
  description: 'Store information in persistent memory for later retrieval.',
  inputSchema: z.object({
    key: z.string().describe('Memory key'),
    value: z.any().describe('Value to store'),
    ttl: z.number().optional().describe('Time to live in seconds'),
    namespace: z.string().optional().default('default'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    key: z.string(),
  }),
  providerPriority: ['context-pack', 'memory-service', 'vfs'],
  tags: ['memory', 'store', 'cache', 'persist'],
};

export const MEMORY_RETRIEVE_CAPABILITY: CapabilityDefinition = {
  id: 'memory.retrieve',
  name: 'Retrieve Memory',
  category: 'memory',
  description: 'Retrieve stored information from memory by key or search.',
  inputSchema: z.object({
    key: z.string().optional().describe('Memory key'),
    query: z.string().optional().describe('Search query'),
    namespace: z.string().optional().default('default'),
    limit: z.number().optional().default(10),
  }),
  outputSchema: z.array(z.object({
    key: z.string(),
    value: z.any(),
    score: z.number().optional(),
    timestamp: z.string(),
  })),
  providerPriority: ['context-pack', 'memory-service', 'vfs'],
  tags: ['memory', 'retrieve', 'search', 'recall'],
};

// ============================================================================
// Automation Capabilities
// ============================================================================

export const AUTOMATION_DISCORD_CAPABILITY: CapabilityDefinition = {
  id: 'automation.discord',
  name: 'Discord Automation',
  category: 'automation',
  description: 'Send messages, manage channels, and interact with Discord API.',
  inputSchema: z.object({
    action: z.enum(['send-message', 'send-embed', 'create-channel', 'get-channel', 'list-channels']).describe('Discord action'),
    channelId: z.string().optional().describe('Channel ID'),
    message: z.string().optional().describe('Message content'),
    embed: z.object({
      title: z.string(),
      description: z.string(),
      color: z.number().optional(),
      fields: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    }).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.string().optional(),
    channelId: z.string().optional(),
  }),
  providerPriority: ['nullclaw'],
  requiresAuth: true,
  tags: ['automation', 'discord', 'messaging', 'social'],
};

export const AUTOMATION_TELEGRAM_CAPABILITY: CapabilityDefinition = {
  id: 'automation.telegram',
  name: 'Telegram Automation',
  category: 'automation',
  description: 'Send messages, manage bots, and interact with Telegram API.',
  inputSchema: z.object({
    action: z.enum(['send-message', 'send-photo', 'send-document', 'get-chat', 'set-webhook']).describe('Telegram action'),
    chatId: z.string().optional().describe('Chat ID'),
    message: z.string().optional().describe('Message content'),
    photo: z.string().optional().describe('Photo URL or base64'),
    document: z.string().optional().describe('Document URL or base64'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.string().optional(),
    chatId: z.string().optional(),
  }),
  providerPriority: ['nullclaw'],
  requiresAuth: true,
  tags: ['automation', 'telegram', 'messaging', 'social'],
};

export const AUTOMATION_WORKFLOW_CAPABILITY: CapabilityDefinition = {
  id: 'automation.workflow',
  name: 'Workflow Automation',
  category: 'automation',
  description: 'Execute automated workflows, scheduled tasks, and custom automation chains.',
  inputSchema: z.object({
    workflow: z.string().describe('Workflow name or ID'),
    trigger: z.enum(['manual', 'scheduled', 'webhook', 'event']).optional().default('manual'),
    params: z.record(z.any()).optional(),
    schedule: z.string().optional().describe('Cron expression for scheduled triggers'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    workflowId: z.string(),
    runId: z.string().optional(),
    status: z.string(),
  }),
  providerPriority: ['nullclaw', 'n8n', 'custom'],
  tags: ['automation', 'workflow', 'schedule', 'pipeline'],
};

// ============================================================================
// OAuth Integration Capabilities (Nango/Composio/Arcade)
// DEPRECATED: Use toolAuthManager from lib/services/tool-authorization-manager.ts
// or oauthIntegration from lib/oauth/index.ts instead.
// ============================================================================

/**
 * @deprecated Use `toolAuthManager.initiateConnection()` from `lib/services/tool-authorization-manager.ts`
 * or `oauthIntegration.connect()` from `lib/oauth/index.ts` instead.
 * 
 * Migration guide:
 * ```typescript
 * // Old
 * await executeCapability('integration.connect', { provider: 'gmail', userId }, context);
 * 
 * // New
 * import { toolAuthManager } from '@/lib/tools/tool-authorization-manager';
 * const result = await toolAuthManager.initiateConnection(userId, 'gmail');
 * ```
 */
export const INTEGRATION_CONNECT_CAPABILITY: CapabilityDefinition = {
  id: 'integration.connect',
  name: 'Connect Third-Party Service',
  category: 'automation',
  description: 'DEPRECATED: Use toolAuthManager.initiateConnection() instead. Initiate OAuth connection to third-party services (Google, GitHub, Slack, etc.) via Nango, Composio, or Arcade. Returns authorization URL for user consent.',
  inputSchema: z.object({
    provider: z.string().describe('Provider config key (e.g., "gmail", "github", "slack", "notion")'),
    userId: z.string().describe('User identifier'),
    redirectUrl: z.string().optional().describe('Redirect URL after authorization'),
    scopes: z.array(z.string()).optional().describe('OAuth scopes to request'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    authUrl: z.string().optional(),
    connectionId: z.string().optional(),
    provider: z.string(),
    requiresAuth: z.boolean(),
  }),
  providerPriority: ['composio', 'arcade', 'nango'],
  requiresAuth: false, // Connection initiation doesn't require OAuth, but using the tool does
  tags: ['integration', 'oauth', 'connection', 'auth', 'nango', 'composio', 'arcade', 'deprecated'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
  permissions: ['oauth:connect'],
};

/**
 * @deprecated Use `toolAuthManager.listConnections()` from `lib/services/tool-authorization-manager.ts`
 * or `oauthIntegration.listConnections()` from `lib/oauth/index.ts` instead.
 * 
 * Migration guide:
 * ```typescript
 * // Old
 * await executeCapability('integration.list_connections', { userId }, context);
 * 
 * // New
 * import { toolAuthManager } from '@/lib/tools/tool-authorization-manager';
 * const result = await toolAuthManager.listConnections(userId);
 * ```
 */
export const INTEGRATION_LIST_CONNECTIONS_CAPABILITY: CapabilityDefinition = {
  id: 'integration.list_connections',
  name: 'List User Connections',
  category: 'automation',
  description: 'DEPRECATED: Use toolAuthManager.listConnections() instead. List all active OAuth connections for a user across providers (Nango, Composio, Arcade).',
  inputSchema: z.object({
    userId: z.string().describe('User identifier'),
    provider: z.string().optional().describe('Filter by provider (optional)'),
  }),
  outputSchema: z.array(z.object({
    id: z.string(),
    provider: z.string(),
    providerConfigKey: z.string(),
    connectionId: z.string(),
    status: z.enum(['active', 'inactive', 'expired']),
    createdAt: z.string(),
    scopes: z.array(z.string()).optional(),
  })),
  providerPriority: ['composio', 'arcade', 'nango'],
  requiresAuth: true,
  tags: ['integration', 'connections', 'oauth', 'list', 'nango', 'composio', 'arcade', 'deprecated'],
};

/**
 * @deprecated Use `toolAuthManager.revokeConnection()` from `lib/services/tool-authorization-manager.ts`
 * or `oauthIntegration.revoke()` from `lib/oauth/index.ts` instead.
 */
export const INTEGRATION_REVOKE_CAPABILITY: CapabilityDefinition = {
  id: 'integration.revoke',
  name: 'Revoke Connection',
  category: 'automation',
  description: 'DEPRECATED: Use toolAuthManager.revokeConnection() instead. Revoke OAuth connection to a third-party service.',
  inputSchema: z.object({
    provider: z.string().describe('Provider config key'),
    userId: z.string().describe('User identifier'),
    connectionId: z.string().optional().describe('Specific connection ID to revoke'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    provider: z.string(),
    revoked: z.boolean(),
  }),
  providerPriority: ['composio', 'arcade', 'nango'],
  requiresAuth: true,
  tags: ['integration', 'revoke', 'disconnect', 'oauth', 'nango', 'composio', 'arcade', 'deprecated'],
};

/**
 * @deprecated Tool execution is handled via existing tool execution flow.
 * Use `toolContextManager.processToolRequest()` or `getToolManager().executeTool()` instead.
 */
export const INTEGRATION_EXECUTE_CAPABILITY: CapabilityDefinition = {
  id: 'integration.execute',
  name: 'Execute Third-Party Tool',
  category: 'automation',
  description: 'DEPRECATED: Use toolContextManager.processToolRequest() or getToolManager().executeTool() instead. Execute a tool/action from a connected third-party service (send email, create issue, post message, etc.). Handles OAuth token refresh automatically.',
  inputSchema: z.object({
    provider: z.string().describe('Provider config key (e.g., "gmail", "github", "slack")'),
    action: z.string().describe('Tool/action name (e.g., "send_email", "create_issue", "post_message")'),
    userId: z.string().describe('User identifier'),
    params: z.record(z.any()).describe('Action-specific parameters'),
    connectionId: z.string().optional().describe('Existing connection ID (optional, will use default)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.any().optional(),
    error: z.string().optional(),
    requiresAuth: z.boolean().optional(),
    authUrl: z.string().optional(),
    connectionId: z.string().optional(),
  }),
  providerPriority: ['composio', 'arcade', 'nango'],
  requiresAuth: true,
  tags: ['integration', 'tool', 'execution', 'oauth', 'nango', 'composio', 'arcade', 'deprecated'],
};

/**
 * @deprecated Use `toolAuthManager.getAvailableTools()` or direct provider SDK calls instead.
 */
export const INTEGRATION_SEARCH_TOOLS_CAPABILITY: CapabilityDefinition = {
  id: 'integration.search_tools',
  name: 'Search Available Tools',
  category: 'automation',
  description: 'DEPRECATED: Use toolAuthManager.getAvailableTools() or direct provider SDK calls instead. Search available tools across all integration providers (Nango, Composio, Arcade) by query, category, or provider.',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    provider: z.string().optional().describe('Filter by provider (nango, composio, arcade)'),
    category: z.string().optional().describe('Filter by category (e.g., "crm", "email", "productivity")'),
    requiresAuth: z.boolean().optional().describe('Filter by auth requirement'),
    limit: z.number().optional().default(20),
  }),
  outputSchema: z.array(z.object({
    name: z.string(),
    description: z.string(),
    provider: z.string(),
    toolkit: z.string().optional(),
    requiresAuth: z.boolean(),
    inputSchema: z.object({}).optional(),
    examples: z.array(z.string()).optional(),
  })),
  providerPriority: ['composio', 'arcade', 'nango'],
  requiresAuth: false,
  tags: ['integration', 'search', 'tools', 'discovery', 'nango', 'composio', 'arcade', 'deprecated'],
};

/**
 * @deprecated Use direct provider SDK calls (Nango proxy, Arcade execute) instead.
 */
export const INTEGRATION_PROXY_CAPABILITY: CapabilityDefinition = {
  id: 'integration.proxy',
  name: 'Proxy API Request',
  category: 'automation',
  description: 'DEPRECATED: Use direct provider SDK calls instead. Make authenticated API requests to third-party services via Nango/Arcade proxy. Handles OAuth token injection automatically.',
  inputSchema: z.object({
    provider: z.string().describe('Provider config key'),
    userId: z.string().describe('User identifier'),
    endpoint: z.string().describe('API endpoint (e.g., "/users", "/repos/{owner}/{repo}")'),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().default('GET'),
    headers: z.record(z.string()).optional().describe('Custom headers'),
    params: z.record(z.any()).optional().describe('Query parameters'),
    data: z.any().optional().describe('Request body'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    status: z.number().optional(),
    data: z.any().optional(),
    headers: z.record(z.string()).optional(),
    error: z.string().optional(),
  }),
  providerPriority: ['nango', 'arcade'],
  requiresAuth: true,
  tags: ['integration', 'proxy', 'api', 'http', 'nango', 'arcade', 'deprecated'],
};

export const BASH_CAPABILITY: CapabilityDefinition = {
  id: 'bash.execute',
  name: 'Bash Command Execution',
  category: 'sandbox',
  description: 'Execute bash commands in sandboxed environment with automatic error recovery (self-healing)',
  inputSchema: z.object({
    command: z.string().describe('Bash command to execute (e.g., "cat file.txt | grep pattern")'),
    cwd: z.string().optional().describe('Working directory (relative to workspace root)'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
    enableHealing: z.boolean().optional().default(true).describe('Enable automatic error recovery'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
    duration: z.number(),
    attempts: z.number().optional(),
    fixesApplied: z.array(z.object({
      attempt: z.number(),
      original: z.string(),
      fixed: z.string(),
    })).optional(),
  }),
  providerPriority: ['bash', 'sandbox'],
  tags: ['bash', 'shell', 'command', 'execute', 'self-healing'],
};

// ============================================================================
// Export All Capabilities
// ============================================================================

export const ALL_CAPABILITIES: CapabilityDefinition[] = [
  // File
  FILE_READ_CAPABILITY,
  FILE_WRITE_CAPABILITY,
  FILE_APPEND_CAPABILITY,
  FILE_DELETE_CAPABILITY,
  FILE_LIST_CAPABILITY,
  FILE_SEARCH_CAPABILITY,
  // Sandbox
  SANDBOX_EXECUTE_CAPABILITY,
  SANDBOX_SHELL_CAPABILITY,
  SANDBOX_SESSION_CAPABILITY,
  BASH_CAPABILITY,
  // Web
  WEB_BROWSE_CAPABILITY,
  WEB_SEARCH_CAPABILITY,
  // Repo
  REPO_SEARCH_CAPABILITY,
  REPO_GIT_CAPABILITY,
  REPO_CLONE_CAPABILITY,
  REPO_COMMIT_CAPABILITY,
  REPO_PUSH_CAPABILITY,
  REPO_PULL_CAPABILITY,
  REPO_SEMANTIC_SEARCH_CAPABILITY,
  REPO_ANALYZE_CAPABILITY,
  // Memory
  MEMORY_STORE_CAPABILITY,
  MEMORY_RETRIEVE_CAPABILITY,
  PROJECT_BUNDLE_CAPABILITY,
  WORKSPACE_GET_CHANGES_CAPABILITY,
  // Automation
  AUTOMATION_DISCORD_CAPABILITY,
  AUTOMATION_TELEGRAM_CAPABILITY,
  AUTOMATION_WORKFLOW_CAPABILITY,
  // OAuth Integration (Nango/Composio/Arcade)
  INTEGRATION_CONNECT_CAPABILITY,
  INTEGRATION_EXECUTE_CAPABILITY,
  INTEGRATION_LIST_CONNECTIONS_CAPABILITY,
  INTEGRATION_REVOKE_CAPABILITY,
  INTEGRATION_SEARCH_TOOLS_CAPABILITY,
  INTEGRATION_PROXY_CAPABILITY,
];

// ============================================================================
// Capability Lookup
// ============================================================================

export const CAPABILITY_BY_ID = new Map<string, CapabilityDefinition>(
  ALL_CAPABILITIES.map(cap => [cap.id, cap])
);

export const CAPABILITIES_BY_CATEGORY = new Map<CapabilityCategory, CapabilityDefinition[]>(
  (['file', 'sandbox', 'web', 'repo', 'memory', 'automation'] as CapabilityCategory[]).map(
    cat => [cat, ALL_CAPABILITIES.filter(c => c.category === cat)]
  )
);

/**
 * Get capability definition by ID
 */
export function getCapability(id: string): CapabilityDefinition | undefined {
  return CAPABILITY_BY_ID.get(id);
}

/**
 * Get all capabilities in a category
 */
export function getCapabilitiesByCategory(category: CapabilityCategory): CapabilityDefinition[] {
  return CAPABILITIES_BY_CATEGORY.get(category) || [];
}

/**
 * Search capabilities by tags
 */
export function searchCapabilities(query: string): CapabilityDefinition[] {
  const lowerQuery = query.toLowerCase();
  return ALL_CAPABILITIES.filter(cap =>
    cap.name.toLowerCase().includes(lowerQuery) ||
    cap.description.toLowerCase().includes(lowerQuery) ||
    cap.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
}