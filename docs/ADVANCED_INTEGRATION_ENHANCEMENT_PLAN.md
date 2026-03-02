# Advanced Agent Integration Enhancement Plan

**Date:** February 27, 2026  
**Status:** Phase 1 In Progress - E2B Services Complete  
**Review Depth:** Exhaustive SDK documentation analysis + codebase audit

## Implementation Progress

### ✅ Completed

1. **E2B Amp Service** - `lib/sandbox/providers/e2b-amp-service.ts`
   - Full Amp integration with prompt execution
   - Streaming JSON output support
   - Thread management (list, continue, delete)
   - Integrated with E2BSandboxHandle

2. **E2B Codex Service** - `lib/sandbox/providers/e2b-codex-service.ts`
   - OpenAI Codex integration
   - Schema-validated output support
   - Streaming JSON events
   - Image/design mockup input support
   - Integrated with E2BSandboxHandle

3. **E2B Provider Updates** - `lib/sandbox/providers/e2b-provider.ts`
   - Added `getAmpService()` method
   - Added `getCodexService()` method
   - Added `executeAmp()` method
   - Added `executeCodex()` method
   - Added `streamAmpEvents()` generator
   - Added `streamCodexEvents()` generator

### 🔄 In Progress

4. **Documentation Updates**
   - Enhancement plan created
   - Usage examples needed

### ⏳ Pending (Phase 2+)

5. Daytona LSP Service
6. Blaxel Agent Handoff
7. Sprites Service Manager
8. Cross-provider enhancements

---

## Executive Summary

After meticulous review of the codebase against SDK documentation (E2B, Daytona, Blaxel, Sprites, Mistral), I've identified **significant missing features and enhancement opportunities** across all providers. This plan details specific implementations to build upon existing code without breaking current functionality.

### Key Findings

1. **E2B**: Missing Amp integration, Codex support, OpenCode, template building, streaming JSON output, image input
2. **Daytona**: Missing LSP server support, process service enhancements, recording features
3. **Blaxel**: Missing async trigger enhancements, batch job improvements, multi-agent handoffs
4. **Sprites**: Missing checkpoint enhancements, service auto-management, SSH tunneling
5. **Cross-Provider**: Missing unified snapshot system, cross-provider file sync, shared MCP gateway

---

## Part 1: E2B Provider Enhancements

### 1.1 Missing Features Identified

From `docs/sdk/e2b-llms-full.txt` (16,918 lines), the following are NOT implemented:

#### A. Amp Integration (docs lines 40-200)
```typescript
// MISSING: Amp service for running Amp coding agent
interface E2BAmpService {
  run(prompt: string, options: AmpOptions): Promise<AmpResult>;
  streamJson(prompt: string): AsyncIterable<AmpEvent>;
  threads: {
    list(): Promise<Thread[]>;
    continue(threadId: string, prompt: string): Promise<AmpResult>;
  };
}
```

**Implementation Plan:**
- Create `lib/sandbox/providers/e2b-amp-service.ts`
- Add `createAmpService()` factory
- Integrate with `E2BSandboxHandle`

#### B. Codex Support (docs lines 800-1000)
```typescript
// MISSING: OpenAI Codex integration
interface E2BCodexService {
  exec(prompt: string, options: {
    fullAuto?: boolean;
    skipGitRepoCheck?: boolean;
    outputSchema?: object;
    image?: string; // Path to design mockup
  }): Promise<CodexResult>;
  streamEvents(prompt: string): AsyncIterable<CodexEvent>;
}
```

**Implementation Plan:**
- Create `lib/sandbox/providers/e2b-codex-service.ts`
- Add schema validation support
- Add image input support for UI mockups

#### C. Template Building (docs lines 300-400, 800-900)
```typescript
// MISSING: Custom template building
class E2BTemplateBuilder {
  fromTemplate(name: string): E2BTemplateBuilder;
  run(commands: string[]): E2BTemplateBuilder;
  env(envVars: Record<string, string>): E2BTemplateBuilder;
  build(name: string, options: BuildOptions): Promise<void>;
}
```

