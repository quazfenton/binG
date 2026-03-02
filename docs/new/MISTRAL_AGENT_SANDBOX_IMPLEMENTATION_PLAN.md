# Mistral Agent SDK Sandbox Provider - Comprehensive Technical Plan

## Executive Summary

This document outlines a comprehensive plan to enhance the existing Mistral Code Interpreter provider implementation with advanced features, better abstraction, modular architecture, and integration with the project's fallback chains and configuration systems.

**Current State**: A basic implementation exists (`mistral-code-interpreter-provider.ts`) that:
- Creates sandbox sessions using Mistral's code_interpreter tool
- Executes commands via conversational AI
- Returns structured JSON output

**Target State**: A production-ready, modular, and composable sandbox provider with:
- Full Agent SDK integration (Agents API + Conversations API)
- Advanced code execution features (file operations, previews, PTY)
- Intelligent fallback chain integration
- Comprehensive error handling and retry logic
- Quota management and cost tracking
- Streaming support for real-time output
- Multi-model support with automatic selection
- Enhanced security and validation

---

## 1. Architecture Overview

### 1.1 System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Application Layer                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐    │
│  │ Chat Panel  │  │ Code Mode   │  │ Agent Interface     │    │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘    │
│         │                │                     │                │
│         └────────────────┴─────────────────────┘                │
│                          │                                      │
│                  ┌───────▼────────┐                             │
│                  │ Sandbox Service │                            │
│                  │     Bridge      │                             │
│                  └───────┬────────┘                             │
└──────────────────────────┼──────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
┌────────▼────────┐ ┌─────▼──────┐  ┌──────▼────────┐
│ Provider Router │ │  Fallback  │  │    Quota      │
│ & Factory       │ │   Chain    │  │   Manager     │
└────────┬────────┘ └────────────┘  └───────────────┘
         │
    ┌────┴────┬────────────┬────────────┬──────────┐
    │         │            │            │          │
┌───▼──┐ ┌───▼───┐  ┌─────▼────┐ ┌────▼────┐ ┌──▼──┐
│Mistral│ │ E2B   │  │ Daytona  │ │RunLoop  │ │Micro│
│ Agent │ │       │  │          │ │         │ │Sndbx│
└───────┘ └───────┘  └──────────┘ └─────────┘ └─────┘
```

### 1.2 Provider Abstraction Layers

**Layer 1: Core Sandbox Provider Interface** (Existing)
```typescript
interface SandboxProvider {
  createSandbox(config): Promise<SandboxHandle>
  getSandbox(sandboxId): Promise<SandboxHandle>
  destroySandbox(sandboxId): Promise<void>
}
```

**Layer 2: Enhanced Capabilities Interface** (New)
```typescript
interface EnhancedSandboxCapabilities {
  // Code execution
  executeCode(code: string, options): Promise<ExecutionResult>
  
  // File operations (virtual)
  getVirtualFileSystem(): Promise<VirtualFileSystem>
  
  // Streaming
  streamExecution(code: string): AsyncIterable<ExecutionChunk>
  
  // State management
  saveState(): Promise<SandboxState>
  restoreState(state: SandboxState): Promise<void>
}
```

**Layer 3: Agent-Specific Interface** (New for Mistral)
```typescript
interface AgentSandboxProvider extends SandboxProvider {
  // Agent lifecycle
  createAgent(config: AgentConfig): Promise<Agent>
  updateAgent(agentId: string, config: AgentUpdate): Promise<Agent>
  
  // Conversation management
  startConversation(agentId: string, inputs: Input[]): Promise<Conversation>
  appendMessage(conversationId: string, inputs: Input[]): Promise<Conversation>
  
  // Tool management
  enableTools(agentId: string, tools: ToolType[]): Promise<void>
  
  // Streaming
  streamConversation(agentId: string, inputs: Input[]): AsyncIterable<StreamChunk>
}
```

---

## 2. Enhanced Mistral Provider Implementation

### 2.1 File Structure

```
lib/sandbox/providers/
├── mistral/
│   ├── index.ts                          # Main exports
│   ├── mistral-agent-provider.ts         # Core provider implementation
│   ├── mistral-conversation-manager.ts   # Conversation state management
│   ├── mistral-code-executor.ts          # Code execution logic
│   ├── mistral-file-system.ts            # Virtual filesystem emulation
│   ├── mistral-stream-handler.ts         # Streaming response handling
│   ├── mistral-error-handler.ts          # Error handling & retry logic
│   ├── mistral-quota-manager.ts          # Usage tracking & quotas
│   ├── mistral-types.ts                  # Mistral-specific types
│   └── utils/
│       ├── prompt-builder.ts             # Prompt construction
│       ├── response-parser.ts            # Response extraction
│       └── code-validator.ts             # Code safety validation
```

### 2.2 Core Provider Implementation

```typescript
// lib/sandbox/providers/mistral/mistral-agent-provider.ts

import { Mistral } from '@mistralai/mistralai'
import type { 
  SandboxProvider, 
  SandboxHandle, 
  SandboxCreateConfig,
  ToolResult,
  PreviewInfo 
} from '../sandbox-provider'
import type { 
  AgentConfig, 
  AgentSandboxHandle,
  MistralProviderConfig,
  MistralSession,
  CodeExecutionRequest,
  CodeExecutionResult,
  StreamChunk,
  ToolType
} from './mistral-types'
import { ConversationManager } from './mistral-conversation-manager'
import { CodeExecutor } from './mistral-code-executor'
import { VirtualFileSystem } from './mistral-file-system'
import { StreamHandler } from './mistral-stream-handler'
import { ErrorHandler, RetryConfig } from './mistral-error-handler'
import { QuotaTracker } from './mistral-quota-manager'

export class MistralAgentProvider implements SandboxProvider {
  readonly name = 'mistral-agent'
  private client: Mistral
  private config: MistralProviderConfig
  private conversationManager: ConversationManager
  private codeExecutor: CodeExecutor
  private streamHandler: StreamHandler
  private errorHandler: ErrorHandler
  private quotaTracker: QuotaTracker

  constructor(config?: Partial<MistralProviderConfig>) {
    const apiKey = process.env.MISTRAL_API_KEY
    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY environment variable is required')
    }

    this.config = {
      apiKey,
      serverURL: process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
      model: process.env.MISTRAL_AGENT_MODEL || 'mistral-medium-2505',
      codeInterpreterModel: process.env.MISTRAL_CODE_INTERPRETER_MODEL || 'mistral-medium-2505',
      defaultTemperature: 0.3,
      defaultTopP: 0.95,
      maxRetries: 3,
      timeout: 120000,
      enableStreaming: true,
      enableQuotaTracking: true,
      ...config,
    }

