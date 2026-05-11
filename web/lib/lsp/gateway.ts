/**
 * gateway.ts — LSP Gateway
 *
 * The app talks to ONE thing: the LspGateway.
 * The gateway manages multiple LSPAdapter instances behind the scenes,
 * auto-spawns adapters based on workspace config files, and routes
 * file operations to the correct adapter by extension/languageId.
 *
 * Architecture:
 *   Next.js App
 *       ↓
 *   LspGateway  ←── one API
 *       ↓
 *   Language Runtime Pool
 *    ├── typescript-language-server
 *    ├── rust-analyzer
 *    ├── pyright
 *    └── others
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { LspClient } from './client';
import { diagnosticBus, type UnifiedDiagnostic, type DiagnosticSource } from './diagnostic-bus';
import { pathToUri } from './path-utils';
import {
  type LSPAdapter,
  type LSPAdapterConfig,
  WORKSPACE_INDICATORS,
} from './adapter';
import { RemoteLspAdapter, type RemoteLspAdapterConfig } from './remote-lsp-adapter';

// ─── Execution mode ────────────────────────────────────────────────────────────

/**
 * Controls where LSP servers run:
 *
 *   'local'  — Spawn language servers via child_process inside the Next.js process.
 *              This is convenient for local development but is NOT recommended for
 *              production because LSPs are memory-intensive, expect a real filesystem,
 *              and can crash the Next.js server.
 *
 *   'remote' — Connect to language servers running in a dedicated container/sandbox
 *              over WebSocket. This is the PRODUCTION-RECOMMENDED mode. LSPs get a
 *              real filesystem with installed deps, proper workspace indexing, and
 *              process isolation from the Next.js server.
 *
 * Set via environment variable: LSP_EXECUTION_MODE=local|remote
 * Defaults to 'local' for dev convenience, but prints a warning in production.
 */
export type LspExecutionMode = 'local' | 'remote';

function getLspExecutionMode(): LspExecutionMode {
  const envMode = process.env.LSP_EXECUTION_MODE;
  if (envMode === 'remote') return 'remote';
  if (envMode === 'local') return 'local';

  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  if (isProduction) {
    console.warn(
      '[LSP] LSP_EXECUTION_MODE not set. Defaulting to "local".\n' +
      '      In-process LSP is NOT recommended for production.\n' +
      '      Set LSP_EXECUTION_MODE=remote and provide SANDBOX_LSP_WS_URL to use a dedicated LSP container.'
    );
  }
  return 'local';
}

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface GatewayOptions {
  /** Workspace root directory */
  projectRoot?: string;
  /** Manually specified adapters (bypasses auto-detection) */
  adapters?: LSPAdapter[];
  /** If true, auto-detect language servers from workspace config files */
  autoDetect?: boolean;
}

// ─── Built-in LspClientAdapter ──────────────────────────────────────────────────

/**
 * Wraps the generic LspClient into an LSPAdapter.
 * This is the go-to implementation for any stdio-based language server.
 */
export class LspClientAdapter implements LSPAdapter {
  private client: LspClient;
  private _ready = false;
  private openDocs = new Map<string, { version: number; languageId: string }>();

  readonly name: string;
  readonly languageIds: string[];
  readonly extensions: string[];
  readonly diagnosticSource: DiagnosticSource;

  constructor(config: LSPAdapterConfig) {
    this.name = config.name;
    this.languageIds = config.languageIds;
    this.extensions = config.extensions;
    this.diagnosticSource = config.diagnosticSource;

    // ── Production guard ──────────────────────────────────────────────────────
    // In-process LSP servers are memory-intensive and expect a real filesystem.
    // In production (especially on Vercel/serverless), spawning child_process
    // can cause OOM crashes, cold-start slowness, and missing workspace deps.
    //
    // The production-recommended path is RemoteLspAdapter (containerized LSP).
    // To override this guard in controlled environments, set:
    //   LSP_EXECUTION_MODE=local_override
    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
    const isOverride = process.env.LSP_EXECUTION_MODE === 'local_override';
    if (isProduction && !isOverride) {
      console.error(
        `⛔ [${this.name}] Refusing to spawn in-process LSP server in production.\n` +
        `   LSP servers are memory-intensive and expect a real filesystem with installed deps.\n` +
        `   Use RemoteLspAdapter instead: set LSP_EXECUTION_MODE=remote, SANDBOX_LSP_WS_URL,\n` +
        `   and optionally SANDBOX_LSP_AUTH_TOKEN for authentication.\n` +
        `   To force in-process LSP anyway, set LSP_EXECUTION_MODE=local_override.`
      );
      throw new Error(
        `[${this.name}] In-process LSP forbidden in production. Use RemoteLspAdapter.`
      );
    }

    this.client = new LspClient({
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
      diagnosticSource: config.diagnosticSource,
      onStderr: (line) => {
        if (line.includes('Error') || line.includes('error')) {
          console.error(`[${this.name}-lsp] ${line}`);
        }
      },
      onError: (err) => {
        console.error(`[${this.name}-lsp] Process error:`, err.message);
      },
      onExit: (code) => {
        console.log(`[${this.name}-lsp] Exited with code ${code}`);
      },
    });
  }