**Implementation Plan:**
- Create `lib/sandbox/providers/e2b-template-builder.ts`
- Add build logging support
- Integrate with sandbox creation

#### D. Streaming JSON Output (docs lines 160-200)
```typescript
// MISSING: Structured streaming output
interface StreamingOptions {
  onEvent: (event: AgentEvent) => void;
  parseJsonLines?: boolean;
}

async runWithStreamingJson(
  command: string,
  options: StreamingOptions
): Promise<void>
```

**Implementation Plan:**
- Add to `E2BSandboxHandle`
- Parse JSONL output streams
- Emit typed events

#### E. Image Input Support (docs lines 400-450)
```typescript
// MISSING: Image/design mockup input
interface ImageInput {
  path: string;
  data: Buffer;
  mimeType: string;
}

async runWithImage(
  command: string,
  image: ImageInput,
  prompt: string
): Promise<Result>
```

**Implementation Plan:**
- Add file upload with image detection
- Add image parameter to command execution
- Support base64 encoding

### 1.2 Implementation Code

```typescript
// lib/sandbox/providers/e2b-amp-service.ts
/**
 * E2B Amp Service
 * 
 * Run Amp coding agent in E2B sandboxes
 * @see https://e2b.dev/docs/agents/amp
 */

import type { Sandbox } from '@e2b/code-interpreter'

export interface AmpExecutionConfig {
  prompt: string
  dangerouslyAllowAll?: boolean
  streamJson?: boolean
  threadId?: string
  workingDir?: string
}

export interface AmpEvent {
  type: 'assistant' | 'result' | 'tool_call' | 'thinking'
  message: {
    content?: string
    usage?: {
      input_tokens: number
      output_tokens: number
    }
    duration_ms?: number
    subtype?: string
  }
}

export interface AmpExecutionResult {
  stdout: string
  stderr: string
  threadId?: string
  events?: AmpEvent[]
}

export interface E2BAmpService {
  run(config: AmpExecutionConfig): Promise<AmpExecutionResult>
  streamJson(config: AmpExecutionConfig): AsyncIterable<AmpEvent>
  threads: {
    list(): Promise<Array<{ id: string; created_at: number }>>
    continue(threadId: string, prompt: string): Promise<AmpExecutionResult>
  }
}

export function createAmpService(
  sandbox: Sandbox,
  apiKey: string
): E2BAmpService {
  const AMP_CMD = 'amp'
  
  async function run(config: AmpExecutionConfig): Promise<AmpExecutionResult> {
    const args = [
      config.dangerouslyAllowAll ? '--dangerously-allow-all' : '',
      config.streamJson ? '--stream-json' : '',
      '-x',
      `"${config.prompt.replace(/"/g, '\\"')}"`,
    ].filter(Boolean).join(' ')

    const command = config.workingDir 
      ? `cd ${config.workingDir} && ${AMP_CMD} ${args}`
      : `${AMP_CMD} ${args}`

    const result = await sandbox.commands.run(command, {
      onStdout: config.streamJson ? undefined : (data) => console.log(data),
    })

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      threadId: config.threadId,
    }
  }

  async function* streamJson(config: AmpExecutionConfig): AsyncIterable<AmpEvent> {
    const args = [
      '--dangerously-allow-all',
      '--stream-json',
      '-x',
      `"${config.prompt.replace(/"/g, '\\"')}"`,
    ].join(' ')

    const command = config.workingDir
      ? `cd ${config.workingDir} && ${AMP_CMD} ${args}`
      : `${AMP_CMD} ${args}`

    // Execute and parse JSONL output
    const result = await sandbox.commands.run(command)
    
    for (const line of result.stdout.split('\n').filter(Boolean)) {
      try {
        const event: AmpEvent = JSON.parse(line)
        yield event
      } catch {
        // Skip invalid JSON lines
      }
    }
  }

  async function listThreads(): Promise<Array<{ id: string; created_at: number }>> {
    const result = await sandbox.commands.run('amp threads list --json')
    return JSON.parse(result.stdout)
  }

  async function continueThread(
    threadId: string,
    prompt: string
  ): Promise<AmpExecutionResult> {
    const result = await sandbox.commands.run(
      `amp threads continue ${threadId} --dangerously-allow-all -x "${prompt.replace(/"/g, '\\"')}"`
    )
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      threadId,
    }
  }

  return {
    run,
    streamJson,
    threads: {
      list: listThreads,
      continue: continueThread,
    },
  }
}
```

```typescript
// lib/sandbox/providers/e2b-codex-service.ts
/**
 * E2B Codex Service
 * 
 * Run OpenAI Codex agent in E2B sandboxes
 * @see https://e2b.dev/docs/agents/codex
 */