    this.client = new Mistral({
      apiKey: this.config.apiKey,
      serverURL: this.config.serverURL,
    })

    this.conversationManager = new ConversationManager(this.client)
    this.codeExecutor = new CodeExecutor(this.client, this.config)
    this.streamHandler = new StreamHandler(this.client)
    this.errorHandler = new ErrorHandler({
      maxRetries: this.config.maxRetries,
      timeout: this.config.timeout,
    })
    this.quotaTracker = new QuotaTracker()
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const sandboxId = `mistral-agent-${crypto.randomUUID()}`
    
    const session: MistralSession = {
      sandboxId,
      createdAt: Date.now(),
      lastActive: Date.now(),
      config,
      workspaceDir: '/workspace',
    }

    // Create agent with code_interpreter tool
    const agent = await this.createCodeInterpreterAgent()
    session.agentId = agent.id

    // Start initial conversation
    const conversation = await this.conversationManager.startConversation(
      agent.id,
      [{ role: 'system', content: 'You are a code execution assistant.' }]
    )
    session.conversationId = conversation.conversationId

    // Store session
    MistralSessionStore.set(sandboxId, session)

    // Track quota
    if (this.config.enableQuotaTracking) {
      await this.quotaTracker.recordSessionStart()
    }

    return new MistralAgentSandboxHandle(
      sandboxId,
      this.client,
      this.config,
      session
    )
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    let session = MistralSessionStore.get(sandboxId)
    
    if (!session) {
      // Rehydrate session (for dev restarts)
      session = {
        sandboxId,
        createdAt: Date.now(),
        lastActive: Date.now(),
        workspaceDir: '/workspace',
        config: {},
      }
      MistralSessionStore.set(sandboxId, session)
    }

    session.lastActive = Date.now()

    return new MistralAgentSandboxHandle(
      sandboxId,
      this.client,
      this.config,
      session
    )
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const session = MistralSessionStore.get(sandboxId)
    if (session) {
      if (this.config.enableQuotaTracking) {
        await this.quotaTracker.recordSessionEnd(session)
      }
      MistralSessionStore.delete(sandboxId)
    }
  }

  private async createCodeInterpreterAgent() {
    return this.client.beta.agents.create({
      model: this.config.codeInterpreterModel,
      name: 'Code Interpreter Agent',
      description: 'Agent specialized in safe code execution and analysis',
      instructions: [
        'You are a code execution assistant.',
        'Execute code safely and return structured results.',
        'Always use the code_interpreter tool for code execution.',
        'Return results in JSON format when possible.',
      ].join('\n'),
      tools: [{ type: 'code_interpreter' }],
      completionArgs: {
        temperature: this.config.defaultTemperature,
        topP: this.config.defaultTopP,
      },
    })
  }

  // Additional Agent SDK methods
  async createAgent(config: AgentConfig) {
    const agent = await this.client.beta.agents.create({
      model: config.model || this.config.model,
      name: config.name,
      description: config.description,
      instructions: config.instructions,
      tools: config.tools?.map(type => ({ type })) || [],
      completionArgs: config.completionArgs,
    })
    return agent
  }

  async updateAgent(agentId: string, update: AgentUpdate) {
    return this.client.beta.agents.update({
      agentId,
      agentUpdateRequest: {
        description: update.description,
        instructions: update.instructions,
        tools: update.tools?.map(type => ({ type )),
        completionArgs: update.completionArgs,
      },
    })
  }

  async enableTools(agentId: string, tools: ToolType[]) {
    return this.updateAgent(agentId, {
      tools,
    })
  }
}

// Session store
const MistralSessionStore = new Map<string, MistralSession>()
```

### 2.3 Conversation Manager

```typescript
// lib/sandbox/providers/mistral/mistral-conversation-manager.ts

import { Mistral } from '@mistralai/mistralai'
import type { 
  Conversation, 
  ConversationEntry, 
  ConversationAppendRequest,
  ConversationRestartRequest,
  StreamChunk
} from './mistral-types'

export class ConversationManager {
  private client: Mistral

  constructor(client: Mistral) {
    this.client = client
  }

  async startConversation(
    agentId: string,
    inputs: ConversationEntry[],
    options?: { store?: boolean; handoffExecution?: 'server' | 'client' }
  ): Promise<Conversation> {
    const response = await this.client.beta.conversations.start({
      agentId,
      inputs,
      store: options?.store ?? true,
      handoffExecution: options?.handoffExecution ?? 'server',
    })

    return {
      conversationId: response.conversationId,
      outputs: response.outputs,
      usage: response.usage,
      createdAt: new Date(),
    }
  }

  async appendMessage(
    conversationId: string,
    inputs: ConversationEntry[],
    options?: { store?: boolean; completionArgs?: any }
  ): Promise<Conversation> {
    const response = await this.client.beta.conversations.append({
      conversationId,
      conversationAppendRequest: {
        inputs,
        store: options?.store ?? true,
        completionArgs: options?.completionArgs,
      },
    })

    return {
      conversationId: response.conversationId,
      outputs: response.outputs,
      usage: response.usage,
      createdAt: new Date(),
    }
  }

  async restartConversation(
    conversationId: string,
    fromEntryId: string,
    inputs: ConversationEntry[],
    options?: { store?: boolean }
  ): Promise<Conversation> {
    const response = await this.client.beta.conversations.restart({
      conversationId,
      conversationRestartRequest: {
        fromEntryId,
        inputs,
        store: options?.store ?? true,
      },
    })

    return {
      conversationId: response.conversationId,
      outputs: response.outputs,
      usage: response.usage,
      createdAt: new Date(),
    }
  }

  async getHistory(conversationId: string): Promise<ConversationEntry[]> {
    const response = await this.client.beta.conversations.getHistory({
      conversationId,
    })
    return response.entries
  }

  async getMessages(conversationId: string): Promise<ConversationEntry[]> {
    const response = await this.client.beta.conversations.getMessages({
      conversationId,
    })
    return response.messages
  }

  async listConversations(options?: { page?: number; pageSize?: number }): Promise<Conversation[]> {
    const response = await this.client.beta.conversations.list({
      page: options?.page ?? 0,
      pageSize: options?.pageSize ?? 100,
    })
    return response
  }

  // Streaming methods
  async *streamConversation(
    agentId: string,
    inputs: ConversationEntry[]
  ): AsyncGenerator<StreamChunk> {
    const stream = await this.client.beta.conversations.startStream({
      agentId,
      inputs,
    })

    for await (const chunk of stream) {
      yield this.parseStreamChunk(chunk)
    }
  }

