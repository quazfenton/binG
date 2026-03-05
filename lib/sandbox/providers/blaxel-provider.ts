/**
 * Blaxel Sandbox Provider
 *
 * Cloud-native sandbox provider with ultra-fast resume (<25ms), auto scale-to-zero,
 * persistent volumes, VPC integration, and lifecycle policies.
 *
 * Features:
 * - Synchronous sandbox execution
 * - Async triggers for long-running tasks (up to 15 min)
 * - Batch jobs
 * - Agent handoffs
 * - Callback webhooks with signature verification
 * - Encrypted callback secret storage
 *
 * Documentation: https://docs.blaxel.ai/api-reference/compute/create-sandbox
 * SDK: @blaxel/core
 * Async Triggers: https://docs.blaxel.ai/Agents/Asynchronous-triggers
 */

import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
  BatchJobConfig,
  BatchTask,
  BatchJobResult,
  AsyncExecutionConfig,
  AsyncExecutionResult,
  LogEntry,
} from './sandbox-provider'
import { quotaManager } from '@/lib/services/quota-manager'
import { blaxelAsyncManager, verifyWebhookFromRequest } from './blaxel-async'
import { getDatabase } from '@/lib/database/connection'
import { encryptSecret, decryptSecret, generateSecureSecret } from '@/lib/utils/crypto'

const WORKSPACE_DIR = '/workspace'
const MAX_INSTANCES = 50
const INSTANCE_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

// Encryption key for callback secrets
const ENCRYPTION_KEY_ENV = process.env.BLAXEL_SECRET_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY_ENV && process.env.NODE_ENV === 'production') {
  console.warn('[Blaxel] BLAXEL_SECRET_ENCRYPTION_KEY not set in production. Callback secrets will NOT be encrypted.');
}

/**
 * Initialize database for callback secrets persistence with ENCRYPTION
 * 
 * SECURITY: Callback secrets are now encrypted using AES-256-GCM
 * This prevents database compromise from exposing webhook secrets
 */
