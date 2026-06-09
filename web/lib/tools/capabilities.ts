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

export type CapabilityCategory = 'file' | 'sandbox' | 'web' | 'repo' | 'memory' | 'automation' | 'desktop';

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
  providerPriority: Array<string>;
  /** Whether this capability requires authentication */
  requiresAuth?: boolean;
  /** Tags for discovery */
  tags: string[];
  /** Tool metadata for intelligent routing (latency, cost, reliability) */
  metadata?: ToolMetadata;
  /** Required permissions for this capability */
  permissions?: string[];
}

// ─── Provider ID Constants (type-safe alternatives to string literals) ──────
// Re-exported from router.ts which owns the canonical ProviderId enum.
// Using these constants prevents typos that silently fail at runtime.
export { ProviderId } from './router';

/**
 * Provider ID string literals for use in capability definitions.
 * Type-checked against ProviderId enum.
 */
export const PROVIDER = {
  VFS: 'vfs' as const,
  LOCAL_FS: 'local-fs' as const,
  MCP_FILESYSTEM: 'mcp-filesystem' as const,
  OPENCODE_V2: 'opencode-v2' as const,
  NULLCLAW: 'nullclaw' as const,
  BLAXEL: 'blaxel' as const,
  MEMORY_SERVICE: 'memory-service' as const,
  RIPGREP: 'ripgrep' as const,
  CONTEXT_PACK: 'context-pack' as const,
  EMBEDDING_SEARCH: 'embedding-search' as const,
  GIT_HELPER: 'git-helper' as const,
  OAUTH_INTEGRATION: 'oauth-integration' as const,
  TERMINAL: 'terminal' as const,
  PROJECT_ANALYSIS: 'workspace-analysis' as const,
  WORKSPACE_GRAPH: 'workspace-graph' as const,
} as const;

export type ProviderIdString = typeof PROVIDER[keyof typeof PROVIDER];

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


// ============================================================================
// Sandbox Capabilities
// ============================================================================

