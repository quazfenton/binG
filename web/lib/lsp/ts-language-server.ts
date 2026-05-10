/**
 * ts-language-server.ts — TypeScript Language Server manager
 *
 * Spawns `typescript-language-server` (which wraps tsserver in LSP),
 * manages document lifecycle, and emits diagnostics to the central bus.
 *
 * Falls back gracefully if the binary is not available (e.g. in web-only
 * deployments where child_process is unavailable).
 */

import { LspClient } from './client';
import { diagnosticBus, type UnifiedDiagnostic, type DiagnosticSource } from './diagnostic-bus';
import { pathToUri } from './path-utils';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface TsServerOptions {
  /** Project root directory (where tsconfig.json lives) */
  projectRoot?: string;
  /** Custom path to typescript-language-server binary */
  binaryPath?: string;
  /** Additional CLI args */
  extraArgs?: string[];
}

export interface TsServerDiagnostic {
  file: string;
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  line?: number;
  column?: number;
  code?: string | number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const DIAGNOSTIC_SOURCE: DiagnosticSource = 'ts-lsp';
// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: TsLanguageServer | null = null;
let _initPromise: Promise<TsLanguageServer | null> | null = null;

// ─── Class ─────────────────────────────────────────────────────────────────────

export class TsLanguageServer {
  private client: LspClient;
  private rootUri: string;
  private openDocs = new Map<string, { version: number; languageId: string }>();
  private ready = false;
  private stopped = false;

