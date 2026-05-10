# LSP Service

Language Server Protocol integration providing real-time diagnostics, code intelligence, and multi-language support across local and remote execution environments.

## 1. Architecture Overview

```
                   ┌──────────────────────────────┐
                   │       Next.js App / Agent     │
                   └──────────────┬───────────────┘
                                  │
                   ┌──────────────▼───────────────┐
                   │         LspGateway            │
                   │  (singleton — getGateway())   │
                   │  • auto-detect workspace      │
                   │  • route by file extension    │
                   │  • manage adapter pool        │
                   └──────┬──────────────┬────────┘
                          │              │
            ┌─────────────▼──┐   ┌───────▼──────────────┐
            │  LOCAL MODE    │   │     REMOTE MODE       │
            │ LspClientAdapter│   │  RemoteLspAdapter     │
            │      │         │   │        │              │
            │ ┌────▼────┐    │   │   WebSocket            │
            │ │LspClient│    │   │   (wss://...)          │
            │ │ (stdio) │    │   │        │              │
            │ └────┬────┘    │   │ ┌──────▼───────────┐  │
            │      │         │   │ │ Container/Sandbox │  │
            │ child_process  │   │ │ • LSP binary      │  │
            │      │         │   │ │ • real filesystem │  │
            │ ┌────▼────┐    │   │ │ • installed deps  │  │
            │ │Lang Srv │    │   │ └──────────────────┘  │
            │ │Process  │    │   │                       │
            │ └─────────┘    │   │                       │
            └────────────────┘   └───────────────────────┘
                          │              │
                   ┌──────▼──────────────▼───────┐
                   │       DiagnosticBus          │
                   │  (singleton — diagnosticBus) │
                   │  • unified diagnostic store  │
                   │  • source-agnostic queries   │
                   │  • subscribe/notify pattern  │
                   └──────────────┬───────────────┘
                                  │
                   ┌──────────────▼───────────────┐
                   │    DiagnosticsProvider       │
                   │  • LLM feedback formatters   │
                   │  • batch summaries           │
                   │  • prompt injection          │
                   └──────────────────────────────┘
```

### Layers

| Layer | Role | Key File |
|-------|------|----------|
| **Gateway** | Single entry point; auto-detects workspace configs, spawns adapters, routes file operations by extension | `web/lib/lsp/gateway.ts` |
| **Adapters** | Implement `LSPAdapter` interface; one per language ecosystem (TypeScript, Rust, Python, Go) | `web/lib/lsp/adapter.ts` |
| **Clients** | Low-level JSON-RPC transport over stdio (local) or WebSocket (remote) | `web/lib/lsp/client.ts`, `web/lib/lsp/remote-lsp-adapter.ts` |
| **Diagnostic Bus** | Centralized, source-agnostic diagnostic store with subscribe/notify | `web/lib/lsp/diagnostic-bus.ts` |
| **Provider** | Formats diagnostics into LLM-friendly feedback strings for prompt injection | `web/lib/lsp/diagnostics-provider.ts` |

## 2. Component Reference

### 2.1 Barrel Export (`index.ts`)

**Role:** Public API surface. Everything the app needs is imported from `@/lib/lsp`.

```typescript
import {
  getGateway, resetGateway,           // Gateway singleton
  diagnosticBus,                       // Diagnostic bus singleton
  buildFeedbackForPrompt,              // LLM feedback formatter
  type LSPAdapter,                     // Adapter interface
  type UnifiedDiagnostic,              // Diagnostic type
  type DiagnosticSource,               // Source union type
} from '@/lib/lsp';
```

### 2.2 Gateway (`gateway.ts`)

**Role:** Orchestrator. Manages multiple language server adapters behind a single API. Auto-detects workspace config files (`tsconfig.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`) and spawns the appropriate adapter.

**How it works:**
- Instantiated via `getGateway(opts?)` (singleton) or `new LspGateway(opts)`
- `start()` scans the project root for workspace indicator files
- For each detected ecosystem, creates either a `LspClientAdapter` (local) or `RemoteLspAdapter` (remote)
- `syncFile()` routes by file extension to the correct adapter
- `getDiagnostics()` queries the bus across all sources
- `shutdown()` gracefully stops all adapters and clears diagnostics

**Execution mode:**

| Mode | Environment | Transport | Production Ready |
|------|-------------|-----------|------------------|
| `local` | In-process `child_process` | stdio (JSON-RPC) | ❌ (memory, filesystem) |
| `remote` | Container/sandbox | WebSocket (JSON-RPC) | ✅ (isolated, real FS) |

Controlled by `LSP_EXECUTION_MODE` env var. Defaults to `local` with a production warning.

**Production guard:** `LspClientAdapter` refuses to spawn in-process language servers when `NODE_ENV=production` or `VERCEL` is set. Override with `LSP_EXECUTION_MODE=local_override` (not recommended).