  get isReady(): boolean {
    return this._ready;
  }

  async initialize(rootUri: string): Promise<void> {
    await this.client.start(rootUri);
    this._ready = true;
    console.log(`[${this.name}-lsp] Initialized`);
  }

  async shutdown(): Promise<void> {
    this._ready = false;
    this.openDocs.clear();
    await this.client.stop();
    diagnosticBus.clear(this.diagnosticSource);
  }

  async syncFile(filePath: string, content: string, languageId?: string): Promise<void> {
    if (!this._ready) return;

    const uri = pathToUri(filePath);
    if (!content && !this.openDocs.has(uri)) return;

    const lid = languageId || this.inferLanguageId(filePath);
    const existing = this.openDocs.get(uri);

    if (!existing) {
      this.client.didOpen(uri, lid, content);
      this.openDocs.set(uri, { version: 1, languageId: lid });
    } else {
      const newVersion = existing.version + 1;
      this.client.didChange(uri, content, newVersion);
      this.openDocs.set(uri, { version: newVersion, languageId: lid });
    }
  }

  closeFile(filePath: string): void {
    if (!this._ready) return;
    const uri = pathToUri(filePath);
    this.client.didClose(uri);
    this.openDocs.delete(uri);
  }

  getDiagnostics(filePath: string): UnifiedDiagnostic[] {
    return diagnosticBus.getForFile(filePath, this.diagnosticSource);
  }

  async waitForDiagnostics(filePath: string, timeoutMs = 3000): Promise<UnifiedDiagnostic[]> {
    return new Promise((resolve) => {
      const existing = diagnosticBus.getForFile(filePath, this.diagnosticSource);
      if (existing.length > 0) {
        resolve(existing);
        return;
      }

      const timer = setTimeout(() => {
        unsubscribe();
        resolve(diagnosticBus.getForFile(filePath, this.diagnosticSource));
      }, timeoutMs);

      const unsubscribe = diagnosticBus.subscribe((_all, updatedFiles) => {
        if (updatedFiles.includes(filePath)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(diagnosticBus.getForFile(filePath, this.diagnosticSource));
        }
      });
    });
  }

  /** Guess language ID from file extension using the adapter's own extension→languageId mapping */
  private inferLanguageId(filePath: string): string {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    const idx = this.extensions.indexOf(ext);
    if (idx >= 0 && idx < this.languageIds.length) return this.languageIds[idx];
    return 'plaintext';
  }
}

// ─── Gateway ───────────────────────────────────────────────────────────────────

export class LspGateway {
  private adapters: LSPAdapter[] = [];
  private projectRoot: string;
  private started = false;