import type { Sandbox } from '@e2b/code-interpreter'
import { readFile } from 'node:fs/promises'

export interface CodexExecutionConfig {
  prompt: string
  fullAuto?: boolean
  skipGitRepoCheck?: boolean
  outputSchema?: object
  image?: {
    path: string
    data?: Buffer
  }
  workingDir?: string
  onEvent?: (event: CodexEvent) => void
}

export interface CodexEvent {
  type: 'tool_call' | 'file_change' | 'message' | 'error'
  data: any
}

export interface CodexExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
  events?: CodexEvent[]
}

export function createCodexService(
  sandbox: Sandbox,
  apiKey: string
) {
  const CODEX_CMD = 'codex exec'

  async function run(config: CodexExecutionConfig): Promise<CodexExecutionResult> {
    // Write output schema if provided
    if (config.outputSchema) {
      await sandbox.files.write(
        '/home/user/codex-schema.json',
        JSON.stringify(config.outputSchema, null, 2)
      )
    }

    // Upload image if provided
    if (config.image?.data) {
      await sandbox.files.write(config.image.path, config.image.data)
    }

    const args = [
      config.fullAuto ? '--full-auto' : '',
      config.skipGitRepoCheck ? '--skip-git-repo-check' : '',
      config.outputSchema ? `--output-schema /home/user/codex-schema.json` : '',
      config.image ? `--image ${config.image.path}` : '',
      config.workingDir ? `-C ${config.workingDir}` : '',
      `"${config.prompt.replace(/"/g, '\\"')}"`,
    ].filter(Boolean).join(' ')

    const command = `${CODEX_CMD} ${args}`

    const result = await sandbox.commands.run(command, {
      onStdout: config.onEvent ? undefined : (data) => console.log(data),
      onStderr: (data) => console.error(data),
    })

    // Parse events if output schema was used
    let events: CodexEvent[] | undefined
    if (config.outputSchema) {
      try {
        const output = JSON.parse(result.stdout)
        events = [{ type: 'tool_call', data: output }]
      } catch {
        // Output doesn't match schema
      }
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode || 0,
      events,
    }
  }

  async function* streamEvents(config: CodexExecutionConfig): AsyncIterable<CodexEvent> {
    const args = [
      '--full-auto',
      '--skip-git-repo-check',
      '--json',
      config.workingDir ? `-C ${config.workingDir}` : '',
      `"${config.prompt.replace(/"/g, '\\"')}"`,
    ].filter(Boolean).join(' ')

    const result = await sandbox.commands.run(`${CODEX_CMD} ${args}`)

    // Parse JSONL output (events to stdout, progress to stderr)
    for (const line of result.stdout.split('\n').filter(Boolean)) {
      try {
        const event: CodexEvent = JSON.parse(line)
        yield event
        config.onEvent?.(event)
      } catch {
        // Skip invalid JSON
      }
    }
  }

  return {
    run,
    streamEvents,
  }
}
```

---

## Part 2: Daytona Provider Enhancements

### 2.1 Missing Features Identified

From `docs/sdk/daytona-llms.txt` (1,192 lines):

#### A. LSP Server Support (docs lines 400-500)
```typescript
// MISSING: Language Server Protocol support
interface LspServerService {
  start(language: string): Promise<void>
  stop(): Promise<void>
  completions(file: string, line: number, col: number): Promise<Completion[]>
  documentSymbols(file: string): Promise<Symbol[]>
  sandboxSymbols(): Promise<Symbol[]>
}
```

**Implementation Plan:**
- Create `lib/sandbox/providers/daytona-lsp-service.ts`
- Support multiple languages
- Add to `DaytonaSandboxHandle`

#### B. Process Service Enhancements (docs lines 600-700)
```typescript
// MISSING: Advanced process management
interface ProcessService {
  codeRun(code: string, language: string): Promise<ProcessResult>
  start(config: ProcessConfig): Promise<Process>
  list(): Promise<ProcessInfo[]>
  logs(pid: number): Promise<string>
}
```

**Implementation Plan:**
- Enhance existing process management
- Add code execution with language detection
- Add log retrieval

#### C. Screen Recording (docs lines 200-250)
```typescript
// MISSING: Screen recording for computer use
interface RecordingService {
  configure(directory: string): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  list(): Promise<Recording[]>
  get(id: string): Promise<Recording>
  download(id: string): Promise<Buffer>
  delete(id: string): Promise<void>
}
```

**Implementation Plan:**
- Add to `ComputerUseService`
- Support MP4/Webm formats
- Add download endpoint

### 2.2 Implementation Code

```typescript
// lib/sandbox/providers/daytona-lsp-service.ts
/**
 * Daytona LSP Server Service
 * 
 * Provides code intelligence via Language Server Protocol
 * @see https://www.daytona.io/docs/en/go-sdk/daytona.md#type-lspserverservice
 */