### 2.3 Adapter Interface (`adapter.ts`)

**Role:** Contract that all language server backends implement.

```typescript
interface LSPAdapter {
  readonly name: string;              // 'typescript', 'rust-analyzer', etc.
  readonly languageIds: string[];     // ['typescript', 'typescriptreact']
  readonly extensions: string[];      // ['.ts', '.tsx']
  readonly diagnosticSource: DiagnosticSource;  // 'ts-lsp', 'rust-lsp'
  readonly isReady: boolean;

  initialize(rootUri: string): Promise<void>;
  shutdown(): Promise<void>;
  syncFile(filePath: string, content: string, languageId?: string): Promise<void>;
  closeFile(filePath: string): void;
  getDiagnostics(filePath: string): UnifiedDiagnostic[];
  waitForDiagnostics(filePath: string, timeoutMs?: number): Promise<UnifiedDiagnostic[]>;
}
```

**Workspace auto-detection** uses `WORKSPACE_INDICATORS`:

| Config File | Language Server | Diagnostic Source |
|-------------|----------------|-------------------|
| `tsconfig.json` | `typescript-language-server --stdio` | `ts-lsp` |
| `Cargo.toml` | `rust-analyzer` | `rust-lsp` |
| `pyproject.toml` | `pyright-langserver --stdio` | `python-lsp` |
| `go.mod` | `gopls` | `go-lsp` |

**Implementations:**
- `LspClientAdapter` — stdio-based, wraps `LspClient`
- `RemoteLspAdapter` — WebSocket-based, connects to containerized LSP

### 2.4 Local Client (`client.ts`)

**Role:** Generic JSON-RPC LSP client over stdio. Spawns a language server binary as a child process, communicates via stdin/stdout with `Content-Length` framing.

**How it works:**
1. `spawn()` the language server binary with `['--stdio']`
2. Send `initialize` JSON-RPC request with client capabilities
3. Send `initialized` notification
4. Document sync via `didOpen` / `didChange` / `didClose` notifications
5. Parse incoming messages with `Content-Length` header framing
6. Dispatch `textDocument/publishDiagnostics` to the `diagnosticBus`
7. Handle `window/logMessage` for server logging

**Key details:**
- 30-second timeout on all RPC requests
- Uses `process.platform === 'win32'` shell detection for `.cmd`/`.bat` binaries
- Supports custom `env`, `cwd`, and `args` per language server
- Rejects all pending requests on server exit

### 2.5 Remote Adapter (`remote-lsp-adapter.ts`)

**Role:** Production-recommended adapter. Proxies JSON-RPC over a WebSocket connection to a language server running in a dedicated container/sandbox.

**Architecture:**
```
Next.js App  ──WebSocket──▶  Container/Sandbox  ──stdio──▶  Language Server
```

**How it works:**
1. Connects to a WebSocket URL (e.g. `wss://sandbox.example.com/lsp/typescript`)
2. Sends JSON-RPC messages over WebSocket (same protocol as stdio, different transport)
3. Automatic reconnection with exponential backoff (default: 5 attempts, 2s base delay)
4. Connection guard (`_connecting` flag) prevents concurrent connection attempts
5. Optional auth: query param token fallback + `Authorization: Bearer` header when using the `ws` package
6. Auto-detects `WebSocket` availability: prefers Node 22+ global, falls back to `ws` package

**Configuration:**
```typescript
interface RemoteLspAdapterConfig {
  name: string;                        // 'typescript'
  wsUrl: string;                       // 'wss://sandbox-abc.e2b.dev/lsp/typescript'
  languageIds: string[];               // ['typescript', 'typescriptreact']
  extensions: string[];                // ['.ts', '.tsx']
  diagnosticSource: string & {};       // 'ts-lsp'
  authToken?: string;                  // Bearer token for WS connection
  reconnectDelayMs?: number;           // default: 2000
  maxReconnectAttempts?: number;       // default: 5
}
```

**Reconnection logic:**
- On WebSocket close: if not destroyed and under max attempts, schedule reconnect
- Delay formula: `baseDelay * 2^(attempt - 1)` (exponential backoff)
- Guard prevents scheduling duplicate reconnects
- On successful connection: reset attempt counter
- On max attempts reached: log error, adapter becomes unavailable

### 2.6 Diagnostic Bus (`diagnostic-bus.ts`)

**Role:** Centralized, source-agnostic diagnostic store. All adapters push diagnostics here; the app queries without knowing which source produced them.

**Design:**
- Singleton: `diagnosticBus` (imported directly)
- Max 1,000 stored diagnostics (oldest evicted on overflow)
- Subscribe/notify pattern for real-time updates
- Unique IDs: `{source}:{file}:{line}:{column}:{messageHash}`

