/**
 * client.ts — Generic LSP (Language Server Protocol) client over JSON-RPC / stdio
 *
 * Spawns a language server binary, communicates via stdin/stdout with
 * Content-Length framing, and pushes diagnostics to the central diagnosticBus.
 *
 * Protocol reference: https://microsoft.github.io/language-server-protocol/
 */

import { spawn, ChildProcess } from 'child_process';
import { diagnosticBus, type UnifiedDiagnostic, type DiagnosticSeverity, type DiagnosticSource, SEVERITY_MAP } from './diagnostic-bus';
import { uriToPath } from './path-utils';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface LspClientOptions {
  /** Binary to spawn (e.g. 'typescript-language-server') */
  command: string;
  /** CLI args passed to the binary */
  args?: string[];
  /** Working directory for the server process (default: cwd) */
  cwd?: string;
  /** Optional env overrides */
  env?: Record<string, string>;
  /** Source label for diagnostics pushed to the bus (e.g. 'ts-lsp', 'rust-lsp') */
  diagnosticSource: DiagnosticSource;
  /** Called when the server logs to stderr */
  onStderr?: (line: string) => void;
  /** Called on fatal errors */
  onError?: (error: Error) => void;
  /** Called when the client exits */
  onExit?: (code: number | null) => void;
}

export interface InitializeResult {
  capabilities: Record<string, unknown>;
  serverInfo?: { name: string; version?: string };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─── Client ─────────────────────────────────────────────────────────────────────

export class LspClient {
  private process?: ChildProcess;
  private messageId = 0;
  private pending = new Map<number | string, PendingRequest>();
  private buffer = '';
  private contentLength = -1;
  private started = false;
  private opts: LspClientOptions;

  constructor(opts: LspClientOptions) {
    this.opts = opts;
  }



  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Start the language server and send initialize */
  async start(rootUri: string): Promise<InitializeResult> {
    if (this.started) throw new Error('LSP client already started');

    const { command, args = [], cwd, env } = this.opts;

    this.process = spawn(command, args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32', // Windows needs shell for .cmd/.bat
    });

    this.started = true;

    // stdout: JSON-RPC messages
    this.process.stdout?.on('data', (chunk: Buffer) => this.handleData(chunk));

    // stderr: logging (language servers often log here)
    this.process.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this.opts.onStderr?.(line);
      }
    });

    // exit
    this.process.on('exit', (code) => {
      this.started = false;
      // Reject all pending requests
      for (const [, pr] of this.pending) {
        clearTimeout(pr.timer);
        pr.reject(new Error(`LSP server exited with code ${code}`));
      }
      this.pending.clear();
      this.opts.onExit?.(code);
    });

    this.process.on('error', (err) => {
      this.started = false;
      this.opts.onError?.(err);
      // Reject the pending initialize request so start() doesn't hang
      for (const [, pr] of this.pending) {
        clearTimeout(pr.timer);
        pr.reject(err);
      }
      this.pending.clear();
    });

    // Send initialize
    const result = await this.request('initialize', {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          synchronization: { didChange: true },
        },
      },
    }) as InitializeResult;

    // Send initialized notification
    this.notify('initialized', {});

    return result;
  }

  /** Gracefully shut down the server */
  async stop(): Promise<void> {
    if (!this.process || !this.started) return;

    try {
      await this.request('shutdown', null);
    } catch {
      // Best effort
    }

    this.notify('exit', null);
    this.process.kill();
    this.started = false;
  }

  // ── Document sync ──────────────────────────────────────────────────────────

  /** Notify server that a document was opened */
  didOpen(uri: string, languageId: string, text: string): void {
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text,
      },
    });
  }

  /** Notify server that a document changed */
  didChange(uri: string, text: string, version?: number): void {
    this.notify('textDocument/didChange', {
      textDocument: {
        uri,
        version: version ?? Date.now(),
      },
      contentChanges: [{ text }],
    });
  }

  /** Notify server that a document was closed */
  didClose(uri: string): void {
    this.notify('textDocument/didClose', {
      textDocument: { uri },
    });
  }

  // ── JSON-RPC primitives ────────────────────────────────────────────────────

  private send(message: Record<string, unknown>): void {
    if (!this.process?.stdin) {
      throw new Error('LSP client not started');
    }
    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    this.process.stdin.write(header + body);
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private request(method: string, params: unknown, timeoutMs = 30000): Promise<unknown> {
    const id = ++this.messageId;
    return new Promise((resolve, reject) => {
      // Safety: never let a pending request hang forever
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  // ── Message framing & routing ──────────────────────────────────────────────

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString();

    while (true) {
      // Parse Content-Length header if we don't have one pending
      if (this.contentLength < 0) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return; // Need more data

        const header = this.buffer.slice(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          console.error('[LSP] Invalid header, flushing buffer');
          this.buffer = '';
          return;
        }

        this.contentLength = parseInt(match[1], 10);
        this.buffer = this.buffer.slice(headerEnd + 4);
      }

      // Wait for full body
      if (Buffer.byteLength(this.buffer) < this.contentLength) return;

      const body = this.buffer.slice(0, this.contentLength);
      this.buffer = this.buffer.slice(this.contentLength);
      this.contentLength = -1;

      try {
        const msg = JSON.parse(body);
        this.dispatch(msg);
      } catch (err) {
        console.error('[LSP] Failed to parse message:', body.slice(0, 200));
      }
    }
  }

  private dispatch(msg: Record<string, unknown>): void {
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

  private handleNotification(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case 'textDocument/publishDiagnostics': {
        const uri = params.uri as string;
        const diagnostics = (params.diagnostics as Array<Record<string, unknown>>) || [];
        const filePath = uriToPath(uri);

        if (diagnostics.length === 0) {
          // Server cleared diagnostics for this file — upsert empty array
          // to remove only this file's diagnostics (not the whole source).
          diagnosticBus.upsert(this.opts.diagnosticSource, [], [filePath]);
        } else {
          const items: Omit<UnifiedDiagnostic, 'id' | 'timestamp' | 'source'>[] = [];
          for (const d of diagnostics) {
            const range = d.range as { start: { line: number; character: number }; end: { line: number; character: number } } | undefined;
            items.push({
              file: filePath,
              message: (d.message as string) || 'Unknown diagnostic',
              severity: SEVERITY_MAP[d.severity as number] || 'info',
              line: range ? range.start.line + 1 : undefined, // LSP uses 0-based; convert to 1-based
              column: range ? range.start.character + 1 : undefined,
              code: d.code as string | number | undefined,
              context: d.source as string | undefined,
            });
          }
          diagnosticBus.upsert(this.opts.diagnosticSource, items, [filePath]);
        }
        break;
      }

      case 'window/logMessage': {
        const type = params.type as number;
        const message = params.message as string;
        const level = type === 1 ? 'error' : type === 2 ? 'warn' : 'info';
        console.log(`[LSP/${level}] ${message}`);
        break;
      }

      default:
        // Ignore unknown notifications
        break;
    }
  }
}