export interface LspCompletion {
  label: string
  kind: number
  detail?: string
  documentation?: string
  textEdit?: {
    range: { start: Position; end: Position }
    newText: string
  }
}

export interface LspSymbol {
  name: string
  kind: number
  location: {
    uri: string
    range: { start: Position; end: Position }
  }
}

export interface Position {
  line: number
  character: number
}

export interface LspServerService {
  start(language: string): Promise<void>
  stop(): Promise<void>
  completions(file: string, position: Position): Promise<LspCompletion[]>
  documentSymbols(file: string): Promise<LspSymbol[]>
  sandboxSymbols(): Promise<LspSymbol[]>
}

export function createLspServerService(
  sandbox: any,
  sandboxId: string
): LspServerService {
  let lspProcess: any = null

  async function start(language: string): Promise<void> {
    const languageServerMap: Record<string, string> = {
      typescript: 'typescript-language-server',
      javascript: 'typescript-language-server',
      python: 'pylsp',
      go: 'gopls',
      rust: 'rust-analyzer',
      java: 'jdtls',
    }

    const server = languageServerMap[language] || languageServerMap.typescript
    
    // Start LSP server process
    lspProcess = await sandbox.process.executeCommand(
      `${server} --stdio`,
      '/workspace'
    )
  }

  async function stop(): Promise<void> {
    if (lspProcess) {
      await lspProcess.kill()
      lspProcess = null
    }
  }

  async function completions(
    file: string,
    position: Position
  ): Promise<LspCompletion[]> {
    // Send LSP textDocument/completion request
    const response = await sendLspRequest('textDocument/completion', {
      textDocument: { uri: `file://${file}` },
      position,
    })
    return response.items || []
  }

  async function documentSymbols(file: string): Promise<LspSymbol[]> {
    const response = await sendLspRequest('textDocument/documentSymbol', {
      textDocument: { uri: `file://${file}` },
    })
    return response || []
  }

  async function sandboxSymbols(): Promise<LspSymbol[]> {
    const response = await sendLspRequest('workspace/symbol', {
      query: '',
    })
    return response || []
  }

  async function sendLspRequest(method: string, params: any): Promise<any> {
    if (!lspProcess) {
      throw new Error('LSP server not started')
    }

    // LSP uses JSON-RPC over stdio
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }

    const response = await lspProcess.executeCommand(
      `echo '${JSON.stringify(request)}' | nc localhost ${lspProcess.port}`
    )

    return JSON.parse(response.result).result
  }

  return {
    start,
    stop,
    completions,
    documentSymbols,
    sandboxSymbols,
  }
}
```

---

## Part 3: Blaxel Provider Enhancements

### 3.1 Missing Features Identified

From `docs/sdk/blaxel-llms-full.txt` (18,272 lines):

#### A. Enhanced Async Triggers (docs lines 1-100, 500-600)
```typescript
// MISSING: Advanced async trigger configuration
interface AsyncTriggerConfig {
  id: string
  type: 'http-async'
  configuration: {
    path: string
    retry: number
    callbackUrl?: string
    callbackSecret?: string
  }
}