  async *streamAppend(
    conversationId: string,
    inputs: ConversationEntry[]
  ): AsyncGenerator<StreamChunk> {
    const stream = await this.client.beta.conversations.appendStream({
      conversationId,
      conversationAppendRequest: { inputs },
    })

    for await (const chunk of stream) {
      yield this.parseStreamChunk(chunk)
    }
  }

  private parseStreamChunk(chunk: any): StreamChunk {
    // Parse streaming chunk into structured format
    return {
      type: chunk.type,
      content: chunk.content,
      timestamp: new Date(),
      metadata: chunk.metadata,
    }
  }
}
```

### 2.4 Code Executor with Enhanced Features

```typescript
// lib/sandbox/providers/mistral/mistral-code-executor.ts

import { Mistral } from '@mistralai/mistralai'
import type { ToolResult } from '../types'
import type { 
  CodeExecutionRequest, 
  CodeExecutionResult,
  ExecutionEnvironment,
  CodeLanguage
} from './mistral-types'
import { PromptBuilder } from './utils/prompt-builder'
import { ResponseParser } from './utils/response-parser'
import { CodeValidator } from './utils/code-validator'

export class CodeExecutor {
  private client: Mistral
  private config: any
  private promptBuilder: PromptBuilder
  private responseParser: ResponseParser
  private codeValidator: CodeValidator

  constructor(client: Mistral, config: any) {
    this.client = client
    this.config = config
    this.promptBuilder = new PromptBuilder()
    this.responseParser = new ResponseParser()
    this.codeValidator = new CodeValidator()
  }

  async executeCode(
    request: CodeExecutionRequest
  ): Promise<CodeExecutionResult> {
    // Validate code for safety
    const validation = await this.codeValidator.validate(request.code, request.language)
    if (!validation.safe) {
      return {
        success: false,
        output: `Code safety validation failed: ${validation.reason}`,
        exitCode: 1,
        validationErrors: validation.errors,
      }
    }

    // Build execution prompt
    const prompt = this.promptBuilder.buildExecutionPrompt({
      code: request.code,
      language: request.language,
      cwd: request.cwd,
      env: request.env,
      timeout: request.timeout,
      requireJsonOutput: request.requireJsonOutput,
    })

    // Execute via conversation
    const response = await this.executeViaConversation(prompt, request.conversationId)

    // Parse response
    const result = this.responseParser.parseExecutionResult(response)

    return result
  }

  async executeCommand(
    command: string,
    cwd?: string,
    timeout?: number
  ): Promise<ToolResult> {
    const prompt = this.promptBuilder.buildCommandPrompt(command, cwd, timeout)
    
    const response = await this.executeViaConversation(prompt)
    
    const result = this.responseParser.parseToolResult(response)
    
    return result
  }

  // Multi-language code execution
  async executePython(code: string, options?: ExecutionEnvironment): Promise<CodeExecutionResult> {
    return this.executeCode({
      code,
      language: 'python',
      ...options,
    })
  }

  async executeJavaScript(code: string, options?: ExecutionEnvironment): Promise<CodeExecutionResult> {
    return this.executeCode({
      code,
      language: 'javascript',
      ...options,
    })
  }

  async executeTypeScript(code: string, options?: ExecutionEnvironment): Promise<CodeExecutionResult> {
    return this.executeCode({
      code,
      language: 'typescript',
      ...options,
    })
  }

  // Specialized execution methods
  async executeWithRetry(
    request: CodeExecutionRequest,
    retryConfig?: { maxRetries: number; backoffMs: number }
  ): Promise<CodeExecutionResult> {
    const maxRetries = retryConfig?.maxRetries ?? 3
    const backoffMs = retryConfig?.backoffMs ?? 1000

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeCode(request)
        if (result.success) {
          return result
        }
        
        if (attempt === maxRetries) {
          return result
        }

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, backoffMs * Math.pow(2, attempt)))
      } catch (error) {
        if (attempt === maxRetries) {
          throw error
        }
        await new Promise(resolve => setTimeout(resolve, backoffMs * Math.pow(2, attempt)))
      }
    }

    throw new Error('Max retries exceeded')
  }

  // Batch execution
  async executeBatch(
    requests: CodeExecutionRequest[]
  ): Promise<CodeExecutionResult[]> {
    const results: CodeExecutionResult[] = []
    
    for (const request of requests) {
      const result = await this.executeCode(request)
      results.push(result)
      
      // Stop on first failure if requested
      if (!result.success && request.stopOnFailure) {
        break
      }
    }

    return results
  }

  // Private helpers
  private async executeViaConversation(
    prompt: string,
    conversationId?: string
  ): Promise<any> {
    if (!conversationId) {
      // Start new conversation
      const response = await this.client.beta.conversations.start({
        model: this.config.codeInterpreterModel,
        tools: [{ type: 'code_interpreter' }],
        inputs: [{ role: 'user', content: prompt }],
      })
      return response
    } else {
      // Append to existing conversation
      const response = await this.client.beta.conversations.append({
        conversationId,
        conversationAppendRequest: {
          inputs: [{ role: 'user', content: prompt }],
        },
      })
      return response
    }
  }
}
```

### 2.5 Virtual File System Emulation

```typescript
// lib/sandbox/providers/mistral/mistral-file-system.ts

import type { ToolResult } from '../types'

interface VirtualFile {
  path: string
  content: string
  createdAt: number
  modifiedAt: number
  size: number
}

interface VirtualDirectory {
  path: string
  entries: string[]
  createdAt: number
}

export class VirtualFileSystem {
  private files: Map<string, VirtualFile> = new Map()
  private directories: Map<string, VirtualDirectory> = new Map()
  private workspaceRoot: string

  constructor(workspaceRoot: string = '/workspace') {
    this.workspaceRoot = workspaceRoot
    this.initializeRootDirectory()
  }

  private initializeRootDirectory() {
    this.directories.set(this.workspaceRoot, {
      path: this.workspaceRoot,
      entries: [],
      createdAt: Date.now(),
    })
  }