  constructor(opts: GatewayOptions = {}) {
    this.projectRoot = opts.projectRoot || process.cwd();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Start the gateway: auto-detect workspace configs, spawn adapters,
   * and initialize all language servers.
   */
  async start(opts: GatewayOptions = {}): Promise<void> {
    if (this.started) return;
    this.started = true;

    const rootUri = `file://${this.projectRoot.replace(/\\/g, '/')}`;

    // 1. Register manually provided adapters
    if (opts.adapters) {
      for (const adapter of opts.adapters) {
        this.adapters.push(adapter);
      }
    }

    // 2. Auto-detect from workspace config files
    if (opts.autoDetect !== false) {
      await this.autoDetectAndSpawn();
    }

    // 3. Initialize all adapters
    const results = await Promise.allSettled(
      this.adapters.map(async (adapter) => {
        try {
          await adapter.initialize(rootUri);
          console.log(`[gateway] ${adapter.name} started`);
        } catch (err) {
          console.warn(`[gateway] ${adapter.name} failed to start:`,
            err instanceof Error ? err.message : String(err));
        }
      })
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[gateway] ${succeeded}/${this.adapters.length} adapters started`);
  }

  /**
   * Shut down all adapters.
   */
  async shutdown(): Promise<void> {
    this.started = false;
    await Promise.allSettled(
      this.adapters.map(async (adapter) => {
        try { await adapter.shutdown(); } catch { /* best effort */ }
      })
    );
    this.adapters = [];
  }

  // ── File routing ───────────────────────────────────────────────────────────

  /**
   * Sync a file to the appropriate language server(s).
   * Routes by file extension to the correct adapter.
   */
  async syncFile(filePath: string, content: string, languageId?: string): Promise<void> {
    const adapter = this.findAdapter(filePath);
    if (!adapter) return;
    await adapter.syncFile(filePath, content, languageId);
  }

  /** Close a file in its adapter */
  closeFile(filePath: string): void {
    const adapter = this.findAdapter(filePath);
    if (adapter) adapter.closeFile(filePath);
  }

  // ── Diagnostics (unified) ──────────────────────────────────────────────────

  /**
   * Get diagnostics for a file from ALL adapters (or a specific one).
   */
  getDiagnostics(filePath: string, source?: DiagnosticSource): UnifiedDiagnostic[] {
    return diagnosticBus.getForFile(filePath, source);
  }

  /**
   * Get diagnostics for a file, waiting for fresh results from its adapter.
   */
  async waitForDiagnostics(filePath: string, timeoutMs = 3000): Promise<UnifiedDiagnostic[]> {
    const adapter = this.findAdapter(filePath);
    if (!adapter) return [];
    return adapter.waitForDiagnostics(filePath, timeoutMs);
  }

  /**
   * Get diagnostics for multiple files across all sources.
   */
  getBatchDiagnostics(filePaths: string[]): Map<string, UnifiedDiagnostic[]> {
    const result = new Map<string, UnifiedDiagnostic[]>();
    for (const fp of filePaths) {
      result.set(fp, diagnosticBus.getForFile(fp));
    }
    return result;
  }

  // ── Adapter management ─────────────────────────────────────────────────────

  /** Register an adapter manually */
  registerAdapter(adapter: LSPAdapter): void {
    this.adapters.push(adapter);
  }

  /** Find the adapter that handles a given file */
  findAdapter(filePath: string): LSPAdapter | undefined {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    return this.adapters.find(a => a.extensions.includes(ext));
  }

  /** List all registered adapters */
  getAdapters(): ReadonlyArray<LSPAdapter> {
    return this.adapters;
  }

  /** Check if any adapter is ready */
  get isReady(): boolean {
    return this.adapters.some(a => a.isReady);
  }

  // ── Auto-detection ─────────────────────────────────────────────────────────

  private async autoDetectAndSpawn(): Promise<void> {
    const mode = getLspExecutionMode();

    for (const [configFile, cfg] of Object.entries(WORKSPACE_INDICATORS)) {
      const configPath = join(this.projectRoot, configFile);
      if (!existsSync(configPath)) continue;

      // Check if an adapter with this name is already registered
      if (this.adapters.some(a => a.name === cfg.name)) continue;

      console.log(`[gateway] Detected ${configFile} — spawning ${cfg.name} (mode: ${mode})`);

      let adapter: LSPAdapter;

      if (mode === 'remote') {
        // Remote mode: connect to LSP running in a container/sandbox over WebSocket.
        // The WebSocket URL can be configured per-language or via a base URL template.
        const wsBaseUrl = process.env.SANDBOX_LSP_WS_URL;
        if (!wsBaseUrl) {
          console.warn(
            `[gateway] LSP_EXECUTION_MODE=remote but SANDBOX_LSP_WS_URL not set. ` +
            `Skipping ${cfg.name} — set SANDBOX_LSP_WS_URL to enable remote LSP.`
          );
          continue;
        }

        // Construct per-language WS URL: wss://sandbox.example.com/lsp/{name}
        const wsUrl = wsBaseUrl.endsWith('/')
          ? `${wsBaseUrl}${cfg.name}`
          : `${wsBaseUrl}/${cfg.name}`;

        adapter = new RemoteLspAdapter({
          name: cfg.name,
          wsUrl,
          languageIds: cfg.languageIds,
          extensions: cfg.extensions,
          diagnosticSource: cfg.diagnosticSource,
          authToken: process.env.SANDBOX_LSP_AUTH_TOKEN,
        });
      } else {
        // Local mode: spawn in-process via child_process (dev only).
        // LspClientAdapter constructor has a production guard that throws
        // unless LSP_EXECUTION_MODE=local_override is set.
        adapter = new LspClientAdapter({
          name: cfg.name,
          command: cfg.command,
          args: cfg.args,
          cwd: this.projectRoot,
          languageIds: cfg.languageIds,
          extensions: cfg.extensions,
          diagnosticSource: cfg.diagnosticSource,
        });
      }

      this.adapters.push(adapter);
    }
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _gateway: LspGateway | null = null;

export function getGateway(opts?: GatewayOptions): LspGateway {
  if (!_gateway) {
    _gateway = new LspGateway(opts);
  }
  return _gateway;
}

export function resetGateway(): void {
  _gateway = null;
}