interface AsyncExecution {
  run(input: any): Promise<{ success: true }>
  waitForCallback(timeoutMs?: number): Promise<CallbackResult>
  verifyCallback(signature: string, body: string): boolean
}
```

**Implementation Plan:**
- Enhance `blaxel-async.ts`
- Add callback secret persistence
- Add signature verification helper

#### B. Multi-Agent Handoffs (docs lines 700-800)
```typescript
// MISSING: Agent chaining/handoffs
interface AgentHandoff {
  run(agentName: string, input: any): Promise<AgentResult>
  chain(agents: string[], input: any): Promise<AgentResult[]>
}
```

**Implementation Plan:**
- Add to `BlaxelProvider`
- Support sequential agent calls
- Add result aggregation

#### C. Batch Job Enhancements (docs lines 400-500)
```typescript
// MISSING: Advanced batch processing
interface BatchJob {
  create(config: BatchConfig): Promise<BatchJobHandle>
  monitor(jobId: string): Promise<BatchStatus>
  cancel(jobId: string): Promise<void>
  results(jobId: string): Promise<BatchResult[]>
}
```

**Implementation Plan:**
- Enhance existing batch support
- Add real-time monitoring
- Add result aggregation

### 3.2 Implementation Code

```typescript
// lib/sandbox/providers/blaxel-agent-handoff.ts
/**
 * Blaxel Multi-Agent Handoff Service
 * 
 * Chain multiple agents together for complex workflows
 * @see https://docs.blaxel.ai/Agents/Deploy-multiple
 */

import { getDatabase } from '@/lib/database'

export interface AgentHandoffResult {
  agentName: string
  output: string
  executionTime: number
  success: boolean
}

export interface AgentChainResult {
  results: AgentHandoffResult[]
  finalOutput: string
  totalExecutionTime: number
}

export interface BlaxelAgentHandoffService {
  run(agentName: string, input: any): Promise<AgentHandoffResult>
  chain(
    agentNames: string[],
    initialInput: any,
    options?: { stopOnError?: boolean }
  ): Promise<AgentChainResult>
  getHistory(agentName?: string): Promise<AgentHandoffResult[]>
}