  async writeFile(path: string, content: string): Promise<ToolResult> {
    try {
      const fullPath = this.resolvePath(path)
      const now = Date.now()

      const file: VirtualFile = {
        path: fullPath,
        content,
        createdAt: now,
        modifiedAt: now,
        size: content.length,
      }

      this.files.set(fullPath, file)

      // Update parent directory
      const parentDir = this.getParentDirectory(fullPath)
      const dir = this.directories.get(parentDir)
      if (dir && !dir.entries.includes(path)) {
        dir.entries.push(path)
      }

      return {
        success: true,
        output: `File written: ${fullPath}`,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to write file: ${error.message}`,
        exitCode: 1,
      }
    }
  }

  async readFile(path: string): Promise<ToolResult> {
    try {
      const fullPath = this.resolvePath(path)
      const file = this.files.get(fullPath)

      if (!file) {
        return {
          success: false,
          output: `File not found: ${path}`,
          exitCode: 1,
        }
      }

      return {
        success: true,
        output: file.content,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to read file: ${error.message}`,
        exitCode: 1,
      }
    }
  }

  async listDirectory(path: string): Promise<ToolResult> {
    try {
      const fullPath = this.resolvePath(path)
      const dir = this.directories.get(fullPath)

      if (!dir) {
        return {
          success: false,
          output: `Directory not found: ${path}`,
          exitCode: 1,
        }
      }

      return {
        success: true,
        output: dir.entries.join('\n'),
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to list directory: ${error.message}`,
        exitCode: 1,
      }
    }
  }

  async deleteFile(path: string): Promise<ToolResult> {
    try {
      const fullPath = this.resolvePath(path)
      
      if (!this.files.has(fullPath)) {
        return {
          success: false,
          output: `File not found: ${path}`,
          exitCode: 1,
        }
      }

      this.files.delete(fullPath)

      // Remove from parent directory
      const parentDir = this.getParentDirectory(fullPath)
      const dir = this.directories.get(parentDir)
      if (dir) {
        dir.entries = dir.entries.filter(entry => entry !== path)
      }

      return {
        success: true,
        output: `File deleted: ${path}`,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to delete file: ${error.message}`,
        exitCode: 1,
      }
    }
  }