**Sources:**
```typescript
type DiagnosticSource = 'lsp' | 'eslint' | 'compiler' | 'runtime' | 'tests' | (string & {});
```

**Unified Diagnostic:**
```typescript
interface UnifiedDiagnostic {
  file: string;           // Absolute file path
  message: string;        // Human-readable diagnostic message
  source: DiagnosticSource;
  severity: 'error' | 'warning' | 'info' | 'hint';
  line?: number;          // 1-based line number
  column?: number;        // 1-based column number
  code?: string | number; // Diagnostic code (e.g. 'TS2322')
  context?: string;       // Additional context
  id: string;             // Unique opaque id
  timestamp: number;      // Unix ms when diagnostic was upserted
}
```

**API:**
| Method | Description |
|--------|-------------|
| `upsert(source, items, affectedFiles?)` | Insert/replace diagnostics for a source+files |
| `getForFile(file, source?)` | Get all diagnostics for a file, optionally filtered by source |
| `getCompacted(file, limit?, source?)` | Deduplicated diagnostics (one per unique message prefix) |
| `getBySource(source)` | All diagnostics from a specific source |
| `getAffectedFiles(source?)` | All files that have diagnostics |
| `getAllSources()` | List active diagnostic sources |
| `subscribe(callback)` | Subscribe to changes → returns unsubscribe function |
| `clear(source)` | Clear all diagnostics from a source |
| `clearForFile(file, source?)` | Clear diagnostics for a specific file |
| `clearAll()` | Clear everything |
| `totalCount` | Total diagnostic count across all sources |

### 2.7 Diagnostics Provider (`diagnostics-provider.ts`)

**Role:** Formats diagnostics into LLM-friendly feedback strings for prompt injection during agent self-correction loops.

**Functions:**
| Function | Description |
|----------|-------------|
| `getDiagnosticSummary(filePath, topMessages?, source?)` | Per-file summary with error/warning counts and top messages |
| `getBatchDiagnosticSummary(filePaths, topMessages?, maxFiles?, source?)` | Multi-file batch summary |
| `buildFeedbackForPrompt(filePath, source?)` | Single-file feedback string (empty if no errors/warnings) |
| `buildBatchFeedbackForPrompt(filePaths, source?)` | Multi-file feedback string |

**Example output:**
```
## LSP Diagnostics for app.ts
- ERROR L15: Type 'string' is not assignable to type 'number'
- WARN L42: Unused variable 'result'

Fix these issues before the code is considered valid.
```

### 2.8 Path Utilities (`path-utils.ts`)

**Role:** Convert between file paths and `file://` URIs (LSP protocol uses URIs).

```typescript
uriToPath('file:///workspace/src/app.ts')  // → '/workspace/src/app.ts' (unix)
                                            // → '\\workspace\\src\\app.ts' (windows)
pathToUri('/workspace/src/app.ts')          // → 'file:///workspace/src/app.ts'
normalizeRelativePath(root, fullPath)       // → relative path (case-insensitive)
```

### 2.9 TypeScript Language Server (`ts-language-server.ts`)

**Role:** Legacy convenience wrapper around the TypeScript language server. Provides a simpler API for TypeScript-only workflows (singleton pattern, direct diagnostic access).

**Key differences from the Gateway approach:**
- Singleton (one instance max) vs Gateway (multiple adapters)
- TypeScript-only vs multi-language
- Direct LSP client vs adapter abstraction
- Deprecated in favor of `getGateway()` + auto-detection

## 3. Usage Patterns

### Basic: Start the gateway and get diagnostics

```typescript
import { getGateway, buildFeedbackForPrompt } from '@/lib/lsp';

// Start (auto-detects tsconfig.json, Cargo.toml, etc.)
const gateway = getGateway({ projectRoot: '/workspace' });
await gateway.start();

// Sync a file (triggers LSP analysis)
await gateway.syncFile('/workspace/src/app.ts', fileContent);

// Wait for diagnostics
const diagnostics = await gateway.waitForDiagnostics('/workspace/src/app.ts', 3000);

// Format for LLM feedback injection
const feedback = buildFeedbackForPrompt('/workspace/src/app.ts');
if (feedback) {
  // Inject into agent prompt for self-correction
  agentPrompt += `\n${feedback}\n`;
}
```

### Remote LSP (production)

```typescript
// Set environment variables:
//   LSP_EXECUTION_MODE=remote
//   SANDBOX_LSP_WS_URL=wss://sandbox.example.com/lsp
//   SANDBOX_LSP_AUTH_TOKEN=<optional>

const gateway = getGateway({ projectRoot: '/workspace' });
await gateway.start();
// Gateway automatically creates RemoteLspAdapter instances
// for each detected workspace config
```

### Manual adapter registration