export const SANDBOX_EXECUTE_CAPABILITY: CapabilityDefinition = {
  id: 'sandbox.execute',
  name: 'Execute Code',
  category: 'sandbox',
  description: 'Execute code in an isolated sandbox environment. Supports multiple languages with args, stdin, and execution context (dependencies, env vars, working dir). Replaces the deprecated code.run.',
  inputSchema: z.object({
    code: z.string().describe('Code to execute'),
    language: z.enum(['javascript', 'typescript', 'python', 'bash', 'rust', 'go', 'java', 'r', 'cpp']).describe('Programming language'),
    args: z.array(z.string()).optional().describe('Command-line arguments'),
    stdin: z.string().optional().describe('Standard input'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
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
  providerPriority: ['nullclaw'],
  tags: ['web', 'search', 'google', 'find'],
};

export const WEB_FETCH_CAPABILITY: CapabilityDefinition = {
  id: 'web.fetch',
  name: 'Web Fetch',
  category: 'web',
  description: 'Fetch content from a URL. Lightweight alternative to web.browse — no JS rendering, just raw content extraction.',
  inputSchema: z.object({
    url: z.string().describe('URL to fetch'),
    maxChars: z.number().optional().default(8000).describe('Max characters to return'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    content: z.string().optional(),
    url: z.string(),
    statusCode: z.number().optional(),
    contentType: z.string().optional(),
  }),
  providerPriority: ['native', 'nullclaw'],
  tags: ['web', 'fetch', 'http', 'url', 'content'],
  metadata: {
    latency: 'low',
    cost: 'low',
  },
};

// ============================================================================
// Repo Capabilities
// ============================================================================

export const REPO_SEARCH_CAPABILITY: CapabilityDefinition = {
  id: 'repo.search',
  name: 'Search Repository',
  category: 'repo',
  description: 'Search codebase using multiple methods: text search (ripgrep), semantic search (embeddings), or tool-based search (blaxel). Replaces the deprecated file.search and repo.semantic-search — use method=auto for automatic routing.',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    path: z.string().optional().describe('Path to search in'),
    method: z.enum(['text', 'semantic', 'tool', 'auto']).optional().default('auto'),
    type: z.enum(['file', 'code', 'docs', 'all']).optional().default('all'),
    limit: z.number().optional().default(20),
    similarityThreshold: z.number().optional().describe('Minimum similarity score (0-1). Only used with method "semantic".'),
  }),
  outputSchema: z.array(z.object({
    path: z.string(),
    line: z.number().optional(),
    content: z.string(),
    score: z.number().optional(),
    type: z.enum(['file', 'function', 'class', 'text']),
  })),
  providerPriority: ['ripgrep', 'blaxel', 'embedding-search', 'local-fs'],
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
  id: 'workspace.bundle',
  name: 'Bundle Workspace',
  category: 'memory',
  description: 'Generate a workspace context bundle (like Repomix) for LLM consumption.',
  inputSchema: z.object({
    path: z.string().optional().describe('Workspace path'),
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
  tags: ['workspace', 'bundle', 'context', 'repomix', 'export'],
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

export const BASH_CAPABILITY: CapabilityDefinition = {
  id: 'bash.execute',
  name: 'Bash Command Execution',
  category: 'sandbox',
  description: 'Execute bash commands in sandboxed environment with automatic error recovery (self-healing). Replaces the deprecated sandbox.shell — includes env vars support.',
  inputSchema: z.object({
    command: z.string().describe('Bash command to execute (e.g., "cat file.txt | grep pattern")'),
    cwd: z.string().optional().describe('Working directory (relative to workspace root)'),
    env: z.record(z.string()).optional().describe('Environment variables'),
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

export const SCHEDULE_TASK_CAPABILITY: CapabilityDefinition = {
  id: 'task.schedule',
  name: 'Schedule Background Task',
  category: 'automation',
  description: 'Schedule background tasks for later execution. Supports cron scheduling, delayed execution, or immediate execution. Tasks are processed by the event worker and can trigger webhooks, run sandbox commands, send emails, or trigger agent tasks.',
  inputSchema: z.object({
    taskType: z.enum(['HACKER_NEWS_DAILY', 'RESEARCH_TASK', 'REPO_DIGEST', 'SEND_EMAIL', 'WEBHOOK', 'SANDBOX_COMMAND', 'NULLCLAW_AGENT', 'CUSTOM_DAG']).describe('Type of background task'),
    schedule: z.object({
      type: z.enum(['cron', 'delay', 'immediate']).describe('Scheduling type'),
      expression: z.string().optional().describe('Cron expression (e.g., "*/5 * * * *")'),
      delayMs: z.number().optional().describe('Delay in milliseconds'),
    }).describe('When to execute'),
    payload: z.record(z.any()).describe('Task-specific payload'),
    metadata: z.object({
      name: z.string().optional(),
      priority: z.enum(['low', 'normal', 'high']).optional(),
      maxRetries: z.number().optional(),
      timeout: z.number().optional(),
    }).optional(),
    userId: z.string().describe('User identifier'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    taskId: z.string(),
    status: z.enum(['scheduled', 'delayed', 'immediate']),
    taskType: z.string(),
    scheduledFor: z.string().optional(),
    error: z.string().optional(),
  }),
  providerPriority: ['events', 'trigger-dev', 'custom'],
  tags: ['task', 'schedule', 'background', 'cron', 'event', 'automation'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.95,
  },
};

export const TASK_STATUS_CAPABILITY: CapabilityDefinition = {
  id: 'task.status',
  name: 'Get Task Status',
  category: 'automation',
  description: 'Get the status of a scheduled background task by its ID.',
  inputSchema: z.object({
    taskId: z.string().describe('Task ID returned from task.schedule'),
  }),
  outputSchema: z.object({
    exists: z.boolean(),
    status: z.string().optional(),
    type: z.string().optional(),
    createdAt: z.number().optional(),
    processedAt: z.number().optional(),
    error: z.string().optional(),
  }),
  providerPriority: ['events', 'trigger-dev', 'custom'],
  tags: ['task', 'status', 'background', 'check'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
};

export const TASK_CANCEL_CAPABILITY: CapabilityDefinition = {
  id: 'task.cancel',
  name: 'Cancel Scheduled Task',
  category: 'automation',
  description: 'Cancel a pending scheduled task before it executes.',
  inputSchema: z.object({
    taskId: z.string().describe('Task ID to cancel'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    error: z.string().optional(),
  }),
  providerPriority: ['events', 'trigger-dev', 'custom'],
  tags: ['task', 'cancel', 'background', 'stop'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.95,
  },
};

// ============================================================================
// Computer Use Capabilities (desktop/screen interaction)
// ============================================================================

export const COMPUTER_USE_CLICK_CAPABILITY: CapabilityDefinition = {
  id: 'computer_use.click',
  name: 'Click Element',
  category: 'sandbox',
  description: 'Click at a specific screen coordinate. Supports single and double clicks.',
  inputSchema: z.object({
    x: z.number().describe('X coordinate'),
    y: z.number().describe('Y coordinate'),
    button: z.enum(['left', 'right', 'middle']).optional().default('left'),
    clicks: z.number().optional().default(1).describe('Number of clicks'),
  }),
  outputSchema: z.object({ success: z.boolean(), error: z.string().optional() }),
  providerPriority: ['opencode-v2', 'daytona', 'e2b', 'codesandbox'],
  tags: ['computer-use', 'click', 'desktop', 'gui'],
};

export const COMPUTER_USE_TYPE_CAPABILITY: CapabilityDefinition = {
  id: 'computer_use.type',
  name: 'Type Text',
  category: 'sandbox',
  description: 'Type text into the active input field. Supports typing, clearing, and Enter key.',
  inputSchema: z.object({
    text: z.string().optional().describe('Text to type'),
    clear: z.boolean().optional().default(false).describe('Clear input first'),
    enter: z.boolean().optional().default(false).describe('Press Enter after typing'),
  }),
  outputSchema: z.object({ success: z.boolean(), error: z.string().optional() }),
  providerPriority: ['opencode-v2', 'daytona', 'e2b', 'codesandbox'],
  tags: ['computer-use', 'type', 'keyboard', 'input'],
};

export const COMPUTER_USE_SCREENSHOT_CAPABILITY: CapabilityDefinition = {
  id: 'computer_use.screenshot',
  name: 'Take Screenshot',
  category: 'sandbox',
  description: 'Capture a screenshot of the screen or a specific region.',
  inputSchema: z.object({
    region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
    quality: z.number().optional().default(80).describe('Image quality 0-100'),
  }),
  outputSchema: z.object({ success: z.boolean(), image: z.string().optional(), error: z.string().optional() }),
  providerPriority: ['opencode-v2', 'daytona', 'e2b', 'codesandbox'],
  tags: ['computer-use', 'screenshot', 'screen', 'image'],
};

export const COMPUTER_USE_SCROLL_CAPABILITY: CapabilityDefinition = {
  id: 'computer_use.scroll',
  name: 'Scroll Screen',
  category: 'sandbox',
  description: 'Scroll the screen horizontally and/or vertically.',
  inputSchema: z.object({
    deltaX: z.number().optional().default(0).describe('Horizontal scroll delta'),
    deltaY: z.number().optional().default(0).describe('Vertical scroll delta'),
  }),
  outputSchema: z.object({ success: z.boolean(), error: z.string().optional() }),
  providerPriority: ['opencode-v2', 'daytona', 'e2b', 'codesandbox'],
  tags: ['computer-use', 'scroll', 'screen'],
};

// ============================================================================
// MCP Capabilities
// ============================================================================

export const MCP_LIST_TOOLS_CAPABILITY: CapabilityDefinition = {
  id: 'mcp.list',
  name: 'List MCP Tools',
  category: 'repo',
  description: 'List all available tools from connected MCP servers.',
  inputSchema: z.object({
    serverId: z.string().optional().describe('Filter by server ID'),
  }),
  outputSchema: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.any()),
  })),
  providerPriority: ['opencode-v2', 'local-mcp', 'remote-mcp'],
  tags: ['mcp', 'list', 'discovery'],
};

export const MCP_CALL_TOOL_CAPABILITY: CapabilityDefinition = {
  id: 'mcp.call',
  name: 'Call MCP Tool',
  category: 'repo',
  description: 'Execute a tool from a connected MCP server.',
  inputSchema: z.object({
    serverId: z.string().describe('MCP server ID'),
    toolName: z.string().describe('Tool name'),
    arguments: z.record(z.any()).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.any().optional(),
    error: z.string().optional(),
  }),
  providerPriority: ['opencode-v2', 'local-mcp', 'remote-mcp'],
  tags: ['mcp', 'execute', 'tool'],
};

// ============================================================================
// Task/Plan Management Capabilities
// ============================================================================

export const TASK_LIST_CAPABILITY: CapabilityDefinition = {
  id: 'task.list',
  name: 'List Tasks',
  category: 'memory',
  description: 'List all tasks with optional filtering by status, retention level, or tags. Returns tasks sorted by priority and recency.',
  inputSchema: z.object({
    status: z.enum(['pending', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled']).optional()
      .describe('Filter by task status'),
    retention: z.enum(['scratch', 'active', 'queued', 'suspended', 'archived']).optional()
      .describe('Filter by retention level'),
    tags: z.array(z.string()).optional().describe('Filter by tags'),
    limit: z.number().optional().default(20).describe('Maximum tasks to return'),
    offset: z.number().optional().default(0).describe('Number of tasks to skip for pagination'),
  }),
  outputSchema: z.object({
    tasks: z.array(z.object({
      id: z.string(),
      title: z.string(),
      description: z.string().optional(),
      status: z.string(),
      retention: z.string(),
      priority: z.number(),
      progress: z.number(),
      steps: z.array(z.object({
        id: z.string(),
        description: z.string(),
        status: z.string(),
        order: z.number(),
      })).optional(),
      tags: z.array(z.string()),
      createdAt: z.number(),
      updatedAt: z.number(),
    })),
    pagination: z.object({
      offset: z.number(),
      limit: z.number(),
      total: z.number(),
      hasMore: z.boolean(),
    }),
  }),
  providerPriority: ['memory-service'],
  tags: ['task', 'list', 'todo', 'plan', 'tasks'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
};

export const TASK_CREATE_CAPABILITY: CapabilityDefinition = {
  id: 'task.create',
  name: 'Create Task',
  category: 'memory',
  description: 'Create a new task or plan. Supports multi-step tasks with ordered steps.',
  inputSchema: z.object({
    title: z.string().describe('Task title'),
    description: z.string().optional().describe('Task description'),
    steps: z.array(z.object({
      description: z.string(),
      order: z.number().optional(),
    })).optional().describe('Initial steps for the task'),
    priority: z.number().min(0).max(100).optional().default(50).describe('Priority (0-100, higher = more important)'),
    retention: z.enum(['scratch', 'active', 'queued', 'suspended', 'archived']).optional().default('queued'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
    parentId: z.string().optional().describe('Parent task ID for hierarchical tasks'),
    dueDate: z.number().optional().describe('Due date timestamp (ms)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    task: z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      steps: z.array(z.any()).optional(),
    }),
  }),
  providerPriority: ['memory-service'],
  tags: ['task', 'create', 'new', 'todo', 'plan'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
};

export const TASK_EDIT_CAPABILITY: CapabilityDefinition = {
  id: 'task.edit',
  name: 'Edit Task',
  category: 'memory',
  description: 'Edit an existing task - update title, description, priority, tags, or add/modify steps.',
  inputSchema: z.object({
    taskId: z.string().describe('Task ID to edit'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    priority: z.number().min(0).max(100).optional().describe('New priority (0-100)'),
    tags: z.array(z.string()).optional().describe('New tags (replaces existing)'),
    status: z.enum(['pending', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled']).optional()
      .describe('New status'),
    addSteps: z.array(z.object({
      description: z.string(),
      afterStepId: z.string().optional(),
    })).optional().describe('Steps to append'),
    editStep: z.object({
      stepId: z.string(),
      description: z.string().optional(),
      status: z.enum(['pending', 'completed', 'skipped', 'failed']).optional(),
      notes: z.string().optional(),
    }).optional().describe('Step to edit'),
    reorderSteps: z.array(z.string()).optional().describe('New step order (array of step IDs)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    task: z.object({
      id: z.string(),
      title: z.string(),
      steps: z.array(z.any()).optional(),
    }),
  }),
  providerPriority: ['memory-service'],
  tags: ['task', 'edit', 'update', 'modify', 'steps'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
};

export const TASK_DELETE_CAPABILITY: CapabilityDefinition = {
  id: 'task.delete',
  name: 'Delete Task',
  category: 'memory',
  description: 'Delete a task. Also deletes child tasks recursively.',
  inputSchema: z.object({
    taskId: z.string().describe('Task ID to delete'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  providerPriority: ['memory-service'],
  tags: ['task', 'delete', 'remove'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.95,
  },
};

export const TASK_SEARCH_CAPABILITY: CapabilityDefinition = {
  id: 'task.search',
  name: 'Search Tasks',
  category: 'memory',
  description: 'Search tasks by query. Matches title, description, and tags using partial matching.',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().optional().default(10).describe('Maximum results'),
  }),
  outputSchema: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    status: z.string(),
    tags: z.array(z.string()),
  })),
  providerPriority: ['memory-service'],
  tags: ['task', 'search', 'find', 'query'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
};

export const TASK_GET_UNFINISHED_CAPABILITY: CapabilityDefinition = {
  id: 'task.getUnfinished',
  name: 'Get Unfinished Tasks',
  category: 'memory',
  description: 'Get all unfinished pending tasks for re-context injection. Useful for reminding about ongoing work.',
  inputSchema: z.object({
    limit: z.number().optional().default(10).describe('Maximum tasks to return'),
    minAgeMs: z.number().optional().describe('Minimum task age in ms (for filtering old tasks)'),
  }),
  outputSchema: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    priority: z.number(),
    progress: z.number(),
    updatedAt: z.number(),
  })),
  providerPriority: ['memory-service'],
  tags: ['task', 'unfinished', 'pending', 'in_progress', 'recontext'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
};

// ============================================================================
// Process Management Capabilities
// ============================================================================


export const PROCESS_STOP_CAPABILITY: CapabilityDefinition = {
  id: 'process.stop',
  name: 'Stop Process',
  category: 'sandbox',
  description: 'Stop a running process by PID or name.',
  inputSchema: z.object({
    pid: z.number().optional().describe('Process ID'),
    name: z.string().optional().describe('Process name pattern'),
    signal: z.enum(['SIGTERM', 'SIGKILL', 'SIGHUP', 'SIGINT']).optional().default('SIGTERM'),
  }),
  outputSchema: z.object({ success: z.boolean(), error: z.string().optional() }),
  providerPriority: ['opencode-v2', 'daytona', 'local-fs'],
  tags: ['process', 'stop', 'kill', 'signal'],
};

export const PROCESS_LIST_CAPABILITY: CapabilityDefinition = {
  id: 'process.list',
  name: 'List Processes',
  category: 'sandbox',
  description: 'List running processes with optional user filter.',
  inputSchema: z.object({
    user: z.string().optional().describe('Filter by user'),
    tracked: z.boolean().optional().default(false).describe('Include agent-tracked processes'),
  }),
  outputSchema: z.array(z.object({
    pid: z.number(),
    command: z.string(),
    user: z.string().optional(),
    cpu: z.number().optional(),
    memory: z.number().optional(),
    tracked: z.boolean().optional(),
  })),
  providerPriority: ['opencode-v2', 'daytona', 'local-fs'],
  tags: ['process', 'list', 'ps'],
};

// ============================================================================
// Terminal / PTY Capabilities
// ============================================================================

export const TERMINAL_CREATE_SESSION_CAPABILITY: CapabilityDefinition = {
  id: 'terminal.create_session',
  name: 'Create Terminal Session',
  category: 'sandbox',
  description: 'Create a new interactive terminal session (PTY if available, command-mode fallback). ' +
    'Use for interactive tasks: running dev servers, navigating TUIs, monitoring long-running processes.',
  inputSchema: z.object({
    cols: z.number().optional().default(120).describe('Terminal width in columns'),
    rows: z.number().optional().default(30).describe('Terminal height in rows'),
    cwd: z.string().optional().describe('Initial working directory'),
  }),
  outputSchema: z.object({
    sessionId: z.string(),
    mode: z.enum(['pty', 'command-mode']),
    cols: z.number(),
    rows: z.number(),
    message: z.string(),
  }),
  providerPriority: ['terminal'],
  tags: ['terminal', 'pty', 'session', 'interactive'],
};

export const TERMINAL_SEND_INPUT_CAPABILITY: CapabilityDefinition = {
  id: 'terminal.send_input',
  name: 'Send Terminal Input',
  category: 'sandbox',
  description: 'Send keystrokes or input to an active terminal session. ' +
    'Use for interactive programs: answering prompts, navigating menus, sending Ctrl+C.',
  inputSchema: z.object({
    sessionId: z.string().describe('Terminal session ID'),
    input: z.string().describe('Input to send (include \\n for Enter)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  providerPriority: ['terminal'],
  tags: ['terminal', 'input', 'interactive'],
};

export const TERMINAL_GET_OUTPUT_CAPABILITY: CapabilityDefinition = {
  id: 'terminal.get_output',
  name: 'Get Terminal Output',
  category: 'sandbox',
  description: 'Read recent output from a terminal session. ' +
    'Can wait for a specific pattern to appear (e.g., "listening on port 3000").',
  inputSchema: z.object({
    sessionId: z.string().describe('Terminal session ID'),
    lines: z.number().optional().default(100).describe('Number of recent lines to retrieve'),
    waitForPattern: z.string().optional().describe('Wait until this pattern appears in output'),
    timeoutMs: z.number().optional().default(30000).describe('Max wait time for pattern (ms)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    lineCount: z.number(),
    message: z.string(),
  }),
  providerPriority: ['terminal'],
  tags: ['terminal', 'output', 'read'],
};

export const TERMINAL_RESIZE_CAPABILITY: CapabilityDefinition = {
  id: 'terminal.resize',
  name: 'Resize Terminal',
  category: 'sandbox',
  description: 'Resize a terminal session dimensions.',
  inputSchema: z.object({
    sessionId: z.string().describe('Terminal session ID'),
    cols: z.number().describe('New width in columns'),
    rows: z.number().describe('New height in rows'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  providerPriority: ['terminal'],
  tags: ['terminal', 'resize'],
};

export const TERMINAL_CLOSE_SESSION_CAPABILITY: CapabilityDefinition = {
  id: 'terminal.close_session',
  name: 'Close Terminal Session',
  category: 'sandbox',
  description: 'Close/terminate an active terminal session.',
  inputSchema: z.object({
    sessionId: z.string().describe('Terminal session ID to close'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  providerPriority: ['terminal'],
  tags: ['terminal', 'close', 'disconnect'],
};

export const TERMINAL_LIST_SESSIONS_CAPABILITY: CapabilityDefinition = {
  id: 'terminal.list_sessions',
  name: 'List Terminal Sessions',
  category: 'sandbox',
  description: 'List all active terminal sessions.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    sessions: z.array(z.object({
      sessionId: z.string(),
      sandboxId: z.string(),
      mode: z.enum(['pty', 'command-mode']),
      cols: z.number(),
      rows: z.number(),
      cwd: z.string(),
      status: z.string(),
      detectedPorts: z.array(z.number()),
    })),
    count: z.number(),
  }),
  providerPriority: ['terminal'],
  tags: ['terminal', 'list', 'sessions'],
};

export const TERMINAL_START_PROCESS_CAPABILITY: CapabilityDefinition = {
  id: 'terminal.start_process',
  name: 'Start Process',
  category: 'sandbox',
  description: 'Start a background process in the sandbox. ' +
    'Use for non-interactive long-running tasks: dev servers, build watchers, database servers.',
  inputSchema: z.object({
    command: z.string().describe('Command to execute'),
    cwd: z.string().optional().describe('Working directory'),
    env: z.record(z.string()).optional().describe('Environment variables'),
    timeout: z.number().optional().default(60000).describe('Execution timeout in ms'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    exitCode: z.number().nullable(),
    message: z.string(),
  }),
  providerPriority: ['terminal', 'opencode-v2', 'daytona'],
  tags: ['terminal', 'process', 'background', 'start'],
};

export const TERMINAL_STOP_PROCESS_CAPABILITY: CapabilityDefinition = {
  id: 'terminal.stop_process',
  name: 'Stop Process',
  category: 'sandbox',
  description: 'Stop a running process by PID. Sends SIGTERM by default.',
  inputSchema: z.object({
    pid: z.number().describe('Process ID to stop'),
    signal: z.enum(['SIGTERM', 'SIGKILL', 'SIGINT']).optional().default('SIGTERM'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  providerPriority: ['terminal', 'opencode-v2', 'daytona'],
  tags: ['terminal', 'process', 'stop', 'kill'],
};

export const TERMINAL_LIST_PROCESSES_CAPABILITY: CapabilityDefinition = {
  id: 'terminal.list_processes',
  name: 'List Processes',
  category: 'sandbox',
  description: 'List running processes with PID, user, CPU, memory, and command. ' +
    'Optionally filter by process name.',
  inputSchema: z.object({
    filter: z.string().optional().describe('Filter by process name'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    processes: z.array(z.object({
      pid: z.number(),
      user: z.string().optional(),
      cpu: z.string().optional(),
      memory: z.string().optional(),
      command: z.string(),
      startTime: z.string().optional(),
    })),
    message: z.string(),
  }),
  providerPriority: ['terminal', 'opencode-v2', 'daytona'],
  tags: ['terminal', 'process', 'list', 'ps'],
};

export const TERMINAL_GET_PORT_STATUS_CAPABILITY: CapabilityDefinition = {
  id: 'terminal.get_port_status',
  name: 'Get Port Status',
  category: 'sandbox',
  description: 'Check which ports are listening and what processes own them. ' +
    'Optionally check a specific port.',
  inputSchema: z.object({
    port: z.number().optional().describe('Specific port to check (omit for all)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    ports: z.array(z.object({
      port: z.number(),
      protocol: z.enum(['tcp', 'udp']),
      state: z.string(),
      pid: z.number().optional(),
      command: z.string().optional(),
    })),
    message: z.string(),
  }),
  providerPriority: ['terminal', 'opencode-v2', 'daytona'],
  tags: ['terminal', 'port', 'network', 'listening'],
};

// ============================================================================
// Preview / Port Capabilities
// ============================================================================

export const PREVIEW_GET_CAPABILITY: CapabilityDefinition = {
  id: 'preview.get',
  name: 'Get Previews',
  category: 'sandbox',
  description: 'Get URLs for previewing sandbox services (web servers, APIs).',
  inputSchema: z.object({
    port: z.number().optional().describe('Specific port to get preview for'),
  }),
  outputSchema: z.array(z.object({
    port: z.number(),
    url: z.string(),
    service: z.string().optional(),
  })),
  providerPriority: ['opencode-v2', 'daytona', 'codesandbox', 'webcontainer'],
  tags: ['preview', 'port', 'url', 'web'],
};

export const PREVIEW_FORWARD_PORT_CAPABILITY: CapabilityDefinition = {
  id: 'preview.forward_port',
  name: 'Forward Port',
  category: 'sandbox',
  description: 'Forward a sandbox port to the external network for access.',
  inputSchema: z.object({
    port: z.number().describe('Port to forward'),
    protocol: z.enum(['http', 'https', 'tcp']).optional().default('http'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    url: z.string().optional(),
    error: z.string().optional(),
  }),
  providerPriority: ['opencode-v2', 'daytona', 'codesandbox'],
  tags: ['preview', 'port', 'forward', 'network'],
};

// ============================================================================
// File Sync Capability
// ============================================================================

export const FILE_SYNC_CAPABILITY: CapabilityDefinition = {
  id: 'file.sync',
  name: 'Sync Files',
  category: 'file',
  description: 'Synchronize files between sandbox and external filesystem. Supports directional and bidirectional sync.',
  inputSchema: z.object({
    direction: z.enum(['to-sandbox', 'from-sandbox', 'bidirectional']).describe('Sync direction'),
    path: z.string().describe('Path to sync'),
    deleteOrphans: z.boolean().optional().default(false).describe('Delete files not in source'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    synced: z.number(),
    deleted: z.number().optional(),
    error: z.string().optional(),
  }),
  providerPriority: ['opencode-v2', 'daytona', 'local-fs'],
  tags: ['file', 'sync', 'transfer'],
};

// ============================================================================
// Code Capabilities
// ============================================================================


export const CODE_AST_DIFF_CAPABILITY: CapabilityDefinition = {
  id: 'code.ast_diff',
  name: 'Apply AST-Aware Diff',
  category: 'file',
  description: 'Apply an AST-aware structural diff to TypeScript/JavaScript files. Preserves formatting while making targeted changes.',
  inputSchema: z.object({
    path: z.string().describe('File path (.ts, .tsx, .js, .jsx)'),
    operation: z.enum(['insert', 'update', 'delete', 'replace']).describe('AST operation'),
    nodeSelector: z.string().describe('AST node selector'),
    newContent: z.string().optional().describe('New content for insert/update'),
    metadata: z.record(z.any()).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    content: z.string(),
    error: z.string().optional(),
    fileType: z.string().optional(),
  }),
  providerPriority: ['local-fs'],
  tags: ['code', 'ast', 'diff', 'refactor', 'typescript'],
};

export const CODE_SYNTAX_CHECK_CAPABILITY: CapabilityDefinition = {
  id: 'code.syntax_check',
  name: 'Syntax Check',
  category: 'file',
  description: 'Validate syntax of code files. Checks brace/paren balance, JSON validity, and language-specific syntax.',
  inputSchema: z.object({
    paths: z.array(z.string()).describe('File paths to check'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    files: z.array(z.object({
      path: z.string(),
      valid: z.boolean(),
      errors: z.array(z.string()).optional(),
    })),
  }),
  providerPriority: ['local-fs', 'opencode-v2'],
  tags: ['code', 'syntax', 'validate', 'lint'],
};

// ============================================================================
// File Batch Operations
// ============================================================================

export const FILE_BATCH_WRITE_CAPABILITY: CapabilityDefinition = {
  id: 'file.batch_write',
  name: 'Batch Write Files',
  category: 'file',
  description: 'Write multiple files atomically (up to 50 files). Returns per-file success/failure.',
  inputSchema: z.object({
    files: z.array(z.object({
      path: z.string(),
      content: z.string(),
    })).max(50),
    commitMessage: z.string().optional().describe('Commit message for audit'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    successCount: z.number(),
    failCount: z.number(),
    results: z.array(z.object({
      path: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
      version: z.number().optional(),
    })),
  }),
  providerPriority: ['mcp-filesystem', 'vfs', 'local-fs'],
  tags: ['file', 'batch', 'write', 'atomic'],
};

// ============================================================================
// Workspace Stats Capability
// ============================================================================

export const WORKSPACE_STATS_CAPABILITY: CapabilityDefinition = {
  id: 'workspace.stats',
  name: 'Workspace Stats',
  category: 'memory',
  description: 'Get workspace statistics: total size, file count, quota usage.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    totalSize: z.number(),
    fileCount: z.number(),
    quotaUsed: z.number().optional(),
    quotaTotal: z.number().optional(),
  }),
  providerPriority: ['vfs', 'local-fs'],
  tags: ['workspace', 'stats', 'quota', 'size'],
};

// ============================================================================
// Workflow / Agent Planning Capabilities
// ============================================================================

export const WORKFLOW_DISCOVERY_CAPABILITY: CapabilityDefinition = {
  id: 'workflow.discovery',
  name: 'Discovery Analysis',
  category: 'memory',
  description: 'Analyze a task request and identify files that need to be read for context.',
  inputSchema: z.object({
    task: z.string().describe('Task description'),
    filesToAnalyze: z.array(z.string()).optional().describe('Specific files to examine'),
  }),
  outputSchema: z.object({
    suggestedFiles: z.array(z.string()),
    taskSummary: z.string(),
    confidence: z.number().optional(),
  }),
  providerPriority: ['opencode-v2', 'blaxel'],
  tags: ['workflow', 'discovery', 'analysis', 'planning'],
};

export const WORKFLOW_PLAN_CAPABILITY: CapabilityDefinition = {
  id: 'workflow.plan',
  name: 'Create Plan',
  category: 'memory',
  description: 'Create a structured execution plan with file modifications, execution order, and rollback strategy.',
  inputSchema: z.object({
    task: z.string().describe('Task description'),
    files: z.array(z.object({ path: z.string(), action: z.string(), reason: z.string() })).optional(),
    executionOrder: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({
    task: z.string(),
    files: z.array(z.any()),
    executionOrder: z.array(z.string()),
    rollbackPlan: z.string(),
  }),
  providerPriority: ['opencode-v2', 'blaxel'],
  tags: ['workflow', 'plan', 'strategy', 'rollback'],
};

export const WORKFLOW_COMMIT_CAPABILITY: CapabilityDefinition = {
  id: 'workflow.commit',
  name: 'Commit Workspace Changes',
  category: 'memory',
  description: 'Commit current workspace state to shadow commits for rollback.',
  inputSchema: z.object({
    message: z.string().describe('Commit message'),
    sessionId: z.string().describe('Session ID'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    commitId: z.string(),
    error: z.string().optional(),
  }),
  providerPriority: ['vfs'],
  tags: ['workflow', 'commit', 'snapshot', 'rollback'],
};

export const WORKFLOW_ROLLBACK_CAPABILITY: CapabilityDefinition = {
  id: 'workflow.rollback',
  name: 'Rollback to Commit',
  category: 'memory',
  description: 'Rollback workspace to a previous shadow commit.',
  inputSchema: z.object({
    commitId: z.string().describe('Commit ID to rollback to'),
    sessionId: z.string().describe('Session ID'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    restoredFiles: z.array(z.string()),
    error: z.string().optional(),
  }),
  providerPriority: ['vfs'],
  tags: ['workflow', 'rollback', 'restore', 'undo'],
};

export const WORKFLOW_HISTORY_CAPABILITY: CapabilityDefinition = {
  id: 'workflow.history',
  name: 'Commit History',
  category: 'memory',
  description: 'Get shadow commit history for the current session.',
  inputSchema: z.object({
    sessionId: z.string().describe('Session ID'),
    limit: z.number().optional().default(20),
  }),
  outputSchema: z.array(z.object({
    id: z.string(),
    message: z.string(),
    timestamp: z.string(),
    fileCount: z.number(),
  })),
  providerPriority: ['vfs'],
  tags: ['workflow', 'history', 'commits', 'log'],
};

export const WORKFLOW_REQUEST_APPROVAL_CAPABILITY: CapabilityDefinition = {
  id: 'workflow.request_approval',
  name: 'Request Human Approval',
  category: 'memory',
  description: 'Create a human-in-the-loop approval request for a risky action.',
  inputSchema: z.object({
    action: z.string().describe('Action requiring approval'),
    details: z.record(z.any()).describe('Action details'),
    timeout: z.number().optional().default(300000).describe('Timeout in ms'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    approvalId: z.string(),
    status: z.enum(['pending', 'approved', 'rejected', 'expired']),
    timeoutAt: z.number().optional(),
  }),
  providerPriority: ['events', 'custom'],
  tags: ['workflow', 'approval', 'hitl', 'human-in-loop'],
};

// ============================================================================
// Workspace Runtime State Capability
// ============================================================================

/**
 * Workspace Runtime State — AI-agent queryable view of everything running
 * in the workspace: processes, services (daemons), preview URLs, and
 * workspace-scoped environment variables.
 *
 * Combines data from:
 *   - VirtualPidRegistry (processes)
 *   - WorkspaceServiceManager (services/daemons)
 *   - WorkspacePreviewRegistry (preview URLs)
 *   - WorkspaceRuntimeService (env vars + aggregate)
 *
 * Use this instead of scraping terminal output with `ps`, `netstat`, or `env`.
 */
export const WORKSPACE_RUNTIME_STATE_CAPABILITY: CapabilityDefinition = {
  id: 'workspace.runtime_state',
  name: 'Workspace Runtime State',
  category: 'sandbox',
  description: 'Get the full runtime state of a workspace: running processes, ' +
    'daemon services (dev servers, databases, build watchers), detected ports ' +
    'with preview URLs, and workspace-scoped environment variables. ' +
    'Returns structured JSON suitable for AI agent consumption. ' +
    'Use instead of scraping terminal output with ps, netstat, or env.',
  inputSchema: z.object({
    workspaceId: z.string().optional()
      .describe('Workspace identifier (userId:conversationId). Defaults to current context.'),
  }),
  outputSchema: z.object({
    workspaceId: z.string(),
    userId: z.string(),
    processes: z.array(z.any()),
    services: z.array(z.any()),
    previews: z.array(z.any()),
    env: z.record(z.string()),
    stats: z.object({
      processCount: z.number(),
      serviceCount: z.number(),
      runningCount: z.number(),
      previewCount: z.number(),
    }),
  }),
  providerPriority: ['workspace-analysis'],
  tags: ['workspace', 'runtime', 'state', 'processes', 'services', 'previews', 'env'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
};

// ============================================================================
// Export All Capabilities
// ============================================================================

// ============================================================================
// Workspace Analysis Capabilities (Queryable MCP-style tools)
// ============================================================================

export const PROJECT_ANALYZE_CAPABILITY: CapabilityDefinition = {
  id: 'workspace.analyze',
  name: 'Analyze Workspace',
  category: 'repo',
  description: 'Deep analysis of a workspace: detects framework, package manager, ' +
    'entry points, configuration files, dependencies, and generates recommended ' +
    'commands for install/run/test/build. Returns structured JSON.',
  inputSchema: z.object({
    includeDependencies: z.boolean().optional().default(false)
      .describe('Include full dependency list (default: false)'),
  }),
  outputSchema: z.object({
    framework: z.string(),
    packageManager: z.string(),
    runtimeMode: z.string(),
    entryFile: z.string().nullable(),
    projectRoot: z.string(),
    scripts: z.array(z.string()),
    recommendedCommands: z.object({
      install: z.string(),
      run: z.string().optional(),
      test: z.string().optional(),
      build: z.string().optional(),
    }),
    configFiles: z.array(z.string()),
    hints: z.array(z.string()),
    potentialIssues: z.array(z.string()),
    fileCount: z.number(),
    topDirs: z.array(z.string()),
  }),
  providerPriority: ['workspace-analysis'],
  tags: ['workspace', 'analyze', 'detection', 'context'],
};

export const PROJECT_LIST_SCRIPTS_CAPABILITY: CapabilityDefinition = {
  id: 'workspace.list_scripts',
  name: 'List Scripts',
  category: 'repo',
  description: 'List all runnable scripts/tasks in the workspace. Includes npm scripts, ' +
    'Makefile targets, pyproject.toml tasks, deno tasks, cargo commands, go tasks, ' +
    'turbo and nx tasks.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    scripts: z.array(z.object({
      name: z.string(),
      command: z.string(),
      source: z.string(),
    })),
  }),
  providerPriority: ['workspace-analysis'],
  tags: ['workspace', 'scripts', 'tasks', 'commands'],
};

export const PROJECT_DEPENDENCIES_CAPABILITY: CapabilityDefinition = {
  id: 'workspace.dependencies',
  name: 'Get Dependencies',
  category: 'repo',
  description: 'List installed dependencies and detect issues like missing packages, ' +
    'version conflicts, missing lock files, or unresolved workspace references.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    dependencies: z.record(z.string()),
    devDependencies: z.record(z.string()),
    issues: z.array(z.object({
      type: z.string(),
      severity: z.string(),
      message: z.string(),
    })),
    lockFile: z.object({
      type: z.string().nullable(),
      exists: z.boolean(),
    }),
    packageManager: z.string(),
  }),
  providerPriority: ['workspace-analysis'],
  tags: ['workspace', 'dependencies', 'packages', 'issues'],
};

export const PROJECT_STRUCTURE_CAPABILITY: CapabilityDefinition = {
  id: 'workspace.structure',
  name: 'Get Workspace Structure',
  category: 'repo',
  description: 'Get the file tree of the workspace with semantic understanding. ' +
    'Returns a structured tree object, file type counts, a text summary, ' +
    'and notable files (config files, entry points, documentation).',
  inputSchema: z.object({
    maxDepth: z.number().optional().default(5)
      .describe('Maximum tree depth (default: 5)'),
    summaryOnly: z.boolean().optional().default(false)
      .describe('Return only the text summary, not the full tree (default: false)'),
  }),
  outputSchema: z.object({
    fileCount: z.number(),
    dirCount: z.number(),
    fileTypes: z.record(z.number()),
    summary: z.string().describe('Text summary of top-level structure'),
    notableItems: z.array(z.string()),
  }),
  providerPriority: ['workspace-analysis'],
  tags: ['workspace', 'structure', 'tree', 'files'],
};

// ============================================================================
// Runtime Broker Capabilities (Phase 8 — Cost/Latency/Capacity-Aware Scheduling)
// ============================================================================

export const RUNTIME_SELECT_PROVIDER_CAPABILITY: CapabilityDefinition = {
  id: 'runtime.select_provider',
  name: 'Select Execution Provider',
  category: 'sandbox',
  description: 'Select the optimal sandbox/execution provider based on cost, latency, ' +
    'capacity, health, quota, and workspace affinity. Replaces static execution policies ' +
    'with dynamic scheduling. Returns the selected provider with confidence score, ' +
    'estimated cost, and alternatives.',
  inputSchema: z.object({
    interactive: z.boolean().optional().default(true).describe('Interactive user command?'),
    cpu: z.number().optional().default(1).describe('CPU cores needed'),
    memory: z.number().optional().default(0.5).describe('Memory GB needed'),
    gpu: z.boolean().optional().default(false).describe('GPU required?'),
    expectedDuration: z.number().optional().default(30).describe('Expected duration in seconds'),
    commandCategory: z.string().optional().describe('Command category for specialization'),
    workspaceId: z.string().optional().describe('Workspace ID for affinity check'),
    costSensitivity: z.enum(['low', 'medium', 'high']).optional(),
    performancePriority: z.enum(['latency', 'throughput', 'balanced']).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    decision: z.object({
      provider: z.string(),
      confidence: z.number(),
      estimatedCost: z.number(),
      currency: z.string(),
      reasons: z.array(z.string()),
      alternatives: z.array(z.object({
        provider: z.string(),
        score: z.number(),
        estimatedCost: z.number(),
        reason: z.string(),
      })),
    }),
  }),
  providerPriority: ['runtime-broker'],
  tags: ['runtime', 'broker', 'scheduling', 'phase8', 'cost', 'latency'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
};

export const RUNTIME_COST_ESTIMATE_CAPABILITY: CapabilityDefinition = {
  id: 'runtime.cost_estimate',
  name: 'Estimate Execution Cost',
  category: 'sandbox',
  description: 'Estimate the cost of running a workload on a specific provider. ' +
    'Returns CPU, memory, GPU, and base cost breakdown in USD.',
  inputSchema: z.object({
    cpu: z.number().optional().default(1).describe('CPU cores'),
    memory: z.number().optional().default(0.5).describe('Memory GB'),
    gpu: z.boolean().optional().default(false).describe('GPU required?'),
    expectedDuration: z.number().optional().default(60).describe('Expected duration in seconds'),
    provider: z.string().optional().describe('Provider to estimate for (default: daytona)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    estimate: z.object({
      provider: z.string(),
      estimatedCost: z.number(),
      currency: z.string(),
      breakdown: z.string(),
      cpuCost: z.number(),
      memoryCost: z.number(),
      gpuCost: z.number(),
      baseCost: z.number(),
      durationMinutes: z.number(),
    }),
  }),
  providerPriority: ['runtime-broker'],
  tags: ['runtime', 'cost', 'estimate', 'phase8'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
};

export const RUNTIME_PROVIDER_STATS_CAPABILITY: CapabilityDefinition = {
  id: 'runtime.provider_stats',
  name: 'Provider Statistics',
  category: 'sandbox',
  description: 'Get aggregate statistics for all sandbox providers: cost models, ' +
    'latency tiers, health scores, and capacity metrics. Used for observability ' +
    'and monitoring of the Phase 8 Runtime Broker.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    stats: z.array(z.object({
      provider: z.string(),
      costModel: z.object({
        cpuCostPerMinute: z.number(),
        memoryCostPerGBMinute: z.number(),
        gpuCostPerMinute: z.number(),
        baseCostPerCall: z.number(),
      }),
      latency: z.object({
        avgMs: z.number(),
        p95Ms: z.number(),
        tier: z.string(),
      }),
      health: z.object({
        score: z.number(),
        failureRate: z.number(),
        shouldDeprioritize: z.boolean(),
      }),
      capacity: z.object({
        quotaRemaining: z.number(),
        activeRequests: z.number(),
        queueDepth: z.number(),
      }),
    })),
    summary: z.object({
      totalProviders: z.number(),
      healthyProviders: z.number(),
      cheapestProvider: z.string(),
      fastestProvider: z.string(),
    }),
  }),
  providerPriority: ['runtime-broker'],
  tags: ['runtime', 'stats', 'observability', 'phase8', 'monitoring'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
};

// ============================================================================
// Workspace Image Stats Capability (Phase 7 — Workspace Image Synthesis)
// ============================================================================

export const WORKSPACE_IMAGE_STATS_CAPABILITY: CapabilityDefinition = {
  id: 'workspace.image_stats',
  name: 'Workspace Image Stats',
  category: 'sandbox',
  description: 'Get workspace image synthesis statistics: total images, active images, ' +
    'cache hit rate, estimated storage savings, and runtime breakdown (node/python/rust). ' +
    'Phase 7: Images are pre-built from dependency lockfiles for instant warm starts.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    totalImages: z.number(),
    activeImages: z.number(),
    nodeImages: z.number(),
    pythonImages: z.number(),
    totalUseCount: z.number(),
    totalEstimatedSizeMb: z.number(),
    enabled: z.boolean(),
  }),
  providerPriority: ['workspace-analysis'],
  tags: ['workspace', 'image', 'synthesis', 'phase7', 'cache', 'warm-start'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
};

// ============================================================================
// Workspace Affinity Capabilities (Phase 6 — Workspace-to-Provider Binding)
// ============================================================================

/**
 * Workspace affinity keeps workspaces bound to specific sandbox providers
 * with configurable TTL. This preserves cache warmth (node_modules, venvs,
 * pip cache) across commands, avoiding expensive cold starts.
 *
 * Phase 6: Exposes affinity state for observability, monitoring, and
 * provider selection transparency. The core affinity logic lives in
 * sandbox-orchestrator.ts (AffinityBinding, getAffinity, setAffinity,
 * touchAffinity, evictAffinity).
 */
export const WORKSPACE_AFFINITY_STATS_CAPABILITY: CapabilityDefinition = {
  id: 'workspace.affinity_stats',
  name: 'Workspace Affinity Stats',
  category: 'sandbox',
  description: 'Get workspace affinity statistics: active bindings, per-provider distribution, ' +
    'total commands routed via affinity, and cache warmth efficiency. ' +
    'Phase 6: Workspace-to-provider binding with TTL preserves cache warmth across commands.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    activeBindings: z.number(),
    providers: z.record(z.number()),
    totalCommands: z.number(),
  }),
  providerPriority: ['workspace-analysis'],
  tags: ['workspace', 'affinity', 'phase6', 'binding', 'cache', 'observability'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
};

export const WORKSPACE_AFFINITY_CONFIG_CAPABILITY: CapabilityDefinition = {
  id: 'workspace.affinity_config',
  name: 'Workspace Affinity Config',
  category: 'sandbox',
  description: 'Get workspace affinity configuration: whether affinity is enabled ' +
    'and the current TTL (time-to-live) for affinity bindings. ' +
    'Phase 6: Configurable via SANDBOX_AFFINITY_ENABLED and SANDBOX_AFFINITY_TTL_MS env vars.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    enabled: z.boolean(),
    ttlMs: z.number(),
  }),
  providerPriority: ['workspace-analysis'],
  tags: ['workspace', 'affinity', 'phase6', 'config', 'ttl'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
};

// ============================================================================
// WorkspaceFS Capabilities (Phase 9 — R2 + SQL metadata + provider sync layers)
// ============================================================================

/**
 * Phase 9: WorkspaceFS sync status — provides visibility into the unified
 * sync layer coordinating R2 cloud storage, VFS database, and sandbox
 * filesystems across providers.
 */
export const WORKSPACEFS_SYNC_STATUS_CAPABILITY: CapabilityDefinition = {
  id: 'workspacefs.sync_status',
  name: 'WorkspaceFS Sync Status',
  category: 'sandbox',
  description: 'Get the sync state for a workspace: VFS version, last R2 sync, ' +
    'last sandbox push, pending conflicts, and whether initial sync is complete. ' +
    'Phase 9: Unified sync layer with R2 + VFS + sandbox coordination.',
  inputSchema: z.object({
    workspaceId: z.string().optional().describe('Workspace identifier (userId:conversationId)'),
  }),
  outputSchema: z.object({
    workspaceId: z.string(),
    vfsVersion: z.number(),
    lastR2SyncAt: z.number(),
    lastSandboxPushAt: z.number(),
    initialSyncComplete: z.boolean(),
    fileCount: z.number(),
    r2Enabled: z.boolean(),
    pendingConflicts: z.number(),
  }),
  providerPriority: ['workspace-analysis'],
  tags: ['workspace', 'sync', 'phase9', 'r2', 'filesystem', 'observability'],
  metadata: { latency: 'low', cost: 'low', reliability: 0.99 },
};

export const WORKSPACEFS_R2_STATUS_CAPABILITY: CapabilityDefinition = {
  id: 'workspacefs.r2_status',
  name: 'WorkspaceFS R2 Status',
  category: 'sandbox',
  description: 'Check R2 cloud storage configuration and health. ' +
    'Returns whether R2 is configured, the bucket name, and endpoint. ' +
    'Phase 9: R2 is used as the durable source of truth for workspace files.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    configured: z.boolean(),
    bucket: z.string().nullable(),
    endpoint: z.string().nullable(),
  }),
  providerPriority: ['workspace-analysis'],
  tags: ['workspace', 'r2', 'phase9', 'storage', 'cloud', 'observability'],
  metadata: { latency: 'low', cost: 'low', reliability: 0.99 },
};

export const WORKSPACEFS_MIGRATE_CAPABILITY: CapabilityDefinition = {
  id: 'workspacefs.migrate_workspace',
  name: 'Migrate Workspace Files',
  category: 'sandbox',
  description: 'Sync workspace files from one sandbox provider to another during ' +
    'cross-provider migration. Pulls latest from VFS (synced from source sandbox), ' +
    'pushes all files to destination sandbox, and optionally restores from R2. ' +
    'Phase 9: Enables seamless provider switching without data loss.',
  inputSchema: z.object({
    workspaceId: z.string().describe('Workspace identifier'),
    fromProvider: z.string().describe('Source provider type'),
    toProvider: z.string().describe('Destination provider type'),
    sourceSandboxId: z.string().describe('Source sandbox ID'),
    destSandboxId: z.string().describe('Destination sandbox ID'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    fromProvider: z.string(),
    toProvider: z.string(),
    filesSynced: z.number(),
    filesRestoredFromR2: z.number(),
    errors: z.array(z.string()),
    duration: z.number(),
  }),
  providerPriority: ['workspace-analysis'],
  tags: ['workspace', 'migration', 'phase9', 'provider', 'sync'],
  metadata: { latency: 'medium', cost: 'low', reliability: 0.95 },
};

// ============================================================================
// Workspace Graph Capabilities (AI-native state querying)
// ============================================================================

// ============================================================================
// CAS Stats Capability (Phase 5 — Content-Addressable Storage observability)
// ============================================================================

export const WORKSPACE_CAS_STATS_CAPABILITY: CapabilityDefinition = {
  id: 'workspace.cas_stats',
  name: 'CAS Storage Stats',
  category: 'memory',
  description: 'Get content-addressable storage statistics: total blobs, total size, ' +
    'dedup ratio, cache hit rates, R2 status, and garbage collection metrics. ' +
    'Use to monitor Phase 5 CAS health and storage efficiency.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    totalBlobs: z.number(),
    totalSize: z.number(),
    totalCompressedSize: z.number().nullable(),
    totalRefs: z.number(),
    unreferencedBlobs: z.number(),
    localCacheSize: z.number(),
    localCacheCount: z.number(),
    r2Enabled: z.boolean(),
    dedupRatio: z.number().nullable(),
  }),
  providerPriority: ['workspace-analysis'],
  tags: ['workspace', 'cas', 'storage', 'phase5', 'observability', 'r2'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.99,
  },
};

export const WORKSPACE_GRAPH_CAPABILITY: CapabilityDefinition = {
  id: 'workspace.graph',
  name: 'Workspace Graph',    category: 'sandbox',
  description: 'Get the full workspace graph — a structured, queryable view of all workspace state. ' +
    'Returns processes, services, ports, previews, snapshots, and images as typed nodes with ' +
    'relationship edges and derived diagnostics. Use instead of scraping terminal output.',
  inputSchema: z.object({
    workspaceId: z.string().optional().describe('Workspace ID (defaults to current)'),
  }),
  outputSchema: z.object({
    workspaceId: z.string(),
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
    summary: z.any(),
    diagnostics: z.array(z.any()),
    generatedAt: z.number(),
  }),
  providerPriority: ['workspace-graph'],
  tags: ['workspace', 'graph', 'state', 'diagnostics', 'processes', 'services'],
};

export const WORKSPACE_GRAPH_DIAGNOSTIC_CAPABILITY: CapabilityDefinition = {
  id: 'workspace.graph_diagnostic',
  name: 'Service Diagnostic',    category: 'sandbox',
  description: 'Get a focused diagnostic trace for a specific service. ' +
    'Traces service → port → preview → process chain to find root causes.',
  inputSchema: z.object({
    serviceId: z.string().describe('Service ID to diagnose'),
    workspaceId: z.string().optional().describe('Workspace ID (defaults to current)'),
  }),
  outputSchema: z.array(z.object({
    level: z.string(),
    message: z.string(),
    relatedNodeIds: z.array(z.string()),
    category: z.string(),
  })),
  providerPriority: ['workspace-graph'],
  tags: ['workspace', 'service', 'diagnostic', 'troubleshoot'],
};

export const WORKSPACE_GRAPH_FIND_PROCESS_CAPABILITY: CapabilityDefinition = {
  id: 'workspace.graph_find_process',
  name: 'Find Processes',    category: 'sandbox',
  description: 'Search for processes by command pattern across the workspace. ' +
    'Returns matching processes plus their related services, ports, and previews.',
  inputSchema: z.object({
    pattern: z.string().describe('Command pattern to search for (e.g., "node", "npm", "python")'),
    workspaceId: z.string().optional().describe('Workspace ID (defaults to current)'),
  }),
  outputSchema: z.object({
    processes: z.array(z.any()),
    relatedNodes: z.array(z.any()),
    edges: z.array(z.any()),
  }),
  providerPriority: ['workspace-graph'],
  tags: ['workspace', 'process', 'search', 'find'],
};

// ============================================================================
// Desktop Automation Capabilities (agent-desktop integration)
// ============================================================================

export const DESKTOP_SNAPSHOT_CAPABILITY: CapabilityDefinition = {
  id: 'desktop.snapshot',
  name: 'Desktop Snapshot',
  category: 'desktop',
  description: 'Capture accessibility tree snapshot of a desktop application. Returns structured UI elements with refs for interaction.',
  inputSchema: z.object({
    app: z.string().optional().describe('Application name to snapshot'),
    windowId: z.string().optional().describe('Specific window ID'),
    interactiveOnly: z.boolean().optional().default(false).describe('Only include interactive elements'),
    compact: z.boolean().optional().default(false).describe('Omit empty structural nodes'),
    includeBounds: z.boolean().optional().default(false).describe('Include pixel bounds'),
    maxDepth: z.number().optional().default(10).describe('Maximum tree depth'),
    skeleton: z.boolean().optional().default(false).describe('Shallow 3-level overview'),
    root: z.string().optional().describe('Start from ref for drill-down'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    command: z.string(),
    data: z.any().optional(),
    error: z.any().optional(),
  }),
  providerPriority: ['tauri-desktop'],
  tags: ['desktop', 'snapshot', 'accessibility', 'ui', 'automation'],
  permissions: ['desktop:accessibility'],
};

export const DESKTOP_CLICK_CAPABILITY: CapabilityDefinition = {
  id: 'desktop.click',
  name: 'Desktop Click',
  category: 'desktop',
  description: 'Click on a UI element by ref ID. Supports single, double, and triple clicks.',
  inputSchema: z.object({
    refId: z.string().describe('Element ref ID from snapshot (e.g., @e1)'),
    clicks: z.number().optional().default(1).describe('Number of clicks (1, 2, or 3)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    command: z.string(),
    data: z.any().optional(),
    error: z.any().optional(),
  }),
  providerPriority: ['tauri-desktop'],
  tags: ['desktop', 'click', 'interaction', 'automation'],
  permissions: ['desktop:accessibility'],
};

export const DESKTOP_TYPE_CAPABILITY: CapabilityDefinition = {
  id: 'desktop.type',
  name: 'Desktop Type Text',
  category: 'desktop',
  description: 'Type text into a UI element by ref ID.',
  inputSchema: z.object({
    refId: z.string().describe('Element ref ID from snapshot'),
    text: z.string().describe('Text to type'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    command: z.string(),
    data: z.any().optional(),
    error: z.any().optional(),
  }),
  providerPriority: ['tauri-desktop'],
  tags: ['desktop', 'type', 'keyboard', 'automation'],
  permissions: ['desktop:accessibility'],
};

export const DESKTOP_SCREENSHOT_CAPABILITY: CapabilityDefinition = {
  id: 'desktop.screenshot',
  name: 'Desktop Screenshot',
  category: 'desktop',
  description: 'Capture a screenshot of the desktop or a specific window.',
  inputSchema: z.object({
    windowId: z.string().optional().describe('Window ID to capture (omit for full screen)'),
    quality: z.number().min(1).max(100).optional().default(80).describe('Image quality 1-100'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    command: z.string(),
    data: z.object({
      width: z.number(),
      height: z.number(),
      imageBase64: z.string(),
      format: z.string(),
    }).optional(),
    error: z.any().optional(),
  }),
  providerPriority: ['tauri-desktop'],
  tags: ['desktop', 'screenshot', 'capture', 'automation'],
  permissions: ['desktop:screen-capture'],
};

export const DESKTOP_CLIPBOARD_GET_CAPABILITY: CapabilityDefinition = {
  id: 'desktop.clipboard_get',
  name: 'Get Clipboard',
  category: 'desktop',
  description: 'Get text content from the system clipboard.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    command: z.string(),
    data: z.string().optional(),
    error: z.any().optional(),
  }),
  providerPriority: ['tauri-desktop'],
  tags: ['desktop', 'clipboard', 'get', 'automation'],
  permissions: ['desktop:clipboard'],
};

export const DESKTOP_CLIPBOARD_SET_CAPABILITY: CapabilityDefinition = {
  id: 'desktop.clipboard_set',
  name: 'Set Clipboard',
  category: 'desktop',
  description: 'Set text content to the system clipboard.',
  inputSchema: z.object({
    text: z.string().describe('Text to copy to clipboard'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    command: z.string(),
    error: z.any().optional(),
  }),
  providerPriority: ['tauri-desktop'],
  tags: ['desktop', 'clipboard', 'set', 'automation'],
  permissions: ['desktop:clipboard'],
};

export const DESKTOP_KEY_PRESS_CAPABILITY: CapabilityDefinition = {
  id: 'desktop.key_press',
  name: 'Press Key Combo',
  category: 'desktop',
  description: 'Press a keyboard shortcut/key combination. Examples: "cmd+s", "ctrl+shift+z", "escape".',
  inputSchema: z.object({
    combo: z.string().describe('Key combination (e.g., "cmd+s", "ctrl+c", "escape")'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    command: z.string(),
    data: z.string().optional(),
    error: z.any().optional(),
  }),
  providerPriority: ['tauri-desktop'],
  tags: ['desktop', 'keyboard', 'shortcut', 'automation'],
  permissions: ['desktop:accessibility'],
};

export const DESKTOP_LAUNCH_APP_CAPABILITY: CapabilityDefinition = {
  id: 'desktop.launch_app',
  name: 'Launch Application',
  category: 'desktop',
  description: 'Launch a desktop application by name or bundle ID.',
  inputSchema: z.object({
    appId: z.string().describe('Application name or bundle ID (e.g., "Safari", "com.apple.Safari")'),
    wait: z.boolean().optional().default(true).describe('Wait for app to launch'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    command: z.string(),
    data: z.any().optional(),
    error: z.any().optional(),
  }),
  providerPriority: ['tauri-desktop'],
  tags: ['desktop', 'launch', 'app', 'automation'],
  permissions: ['desktop:app-management'],
};

export const DESKTOP_CLOSE_APP_CAPABILITY: CapabilityDefinition = {
  id: 'desktop.close_app',
  name: 'Close Application',
  category: 'desktop',
  description: 'Close/quit a desktop application.',
  inputSchema: z.object({
    appName: z.string().describe('Application name'),
    force: z.boolean().optional().default(false).describe('Force quit if app is unresponsive'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    command: z.string(),
    error: z.any().optional(),
  }),
  providerPriority: ['tauri-desktop'],
  tags: ['desktop', 'close', 'quit', 'app', 'automation'],
  permissions: ['desktop:app-management'],
};

export const DESKTOP_LIST_WINDOWS_CAPABILITY: CapabilityDefinition = {
  id: 'desktop.list_windows',
  name: 'List Windows',
  category: 'desktop',
  description: 'List all visible windows on the desktop.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    command: z.string(),
    data: z.array(z.object({
      id: z.string(),
      title: z.string(),
      appName: z.string(),
      pid: z.number(),
    })).optional(),
    error: z.any().optional(),
  }),
  providerPriority: ['tauri-desktop'],
  tags: ['desktop', 'windows', 'list', 'automation'],
  permissions: ['desktop:accessibility'],
};

export const DESKTOP_LIST_APPS_CAPABILITY: CapabilityDefinition = {
  id: 'desktop.list_apps',
  name: 'List Applications',
  category: 'desktop',
  description: 'List all running GUI applications.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    command: z.string(),
    data: z.array(z.object({
      name: z.string(),
      bundleId: z.string().optional(),
      pid: z.number(),
    })).optional(),
    error: z.any().optional(),
  }),
  providerPriority: ['tauri-desktop'],
  tags: ['desktop', 'apps', 'list', 'automation'],
  permissions: ['desktop:accessibility'],
};

export const ALL_CAPABILITIES: CapabilityDefinition[] = [
  // File
  FILE_READ_CAPABILITY,
  FILE_WRITE_CAPABILITY,
  FILE_APPEND_CAPABILITY,
  FILE_DELETE_CAPABILITY,
  FILE_LIST_CAPABILITY,
  FILE_SYNC_CAPABILITY,
  FILE_BATCH_WRITE_CAPABILITY,
  // Sandbox
  SANDBOX_EXECUTE_CAPABILITY,
  SANDBOX_SESSION_CAPABILITY,
  BASH_CAPABILITY,
  // Computer Use
  COMPUTER_USE_CLICK_CAPABILITY,
  COMPUTER_USE_TYPE_CAPABILITY,
  COMPUTER_USE_SCREENSHOT_CAPABILITY,
  COMPUTER_USE_SCROLL_CAPABILITY,
  // Process Management
  PROCESS_STOP_CAPABILITY,
  PROCESS_LIST_CAPABILITY,
  // Terminal / PTY
  TERMINAL_CREATE_SESSION_CAPABILITY,
  TERMINAL_SEND_INPUT_CAPABILITY,
  TERMINAL_GET_OUTPUT_CAPABILITY,
  TERMINAL_RESIZE_CAPABILITY,
  TERMINAL_CLOSE_SESSION_CAPABILITY,
  TERMINAL_LIST_SESSIONS_CAPABILITY,
  TERMINAL_START_PROCESS_CAPABILITY,
  TERMINAL_STOP_PROCESS_CAPABILITY,
  TERMINAL_LIST_PROCESSES_CAPABILITY,
  TERMINAL_GET_PORT_STATUS_CAPABILITY,
  // Preview
  PREVIEW_GET_CAPABILITY,
  PREVIEW_FORWARD_PORT_CAPABILITY,
  // Web
  WEB_BROWSE_CAPABILITY,
  WEB_SEARCH_CAPABILITY,
  WEB_FETCH_CAPABILITY,
  // Repo
  REPO_SEARCH_CAPABILITY,
  REPO_GIT_CAPABILITY,
  REPO_ANALYZE_CAPABILITY,
  // MCP
  MCP_LIST_TOOLS_CAPABILITY,
  MCP_CALL_TOOL_CAPABILITY,
  // Code
  CODE_AST_DIFF_CAPABILITY,
  CODE_SYNTAX_CHECK_CAPABILITY,
  // Memory
  MEMORY_STORE_CAPABILITY,
  MEMORY_RETRIEVE_CAPABILITY,
  PROJECT_BUNDLE_CAPABILITY,
  WORKSPACE_GET_CHANGES_CAPABILITY,
  WORKSPACE_STATS_CAPABILITY,
  // Automation
  AUTOMATION_DISCORD_CAPABILITY,
  AUTOMATION_TELEGRAM_CAPABILITY,
  AUTOMATION_WORKFLOW_CAPABILITY,
  // Task Scheduling (trigger.dev integration)
  SCHEDULE_TASK_CAPABILITY,
  TASK_STATUS_CAPABILITY,
  TASK_CANCEL_CAPABILITY,
  // Task/Plan Management
  TASK_LIST_CAPABILITY,
  TASK_CREATE_CAPABILITY,
  TASK_EDIT_CAPABILITY,
  TASK_DELETE_CAPABILITY,
  TASK_SEARCH_CAPABILITY,
  TASK_GET_UNFINISHED_CAPABILITY,
  // Workflow / Agent Planning
  WORKFLOW_DISCOVERY_CAPABILITY,
  WORKFLOW_PLAN_CAPABILITY,
  WORKFLOW_COMMIT_CAPABILITY,
  WORKFLOW_ROLLBACK_CAPABILITY,
  WORKFLOW_HISTORY_CAPABILITY,
  WORKFLOW_REQUEST_APPROVAL_CAPABILITY,
  // Workspace Analysis (Queryable MCP-style tools)
  PROJECT_ANALYZE_CAPABILITY,
  PROJECT_LIST_SCRIPTS_CAPABILITY,
  PROJECT_DEPENDENCIES_CAPABILITY,
  PROJECT_STRUCTURE_CAPABILITY,
  // Workspace Graph (AI-native state querying)
  // Workspace Runtime State (AI-agent queryable workspace state)
  WORKSPACE_RUNTIME_STATE_CAPABILITY,
  WORKSPACE_CAS_STATS_CAPABILITY,
  // Workspace Affinity (Phase 6 — Workspace-to-provider binding with TTL)
  WORKSPACE_AFFINITY_STATS_CAPABILITY,
  WORKSPACE_AFFINITY_CONFIG_CAPABILITY,
  // Workspace Image Synthesis (Phase 7 — Pre-built images from dependency lockfiles)
  WORKSPACE_IMAGE_STATS_CAPABILITY,
  WORKSPACE_GRAPH_CAPABILITY,
  WORKSPACE_GRAPH_DIAGNOSTIC_CAPABILITY,
  WORKSPACE_GRAPH_FIND_PROCESS_CAPABILITY,
  // Runtime Broker (Phase 8 — Cost/Latency/Capacity-Aware Scheduling)
  RUNTIME_SELECT_PROVIDER_CAPABILITY,
  RUNTIME_COST_ESTIMATE_CAPABILITY,
  RUNTIME_PROVIDER_STATS_CAPABILITY,
  // WorkspaceFS Sync (Phase 9 — R2 + SQL metadata + provider sync layers)
  WORKSPACEFS_SYNC_STATUS_CAPABILITY,
  WORKSPACEFS_R2_STATUS_CAPABILITY,
  WORKSPACEFS_MIGRATE_CAPABILITY,
  // Desktop Automation (agent-desktop integration)
  DESKTOP_SNAPSHOT_CAPABILITY,
  DESKTOP_CLICK_CAPABILITY,
  DESKTOP_TYPE_CAPABILITY,
  DESKTOP_SCREENSHOT_CAPABILITY,
  DESKTOP_CLIPBOARD_GET_CAPABILITY,
  DESKTOP_CLIPBOARD_SET_CAPABILITY,
  DESKTOP_KEY_PRESS_CAPABILITY,
  DESKTOP_LAUNCH_APP_CAPABILITY,
  DESKTOP_CLOSE_APP_CAPABILITY,
  DESKTOP_LIST_WINDOWS_CAPABILITY,
  DESKTOP_LIST_APPS_CAPABILITY,
];

// ============================================================================
// Capability Lookup
// ============================================================================

export const CAPABILITY_BY_ID = new Map<string, CapabilityDefinition>(
  ALL_CAPABILITIES.map(cap => [cap.id, cap])
);

export const CAPABILITIES_BY_CATEGORY = new Map<CapabilityCategory, CapabilityDefinition[]>(
  (Array.from(new Set(ALL_CAPABILITIES.map(c => c.category))) as CapabilityCategory[]).map(
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
    (cap.tags && Array.isArray(cap.tags) && cap.tags.some(tag => tag.toLowerCase().includes(lowerQuery)))
  );
}