  async createDirectory(path: string): Promise<ToolResult> {
    try {
      const fullPath = this.resolvePath(path)

      if (this.directories.has(fullPath)) {
        return {
          success: false,
          output: `Directory already exists: ${path}`,
          exitCode: 1,
        }
      }

      this.directories.set(fullPath, {
        path: fullPath,
        entries: [],
        createdAt: Date.now(),
      })

      // Update parent directory
      const parentDir = this.getParentDirectory(fullPath)
      const dir = this.directories.get(parentDir)
      if (dir) {
        dir.entries.push(path)
      }

      return {
        success: true,
        output: `Directory created: ${path}`,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to create directory: ${error.message}`,
        exitCode: 1,
      }
    }
  }

  async fileExists(path: string): Promise<boolean> {
    const fullPath = this.resolvePath(path)
    return this.files.has(fullPath)
  }

  async directoryExists(path: string): Promise<boolean> {
    const fullPath = this.resolvePath(path)
    return this.directories.has(fullPath)
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot
  }

  // Sync filesystem state with Mistral conversation
  async syncWithConversation(conversationId: string): Promise<void> {
    // Build filesystem state summary
    const state = {
      files: Array.from(this.files.entries()).map(([path, file]) => ({
        path,
        size: file.size,
        modifiedAt: file.modifiedAt,
      })),
      directories: Array.from(this.directories.entries()).map(([path, dir]) => ({
        path,
        entries: dir.entries,
      })),
    }

    // Send state update to conversation for context
    // This helps Mistral maintain awareness of filesystem state
    // Implementation depends on conversation manager
  }

  // Private helpers
  private resolvePath(path: string): string {
    if (path.startsWith('/')) {
      return path
    }
    return `${this.workspaceRoot}/${path}`
  }

  private getParentDirectory(path: string): string {
    const parts = path.split('/')
    return parts.slice(0, -1).join('/') || '/'
  }
}
```

---

## 3. Integration with Existing Systems

### 3.1 Provider Registration & Factory

```typescript
// lib/sandbox/providers/index.ts

import type { SandboxProvider } from './sandbox-provider'
import { DaytonaProvider } from './daytona-provider'
import { E2BProvider } from './e2b-provider'
import { RunLoopProvider } from './runloop-provider'
import { MicroSandboxProvider } from './microsandbox-provider'
import { MistralAgentProvider } from './mistral/mistral-agent-provider'
import { BlaxelProvider } from './blaxel-provider'

export type ProviderName = 
  | 'daytona'
  | 'e2b'
  | 'runloop'
  | 'microsandbox'
  | 'mistral'
  | 'mistral-agent'
  | 'blaxel'

interface ProviderRegistryEntry {
  provider: SandboxProvider
  priority: number
  enabled: boolean
  available: boolean
}

class SandboxProviderRegistry {
  private providers: Map<ProviderName, ProviderRegistryEntry> = new Map()
  private defaultChain: ProviderName[] = ['daytona', 'e2b', 'mistral-agent', 'microsandbox']

  constructor() {
    this.registerBuiltInProviders()
  }

  private registerBuiltInProviders() {
    // Register providers with priority (lower = higher priority)
    this.register('daytona', new DaytonaProvider(), 1)
    this.register('e2b', new E2BProvider(), 2)
    this.register('mistral-agent', new MistralAgentProvider(), 3)
    this.register('microsandbox', new MicroSandboxProvider(), 4)
    this.register('runloop', new RunLoopProvider(), 5)
    this.register('blaxel', new BlaxelProvider(), 6)
  }

  register(name: ProviderName, provider: SandboxProvider, priority: number = 10) {
    this.providers.set(name, {
      provider,
      priority,
      enabled: true,
      available: true,
    })
  }

  async getAvailableProviders(): Promise<SandboxProvider[]> {
    const available: SandboxProvider[] = []
    
    for (const [name, entry] of this.providers) {
      if (!entry.enabled) continue
      
      try {
        const isAvailable = await this.checkProviderAvailability(entry.provider)
        entry.available = isAvailable
        if (isAvailable) {
          available.push(entry.provider)
        }
      } catch {
        entry.available = false
      }
    }
    
    return available.sort((a, b) => {
      const aEntry = Array.from(this.providers.values()).find(e => e.provider === a)
      const bEntry = Array.from(this.providers.values()).find(e => e.provider === b)
      return (aEntry?.priority ?? 10) - (bEntry?.priority ?? 10)
    })
  }

  async createWithFallback(config: any, providerChain?: ProviderName[]): Promise<SandboxHandle> {
    const chain = providerChain || this.defaultChain
    const errors: Array<{ provider: string; error: Error }> = []

    for (const providerName of chain) {
      const entry = this.providers.get(providerName)
      if (!entry || !entry.enabled || !entry.available) {
        continue
      }

      try {
        const handle = await entry.provider.createSandbox(config)
        console.log(`[Sandbox] Created with provider: ${providerName}`)
        return handle
      } catch (error: any) {
        console.warn(`[Sandbox] Provider ${providerName} failed:`, error.message)
        errors.push({ provider: providerName, error })
        
        // Check if error is retryable
        if (this.isRetryableError(error)) {
          continue
        }
        
        // Non-retryable error, try next provider
      }
    }

    throw new Error(
      `All sandbox providers failed. Errors: ${errors.map(e => `${e.provider}: ${e.error.message}`).join('; ')}`
    )
  }

  private isRetryableError(error: any): boolean {
    const message = error.message.toLowerCase()
    return (
      message.includes('timeout') ||
      message.includes('rate limit') ||
      message.includes('unavailable') ||
      message.includes('503') ||
      message.includes('429')
    )
  }

  private async checkProviderAvailability(provider: SandboxProvider): Promise<boolean> {
    try {
      // Lightweight health check
      await provider.createSandbox({})
      return true
    } catch {
      return false
    }
  }
}

export const sandboxProviderRegistry = new SandboxProviderRegistry()

export function getSandboxProvider(name?: ProviderName): SandboxProvider {
  if (name) {
    const entry = sandboxProviderRegistry.providers.get(name)
    if (!entry) {
      throw new Error(`Provider ${name} not found`)
    }
    return entry.provider
  }

  // Return default provider based on environment
  const preferredProvider = process.env.SANDBOX_PROVIDER as ProviderName || 'daytona'
  return getSandboxProvider(preferredProvider)
}
```

### 3.2 Environment Configuration

```typescript
// Add to env.example

# ===========================================
# MISTRAL AGENT SANDBOX PROVIDER
# ===========================================
# Mistral AI Agent SDK for code execution
# Documentation: https://docs.mistral.ai/agents/

# Required: Mistral API Key
MISTRAL_API_KEY=your_mistral_api_key_here

# Optional: Custom base URL (for enterprise/proxy)
#MISTRAL_BASE_URL=https://api.mistral.ai/v1

# Agent Model Configuration
# Default model for general agent tasks
MISTRAL_AGENT_MODEL=mistral-medium-2505

# Model for code interpretation (can use same as agent model)
MISTRAL_CODE_INTERPRETER_MODEL=mistral-medium-2505

# Agent Behavior Configuration
# Temperature for agent responses (0.0 - 1.0)
# Lower = more deterministic, higher = more creative
MISTRAL_AGENT_TEMPERATURE=0.3

# Top P for sampling (0.0 - 1.0)
MISTRAL_AGENT_TOP_P=0.95

# Execution Configuration
# Maximum retries for failed executions
MISTRAL_CODE_EXECUTION_MAX_RETRIES=3

# Timeout for code execution in milliseconds
MISTRAL_CODE_EXECUTION_TIMEOUT_MS=120000

# Enable/disable streaming responses
MISTRAL_ENABLE_STREAMING=true

# Enable/disable quota tracking
MISTRAL_ENABLE_QUOTA_TRACKING=true

# Monthly quota for Mistral code interpreter executions
# Set to 0 to disable (unlimited)
MISTRAL_CODE_EXECUTION_MONTHLY_QUOTA=1000

# Sandbox Provider Fallback Chain
# Comma-separated list of providers in order of preference
# Available: daytona, e2b, mistral-agent, microsandbox, runloop, blaxel
SANDBOX_PROVIDER_FALLBACK_CHAIN=daytona,e2b,mistral-agent,microsandbox

# Default Sandbox Provider (when not using fallback)
SANDBOX_PROVIDER=mistral-agent

# Enable Mistral Agent as fallback when primary providers fail
SANDBOX_ENABLE_MISTRAL_FALLBACK=true
```

### 3.3 Quota Manager Integration

```typescript
// lib/sandbox/providers/mistral/mistral-quota-manager.ts

import { quotaManager } from '../../../services/quota-manager'

interface UsageRecord {
  timestamp: number
  sandboxId: string
  conversationId?: string
  executionCount: number
  tokenUsage?: {
    prompt: number
    completion: number
    total: number
  }
}

export class QuotaTracker {
  private usageRecords: Map<string, UsageRecord> = new Map()
  private monthlyQuota: number
  private quotaResetDate: Date

  constructor() {
    this.monthlyQuota = parseInt(process.env.MISTRAL_CODE_EXECUTION_MONTHLY_QUOTA || '1000', 10)
    this.quotaResetDate = this.getNextMonthStart()
  }

  async recordSessionStart(): Promise<void> {
    // Check quota
    if (this.monthlyQuota > 0) {
      const currentUsage = await this.getCurrentMonthUsage()
      if (currentUsage >= this.monthlyQuota) {
        throw new Error('Mistral code execution monthly quota exceeded')
      }
    }
  }

  async recordExecution(
    sandboxId: string,
    conversationId: string,
    tokenUsage?: any
  ): Promise<void> {
    const record = this.usageRecords.get(sandboxId) || {
      timestamp: Date.now(),
      sandboxId,
      executionCount: 0,
    }

    record.executionCount++
    record.timestamp = Date.now()
    
    if (tokenUsage) {
      record.tokenUsage = {
        prompt: tokenUsage.prompt_tokens || 0,
        completion: tokenUsage.completion_tokens || 0,
        total: tokenUsage.total_tokens || 0,
      }
    }

    this.usageRecords.set(sandboxId, record)

    // Report to global quota manager
    await quotaManager.recordUsage('mistral', {
      type: 'code_execution',
      count: 1,
      tokens: record.tokenUsage?.total,
    })
  }

  async recordSessionEnd(session: any): Promise<void> {
    const record = this.usageRecords.get(session.sandboxId)
    if (record) {
      this.usageRecords.delete(session.sandboxId)
    }
  }

  async getCurrentMonthUsage(): Promise<number> {
    // Sum all executions this month
    const now = Date.now()
    let total = 0

    for (const record of this.usageRecords.values()) {
      if (record.timestamp >= this.quotaResetDate.getTime()) {
        total += record.executionCount
      }
    }

    return total
  }

  async getUsageStats(): Promise<{
    currentUsage: number
    quota: number
    remaining: number
    resetDate: Date
  }> {
    const currentUsage = await this.getCurrentMonthUsage()
    return {
      currentUsage,
      quota: this.monthlyQuota,
      remaining: Math.max(0, this.monthlyQuota - currentUsage),
      resetDate: this.quotaResetDate,
    }
  }

  private getNextMonthStart(): Date {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() + 1, 1)
  }
}
```

---

## 4. Advanced Features & Use Cases

### 4.1 Streaming Code Execution

```typescript
// lib/sandbox/providers/mistral/mistral-stream-handler.ts

import { Mistral } from '@mistralai/mistralai'
import type { StreamChunk } from './mistral-types'

export class StreamHandler {
  private client: Mistral

  constructor(client: Mistral) {
    this.client = client
  }

  async *streamCodeExecution(
    code: string,
    options?: {
      language?: string
      conversationId?: string
      agentId?: string
    }
  ): AsyncGenerator<StreamChunk> {
    const agentId = options?.agentId
    const conversationId = options?.conversationId

    if (!agentId && !conversationId) {
      throw new Error('Either agentId or conversationId is required')
    }

    if (conversationId) {
      // Stream append to existing conversation
      const stream = this.client.beta.conversations.appendStream({
        conversationId,
        conversationAppendRequest: {
          inputs: [{ role: 'user', content: `Execute: ${code}` }],
        },
      })

      for await (const chunk of stream) {
        yield this.parseChunk(chunk)
      }
    } else if (agentId) {
      // Stream new conversation
      const stream = this.client.beta.conversations.startStream({
        agentId,
        inputs: [{ role: 'user', content: `Execute: ${code}` }],
      })

      for await (const chunk of stream) {
        yield this.parseChunk(chunk)
      }
    }
  }

  private parseChunk(chunk: any): StreamChunk {
    return {
      type: chunk.type,
      content: chunk.content,
      timestamp: new Date(),
      metadata: {
        conversationId: chunk.conversation_id,
        entryId: chunk.id,
      },
    }
  }
}
```

### 4.2 Error Handler with Retry Logic

```typescript
// lib/sandbox/providers/mistral/mistral-error-handler.ts

import type { RetryConfig } from './mistral-types'

export enum ErrorType {
  RATE_LIMIT = 'RATE_LIMIT',
  TIMEOUT = 'TIMEOUT',
  AUTH_FAILURE = 'AUTH_FAILURE',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  EXECUTION_ERROR = 'EXECUTION_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export class MistralError extends Error {
  constructor(
    message: string,
    public readonly type: ErrorType,
    public readonly originalError?: Error,
    public readonly retryable: boolean = false
  ) {
    super(message)
    this.name = 'MistralError'
  }
}

export class ErrorHandler {
  private config: RetryConfig

  constructor(config: RetryConfig) {
    this.config = config
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error: any) {
        lastError = error
        const mistralError = this.classifyError(error)

        if (!mistralError.retryable || attempt === this.config.maxRetries) {
          throw mistralError
        }

        // Exponential backoff with jitter
        const delay = this.calculateBackoff(attempt)
        console.warn(
          `[Mistral] ${context} failed (attempt ${attempt + 1}/${this.config.maxRetries}), retrying in ${delay}ms...`,
          mistralError.message
        )
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    throw lastError
  }

  classifyError(error: any): MistralError {
    const message = error.message?.toLowerCase() || ''
    const statusCode = error.statusCode || error.response?.status

    // Rate limiting
    if (statusCode === 429 || message.includes('rate limit')) {
      return new MistralError(
        'Rate limit exceeded',
        ErrorType.RATE_LIMIT,
        error,
        true
      )
    }

    // Timeout
    if (statusCode === 504 || message.includes('timeout')) {
      return new MistralError(
        'Request timeout',
        ErrorType.TIMEOUT,
        error,
        true
      )
    }

    // Authentication
    if (statusCode === 401 || statusCode === 403) {
      return new MistralError(
        'Authentication failed',
        ErrorType.AUTH_FAILURE,
        error,
        false
      )
    }

    // Quota
    if (message.includes('quota') || message.includes('limit exceeded')) {
      return new MistralError(
        'Quota exceeded',
        ErrorType.QUOTA_EXCEEDED,
        error,
        false
      )
    }

    // Validation
    if (statusCode === 400) {
      return new MistralError(
        `Validation error: ${message}`,
        ErrorType.VALIDATION_ERROR,
        error,
        false
      )
    }

    // Network
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return new MistralError(
        'Network error',
        ErrorType.NETWORK_ERROR,
        error,
        true
      )
    }

    // Default
    return new MistralError(
      error.message || 'Unknown error',
      ErrorType.UNKNOWN,
      error,
      true
    )
  }

  private calculateBackoff(attempt: number): number {
    const baseDelay = 1000
    const maxDelay = 30000
    const exponentialDelay = baseDelay * Math.pow(2, attempt)
    
    // Add jitter (±20%)
    const jitter = (Math.random() - 0.5) * 0.4 * exponentialDelay
    
    return Math.min(exponentialDelay + jitter, maxDelay)
  }
}

export interface RetryConfig {
  maxRetries: number
  timeout: number
}
```

### 4.3 Code Safety Validator

```typescript
// lib/sandbox/providers/mistral/utils/code-validator.ts

interface ValidationResult {
  safe: boolean
  reason?: string
  errors: string[]
  warnings: string[]
}

export class CodeValidator {
  private dangerousPatterns: RegExp[] = [
    // System commands
    /rm\s+-rf\s+\//,
    /mkfs\./,
    /dd\s+if=.*of=\/dev/,
    /:\(\)\{\s*:\|:\s*&\s*\}\s*:/,  // Fork bomb
    
    // Network attacks
    /nmap\s+-sS/,
    /hping3?/,
    
    // File access
    /\/etc\/passwd/,
    /\/etc\/shadow/,
    /\/proc\/\d+/,
  ]

  private allowedLanguages = ['python', 'javascript', 'typescript', 'bash', 'shell']

  async validate(code: string, language: string): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    // Check language
    if (!this.allowedLanguages.includes(language.toLowerCase())) {
      errors.push(`Unsupported language: ${language}`)
    }

    // Check for dangerous patterns
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(code)) {
        errors.push(`Dangerous pattern detected: ${pattern.source}`)
      }
    }

    // Language-specific checks
    if (language === 'python') {
      const pythonWarnings = this.validatePython(code)
      warnings.push(...pythonWarnings)
    } else if (language === 'javascript' || language === 'typescript') {
      const jsWarnings = this.validateJavaScript(code)
      warnings.push(...jsWarnings)
    }

    return {
      safe: errors.length === 0,
      errors,
      warnings,
      reason: errors.length > 0 ? errors.join('; ') : undefined,
    }
  }

  private validatePython(code: string): string[] {
    const warnings: string[] = []

    // Check for potentially dangerous imports
    const dangerousImports = ['os.system', 'subprocess.call', 'eval(', 'exec(']
    for (const imp of dangerousImports) {
      if (code.includes(imp)) {
        warnings.push(`Potentially dangerous function: ${imp}`)
      }
    }

    return warnings
  }

  private validateJavaScript(code: string): string[] {
    const warnings: string[] = []

    // Check for eval/function
    if (/\beval\s*\(/.test(code) || /\bfunction\s*\(/.test(code)) {
      warnings.push('Use of eval() or Function constructor detected')
    }

    // Check for require with dynamic paths
    if (/require\s*\(\s*[^'"]/.test(code)) {
      warnings.push('Dynamic require path detected')
    }

    return warnings
  }
}
```

---

## 5. Testing Strategy

### 5.1 Unit Tests

```typescript
// lib/sandbox/providers/mistral/__tests__/mistral-provider.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MistralAgentProvider } from '../mistral-agent-provider'

describe('MistralAgentProvider', () => {
  let provider: MistralAgentProvider

  beforeEach(() => {
    vi.stubEnv('MISTRAL_API_KEY', 'test-key')
    provider = new MistralAgentProvider()
  })

  it('should create a sandbox', async () => {
    const handle = await provider.createSandbox({})
    expect(handle.id).toMatch(/mistral-agent-.+/)
    expect(handle.workspaceDir).toBe('/workspace')
  })

  it('should execute code', async () => {
    const handle = await provider.createSandbox({})
    const result = await handle.executeCommand('print("Hello, World!")')
    expect(result.success).toBe(true)
    expect(result.output).toContain('Hello, World!')
  })

  it('should handle errors gracefully', async () => {
    const handle = await provider.createSandbox({})
    const result = await handle.executeCommand('invalid syntax')
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(1)
  })

  it('should respect quota limits', async () => {
    vi.stubEnv('MISTRAL_CODE_EXECUTION_MONTHLY_QUOTA', '0')
    const providerWithQuota = new MistralAgentProvider()
    
    await expect(providerWithQuota.createSandbox({}))
      .rejects
      .toThrow('quota exceeded')
  })
})
```

### 5.2 Integration Tests

```typescript
// tests/integration/mistral-sandbox.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MistralAgentProvider } from '../../lib/sandbox/providers/mistral/mistral-agent-provider'

describe('Mistral Sandbox Integration', () => {
  let provider: MistralAgentProvider

  beforeAll(() => {
    provider = new MistralAgentProvider()
  })

  it('should execute Python code', async () => {
    const handle = await provider.createSandbox({})
    
    const result = await handle.executeCommand(`
import math
result = math.sqrt(16)
print(f"Square root of 16 is {result}")
    `.trim())

    expect(result.success).toBe(true)
    expect(result.output).toContain('4.0')
  })

  it('should execute JavaScript code', async () => {
    const handle = await provider.createSandbox({})
    
    const result = await handle.executeCommand(`
const numbers = [1, 2, 3, 4, 5]
const sum = numbers.reduce((a, b) => a + b, 0)
console.log(\`Sum: \${sum}\`)
    `.trim())

    expect(result.success).toBe(true)
    expect(result.output).toContain('Sum: 15')
  })

  it('should handle file operations via virtual filesystem', async () => {
    const handle = await provider.createSandbox({})
    
    // Write file
    const writeResult = await handle.writeFile('/workspace/test.txt', 'Hello, World!')
    expect(writeResult.success).toBe(true)

    // Read file
    const readResult = await handle.readFile('/workspace/test.txt')
    expect(readResult.success).toBe(true)
    expect(readResult.output).toBe('Hello, World!')
  })

  afterAll(async () => {
    // Cleanup
    // Note: Actual cleanup depends on implementation
  })
})
```

---

## 6. Performance Optimization

### 6.1 Connection Pooling

```typescript
// lib/sandbox/providers/mistral/mistral-connection-pool.ts