```typescript
import { LspGateway, RemoteLspAdapter } from '@/lib/lsp';

const gateway = new LspGateway({ projectRoot: '/workspace' });

// Register a custom adapter before starting
gateway.registerAdapter(new RemoteLspAdapter({
  name: 'typescript',
  wsUrl: 'wss://custom.example.com/lsp/typescript',
  languageIds: ['typescript', 'typescriptreact'],
  extensions: ['.ts', '.tsx'],
  diagnosticSource: 'ts-lsp',
}));

await gateway.start({ autoDetect: false }); // skip auto-detection
```

### Subscribe to diagnostic changes

```typescript
import { diagnosticBus } from '@/lib/lsp';

const unsubscribe = diagnosticBus.subscribe((allDiagnostics, updatedFiles) => {
  console.log(`Files updated: ${updatedFiles.join(', ')}`);
  console.log(`Total diagnostics: ${allDiagnostics.length}`);

  for (const file of updatedFiles) {
    const fileDiags = diagnosticBus.getForFile(file);
    const errors = fileDiags.filter(d => d.severity === 'error');
    if (errors.length > 0) {
      console.error(`${file}: ${errors.length} errors`);
    }
  }
});

// Later: unsubscribe();
```

## 4. Environment Variables

| Variable | Purpose | Values | Default |
|----------|---------|--------|---------|
| `LSP_EXECUTION_MODE` | Controls execution environment | `local`, `remote`, `local_override` | `local` |
| `SANDBOX_LSP_WS_URL` | Base WebSocket URL for remote LSP containers | URL string (e.g. `wss://sandbox.example.com/lsp`) | — |
| `SANDBOX_LSP_AUTH_TOKEN` | Auth token for remote LSP WebSocket connections | Token string | — |
| `NODE_ENV` | Triggers production guard in `LspClientAdapter` | `production` | — |
| `VERCEL` | Triggers production guard (Vercel deployments) | any value | — |

## 5. Protocol Details

### JSON-RPC over stdio

```
Content-Length: 123\r\n
\r\n
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
```

### JSON-RPC over WebSocket

Same JSON-RPC messages, no `Content-Length` framing — each WebSocket frame contains exactly one JSON message.

### LSP Initialization Sequence

```
Client → Server:  initialize (capabilities, rootUri)
Server → Client:  initialize result (server capabilities)
Client → Server:  initialized
Client → Server:  textDocument/didOpen (file content)
Server → Client:  textDocument/publishDiagnostics (diagnostics)
```

### LSP Shutdown Sequence

```
Client → Server:  shutdown request
Server → Client:  shutdown response
Client → Server:  exit notification
[close transport]
```

## 6. Integration Points

### Agent Self-Correction Loop

The LSP service integrates with the agent loop via `diagnostics-provider.ts`. After each file edit, the agent:

1. Calls `gateway.syncFile()` to push the new content
2. Calls `gateway.waitForDiagnostics()` to get fresh diagnostics
3. Calls `buildFeedbackForPrompt()` to format feedback
4. Injects the feedback into the next prompt iteration for self-correction

### Sandbox Integration

`web/lib/sandbox/lsp-integration.ts` provides a higher-level API for sandbox environments:
- `getCompletions()` — code completion
- `goToDefinition()` — jump to definition
- `findReferences()` — find all references
- `getHover()` — hover documentation
- `getDiagnostics()` — diagnostic errors/warnings
- `formatDocument()` — code formatting

### Daytona LSP Service

`web/lib/sandbox/providers/daytona-lsp-service.ts` wraps Daytona's native LSP REST API for use within Daytona sandboxes. Supports 24 language IDs.

## 7. File Index

| File | Purpose |
|------|---------|
| `web/lib/lsp/index.ts` | Barrel export — public API |
| `web/lib/lsp/gateway.ts` | Gateway orchestrator + `LspClientAdapter` |
| `web/lib/lsp/adapter.ts` | `LSPAdapter` interface + auto-detection config |
| `web/lib/lsp/client.ts` | Generic LSP client (stdio) |
| `web/lib/lsp/remote-lsp-adapter.ts` | Remote LSP adapter (WebSocket) |
| `web/lib/lsp/diagnostic-bus.ts` | Centralized diagnostic store |
| `web/lib/lsp/diagnostics-provider.ts` | LLM feedback formatters |
| `web/lib/lsp/path-utils.ts` | URI/path conversion utilities |
| `web/lib/lsp/ts-language-server.ts` | Legacy TypeScript LSP wrapper |
| `web/lib/sandbox/lsp-integration.ts` | Sandbox-level LSP integration |
| `web/lib/sandbox/providers/daytona-lsp-service.ts` | Daytona LSP REST API wrapper |
| `web/__tests__/lsp/lsp-smoke.test.ts` | Integration smoke tests |
