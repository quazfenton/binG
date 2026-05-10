/**
 * remote-lsp-adapter.ts — Remote LSP Adapter
 *
 * Implements LSPAdapter by proxying JSON-RPC over a WebSocket connection
 * to a language server running in a dedicated container/sandbox.
 *
 * Architecture (the "good" pattern):
 *   Next.js App
 *       ↓ WebSocket
 *   Container / Sandbox
 *       ↓
 *   Language Server Process (typescript-language-server, rust-analyzer, etc.)
 *
 * This is the PRODUCTION-RECOMMENDED adapter. LSP servers expect:
 *   - Real filesystem (node_modules, tsconfig.json, Cargo.toml)
 *   - Installed dependencies
 *   - Proper workspace indexing
 *
 * They behave MUCH worse when run in-process or against fake/in-memory FS.
 *
 * NOTE: This is the client side only. A companion LSP WebSocket server
 * (e.g., a small Node.js process that wraps `typescript-language-server --stdio`
 * and bridges it to WebSocket) must be deployed in the container alongside
 * the language server binary.
 *
 * Usage:
 *   const adapter = new RemoteLspAdapter({
 *     name: 'typescript',
 *     wsUrl: 'wss://sandbox-abc.e2b.dev/lsp/typescript',
 *     languageIds: ['typescript', 'typescriptreact'],
 *     extensions: ['.ts', '.tsx'],
 *     diagnosticSource: 'ts-lsp',
 *   });
 *   await adapter.initialize('file:///workspace');
 *   await adapter.syncFile('/workspace/src/app.ts', content);
 *   const diags = await adapter.waitForDiagnostics('/workspace/src/app.ts');
 */