import { Mistral } from '@mistralai/mistralai'

interface PoolEntry {
  client: Mistral
  createdAt: number
  lastUsed: number
  requestCount: number
}

export class MistralConnectionPool {
  private pool: Map<string, PoolEntry> = new Map()
  private maxPoolSize: number
  private maxAge: number
  private maxRequests: number

  constructor(options?: {
    maxPoolSize?: number
    maxAge?: number
    maxRequests?: number
  }) {
    this.maxPoolSize = options?.maxPoolSize ?? 10
    this.maxAge = options?.maxAge ?? 300000 // 5 minutes
    this.maxRequests = options?.maxRequests ?? 1000
  }

  acquire(apiKey: string, serverURL: string): Mistral {
    const key = `${apiKey}:${serverURL}`
    const now = Date.now()

    // Check existing connection
    const entry = this.pool.get(key)
    if (entry) {
      if (this.isExpired(entry, now)) {
        this.pool.delete(key)
      } else {
        entry.lastUsed = now
        entry.requestCount++
        return entry.client
      }
    }

    // Create new connection
    const client = new Mistral({ apiKey, serverURL })
    this.pool.set(key, {
      client,
      createdAt: now,
      lastUsed: now,
      requestCount: 1,
    })

    // Evict oldest if pool is full
    if (this.pool.size > this.maxPoolSize) {
      this.evictOldest()
    }

    return client
  }