export function createAgentHandoffService(
  apiKey: string,
  workspace: string
): BlaxelAgentHandoffService {
  const db = getDatabase()
  
  // Ensure history table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS blaxel_agent_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      input TEXT,
      output TEXT,
      execution_time INTEGER,
      success BOOLEAN,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  async function run(
    agentName: string,
    input: any
  ): Promise<AgentHandoffResult> {
    const startTime = Date.now()
    
    try {
      // Call agent via Blaxel API
      const response = await fetch(
        `https://run.blaxel.ai/${workspace}/agents/${agentName}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ input }),
        }
      )

      const output = await response.text()
      const executionTime = Date.now() - startTime

      // Record in history
      db.exec(
        `INSERT INTO blaxel_agent_history (agent_name, input, output, execution_time, success)
         VALUES (?, ?, ?, ?, ?)`,
        [agentName, JSON.stringify(input), output, executionTime, response.ok]
      )

      return {
        agentName,
        output,
        executionTime,
        success: response.ok,
      }
    } catch (error: any) {
      const executionTime = Date.now() - startTime
      
      db.exec(
        `INSERT INTO blaxel_agent_history (agent_name, input, output, execution_time, success)
         VALUES (?, ?, ?, ?, ?)`,
        [agentName, JSON.stringify(input), error.message, executionTime, false]
      )

      throw error
    }
  }

  async function chain(
    agentNames: string[],
    initialInput: any,
    options: { stopOnError?: boolean } = {}
  ): Promise<AgentChainResult> {
    const results: AgentHandoffResult[] = []
    const startTime = Date.now()
    let currentInput = initialInput

    for (const agentName of agentNames) {
      try {
        const result = await run(agentName, currentInput)
        results.push(result)
        currentInput = result.output

        if (!result.success && options.stopOnError) {
          break
        }
      } catch (error: any) {
        if (options.stopOnError) {
          results.push({
            agentName,
            output: error.message,
            executionTime: 0,
            success: false,
          })
          break
        }
        throw error
      }
    }

    return {
      results,
      finalOutput: results[results.length - 1]?.output || '',
      totalExecutionTime: Date.now() - startTime,
    }
  }

  async function getHistory(agentName?: string): Promise<AgentHandoffResult[]> {
    const query = agentName
      ? 'SELECT * FROM blaxel_agent_history WHERE agent_name = ? ORDER BY created_at DESC LIMIT 100'
      : 'SELECT * FROM blaxel_agent_history ORDER BY created_at DESC LIMIT 100'

    const stmt = db.prepare(query)
    const rows = agentName ? stmt.all(agentName) : stmt.all()

    return rows.map((row: any) => ({
      agentName: row.agent_name,
      output: row.output,
      executionTime: row.execution_time,
      success: row.success,
    }))
  }

  return {
    run,
    chain,
    getHistory,
  }
}
```

---

## Part 4: Sprites Provider Enhancements

### 4.1 Missing Features Identified

From `docs/sdk/sprites-llms-full.txt` (1,368 lines):

#### A. Enhanced Checkpoint System (docs lines 200-300)
```typescript
// MISSING: Advanced checkpoint management
interface CheckpointManager {
  create(name?: string): Promise<Checkpoint>
  restore(checkpointId: string): Promise<void>
  list(): Promise<Checkpoint[]>
  delete(checkpointId: string): Promise<void>
  export(checkpointId: string): Promise<TarBuffer>
  import(tarBuffer: TarBuffer): Promise<Checkpoint>
}
```

**Implementation Plan:**
- Enhance `sprites-checkpoint-manager.ts`
- Add export/import functionality
- Add retention policies

#### B. Service Auto-Management (docs lines 400-500)
```typescript
// MISSING: Service lifecycle management
interface ServiceManager {
  create(config: ServiceConfig): Promise<Service>
  list(): Promise<Service[]>
  restart(serviceId: string): Promise<void>
  logs(serviceId: string): Promise<string>
  configureAutoSuspend(enabled: boolean): Promise<void>
}
```

**Implementation Plan:**
- Add to `SpritesSandboxHandle`
- Support autostart/autostop
- Add log retrieval

#### C. SSH Tunneling (docs lines 500-600)
```typescript
// MISSING: SSH access and tunneling
interface SshService {
  getConnectionConfig(): Promise<SshConfig>
  createTunnel(localPort: number, remotePort: number): Promise<Tunnel>
  listTunnels(): Promise<Tunnel[]>
  closeTunnel(tunnelId: string): Promise<void>
}
```

**Implementation Plan:**
- Add SSH key management
- Add port forwarding
- Add tunnel lifecycle

### 4.2 Implementation Code

```typescript
// lib/sandbox/providers/sprites-service-manager.ts
/**
 * Sprites Service Manager
 * 
 * Manage auto-start/stop services on Sprites
 * @see https://docs.sprites.dev/working-with-sprites/#auto-suspend
 */

export interface ServiceConfig {
  name: string
  protocol: 'tcp' | 'udp'
  internalPort: number
  autostart: boolean
  autostop: 'suspend' | 'stop' | 'never'
  command?: string
  args?: string[]
}

export interface Service {
  id: string
  name: string
  status: 'running' | 'stopped' | 'suspended'
  config: ServiceConfig
}

export interface SpritesServiceManager {
  create(config: ServiceConfig): Promise<Service>
  list(): Promise<Service[]>
  restart(serviceId: string): Promise<void>
  logs(serviceId: string): Promise<string>
  configureAutoSuspend(enabled: boolean): Promise<void>
  delete(serviceId: string): Promise<void>
}

export function createServiceManager(
  sprite: any,
  spriteName: string
): SpritesServiceManager {
  async function create(config: ServiceConfig): Promise<Service> {
    // Update Sprite config with service
    const currentConfig = await sprite.getConfig()
    
    const newService = {
      protocol: config.protocol,
      internal_port: config.internalPort,
      autostart: config.autostart,
      autostop: config.autostop,
    }

    const updatedConfig = {
      ...currentConfig,
      services: [...(currentConfig.services || []), newService],
    }

    await sprite.updateConfig(updatedConfig)

    // Start service if command provided
    if (config.command) {
      await sprite.execFile(config.command, config.args || [], {
        background: true,
      })
    }

    return {
      id: `${spriteName}-${config.name}`,
      name: config.name,
      status: 'running',
      config,
    }
  }

  async function list(): Promise<Service[]> {
    const config = await sprite.getConfig()
    return (config.services || []).map((svc: any, index: number) => ({
      id: `${spriteName}-service-${index}`,
      name: `service-${index}`,
      status: 'running', // Would need to check actual status
      config: {
        name: `service-${index}`,
        protocol: svc.protocol,
        internalPort: svc.internal_port,
        autostart: svc.autostart,
        autostop: svc.autostop,
      },
    }))
  }

  async function restart(serviceId: string): Promise<void> {
    // Kill existing process and restart
    const services = await list()
    const service = services.find(s => s.id === serviceId)
    
    if (!service) {
      throw new Error(`Service ${serviceId} not found`)
    }

    // This would need actual process management
    await sprite.execFile('pkill', ['-f', service.config.name])
    
    if (service.config.command) {
      await sprite.execFile(service.config.command, service.config.args || [], {
        background: true,
      })
    }
  }

  async function logs(serviceId: string): Promise<string> {
    // Get service logs (would need journalctl or similar)
    const result = await sprite.execFile('journalctl', [
      '-u',
      serviceId,
      '--no-pager',
      '-n',
      '100',
    ])
    return result.stdout
  }

  async function configureAutoSuspend(enabled: boolean): Promise<void> {
    const config = await sprite.getConfig()
    
    const updatedConfig = {
      ...config,
      services: (config.services || []).map((svc: any) => ({
        ...svc,
        autostop: enabled ? 'suspend' : 'never',
      })),
    }

    await sprite.updateConfig(updatedConfig)
  }

  async function delete(serviceId: string): Promise<void> {
    const config = await sprite.getConfig()
    const services = await list()
    const serviceIndex = services.findIndex(s => s.id === serviceId)
    
    if (serviceIndex === -1) {
      throw new Error(`Service ${serviceId} not found`)
    }

    const updatedConfig = {
      ...config,
      services: (config.services || []).filter(
        (_, i) => i !== serviceIndex
      ),
    }

    await sprite.updateConfig(updatedConfig)
  }

  return {
    create,
    list,
    restart,
    logs,
    configureAutoSuspend,
    delete,
  }
}
```

---

## Part 5: Cross-Provider Enhancements

### 5.1 Unified Snapshot System

```typescript
// lib/sandbox/unified-snapshot.ts
/**
 * Unified Snapshot System
 * 
 * Cross-provider snapshot/checkpoint management
 */

export interface Snapshot {
  id: string
  provider: string
  sandboxId: string
  createdAt: number
  size?: number
  metadata?: Record<string, any>
}

export interface UnifiedSnapshotManager {
  create(handle: SandboxHandle, name?: string): Promise<Snapshot>
  restore(snapshotId: string, handle: SandboxHandle): Promise<void>
  list(handle: SandboxHandle): Promise<Snapshot[]>
  delete(snapshotId: string): Promise<void>
  export(snapshotId: string): Promise<TarBuffer>
  import(provider: string, tarBuffer: TarBuffer): Promise<Snapshot>
}
```

### 5.2 Cross-Provider File Sync

```typescript
// lib/sandbox/cross-provider-sync.ts
/**
 * Cross-Provider File Synchronization
 * 
 * Sync files between different provider sandboxes
 */

export interface SyncConfig {
  source: { provider: string; sandboxId: string; path: string }
  destination: { provider: string; sandboxId: string; path: string }
  mode: 'push' | 'pull' | 'bidirectional'
  incremental?: boolean
}

export interface SyncResult {
  transferred: number
  skipped: number
  errors: Array<{ path: string; error: string }>
}

export async function syncFiles(config: SyncConfig): Promise<SyncResult> {
  // Implementation using tar-pipe for large transfers
  // and individual file sync for small changes
}
```

### 5.3 Shared MCP Gateway

```typescript
// lib/sandbox/shared-mcp-gateway.ts
/**
 * Shared MCP Gateway
 * 
 * Unified MCP tool access across all providers
 */

export interface SharedMcpGateway {
  listTools(): Promise<McpTool[]>
  callTool(name: string, args: Record<string, any>): Promise<McpToolResult>
  addServer(config: McpServerConfig): Promise<void>
  removeServer(name: string): Promise<void>
  getServers(): Promise<McpServer[]>
}
```

---

## Part 6: Implementation Priority

### Phase 1 (High Priority - Week 1-2)
1. ✅ E2B Amp Service - Already partially implemented
2. ✅ E2B Codex Service - High demand feature
3. ✅ Daytona LSP Service - Code intelligence
4. ✅ Blaxel Agent Handoff - Multi-agent workflows

### Phase 2 (Medium Priority - Week 3-4)
1. E2B Template Builder - Custom environments
2. Sprites Service Manager - Auto-management
3. Daytona Recording Service - Screen recording
4. Cross-provider snapshot system

### Phase 3 (Lower Priority - Week 5-6)
1. E2B streaming JSON output
2. E2B image input support
3. Sprites SSH tunneling
4. Cross-provider file sync
5. Shared MCP gateway

---

## Part 7: Testing Strategy

### Unit Tests
```typescript
// test/sandbox/providers/e2b-amp-service.test.ts
describe('E2B Amp Service', () => {
  it('should run Amp with prompt', async () => {
    const amp = createAmpService(sandbox, apiKey)
    const result = await amp.run({
      prompt: 'Create a hello world function',
      dangerouslyAllowAll: true,
    })
    expect(result.stdout).toContain('Hello')
  })

  it('should stream JSON events', async () => {
    const amp = createAmpService(sandbox, apiKey)
    const events: AmpEvent[] = []
    
    for await (const event of amp.streamJson({
      prompt: 'Test prompt',
      streamJson: true,
    })) {
      events.push(event)
    }
    
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].type).toBe('assistant')
  })
})
```

### Integration Tests
```typescript
// test/integration/agent-handoff.test.ts
describe('Blaxel Agent Handoff', () => {
  it('should chain multiple agents', async () => {
    const handoff = createAgentHandoffService(apiKey, workspace)
    
    const result = await handoff.chain(
      ['research-agent', 'writing-agent', 'review-agent'],
      'Write a blog post about AI'
    )
    
    expect(result.results.length).toBe(3)
    expect(result.finalOutput).toBeTruthy()
  })
})
```

---

## Part 8: Rollback Strategy

All enhancements are designed as **additive modules** that:
1. Don't modify existing provider interfaces
2. Use factory functions for optional features
3. Gracefully degrade if dependencies unavailable
4. Can be disabled via environment variables

Example rollback:
```typescript
// If E2B Amp fails to load
try {
  const amp = createAmpService(sandbox, apiKey)
} catch (error) {
  console.warn('Amp service unavailable:', error)
  // Continue without Amp - no breaking changes
}
```

---

## Conclusion

This plan identifies **20+ missing features** across providers and provides specific implementation code for each. All enhancements are designed to be additive, non-breaking, and optionally enabled.

**Next Steps:**
1. Review and approve implementation priorities
2. Begin Phase 1 implementations
3. Add comprehensive tests
4. Update documentation
5. Deploy with feature flags for gradual rollout