function initializeBlaxelDatabase(): void {
  try {
    const db = getDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS blaxel_callback_secrets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sandbox_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        secret_encrypted TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(sandbox_id, agent)
      )
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_blaxel_secrets_sandbox
      ON blaxel_callback_secrets(sandbox_id)
    `);
    console.log('[Blaxel] Database initialized for callback secrets (encrypted)');
  } catch (error) {
    console.warn('[Blaxel] Database init failed:', error);
  }
}

// Initialize on module load
initializeBlaxelDatabase();

interface BlaxelSandboxInstance {
  sandbox: any
  metadata: BlaxelSandboxMetadata
  createdAt: number
  lastActive: number
}

interface BlaxelSandboxMetadata {
  name: string
  displayName: string
  region: string
  url: string
  status: string
  expiresIn?: number
  volumes?: Array<{ name: string; mountPath: string }>
}

const sandboxInstances = new Map<string, BlaxelSandboxInstance>()

// Periodic cleanup of stale instances
setInterval(() => {
  const now = Date.now()
  for (const [id, instance] of sandboxInstances.entries()) {
    if (now - instance.lastActive > INSTANCE_TTL_MS) {
      console.log(`[Blaxel] Cleaning up stale instance: ${id}`)
      instance.sandbox.delete().catch(console.error)
      sandboxInstances.delete(id)
    }
  }
}, 30 * 60 * 1000)

export class BlaxelProvider implements SandboxProvider {
  readonly name = 'blaxel'
  private client: any = null
  private apiKey: string
  private workspace: string
  private defaultRegion: string
  private defaultImage: string
  private defaultMemory: number
  private defaultTtl: string

  constructor() {
    this.apiKey = process.env.BLAXEL_API_KEY || ''
    this.workspace = process.env.BLAXEL_WORKSPACE || 'default'
    this.defaultRegion = process.env.BLAXEL_DEFAULT_REGION || 'us-pdx-1'
    this.defaultImage = process.env.BLAXEL_DEFAULT_IMAGE || 'blaxel/base-image:latest'
    this.defaultMemory = parseInt(process.env.BLAXEL_DEFAULT_MEMORY || '4096', 10)
    this.defaultTtl = process.env.BLAXEL_DEFAULT_TTL || '24h'

    if (!this.apiKey) {
      console.warn('[Blaxel] BLAXEL_API_KEY not configured. Provider will fail on first use.')
    }
  }

  private async ensureClient(): Promise<any> {
    if (this.client) return this.client

    try {
      const blaxelSdk = await import('@blaxel/core') as any
      // Initialize Blaxel SDK per documentation
      // https://docs.blaxel.ai/Infrastructure/Middleware#initialize-the-sdk
      await blaxelSdk.default.initialize({
        apiKey: this.apiKey,
        workspace: this.workspace,
      })
      this.client = blaxelSdk.default
      return this.client
    } catch (error: any) {
      console.error('[Blaxel] Failed to initialize client:', error.message)
      throw new Error(`Blaxel SDK not available. Install with: pnpm add @blaxel/core. Error: ${error.message}`)
    }
  }

  /**
   * Create sandbox with volume template
   * 
   * ADDED: Volume template support per Blaxel docs
   * 
   * @param config - Sandbox configuration
   * @param volumeTemplate - Optional volume template name
   * @returns Sandbox handle
   * 
   * @see https://docs.blaxel.ai/volumes
   */
  async createSandboxWithVolume(
    config: SandboxCreateConfig,
    volumeTemplate?: string
  ): Promise<SandboxHandle> {
    await this.ensureClient()

    // Map language to image
    const languageImageMap: Record<string, string> = {
      typescript: 'blaxel/typescript:latest',
      javascript: 'blaxel/node:latest',
      python: 'blaxel/python:latest',
      go: 'blaxel/go:latest',
      rust: 'blaxel/rust:latest',
    }
    const image = config.language ? (languageImageMap[config.language] || this.defaultImage) : this.defaultImage

    const createParams: any = {
      image,
      region: this.defaultRegion,
      memory: this.defaultMemory,
      ttl: this.defaultTtl,
      envVars: {
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
        ...config.envVars,
      },
    }

    // Add volume template if specified
    if (volumeTemplate) {
      createParams.volumeTemplate = volumeTemplate
    }

    const sandbox = await this.client.sandbox.create(createParams)
    const metadata: BlaxelSandboxMetadata = {
      name: sandbox.name,
      displayName: `binG Sandbox ${sandbox.name}`,
      region: sandbox.region,
      status: sandbox.status,
      url: '',
    }

    const instance: BlaxelSandboxInstance = {
      sandbox,
      metadata,
      createdAt: Date.now(),
      lastActive: Date.now(),
    }

    sandboxInstances.set(sandbox.id, instance)
    quotaManager.recordUsage('blaxel', 1)

    console.log(`[Blaxel] Created sandbox ${sandbox.id} with volume template: ${volumeTemplate || 'none'}`)

    return new BlaxelSandboxHandle(sandbox, metadata)
  }

  /**
   * Create volume template
   * 
   * ADDED: Volume template creation
   * 
   * @param name - Template name
   * @param files - Files to include in template
   * @returns Template ID
   * 
   * @example
   * ```typescript
   * await blaxelProvider.createVolumeTemplate('node-project', [
   *   { path: 'package.json', content: '{...}' },
   *   { path: 'src/index.ts', content: '...' },
   * ])
   * ```
   */
  async createVolumeTemplate(
    name: string,
    files: Array<{ path: string; content: string }>
  ): Promise<string> {
    await this.ensureClient()

    try {
      const template = await this.client.volumes.createTemplate({
        name,
        workspace: this.workspace,
        files,
      })

      console.log(`[Blaxel] Created volume template: ${name}`)
      return template.id
    } catch (error: any) {
      console.error('[Blaxel] Failed to create volume template:', error.message)
      throw error
    }
  }

  /**
   * List volume templates
   * 
   * @returns Array of volume templates
   */
  async listVolumeTemplates(): Promise<Array<{ id: string; name: string; createdAt: number }>> {
    await this.ensureClient()

    try {
      const templates = await this.client.volumes.listTemplates({
        workspace: this.workspace,
      })

      return templates.map((t: any) => ({
        id: t.id,
        name: t.name,
        createdAt: new Date(t.created_at).getTime(),
      }))
    } catch (error: any) {
      console.error('[Blaxel] Failed to list volume templates:', error.message)
      return []
    }
  }

  /**
   * Delete volume template
   *
   * @param templateId - Template ID to delete
   */
  async deleteVolumeTemplate(templateId: string): Promise<void> {
    await this.ensureClient()

    try {
      await this.client.volumes.deleteTemplate({
        id: templateId,
        workspace: this.workspace,
      })

      console.log(`[Blaxel] Deleted volume template: ${templateId}`)
    } catch (error: any) {
      console.error('[Blaxel] Failed to delete volume template:', error.message)
      throw error
    }
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const client = await this.ensureClient()

    try {
      // Enforce max instances
      if (sandboxInstances.size >= MAX_INSTANCES) {
        let oldestId: string | null = null
        let oldestTime = Date.now()
        for (const [id, instance] of sandboxInstances.entries()) {
          if (instance.createdAt < oldestTime) {
            oldestTime = instance.createdAt
            oldestId = id
          }
        }
        if (oldestId) {
          console.log(`[Blaxel] Evicting oldest instance: ${oldestId}`)
          await sandboxInstances.get(oldestId)?.sandbox.delete()
          sandboxInstances.delete(oldestId)
        }
      }

      // Build sandbox spec per Blaxel API docs
      const sandboxName = `blaxel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const createRequest = {
        metadata: {
          name: sandboxName,
          displayName: `binG Sandbox ${sandboxName}`,
          labels: {
            userId: config.labels?.userId || 'unknown',
            provider: 'blaxel',
          },
        },
        spec: {
          enabled: true,
          region: this.defaultRegion,
          runtime: {
            image: this.defaultImage,
            memory: this.defaultMemory,
            envs: [
              { name: 'TERM', value: 'xterm-256color' },
              { name: 'LANG', value: 'en_US.UTF-8' },
              ...(config.envVars
                ? Object.entries(config.envVars).map(([name, value]) => ({
                    name,
                    value,
                    secret: name.toLowerCase().includes('key') || name.toLowerCase().includes('secret'),
                  }))
                : []),
            ],
            ttl: this.defaultTtl,
            ports: [
              { target: 8080, name: 'http', protocol: 'HTTP' },
              { target: 3000, name: 'dev', protocol: 'HTTP' },
            ],
          },
          lifecycle: {
            expirationPolicies: [
              {
                type: 'ttl-idle',
                action: 'delete',
                value: this.defaultTtl,
              },
            ],
          },
          // Add volumes if configured
          volumes: config.mounts?.map((mount, idx) => ({
            name: `vol-${idx}`,
            mountPath: mount.target,
            readOnly: false,
          })),
        },
      }

      // Create sandbox via Blaxel API
      const sandbox = await client.sandboxes.create(createRequest)
      const now = Date.now()

      const metadata: BlaxelSandboxMetadata = {
        name: sandbox.metadata?.name || sandboxName,
        displayName: sandbox.metadata?.displayName || '',
        region: sandbox.spec?.region || this.defaultRegion,
        url: sandbox.metadata?.url || '',
        status: sandbox.status || 'DEPLOYED',
        expiresIn: sandbox.expiresIn,
        volumes: sandbox.spec?.volumes,
      }

      const instance: BlaxelSandboxInstance = {
        sandbox,
        metadata,
        createdAt: now,
        lastActive: now,
      }

      sandboxInstances.set(sandboxName, instance)
      quotaManager.recordUsage('blaxel')

      console.log(`[Blaxel] Created sandbox: ${sandboxName}, URL: ${metadata.url}`)

      return new BlaxelSandboxHandle(sandbox, metadata)
    } catch (error: any) {
      console.error('[Blaxel] Failed to create sandbox:', error.message)
      throw new Error(`Blaxel sandbox creation failed: ${error.message}`)
    }
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const instance = sandboxInstances.get(sandboxId)
    if (!instance) {
      throw new Error(`Blaxel sandbox ${sandboxId} not found`)
    }
    instance.lastActive = Date.now()
    return new BlaxelSandboxHandle(instance.sandbox, instance.metadata)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const instance = sandboxInstances.get(sandboxId)
    if (instance) {
      try {
        await instance.sandbox.delete()
        console.log(`[Blaxel] Destroyed sandbox: ${sandboxId}`)
      } catch (error: any) {
        console.warn(`[Blaxel] Failed to destroy sandbox ${sandboxId}:`, error.message)
      } finally {
        sandboxInstances.delete(sandboxId)
      }
    }
  }

  // ============================================
  // Extended Features: Codegen Tools
  // ============================================

  /**
   * Semantic search to find relevant code snippets
   * @see https://docs.blaxel.ai/Agents/Code-generation-tools#codegen-codebase-search
   */
  async codegenCodebaseSearch(query: string, options?: {
    repoId?: string;
    limit?: number;
    fileTypes?: string[];
  }): Promise<{ results: Array<{ file: string; content: string; score: number }> }> {
    const client = await this.ensureClient()
    try {
      return await client.codegen.codebaseSearch(query, options)
    } catch (error: any) {
      console.error('[Blaxel] codegenCodebaseSearch failed:', error.message)
      throw new Error(`Codebase search failed: ${error.message}`)
    }
  }

  /**
   * Fast fuzzy file path search
   * @see https://docs.blaxel.ai/Agents/Code-generation-tools#codegen-file-search
   */
  async codegenFileSearch(pattern: string, options?: {
    repoId?: string;
    limit?: number;
  }): Promise<{ results: Array<{ path: string; score: number }> }> {
    const client = await this.ensureClient()
    try {
      return await client.codegen.fileSearch(pattern, options)
    } catch (error: any) {
      console.error('[Blaxel] codegenFileSearch failed:', error.message)
      throw new Error(`File search failed: ${error.message}`)
    }
  }

  /**
   * Exact regex search using ripgrep engine
   * @see https://docs.blaxel.ai/Agents/Code-generation-tools#codegen-grep-search
   */
  async codegenGrepSearch(pattern: string, options?: {
    repoId?: string;
    path?: string;
    limit?: number;
  }): Promise<{ results: Array<{ file: string; line: number; content: string }> }> {
    const client = await this.ensureClient()
    try {
      return await client.codegen.grepSearch(pattern, options)
    } catch (error: any) {
      console.error('[Blaxel] codegenGrepSearch failed:', error.message)
      throw new Error(`Grep search failed: ${error.message}`)
    }
  }

  /**
   * List directory contents (quick discovery)
   * @see https://docs.blaxel.ai/Agents/Code-generation-tools#codegen-list-dir
   */
  async codegenListDir(path: string, options?: {
    repoId?: string;
    includePatterns?: string[];
    excludePatterns?: string[];
  }): Promise<{ results: Array<{ name: string; type: 'file' | 'directory'; path: string }> }> {
    const client = await this.ensureClient()
    try {
      return await client.codegen.listDir(path, options)
    } catch (error: any) {
      console.error('[Blaxel] codegenListDir failed:', error.message)
      throw new Error(`List directory failed: ${error.message}`)
    }
  }

  /**
   * Read file contents within a specific line range (max 250 lines)
   * @see https://docs.blaxel.ai/Agents/Code-generation-tools#codegen-read-file-range
   */
  async codegenReadFileRange(filePath: string, startLine: number, endLine: number, options?: {
    repoId?: string;
  }): Promise<{ content: string; startLine: number; endLine: number }> {
    const client = await this.ensureClient()
    try {
      return await client.codegen.readFileRange(filePath, startLine, endLine, options)
    } catch (error: any) {
      console.error('[Blaxel] codegenReadFileRange failed:', error.message)
      throw new Error(`Read file range failed: ${error.message}`)
    }
  }

  /**
   * Performs semantic search/reranking on code files in a directory
   * @see https://docs.blaxel.ai/Agents/Code-generation-tools#codegen-rerank
   */
  async codegenRerank(query: string, directory: string, options?: {
    repoId?: string;
    limit?: number;
  }): Promise<{ results: Array<{ file: string; score: number; content: string }> }> {
    const client = await this.ensureClient()
    try {
      return await client.codegen.rerank(query, directory, options)
    } catch (error: any) {
      console.error('[Blaxel] codegenRerank failed:', error.message)
      throw new Error(`Rerank failed: ${error.message}`)
    }
  }

  /**
   * Plan parallel edits across multiple file locations
   * @see https://docs.blaxel.ai/Agents/Code-generation-tools#codegen-parallel-apply
   */
  async codegenParallelApply(edits: Array<{
    filePath: string;
    startLine: number;
    endLine: number;
    newContent: string;
  }>, options?: {
    repoId?: string;
    dryRun?: boolean;
  }): Promise<{ results: Array<{ filePath: string; success: boolean; error?: string }> }> {
    const client = await this.ensureClient()
    try {
      return await client.codegen.parallelApply(edits, options)
    } catch (error: any) {
      console.error('[Blaxel] codegenParallelApply failed:', error.message)
      throw new Error(`Parallel apply failed: ${error.message}`)
    }
  }

  /**
   * Use smarter model to retry a failed edit
   * @see https://docs.blaxel.ai/Agents/Code-generation-tools#codegen-reapply
   */
  async codegenReapply(editId: string, options?: {
    model?: string;
    maxRetries?: number;
  }): Promise<{ success: boolean; result?: any; error?: string }> {
    const client = await this.ensureClient()
    try {
      return await client.codegen.reapply(editId, options)
    } catch (error: any) {
      console.error('[Blaxel] codegenReapply failed:', error.message)
      throw new Error(`Reapply failed: ${error.message}`)
    }
  }

  // ============================================
  // Extended Features: Batch Jobs
  // ============================================

  /**
   * Create a batch job to trigger HTTP endpoint for batch execution
   * @see https://docs.blaxel.ai/Jobs/Batch-Jobs
   */
  async createBatchJob(config: {
    name: string;
    endpoint: string;
    method?: 'POST' | 'GET' | 'PUT';
    headers?: Record<string, string>;
    payload?: any;
    concurrency?: number;
  }): Promise<{ jobId: string; endpoint: string }> {
    const client = await this.ensureClient()
    try {
      return await client.jobs.createBatch({
        name: config.name,
        endpoint: config.endpoint,
        method: config.method || 'POST',
        headers: config.headers,
        payload: config.payload,
        concurrency: config.concurrency,
      })
    } catch (error: any) {
      console.error('[Blaxel] createBatchJob failed:', error.message)
      throw new Error(`Batch job creation failed: ${error.message}`)
    }
  }

  /**
   * Trigger batch execution via HTTP endpoint
   * @see https://docs.blaxel.ai/Jobs/Batch-Jobs#http-trigger
   */
  async triggerBatchExecution(jobId: string, inputData: any[]): Promise<{ executionId: string; status: string }> {
    const client = await this.ensureClient()
    try {
      return await client.jobs.trigger(jobId, { data: inputData })
    } catch (error: any) {
      console.error('[Blaxel] triggerBatchExecution failed:', error.message)
      throw new Error(`Batch trigger failed: ${error.message}`)
    }
  }

  // ============================================
  // Extended Features: Deploy Agent
  // ============================================

  /**
   * Deploy an agent for delegated tasks (e.g., hosting OpenClaw for more agency)
   * @see https://docs.blaxel.ai/Agents/Deploy-agent
   */
  async deployAgent(config: {
    name: string;
    image: string;
    command?: string[];
    env?: Record<string, string>;
    ports?: number[];
    resources?: {
      memory?: number;
      cpu?: number;
    };
  }): Promise<{ agentId: string; url: string; status: string }> {
    const client = await this.ensureClient()
    try {
      return await client.agents.deploy({
        name: config.name,
        image: config.image,
        command: config.command,
        env: config.env,
        ports: config.ports,
        resources: config.resources,
      })
    } catch (error: any) {
      console.error('[Blaxel] deployAgent failed:', error.message)
      throw new Error(`Agent deployment failed: ${error.message}`)
    }
  }

  /**
   * Get deployed agent status
   */
  async getAgentStatus(agentId: string): Promise<{ status: string; url?: string; metrics?: any }> {
    const client = await this.ensureClient()
    try {
      return await client.agents.getStatus(agentId)
    } catch (error: any) {
      console.error('[Blaxel] getAgentStatus failed:', error.message)
      throw new Error(`Get agent status failed: ${error.message}`)
    }
  }

  /**
   * Stop and remove a deployed agent
   */
  async destroyAgent(agentId: string): Promise<{ success: boolean }> {
    const client = await this.ensureClient()
    try {
      return await client.agents.destroy(agentId)
    } catch (error: any) {
      console.error('[Blaxel] destroyAgent failed:', error.message)
      throw new Error(`Destroy agent failed: ${error.message}`)
    }
  }

  // ============================================
  // Extended Features: Ports and Previews
  // ============================================

  /**
   * Create a port mapping for external access
   * @see https://docs.blaxel.ai/Networking/Ports
   */
  async createPort(port: number, protocol: 'http' | 'tcp' = 'http'): Promise<{ port: number; url: string }> {
    const client = await this.ensureClient()
    try {
      return await client.ports.create({ port, protocol })
    } catch (error: any) {
      console.error('[Blaxel] createPort failed:', error.message)
      throw new Error(`Port creation failed: ${error.message}`)
    }
  }

  /**
   * Get all port mappings
   */
  async listPorts(): Promise<Array<{ port: number; protocol: string; url: string }>> {
    const client = await this.ensureClient()
    try {
      return await client.ports.list()
    } catch (error: any) {
      console.error('[Blaxel] listPorts failed:', error.message)
      throw new Error(`List ports failed: ${error.message}`)
    }
  }

  /**
   * Delete a port mapping
   */
  async deletePort(port: number): Promise<{ success: boolean }> {
    const client = await this.ensureClient()
    try {
      return await client.ports.delete(port)
    } catch (error: any) {
      console.error('[Blaxel] deletePort failed:', error.message)
      throw new Error(`Delete port failed: ${error.message}`)
    }
  }

  /**
   * Create a preview URL for temporary sharing
   * @see https://docs.blaxel.ai/Networking/Previews
   */
  async createPreview(port: number, options?: {
    expiresIn?: number;
    auth?: { username: string; password: string };
  }): Promise<{ previewUrl: string; expiresAt: string }> {
    const client = await this.ensureClient()
    try {
      return await client.previews.create({ port, ...options })
    } catch (error: any) {
      console.error('[Blaxel] createPreview failed:', error.message)
      throw new Error(`Preview creation failed: ${error.message}`)
    }
  }

  /**
   * List all preview URLs
   */
  async listPreviews(): Promise<Array<{ previewUrl: string; port: number; expiresAt: string }>> {
    const client = await this.ensureClient()
    try {
      return await client.previews.list()
    } catch (error: any) {
      console.error('[Blaxel] listPreviews failed:', error.message)
      throw new Error(`List previews failed: ${error.message}`)
    }
  }

  /**
   * Delete a preview URL
   */
  async deletePreview(previewUrl: string): Promise<{ success: boolean }> {
    const client = await this.ensureClient()
    try {
      return await client.previews.delete(previewUrl)
    } catch (error: any) {
      console.error('[Blaxel] deletePreview failed:', error.message)
      throw new Error(`Delete preview failed: ${error.message}`)
    }
  }
}

