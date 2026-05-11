/**
 * index.ts — LSP module barrel export
 *
 * The app talks to ONE thing: the LspGateway.
 * The gateway manages multiple LSPAdapter instances behind the scenes,
 * auto-spawns adapters based on workspace config files, and routes
 * file operations to the correct adapter by extension/languageId.
 *
 * Usage:
 *   import { getGateway, buildFeedbackForPrompt } from '@/lib/lsp';
 *
 *   // Start the gateway (auto-detects tsconfig.json, Cargo.toml, etc.)
 *   const gateway = getGateway({ projectRoot: '/path/to/workspace' });
 *   await gateway.start();
 *
 *   // Sync a file — gateway routes to the right language server
 *   await gateway.syncFile('/path/to/file.ts', fileContent);
 *
 *   // Get unified diagnostics from ALL language servers
 *   const diags = await gateway.waitForDiagnostics('/path/to/file.ts');
 *
 *   // Format for LLM feedback injection
 *   const feedback = buildFeedbackForPrompt('/path/to/file.ts');
 */

// ─── Diagnostic Bus ────────────────────────────────────────────────────────────

export {
  diagnosticBus,
  type UnifiedDiagnostic,
  type DiagnosticSeverity,
  type DiagnosticSource,
} from './diagnostic-bus';

// ─── Path utilities ────────────────────────────────────────────────────────────

export { uriToPath, pathToUri, normalizeRelativePath } from './path-utils';

// ─── Adapter interface ─────────────────────────────────────────────────────────

export {
  type LSPAdapter,
  type LSPAdapterConfig,
  WORKSPACE_INDICATORS,
} from './adapter';

// ─── Gateway (primary API) ─────────────────────────────────────────────────────

export {
  LspGateway,
  LspClientAdapter,
  getGateway,
  resetGateway,
  type GatewayOptions,
  type LspExecutionMode,
} from './gateway';

// ─── Remote LSP adapter (production-recommended) ───────────────────────────────

export {
  RemoteLspAdapter,
  type RemoteLspAdapterConfig,
} from './remote-lsp-adapter';

// ─── Generic LSP client (low-level) ────────────────────────────────────────────

export {
  LspClient,
  type LspClientOptions,
  type InitializeResult,
} from './client';

// ─── TypeScript LSP (convenience) ──────────────────────────────────────────────

export {
  TsLanguageServer,
  isLspAvailable,
  formatDiagnosticsForFeedback,
  type TsServerOptions,
  type TsServerDiagnostic,
} from './ts-language-server';

// ─── Diagnostic queries & formatters ───────────────────────────────────────────

export {
  getDiagnosticSummary,
  getBatchDiagnosticSummary,
  buildFeedbackForPrompt,
  buildBatchFeedbackForPrompt,
  type DiagnosticSummary,
  type BatchDiagnosticSummary,
} from './diagnostics-provider';