import { diagnosticBus, type UnifiedDiagnostic, type DiagnosticSource, SEVERITY_MAP } from './diagnostic-bus';
import { uriToPath, pathToUri } from './path-utils';
import type { LSPAdapter } from './adapter';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface RemoteLspAdapterConfig {
  /** Human-readable name for logging */
  name: string;
  /** WebSocket URL to the containerized LSP service */
  wsUrl: string;
  /** Language IDs this adapter handles */
  languageIds: string[];
  /** File extensions this adapter handles */
  extensions: string[];
  /** Diagnostic source label for the bus */
  diagnosticSource: string & {};
  /** Optional auth token for the WebSocket connection (sent as query param) */
  authToken?: string;
  /** Reconnect delay in ms (default: 2000) */
  reconnectDelayMs?: number;
  /** Max reconnection attempts before giving up (default: 5) */
  maxReconnectAttempts?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─── RemoteLspAdapter ───────────────────────────────────────────────────────────

export class RemoteLspAdapter implements LSPAdapter {
  readonly name: string;
  readonly languageIds: string[];
  readonly extensions: string[];
  readonly diagnosticSource: string & {};

  private wsUrl: string;
  private authToken?: string;
  private reconnectDelayMs: number;
  private maxReconnectAttempts: number;

  private ws: WebSocket | null = null;
  private _ready = false;
  private _connecting = false;
  private _connectPromise: Promise<void> | null = null;
  private messageId = 0;
  private pending = new Map<number, PendingRequest>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private openDocs = new Set<string>();
  private destroyed = false;

  constructor(config: RemoteLspAdapterConfig) {
    this.name = config.name;
    this.wsUrl = config.wsUrl;
    this.languageIds = config.languageIds;
    this.extensions = config.extensions;
    this.diagnosticSource = config.diagnosticSource;
    this.authToken = config.authToken;
    this.reconnectDelayMs = config.reconnectDelayMs ?? 2000;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 5;
  }

  // ── LSPAdapter: Lifecycle ──────────────────────────────────────────────────

  get isReady(): boolean {
    return this._ready && this.ws?.readyState === WebSocket.OPEN;
  }

  async initialize(rootUri: string): Promise<void> {
    if (this.destroyed) throw new Error(`[${this.name}] Adapter is destroyed`);

    await this.connect();

    const result = await this.rpcRequest('initialize', {
      processId: null,
      rootUri,
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          synchronization: { didChange: true },
        },
      },
    });

    this.rpcNotify('initialized', {});

    console.log(`[${this.name}] Remote LSP initialized (server: ${(result as any)?.serverInfo?.name || 'unknown'})`);
    this._ready = true;
  }

  async shutdown(): Promise<void> {
    this.destroyed = true;
    this._ready = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reject all pending requests
    for (const [, pr] of this.pending) {
      clearTimeout(pr.timer);
      pr.reject(new Error(`[${this.name}] Adapter shutting down`));
    }
    this.pending.clear();

    // Send LSP shutdown sequence BEFORE disconnecting
    try {
      await this.rpcRequest('shutdown', null);
    } catch {
      // Best effort
    }

    try {
      this.rpcNotify('exit', null);
    } catch {
      // Best effort (WS may already be closed)
    }

    this.disconnect();
    diagnosticBus.clear(this.diagnosticSource as DiagnosticSource);
    console.log(`[${this.name}] Remote LSP shut down`);
  }

  // ── LSPAdapter: Document sync ──────────────────────────────────────────────

  async syncFile(filePath: string, content: string, languageId?: string): Promise<void> {
    if (!this.isReady) return;
    if (!content && !this.openDocs.has(filePath)) return;

    const uri = pathToUri(filePath);
    const lid = languageId || this.inferLanguageId(filePath);

    if (!this.openDocs.has(uri)) {
      this.rpcNotify('textDocument/didOpen', {
        textDocument: { uri, languageId: lid, version: 1, text: content },
      });
      this.openDocs.add(uri);
    } else {
      this.rpcNotify('textDocument/didChange', {
        textDocument: { uri, version: Date.now() },
        contentChanges: [{ text: content }],
      });
    }
  }

  closeFile(filePath: string): void {
    if (!this.isReady) return;
    const uri = pathToUri(filePath);
    this.rpcNotify('textDocument/didClose', {
      textDocument: { uri },
    });
    this.openDocs.delete(uri);
  }

  // ── LSPAdapter: Diagnostics ────────────────────────────────────────────────

  getDiagnostics(filePath: string): UnifiedDiagnostic[] {
    return diagnosticBus.getForFile(filePath, this.diagnosticSource as DiagnosticSource);
  }

  async waitForDiagnostics(filePath: string, timeoutMs = 3000): Promise<UnifiedDiagnostic[]> {
    return new Promise((resolve) => {
      const existing = diagnosticBus.getForFile(filePath, this.diagnosticSource as DiagnosticSource);
      if (existing.length > 0) {
        resolve(existing);
        return;
      }

      const timer = setTimeout(() => {
        unsubscribe();
        resolve(diagnosticBus.getForFile(filePath, this.diagnosticSource as DiagnosticSource));
      }, timeoutMs);

      const unsubscribe = diagnosticBus.subscribe((_all, updatedFiles) => {
        if (updatedFiles.includes(filePath)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(diagnosticBus.getForFile(filePath, this.diagnosticSource as DiagnosticSource));
        }
      });
    });
  }

  // ── WebSocket connection management ────────────────────────────────────────

  private async connect(): Promise<void> {
    if (this.destroyed) throw new Error(`[${this.name}] Adapter is destroyed`);
    // Wait for in-progress connection instead of returning early - this prevents
    // race conditions where initialize() sends RPC requests on a not-yet-open socket
    if (this._connecting && this._connectPromise) {
      return this._connectPromise;
    }

    this._connectPromise = new Promise((resolve, reject) => {
      void this.connectInternal(resolve, reject);
    });
    return this._connectPromise;
  }

  private async connectInternal(
    resolve: (value: void) => void,
    reject: (error: Error) => void
  ): Promise<void> {
    this._connecting = true;
    try {
      // Try Node 22+ global WebSocket first, then fall back to 'ws' package
      let WS: any = (globalThis as any).WebSocket;
      let useWsPackage = false;
      if (!WS) {
        try {
          const wsModule = await import('ws');
          WS = wsModule.default || wsModule;
          useWsPackage = true;
        } catch {
          throw new Error(
            `[${this.name}] WebSocket not available. Install the 'ws' package: npm install ws`
          );
        }
      }

      // Append auth token to URL as query parameter if configured
      let url = this.wsUrl;
      if (this.authToken) {
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}token=${encodeURIComponent(this.authToken)}`;
      }

      // When using the 'ws' package, pass auth header for better security
      // (query params appear in proxy logs; headers don't)
      if (useWsPackage && this.authToken) {
        this.ws = new WS(url, {
          headers: { Authorization: `Bearer ${this.authToken}` },
        } as any) as WebSocket;
      } else {
        this.ws = new WS(url) as WebSocket;
      }

      this.ws.onopen = () => {
        console.log(`[${this.name}] WebSocket connected to ${this.wsUrl}`);
        this._connecting = false;
        this._connectPromise = null;
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string);
          this.dispatchMessage(msg);
        } catch (err) {
          console.error(`[${this.name}] Failed to parse WS message:`, (event.data as string)?.slice(0, 200));
        }
      };

      this.ws.onerror = (err: Event) => {
        console.error(`[${this.name}] WebSocket error:`, err);
        if (!this._ready) {
          this._connecting = false;
          this._connectPromise = null;
          reject(new Error(`[${this.name}] WebSocket connection failed`));
        }
      };

      this.ws.onclose = (event: CloseEvent) => {
        console.log(`[${this.name}] WebSocket closed (code: ${event.code})`);
        this._connecting = false;
        this._connectPromise = null;
        this._ready = false;

        // Reject pending requests
        for (const [, pr] of this.pending) {
          clearTimeout(pr.timer);
          pr.reject(new Error(`[${this.name}] Connection closed`));
        }
        this.pending.clear();

        // Auto-reconnect (unless destroyed)
        if (!this.destroyed && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      this._connecting = false;
      this._connectPromise = null;
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this._connecting) return;

    this.reconnectAttempts++;
    const delay = this.reconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1);

    console.warn(
      `[${this.name}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(async () => {
      if (this.destroyed) return;
      try {
        await this.connect();
        console.log(`[${this.name}] Reconnected successfully`);
      } catch {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        } else {
          console.error(`[${this.name}] Max reconnect attempts reached. LSP unavailable.`);
        }
      }
    }, delay);
  }

  private disconnect(): void {
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect on intentional close
      this.ws.close();
      this.ws = null;
    }
    this._connecting = false;
    this._connectPromise = null;
    this.openDocs.clear();
  }

  // ── JSON-RPC message dispatch ──────────────────────────────────────────────

  private dispatchMessage(msg: Record<string, unknown>): void {
    // Response to a pending request
    if (msg.id !== undefined && this.pending.has(msg.id as number)) {
      const pr = this.pending.get(msg.id as number)!;
      clearTimeout(pr.timer);
      this.pending.delete(msg.id as number);

      if (msg.error) {
        const err = msg.error as { code: number; message: string };
        pr.reject(new Error(`LSP error ${err.code}: ${err.message}`));
      } else {
        pr.resolve(msg.result);
      }
      return;
    }

    // Server→client notification
    if (msg.method) {
      this.handleNotification(msg.method as string, msg.params as Record<string, unknown>);
    }
  }

  /** Handle server-push notifications (diagnostics, log messages, etc.) */
  private handleNotification(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case 'textDocument/publishDiagnostics': {
        const uri = params.uri as string;
        const diagnostics = (params.diagnostics as Array<Record<string, unknown>>) || [];
        const filePath = uriToPath(uri);

        if (diagnostics.length === 0) {
          diagnosticBus.upsert(this.diagnosticSource as DiagnosticSource, [], [filePath]);
        } else {
          const items: Omit<UnifiedDiagnostic, 'id' | 'timestamp' | 'source'>[] = [];
          for (const d of diagnostics) {
            const range = d.range as {
              start: { line: number; character: number };
              end: { line: number; character: number };
            } | undefined;
            items.push({
              file: filePath,
              message: (d.message as string) || 'Unknown diagnostic',
              severity: SEVERITY_MAP[d.severity as number] || 'info',
              line: range ? range.start.line + 1 : undefined,
              column: range ? range.start.character + 1 : undefined,
              code: d.code as string | number | undefined,
              context: d.source as string | undefined,
            });
          }
          diagnosticBus.upsert(this.diagnosticSource as DiagnosticSource, items, [filePath]);
        }
        break;
      }

      case 'window/logMessage': {
        const type = params.type as number;
        const message = params.message as string;
        const level = type === 1 ? 'error' : type === 2 ? 'warn' : 'info';
        console.log(`[${this.name}/${level}] ${message}`);
        break;
      }

      default:
        // Ignore unknown notifications
        break;
    }
  }

  // ── JSON-RPC primitives ────────────────────────────────────────────────────

  private rpcNotify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private rpcRequest(method: string, params: unknown, timeoutMs = 30000): Promise<unknown> {
    const id = ++this.messageId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[${this.name}] RPC '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private send(message: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`[${this.name}] WebSocket not connected`);
    }
    this.ws.send(JSON.stringify(message));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private inferLanguageId(filePath: string): string {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    const idx = this.extensions.indexOf(ext);
    if (idx >= 0 && idx < this.languageIds.length) return this.languageIds[idx];
    return 'plaintext';
  }
}