import { SandboxSecurityManager } from '../security-manager'

export class BlaxelSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = WORKSPACE_DIR
  private sandbox: any
  private metadata: BlaxelSandboxMetadata
  private static callbackSecrets = new Map<string, string>()

  constructor(sandbox: any, metadata: BlaxelSandboxMetadata) {
    this.sandbox = sandbox
    this.metadata = metadata
    this.id = metadata.name
  }

  /**
   * Execute agent request asynchronously with callback
   * 
   * @see https://docs.blaxel.ai/Agents/Asynchronous-triggers
   */
  async executeAgentAsync(config: {
    agent: string;
    input: string;
    callbackUrl?: string;
  }): Promise<{ success: boolean; executionId?: string; error?: string }> {
    try {
      const response = await fetch(
        `${this.metadata.url}/agents/${config.agent}?async=true`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.BLAXEL_API_KEY}`,
          },
          body: JSON.stringify({ input: config.input }),
        }
      );

      if (!response.ok) {
        throw new Error(`Blaxel async execution failed: ${response.statusText}`);
      }

      const result = await response.json();
      
      return {
        success: true,
        executionId: result.executionId,
      };
    } catch (error: any) {
      console.error('[Blaxel] Async execution failed:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Register callback URL for async execution
   *
   * SECURITY: Callback secrets are now encrypted before storage
   * using AES-256-GCM authenticated encryption
   *
   * @see https://docs.blaxel.ai/Agents/Asynchronous-triggers#verify-a-callback-using-its-signature
   */
  async registerCallback(agent: string, callbackUrl: string): Promise<{ secret: string; success: boolean }> {
    try {
      // Generate secure random secret
      const secret = generateSecureSecret(32); // 64 character hex string
      const key = `${this.id}:${agent}`;

      // Store in memory (unencrypted for quick access)
      BlaxelSandboxHandle.callbackSecrets.set(key, secret);

      // Persist to database (ENCRYPTED)
      await this.persistCallbackSecret(key, secret);

      return { secret, success: true };
    } catch (error: any) {
      console.error('[Blaxel] Callback registration failed:', error);
      return { secret: '', success: false };
    }
  }

  /**
   * Get callback secret for verification
   * 
   * SECURITY: Secrets are decrypted on retrieval from database
   */
  async getCallbackSecret(agent: string): Promise<string | null> {
    const key = `${this.id}:${agent}`;

    // Try memory first (already decrypted)
    const cached = BlaxelSandboxHandle.callbackSecrets.get(key);
    if (cached) return cached;

    // Try database (will decrypt)
    return await this.loadCallbackSecret(key);
  }

  /**
   * Persist callback secret to database WITH ENCRYPTION
   * 
   * SECURITY: Uses AES-256-GCM authenticated encryption
   * Format: iv:authTag:encryptedData (all hex encoded)
   */
  private async persistCallbackSecret(key: string, secret: string): Promise<void> {
    try {
      const db = getDatabase();
      
      // Encrypt the secret before storing
      const encryptedSecret = ENCRYPTION_KEY_ENV 
        ? encryptSecret(secret, ENCRYPTION_KEY_ENV)
        : secret; // Fallback to plaintext if no key (dev only)
      
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO blaxel_callback_secrets
        (sandbox_id, agent, secret_encrypted, created_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `);
      stmt.run(this.id, key, encryptedSecret);
      
      if (ENCRYPTION_KEY_ENV) {
        console.log('[Blaxel] Callback secret encrypted and persisted');
      }
    } catch (error) {
      console.error('[Blaxel] Failed to persist callback secret:', error);
    }
  }

  /**
   * Load callback secret from database WITH DECRYPTION
   * 
   * SECURITY: Decrypts secret on retrieval
   * Validates encryption format before decryption
   */
  private async loadCallbackSecret(key: string): Promise<string | null> {
    try {
      const db = getDatabase();
      const stmt = db.prepare('SELECT secret_encrypted FROM blaxel_callback_secrets WHERE sandbox_id = ? AND agent = ?');
      const row = stmt.get(this.id, key) as { secret_encrypted: string } | undefined;
      
      if (!row?.secret_encrypted) {
        return null;
      }
      
      const encryptedSecret = row.secret_encrypted;
      
      // Check if it's in encrypted format
      // If not, it's from old unencrypted storage (migration path)
      if (!encryptedSecret.includes(':')) {
        console.warn('[Blaxel] Found unencrypted secret, migrating to encrypted storage');
        // Re-encrypt and update
        if (ENCRYPTION_KEY_ENV) {
          const reEncrypted = encryptSecret(encryptedSecret, ENCRYPTION_KEY_ENV);
          const updateStmt = db.prepare('UPDATE blaxel_callback_secrets SET secret_encrypted = ? WHERE sandbox_id = ? AND agent = ?');
          updateStmt.run(reEncrypted, this.id, key);
        }
        return encryptedSecret;
      }
      
      // Decrypt the secret
      if (ENCRYPTION_KEY_ENV) {
        try {
          const decrypted = decryptSecret(encryptedSecret, ENCRYPTION_KEY_ENV);
          return decrypted;
        } catch (decryptError: any) {
          console.error('[Blaxel] Failed to decrypt callback secret:', decryptError.message);
          return null;
        }
      } else {
        // Dev mode without encryption key
        console.warn('[Blaxel] Loading encrypted secret without encryption key (dev mode)');
        return encryptedSecret;
      }
    } catch (error) {
      console.error('[Blaxel] Failed to load callback secret:', error);
      return null;
    }
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    const effectiveTimeout = timeout ?? 60_000

    try {
      // ✅ ENHANCED: Use combined validation and sanitization
      const sanitized = SandboxSecurityManager.validateAndSanitizeCommand(command)
      
      // Blaxel sandboxes support run() method for command execution
      const result = await this.sandbox.run({
        command: ['bash', '-c', sanitized],
        timeout: effectiveTimeout,
        cwd: cwd || WORKSPACE_DIR,
      })

      return {
        success: result.exitCode === 0,
        output: result.stdout || result.stderr || '',
        exitCode: result.exitCode,
      }
    } catch (error: any) {
      // Security exceptions should be logged but not expose details
      if (error.message?.includes('Security Exception')) {
        console.warn('[Blaxel] Security validation failed:', error.message)
        return {
          success: false,
          output: 'Security validation failed',
        }
      }
      
      if (error.message?.includes('timed out') || error.code === 'TIMEOUT') {
        return {
          success: false,
          output: `Command timed out after ${effectiveTimeout}ms`,
          exitCode: 124,
        }
      }
      throw error
    }
  }

  /**
   * Execute command asynchronously (for long-running tasks)
   *
   * Unlike executeCommand which blocks, this returns immediately
   * and the task runs in the background for up to 15 minutes.
   *
   * @param config - Async execution configuration
   * @returns Async execution result
   *
   * @see https://docs.blaxel.ai/Agents/Asynchronous-triggers
   */
  async executeAsync(
    config: AsyncExecutionConfig
  ): Promise<AsyncExecutionResult> {
    try {
      // ✅ ENHANCED: Use combined validation and sanitization
      const sanitized = SandboxSecurityManager.validateAndSanitizeCommand(config.command)

      // Use Blaxel async execution via SDK if available
      if (this.sandbox.runAsync) {
        const result = await this.sandbox.runAsync({
          command: ['bash', '-c', sanitized],
          cwd: (config as any).cwd || WORKSPACE_DIR,
          timeout: config.timeout || 900000, // 15 minutes max
          callbackUrl: config.callbackUrl,
        })

        return {
          executionId: result.executionId,
          status: 'started',
          callbackUrl: config.callbackUrl,
        }
      }

      // Fallback to fetch if SDK method not available
      const apiKey = process.env.BLAXEL_API_KEY
      const response = await fetch(`${this.metadata.url}?async=true`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: sanitized,
          callbackUrl: config.callbackUrl,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      return {
        executionId: data.executionId,
        status: 'started',
        callbackUrl: config.callbackUrl,
      }
    } catch (error: any) {
      // Security exceptions should be logged but not expose details
      if (error.message?.includes('Security Exception')) {
        console.warn('[Blaxel] Security validation failed:', error.message)
        throw new Error('Security validation failed')
      }
      
      console.error('[Blaxel] Async execution failed:', error.message)
      throw new Error(`Async execution failed: ${error.message}`)
    }
  }

  /**
   * Get async execution status
   * 
   * @param executionId - Execution ID from executeCommandAsync
   * @returns Current execution status
   */
  async getAsyncExecutionStatus(
    executionId: string
  ): Promise<{
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    output?: string;
    exitCode?: number;
    error?: string;
  }> {
    try {
      const status = await this.sandbox.getExecutionStatus(executionId);
      
      return {
        status: status.state || 'pending',
        output: status.stdout,
        exitCode: status.exitCode,
        error: status.error,
      };
    } catch (error: any) {
      console.error('[Blaxel] Failed to get async status:', error);
      throw error;
    }
  }

  /**
   * Cancel async execution
   * 
   * @param executionId - Execution ID to cancel
   */
  async cancelAsyncExecution(executionId: string): Promise<void> {
    try {
      await this.sandbox.cancelExecution(executionId);
    } catch (error: any) {
      console.error('[Blaxel] Failed to cancel execution:', error);
      throw error;
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      // ✅ ENHANCED: Use combined validation for path and content
      const { resolvedPath, validatedContent } = SandboxSecurityManager.validateWriteFile(
        filePath,
        content,
        WORKSPACE_DIR
      )

      // Blaxel SDK provides fs.write for file operations
      await this.sandbox.fs.write(resolvedPath, validatedContent)
      return {
        success: true,
        output: `File written: ${resolvedPath}`,
        exitCode: 0,
      }
    } catch (error: any) {
      // Security exceptions should be logged but not expose details
      if (error.message?.includes('Security Exception')) {
        console.warn('[Blaxel] Security validation failed:', error.message)
        return {
          success: false,
          output: 'Security validation failed',
          exitCode: 1,
        }
      }
      
      return {
        success: false,
        output: error.message,
        exitCode: 1,
      }
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    try {
      // ✅ ENHANCED: Validate path before reading
      const resolved = SandboxSecurityManager.resolvePath(WORKSPACE_DIR, filePath)
      
      const content = await this.sandbox.fs.read(resolved)
      return {
        success: true,
        output: content,
        exitCode: 0,
      }
    } catch (error: any) {
      // Security exceptions should be logged but not expose details
      if (error.message?.includes('Security Exception')) {
        console.warn('[Blaxel] Security validation failed:', error.message)
        return {
          success: false,
          output: 'Security validation failed',
          exitCode: 1,
        }
      }
      
      return {
        success: false,
        output: error.message,
        exitCode: 1,
      }
    }
  }

  async listDirectory(dirPath?: string): Promise<ToolResult> {
    try {
      // ✅ ENHANCED: Validate path before listing
      const resolved = SandboxSecurityManager.resolvePath(WORKSPACE_DIR, dirPath || '.')
      
      const result = await this.executeCommand(`ls -la '${resolved}'`)
      return result
    } catch (error: any) {
      // Security exceptions should be logged but not expose details
      if (error.message?.includes('Security Exception')) {
        console.warn('[Blaxel] Security validation failed:', error.message)
        return {
          success: false,
          output: 'Security validation failed',
          exitCode: 1,
        }
      }
      
      return {
        success: false,
        output: error.message,
        exitCode: 1,
      }
    }
  }

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    // Blaxel provides URL in metadata
    return {
      port,
      url: this.metadata.url || `https://${this.id}.blaxel.ai`,
      token: undefined,
    }
  }

  async getProviderInfo(): Promise<any> {
    return {
      provider: 'blaxel',
      region: this.metadata.region,
      status: this.metadata.status.toLowerCase() as any,
      url: this.metadata.url,
      createdAt: new Date().toISOString(),
      expiresIn: this.metadata.expiresIn,
    }
  }

  async createPty(_options: PtyOptions): Promise<PtyHandle> {
    throw new Error('Blaxel does not support PTY sessions. Use Sprites or Daytona for interactive terminal access.')
  }

  /**
   * Run batch job with multiple tasks (parallel execution)
   * Ideal for: data processing, bulk code execution, AI batch inference
   * 
   * Note: This requires a deployed Blaxel job. For ad-hoc code execution,
   * use executeCommand() or executeAsync() instead.
   */
  async runBatchJob(tasks: BatchTask[], config?: BatchJobConfig): Promise<BatchJobResult> {
    try {
      // Import Blaxel core for job management
      const { blJob } = await import('@blaxel/core')
      
      const jobName = config?.name || `job-${Date.now()}`
      const job = blJob(jobName)
      
      // Create execution request with tasks
      const executionId = await job.createExecution({
        tasks: tasks.map(t => t.data),
        memory: config?.runtime?.memory,
        env: config?.runtime?.timeout ? { TIMEOUT_MS: String(config.runtime.timeout) } : undefined,
      })
      
      // Poll for completion
      const result = await this.pollJobCompletion(job, executionId, config?.runtime?.timeout || 300)
      
      quotaManager.recordUsage('blaxel', tasks.length)
      
      return {
        jobId: executionId,
        status: result.status as any,
        totalTasks: tasks.length,
        completedTasks: result.completedTasks || 0,
        failedTasks: result.failedTasks || 0,
        results: result.taskResults || [],
      }
    } catch (error: any) {
      console.error('[Blaxel] Batch job failed:', error.message)
      throw new Error(`Batch job failed: ${error.message}`)
    }
  }

  /**
   * Schedule recurring job (cron)
   * 
   * DEPRECATED: Cron scheduling is configured via blaxel.toml, not runtime SDK.
   * Use the Blaxel CLI or Console to configure scheduled jobs.
   * 
   * @see https://docs.blaxel.ai/Jobs/Overview
   * @see https://docs.blaxel.ai/Jobs/Deploy-a-job
   * 
   * @deprecated Use blaxel.toml configuration or Blaxel Console instead
   */
  async scheduleJob(_schedule: string, _tasks?: BatchTask[]): Promise<{ scheduleId: string }> {
    throw new Error(
      'Cron scheduling is not supported via SDK. Configure scheduled jobs via blaxel.toml or the Blaxel Console. ' +
      'See: https://docs.blaxel.ai/Jobs/Overview'
    )
  }

  /**
   * Execute asynchronously with automatic callback signature verification setup
   * Stores callback secret for later verification
   */
  async executeAsyncWithVerifiedCallback(
    config: AsyncExecutionConfig & { callbackSecret?: string }
  ): Promise<AsyncExecutionResult & { verified: boolean }> {
    try {
      const result = await this.executeAsync(config)

      // Store callback secret for later verification if provided
      if (config.callbackSecret) {
        await this.storeCallbackSecret(result.executionId, config.callbackSecret)
      }

      return {
        ...result,
        verified: !!config.callbackSecret
      }
    } catch (error: any) {
      console.error('[Blaxel] Verified async execution failed:', error.message)
      throw error
    }
  }

  /**
   * Stream sandbox logs in real-time
   * Returns an async iterable iterator for log consumption
   */
  async streamLogs(options?: {
    follow?: boolean
    tail?: number
    since?: string
  }): Promise<AsyncIterableIterator<LogEntry>> {
    try {
      const apiKey = process.env.BLAXEL_API_KEY
      const follow = options?.follow ?? true
      const tail = options?.tail ?? 100

      const url = `${this.metadata.url}/logs?follow=${follow}&tail=${tail}`

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('No response body for log stream')
      }

      return this.createLogStreamIterator(response.body)
    } catch (error: any) {
      console.error('[Blaxel] Log streaming failed:', error.message)
      throw error
    }
  }

  /**
   * Create async iterator for log stream
   */
  private async *createLogStreamIterator(
    body: ReadableStream<Uint8Array>
  ): AsyncIterableIterator<LogEntry> {
    const reader = body.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.trim()) continue

          // Parse log line format: timestamp message
          const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d+Z)\s+(.*)$/)
          if (match) {
            yield {
              timestamp: match[1],
              message: match[2],
              level: 'info'
            }
          } else {
            yield {
              timestamp: new Date().toISOString(),
              message: line,
              level: 'info'
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Store callback secret for later verification
   * Uses class-level Map for persistence across method calls
   */
  private async storeCallbackSecret(executionId: string, secret: string): Promise<void> {
    BlaxelSandboxHandle.callbackSecrets.set(executionId, secret)

    setTimeout(() => BlaxelSandboxHandle.callbackSecrets.delete(executionId), 15 * 60 * 1000)
  }

  /**
   * Call another Blaxel agent (microservice handoff)
   * Ideal for: multi-stage pipelines, specialized agent orchestration
   */
  async callAgent(config: { targetAgent: string; input: any; waitForCompletion?: boolean }): Promise<any> {
    try {
      const blaxelCore = await import('@blaxel/core') as any
      
      const agent = blaxelCore.blAgent(config.targetAgent)
      const result = await agent.run(config.input)
      
      if (config.waitForCompletion === false) {
        // Return async execution handle - result may be string or object
        return { executionId: result?.id || String(result), status: 'started' }
      }
      
      return result
    } catch (error: any) {
      console.error('[Blaxel] Agent handoff failed:', error.message)
      throw new Error(`Agent handoff failed: ${error.message}`)
    }
  }

  /**
   * Verify webhook callback signature (security)
   * Static method for use in webhook handlers
   */
  static async verifyCallbackSignature(request: any, secret: string): Promise<boolean> {
    try {
      const { verifyWebhookFromRequest } = await import('@blaxel/core')
      return verifyWebhookFromRequest(request, secret)
    } catch (error: any) {
      console.error('[Blaxel] Callback signature verification failed:', error.message)
      return false
    }
  }

  /**
   * Create Express middleware for callback verification
   * Use with webhook endpoints receiving async execution callbacks
   * 
   * @example
   * ```typescript
   * app.post('/api/callback', 
   *   BlaxelSandboxHandle.verifyCallbackMiddleware(process.env.BLAXEL_CALLBACK_SECRET!),
   *   handleCallback
   * )
   * ```
   */
  static verifyCallbackMiddleware(secret: string) {
    return async (req: any, res: any, next: any) => {
      try {
        const isValid = await BlaxelSandboxHandle.verifyCallbackSignature(req, secret)
        
        if (!isValid) {
          return res.status(401).json({ error: 'Invalid signature' })
        }
        
        next()
      } catch (error: any) {
        console.error('[Blaxel] Callback verification error:', error.message)
        res.status(500).json({ error: 'Verification failed' })
      }
    }
  }

  private async pollJobCompletion(job: any, executionId: string, timeoutSeconds: number = 300): Promise<any> {
    const startTime = Date.now()
    const timeoutMs = timeoutSeconds * 1000

    while (Date.now() - startTime < timeoutMs) {
      try {
        const status = await job.getExecutionStatus(executionId)

        if (status === 'completed' || status === 'failed') {
          const execution = await job.getExecution(executionId)
          return {
            status: status,
            completedTasks: execution?.completedTasks || 0,
            failedTasks: execution?.failedTasks || 0,
            taskResults: execution?.taskResults || [],
          }
        }
      } catch (error) {
        // Continue polling on transient errors
        console.warn('[Blaxel] Polling error:', error)
      }

      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    throw new Error(`Job ${executionId} timed out after ${timeoutSeconds}s`)
  }
}

// Re-export static methods from BlaxelSandboxHandle for easier access
export const { verifyCallbackSignature, verifyCallbackMiddleware } = BlaxelSandboxHandle
