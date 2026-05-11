/**
 * adapter.ts — LSP Adapter interface
 *
 * Every language server backend implements this interface.
 * The app NEVER cares which LSP is underneath — it only talks to LSPAdapter.
 *
 * Implementations:
 *   TsLspAdapter    → typescript-language-server (tsserver wrapper)
 *   RustLspAdapter  → rust-analyzer
 *   PythonLspAdapter → pyright-langserver / pylsp
 *   ... any native LSP process
 */

import type { UnifiedDiagnostic, DiagnosticSource } from './diagnostic-bus';

// ─── Adapter Interface ──────────────────────────────────────────────────────────

export interface LSPAdapter {
  /** Human-readable name for logging (e.g. 'typescript', 'rust-analyzer') */
  readonly name: string;

  /** Language IDs this adapter handles (e.g. ['typescript', 'typescriptreact']) */
  readonly languageIds: string[];

  /** File extensions this adapter handles (e.g. ['.ts', '.tsx']) */
  readonly extensions: string[];

  /** Diagnostic source label for the bus (e.g. 'ts-lsp', 'rust-lsp') */
  readonly diagnosticSource: DiagnosticSource;

  /** Whether the adapter is currently running */
  readonly isReady: boolean;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Start the language server and send initialize */
  initialize(rootUri: string): Promise<void>;

  /** Gracefully shut down the server */
  shutdown(): Promise<void>;

  // ── Document sync ──────────────────────────────────────────────────────────

  /** Open or update a document in the language server */
  syncFile(filePath: string, content: string, languageId?: string): Promise<void>;

  /** Close a document (releases server-side resources) */
  closeFile(filePath: string): void;

  // ── Diagnostics ────────────────────────────────────────────────────────────

  /** Get current diagnostics for a file from the bus */
  getDiagnostics(filePath: string): UnifiedDiagnostic[];

  /**
   * Wait for diagnostics to arrive for a file.
   * Returns after diagnostics are published or timeoutMs elapses.
   */
  waitForDiagnostics(filePath: string, timeoutMs?: number): Promise<UnifiedDiagnostic[]>;
}

// ─── Adapter Config ────────────────────────────────────────────────────────────

export interface LSPAdapterConfig {
  /** Binary to spawn (e.g. 'typescript-language-server', 'rust-analyzer') */
  command: string;
  /** CLI args passed to the binary */
  args?: string[];
  /** Working directory (default: workspace root) */
  cwd?: string;
  /** Environment overrides */
  env?: Record<string, string>;
  /** Language IDs this adapter handles */
  languageIds: string[];
  /** File extensions this adapter handles */
  extensions: string[];
  /** Diagnostic source label */
  diagnosticSource: DiagnosticSource;
  /** Human-readable name */
  name: string;
}

// ─── Workspace detection ────────────────────────────────────────────────────────

/**
 * Config files that indicate a language ecosystem.
 * Used by the gateway to auto-spawn adapters.
 */
export const WORKSPACE_INDICATORS: Record<string, { name: string; command: string; args: string[]; languageIds: string[]; extensions: string[]; diagnosticSource: DiagnosticSource }> = {
  'tsconfig.json': {
    name: 'typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    languageIds: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'],
    diagnosticSource: 'ts-lsp',
  },
  'Cargo.toml': {
    name: 'rust-analyzer',
    command: 'rust-analyzer',
    args: [],
    languageIds: ['rust'],
    extensions: ['.rs'],
    diagnosticSource: 'rust-lsp',
  },
  'pyproject.toml': {
    name: 'pyright',
    command: 'pyright-langserver',
    args: ['--stdio'],
    languageIds: ['python'],
    extensions: ['.py', '.pyi', '.pyx'],
    diagnosticSource: 'python-lsp',
  },
  'go.mod': {
    name: 'gopls',
    command: 'gopls',
    args: [],
    languageIds: ['go'],
    extensions: ['.go'],
    diagnosticSource: 'go-lsp',
  },
};