  release(apiKey: string, serverURL: string): void {
    const key = `${apiKey}:${serverURL}`
    this.pool.delete(key)
  }

  private isExpired(entry: PoolEntry, now: number): boolean {
    return (
      now - entry.createdAt > this.maxAge ||
      entry.requestCount > this.maxRequests
    )
  }

  private evictOldest(): void {
    let oldestKey: string | undefined
    let oldestTime = Infinity

    for (const [key, entry] of this.pool) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.pool.delete(oldestKey)
    }
  }
}
```

### 6.2 Response Caching

```typescript
// lib/sandbox/providers/mistral/mistral-response-cache.ts

import { createHash } from 'node:crypto'

interface CacheEntry<T> {
  value: T
  createdAt: number
  ttl: number
  hits: number
}

export class ResponseCache<T = any> {
  private cache: Map<string, CacheEntry<T>> = new Map()
  private defaultTTL: number
  private maxSize: number

  constructor(options?: { defaultTTL?: number; maxSize?: number }) {
    this.defaultTTL = options?.defaultTTL ?? 300000 // 5 minutes
    this.maxSize = options?.maxSize ?? 1000
  }

  async get(key: string): Promise<T | null> {
    const entry = this.cache.get(key)
    
    if (!entry) {
      return null
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key)
      return null
    }