  private constructor(client: LspClient, rootUri: string) {
    this.client = client;
    this.rootUri = rootUri;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  /** Get or create the singleton instance. Returns null if unavailable. */
  static async getInstance(opts: TsServerOptions = {}): Promise<TsLanguageServer | null> {
    if (_instance && !_instance.stopped) return _instance;
    if (_initPromise) return _initPromise;

    _initPromise = TsLanguageServer.create(opts);
    _instance = await _initPromise;
    _initPromise = null;
    return _instance;
  }

  private static async create(opts: TsServerOptions): Promise<TsLanguageServer | null> {
    const root = opts.projectRoot || process.cwd();
    const rootUri = pathToUri(root);
    const binary = opts.binaryPath || 'typescript-language-server';

    // Build args: --stdio tells it to use stdio transport
    const args = ['--stdio', ...(opts.extraArgs || [])];

    const client = new LspClient({
      command: binary,
      args,
      cwd: root,
      diagnosticSource: DIAGNOSTIC_SOURCE,
      onStderr: (line) => {
        // TypeScript language server logs info/warnings to stderr
        if (line.includes('Error') || line.includes('error')) {
          console.error(`[ts-lsp] ${line}`);
        }
      },
      onError: (err) => {
        console.error('[ts-lsp] Server process error:', err.message);
      },
      onExit: (code) => {
        console.log(`[ts-lsp] Server exited with code ${code}`);
      },
    });

    try {
      await client.start(rootUri);
      const server = new TsLanguageServer(client, rootUri);
      server.ready = true;
      console.log('[ts-lsp] TypeScript language server started');
      return server;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[ts-lsp] Failed to start TypeScript language server:', message);
      console.warn('[ts-lsp] LSP-based diagnostics unavailable — falling back to tsc CLI');
      return null;
    }
  }

  // ── Document lifecycle ─────────────────────────────────────────────────────

  /**
   * Open or update a document in the LSP server.
   * After calling this, diagnostics will be published asynchronously
   * to the diagnosticBus.
   */
  async syncFile(filePath: string, content: string, languageId = 'typescript'): Promise<void> {
    if (!this.ready || this.stopped) return;
    if (!content && !this.openDocs.has(pathToUri(filePath))) {
      // Don't open a file with empty content — LSP server can't parse it
      return;
    }

    const uri = pathToUri(filePath);
    const existing = this.openDocs.get(uri);

    if (!existing) {
      this.client.didOpen(uri, languageId, content);
      this.openDocs.set(uri, { version: 1, languageId });
    } else {
      const newVersion = existing.version + 1;
      this.client.didChange(uri, content, newVersion);
      this.openDocs.set(uri, { version: newVersion, languageId });
    }
  }

  /** Close a document (releases server-side resources) */
  closeFile(filePath: string): void {
    if (!this.ready || this.stopped) return;
    const uri = pathToUri(filePath);
    this.client.didClose(uri);
    this.openDocs.delete(uri);
  }

  // ── Diagnostics ────────────────────────────────────────────────────────────

  /**
   * Get current diagnostics for a file from the bus.
   * Call this after syncFile() — diagnostics arrive asynchronously,
   * so you may want to wait briefly or use subscribe() instead.
   */
  getDiagnosticsForFile(filePath: string): UnifiedDiagnostic[] {
    return diagnosticBus.getForFile(filePath);
  }

  /**
   * Get compacted (deduplicated) diagnostics for LLM feedback.
   * Returns up to `limit` unique diagnostic messages.
   */
  getCompactedDiagnostics(filePath: string, limit = 10): UnifiedDiagnostic[] {
    return diagnosticBus.getCompacted(filePath, limit);
  }

  /**
   * Subscribe to diagnostic updates. The callback fires whenever
   * the LSP server publishes diagnostics for any file.
   * Returns an unsubscribe function.
   */
  onDiagnostics(
    callback: (diagnostics: UnifiedDiagnostic[], updatedFiles: string[]) => void
  ): () => void {
    return diagnosticBus.subscribe(callback);
  }

  /**
   * Wait for diagnostics to arrive for a specific file.
   * Useful after syncing a file to get fresh diagnostics.
   * Returns after `timeoutMs` milliseconds at most.
   */
  async waitForDiagnostics(filePath: string, timeoutMs = 3000): Promise<UnifiedDiagnostic[]> {
    return new Promise((resolve) => {
      // Check immediately
      const existing = diagnosticBus.getForFile(filePath);
      if (existing.length > 0) {
        resolve(existing);
        return;
      }

      const timer = setTimeout(() => {
        unsubscribe();
        resolve(diagnosticBus.getForFile(filePath));
      }, timeoutMs);

      const unsubscribe = diagnosticBus.subscribe((_all, updatedFiles) => {
        if (updatedFiles.includes(filePath)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(diagnosticBus.getForFile(filePath));
        }
      });
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  get isReady(): boolean {
    return this.ready && !this.stopped;
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    this.openDocs.clear();
    await this.client.stop();
    diagnosticBus.clear(DIAGNOSTIC_SOURCE);
    _instance = null;
  }
}

// ─── Convenience helpers ───────────────────────────────────────────────────────

/**
 * Quick check: is the LSP server available?
 * Use this before calling getInstance() if you want to avoid the startup delay.
 */
export async function isLspAvailable(): Promise<boolean> {
  const instance = await TsLanguageServer.getInstance();
  return instance?.isReady ?? false;
}

/**
 * Format diagnostics as a human-readable string for LLM feedback injection.
 */
export function formatDiagnosticsForFeedback(
  diagnostics: TsServerDiagnostic[],
  maxItems = 5
): string {
  if (diagnostics.length === 0) return '';

  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');

  const lines: string[] = [];

  if (errors.length > 0) {
    lines.push(`## TypeScript Errors (${errors.length})`);
    for (const d of errors.slice(0, maxItems)) {
      const loc = d.line ? `Line ${d.line}` : '';
      const code = d.code ? ` [${d.code}]` : '';
      lines.push(`- ${loc}: ${d.message}${code}`);
    }
    if (errors.length > maxItems) {
      lines.push(`- ... and ${errors.length - maxItems} more errors`);
    }
  }

  if (warnings.length > 0 && lines.length < maxItems * 2) {
    lines.push(`\n## TypeScript Warnings (${warnings.length})`);
    const remaining = Math.max(0, maxItems - errors.length);
    for (const d of warnings.slice(0, remaining)) {
      const loc = d.line ? `Line ${d.line}` : '';
      const code = d.code ? ` [${d.code}]` : '';
      lines.push(`- ${loc}: ${d.message}${code}`);
    }
  }

  return lines.join('\n');
}