    entry.hits++
    return entry.value
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictLRU()
    }

    this.cache.set(key, {
      value,
      createdAt: Date.now(),
      ttl: ttl ?? this.defaultTTL,
      hits: 0,
    })
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }

  async clear(): Promise<void> {
    this.cache.clear()
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.createdAt > entry.ttl
  }

  private evictLRU(): void {
    let lruKey: string | undefined
    let lruHits = Infinity

    for (const [key, entry] of this.cache) {
      if (entry.hits < lruHits) {
        lruHits = entry.hits
        lruKey = key
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey)
    }
  }

  static hashKey(...args: any[]): string {
    const hash = createHash('sha256')
    for (const arg of args) {
      hash.update(JSON.stringify(arg))
    }
    return hash.digest('hex')
  }
}
```

---

## 7. Documentation & Examples

### 7.1 Usage Examples

```typescript
// examples/mistral-agent-usage.ts

import { MistralAgentProvider } from '../lib/sandbox/providers/mistral/mistral-agent-provider'

// Basic usage
async function basicUsage() {
  const provider = new MistralAgentProvider()
  const sandbox = await provider.createSandbox({})

  // Execute Python code
  const result = await sandbox.executeCommand(`
import numpy as np
data = np.random.randn(100)
print(f"Mean: {data.mean():.4f}")
print(f"Std: {data.std():.4f}")
  `.trim())

  console.log(result.output)
}

// With streaming
async function streamingUsage() {
  const provider = new MistralAgentProvider({ enableStreaming: true })
  const sandbox = await provider.createSandbox({})

  const stream = provider.streamCodeExecution(`
for i in range(10):
    print(f"Count: {i}")
  `.trim())

  for await (const chunk of stream) {
    console.log('Stream:', chunk.content)
  }
}

// With custom agent
async function customAgentUsage() {
  const provider = new MistralAgentProvider()
  
  // Create custom agent
  const agent = await provider.createAgent({
    name: 'Data Analysis Agent',
    description: 'Specialized in data analysis and visualization',
    instructions: 'You are a data analysis expert. Use Python with pandas and matplotlib.',
    tools: ['code_interpreter'],
  })

  const sandbox = await provider.createSandbox({})
  
  // Execute with custom agent context
  const result = await sandbox.executeCommand(`
import pandas as pd
import matplotlib.pyplot as plt

# Create sample data
data = pd.DataFrame({
    'x': range(10),
    'y': [i**2 for i in range(10)]
})

print(data.describe())
  `.trim())

  console.log(result.output)
}

// Error handling
async function errorHandlingUsage() {
  const provider = new MistralAgentProvider({
    maxRetries: 3,
    timeout: 60000,
  })

  try {
    const sandbox = await provider.createSandbox({})
    const result = await sandbox.executeCommand('invalid code')
    
    if (!result.success) {
      console.error('Execution failed:', result.output)
    }
  } catch (error) {
    console.error('Provider error:', error.message)
  }
}
```

---

## 8. Security Considerations

### 8.1 Security Checklist

- [ ] **API Key Management**: Store keys securely, never commit to version control
- [ ] **Input Validation**: Validate all user inputs before sending to Mistral
- [ ] **Code Safety**: Implement code validation to prevent dangerous operations
- [ ] **Rate Limiting**: Implement client-side rate limiting
- [ ] **Quota Management**: Track and enforce usage quotas
- [ ] **Error Handling**: Don't expose sensitive information in error messages
- [ ] **Logging**: Log all executions for audit purposes
- [ ] **Timeout Enforcement**: Enforce execution timeouts to prevent hangs
- [ ] **Output Sanitization**: Sanitize outputs before displaying to users

### 8.2 Code Safety Implementation

The `CodeValidator` class (section 4.3) implements:
- Pattern-based detection of dangerous code
- Language-specific safety checks
- Configurable allowlists/blocklists
- Warning system for potentially risky operations

---

## 9. Migration Guide

### 9.1 From Existing Implementation

The new implementation is backward compatible. To migrate:

1. **Update imports**:
```typescript
// Old
import { MistralCodeInterpreterProvider } from './providers/mistral-code-interpreter-provider'

// New
import { MistralAgentProvider } from './providers/mistral/mistral-agent-provider'
```

2. **Update environment variables**:
```bash
# Add to .env
MISTRAL_AGENT_MODEL=mistral-medium-2505
MISTRAL_ENABLE_STREAMING=true
MISTRAL_ENABLE_QUOTA_TRACKING=true
```

3. **Enable in fallback chain**:
```bash
SANDBOX_PROVIDER_FALLBACK_CHAIN=daytona,e2b,mistral-agent,microsandbox
```

---

## 10. Future Enhancements

### 10.1 Planned Features

1.
3. **Advanced Tool Integration**: Custom tool definitions beyond code_interpreter
4. **Document Library Integration**: RAG capabilities with custom document libraries
5. 
6. **Image Generation Integration**: Generate visualizations and plots via image_generation tool
7. 
8. **Performance Metrics**: Detailed execution analytics and cost tracking
9. **Custom Models**: Support for fine-tuned Mistral models
10. **Edge Computing**: Deploy agents closer to users for lower latency

### 10.2 Research Areas

- **Optimal Prompt Engineering**: Research best prompts for reliable code execution
- **Cost Optimization**: Strategies to minimize token usage while maintaining quality
- **Security Hardening**: Advanced techniques to prevent code injection attacks
- **Performance Benchmarking**: Compare Mistral with other sandbox providers

---

## 11. Conclusion

This comprehensive plan transforms the basic Mistral code interpreter into a production-ready, feature-rich sandbox provider that:

1. **Integrates seamlessly** with existing architecture
2. **Provides fallback** when other providers are unavailable
3. **Offers advanced features** like streaming, virtual filesystem, and batch execution
4. **Implements robust error handling** with retry logic
5. **Tracks usage** with quota management
6. **Ensures security** with code validation
7. **Optimizes performance** with connection pooling and caching

The modular design allows for easy extension and maintenance, while the comprehensive testing strategy ensures reliability.

---

## Appendix A: Complete File List

```
lib/sandbox/providers/mistral/
├── index.ts
├── mistral-agent-provider.ts
├── mistral-conversation-manager.ts
├── mistral-code-executor.ts
├── mistral-file-system.ts
├── mistral-stream-handler.ts
├── mistral-error-handler.ts
├── mistral-quota-manager.ts
├── mistral-types.ts
├── mistral-connection-pool.ts
├── mistral-response-cache.ts
└── utils/
    ├── prompt-builder.ts
    ├── response-parser.ts
    └── code-validator.ts

tests/integration/
└── mistral-sandbox.test.ts

examples/
└── mistral-agent-usage.ts

docs/
└── MISTRAL_AGENT_SANDBOX_IMPLEMENTATION_PLAN.md (this document)
```
