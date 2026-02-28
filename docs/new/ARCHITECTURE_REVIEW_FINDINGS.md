# Architecture Review & Refactoring Recommendations

**Document Type:** Technical Architecture Review  
**Review Date:** 2026-02-27  
**Scope:** lib/, lib/api/, app/api/, sandbox/, tools/, streaming/, agent handling  
**Status:** 📋 Findings & Recommendations

---

## Executive Summary

This review identified **significant architectural opportunities** for improving modularity, reducing duplication, and enhancing maintainability across the codebase. The system has evolved organically with multiple overlapping abstractions that should be consolidated.

### Key Findings Summary

| Category | Issues Found | Severity | Impact |
|----------|-------------|----------|--------|
| **Provider Fragmentation** | 7 sandbox providers with duplicated logic | 🔴 High | Maintenance burden, inconsistent behavior |
| **Tool Calling Duplication** | 4 separate tool integration systems | 🔴 High | Confusing developer experience |
| **LLM Provider Scattering** | Logic split across 5+ files | 🟡 Medium | Hard to trace execution flow |
| **Context Management** | No unified context engineering | 🟡 Medium | Suboptimal token usage |
| **Error Handling** | Inconsistent patterns across services | 🟡 Medium | Poor debugging experience |
| **Streaming Logic** | Duplicated across 3+ managers | 🟡 Medium | Bug-prone, hard to maintain |

---

## 1. Sandbox Provider Architecture Issues

### 1.1 Problem: Provider Logic Fragmentation

**Current State:**
```
lib/sandbox/providers/
├── sandbox-provider.ts       # Base interfaces
├── daytona-provider.ts       # 400+ lines
├── runloop-provider.ts       # 300+ lines  
├── blaxel-provider.ts        # 680+ lines (NEW)
├── sprites-provider.ts       # 1147+ lines (NEW)
├── microsandbox-provider.ts  # 500+ lines
├── e2b-provider.ts           # 600+ lines
├── mistral-agent-provider.ts # 500+ lines
└── codesandbox-provider.ts   # 300+ lines
```

**Issues:**
1. **Duplicated lifecycle logic** - Each provider reimplements:
   - Instance caching with TTL cleanup
   - Command sanitization (similar but not identical)
   - Path resolution (similar but not identical)
   - Workspace setup
   - Quota tracking integration

2. **Inconsistent error handling** - Some providers throw, others return `{ success: false }`

3. **Provider-specific features not abstracted** - Blaxel's `runBatchJob` and Sprites' `syncVfs` have no common abstraction

### 1.2 Recommendation: Base Provider Class with Composition

**Proposed Structure:**
```typescript
// lib/sandbox/providers/base-provider.ts (NEW)
export abstract class BaseSandboxProvider implements SandboxProvider {
  abstract readonly name: string;
  protected readonly instanceCache = new Map<string, SandboxHandle>();
  protected readonly quotaManager = quotaManager;
  
  // Shared lifecycle
  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    this.enforceMaxInstances();
    const handle = await this.doCreateSandbox(config);
    this.instanceCache.set(handle.id, handle);
    this.quotaManager.recordUsage(this.name);
    return handle;
  }
  
  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const cached = this.instanceCache.get(sandboxId);
    if (cached) return cached;
    return this.doGetSandbox(sandboxId);
  }
  
  async destroySandbox(sandboxId: string): Promise<void> {
    await this.doDestroySandbox(sandboxId);
    this.instanceCache.delete(sandboxId);
  }
  
  // Template methods for providers to implement
  protected abstract doCreateSandbox(config: SandboxCreateConfig): Promise<SandboxHandle>;
  protected abstract doGetSandbox(sandboxId: string): Promise<SandboxHandle>;
  protected abstract doDestroySandbox(sandboxId: string): Promise<void>;
  
  // Shared utilities
  protected enforceMaxInstances(): void { /* ... */ }
  protected startCleanupInterval(): void { /* ... */ }
}

// Shared command sanitization mixin
export const CommandSanitizationMixin = {
  sanitizeCommand(command: string): string {
    // Single source of truth for all providers
  },
  
  validateCommand(command: string): { valid: boolean; reason?: string } {
    // Reuse sandbox-tools.ts validation
  }
};

// Shared path resolution mixin
export const PathResolutionMixin = {
  resolvePath(filePath: string, sandboxRoot: string): string {
    // Single source of truth for all providers
  }
};
```

**Provider Implementation Example:**
```typescript
// lib/sandbox/providers/blaxel-provider.ts
export class BlaxelProvider extends BaseSandboxProvider {
  readonly name = 'blaxel';
  
  protected async doCreateSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const client = await this.ensureClient();
    const sandbox = await client.sandboxes.create({ /* ... */ });
    return new BlaxelSandboxHandle(sandbox, metadata);
  }
  
  // Blaxel-specific features
  async runBatchJob(tasks: BatchTask[], config?: BatchJobConfig): Promise<BatchJobResult> {
    // Blaxel-specific implementation
  }
}
```

**Benefits:**
- ✅ 60-70% code reduction across providers
- ✅ Consistent error handling
- ✅ Easier to add new providers
- ✅ Shared testing utilities
- ✅ Centralized logging and monitoring

---

## 2. Tool Calling Architecture Issues

### 2.1 Problem: Four Overlapping Tool Systems

**Current Systems:**
1. **SANDBOX_TOOLS** (`lib/sandbox/sandbox-tools.ts`) - Basic shell/file ops
2. **ToolIntegrationManager** (`lib/tools/tool-integration-system.ts`) - Arcade/Nango/Composio
3. **ComposioService** (`lib/api/composio-service.ts`) - 800+ toolkits
4. **MCP Tools** (`lib/mcp/`) - Model Context Protocol

**File: `lib/api/priority-request-router.ts`** - Lines 60-120:
```typescript
private initializeEndpoints(): EndpointConfig[] {
  const endpoints: EndpointConfig[] = [
    // Priority 0: Fast-Agent
    { name: 'fast-agent', /* ... */ },
    // Priority 1: Original LLM
    { name: 'original-system', /* ... */ },
    // Priority 2: n8n Agents
    { name: 'n8n-agents', /* ... */ },
    // Priority 3: Composio Tools
    { name: 'composio-tools', /* ... */ },
    // Priority 4: Tool Execution (Arcade/Nango)
    { name: 'tool-execution', /* ... */ },
    // Priority 5: Sandbox Agent
    { name: 'sandbox-agent', /* ... */ },
  ];
}
```

**Issues:**
1. **No unified tool registry** - Tools registered in multiple places
2. **Inconsistent tool schemas** - Each system uses different parameter formats
3. **Duplicate tool implementations** - File operations exist in SANDBOX_TOOLS and ToolIntegrationManager
4. **Complex routing logic** - Priority router has 870 lines of tool routing

### 2.2 Recommendation: Unified Tool Registry

**Proposed Structure:**
```typescript
// lib/tools/registry.ts (NEW)
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  handler: (args: any, context: ToolContext) => Promise<ToolResult>;
  metadata: {
    provider: 'sandbox' | 'composio' | 'arcade' | 'nango' | 'mcp';
    category: 'filesystem' | 'shell' | 'api' | 'database' | 'communication';
    requiresAuth: boolean;
  };
}

class UnifiedToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private categories = new Map<string, Set<string>>();
  
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    
    // Index by category
    if (!this.categories.has(tool.metadata.category)) {
      this.categories.set(tool.metadata.category, new Set());
    }
    this.categories.get(tool.metadata.category)!.add(tool.name);
  }
  
  getToolsByCategory(category: string): ToolDefinition[] {
    const names = this.categories.get(category) || new Set();
    return Array.from(names).map(name => this.tools.get(name)!);
  }
  
  getToolsByProvider(provider: string): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter(tool => tool.metadata.provider === provider);
  }
  
  execute(name: string, args: any, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool.handler(args, context);
  }
}

// lib/tools/index.ts (NEW)
export const toolRegistry = new UnifiedToolRegistry();

// Register sandbox tools
toolRegistry.register({
  name: 'exec_shell',
  description: 'Execute shell command',
  parameters: SANDBOX_TOOLS[0].parameters,
  handler: async (args, context) => {
    const sandbox = await sandboxBridge.getSandbox(context.sandboxId);
    return sandbox.executeCommand(args.command);
  },
  metadata: {
    provider: 'sandbox',
    category: 'shell',
    requiresAuth: false,
  }
});

// Register Composio tools dynamically
toolRegistry.registerComposioTools(await composioService.getAvailableTools());
```

**Benefits:**
- ✅ Single source of truth for all tools
- ✅ Consistent schema validation
- ✅ Easier tool discovery
- ✅ Simplified routing logic
- ✅ Better testing (mock registry)

---

## 3. LLM Provider Architecture Issues

### 3.1 Problem: Scattered Provider Logic

**Current Files:**
1. `lib/api/llm-providers.ts` (1336 lines) - Main provider implementations
2. `lib/api/llm-providers-data.ts` - Provider metadata
3. `lib/api/enhanced-llm-service.ts` (975 lines) - Fallback logic
4. `lib/api/fast-agent-service.ts` (518 lines) - Fast-Agent wrapper
5. `lib/api/priority-request-router.ts` (870 lines) - Request routing

**Issues:**
1. **Provider implementations mixed with business logic** - `llm-providers.ts` has both API calls and fallback logic
2. **No clear separation of concerns** - Streaming, error handling, and retries all in one file
3. **Duplicate provider configs** - PROVIDERS object defined in multiple places
4. **Hard to test** - Tight coupling between provider logic and Next.js API routes

### 3.2 Recommendation: Provider Abstraction Layer

**Proposed Structure:**
```
lib/llm/
├── index.ts                    # Public API
├── types.ts                    # Shared types
├── registry.ts                 # Provider registry
├── providers/
│   ├── base-provider.ts        # Abstract base class
│   ├── openai-provider.ts      # OpenAI implementation
│   ├── anthropic-provider.ts   # Anthropic implementation
│   ├── google-provider.ts      # Google implementation
│   └── ...                     # Other providers
├── middleware/
│   ├── retry-middleware.ts     # Retry logic
│   ├── fallback-middleware.ts  # Fallback chain
│   ├── circuit-breaker.ts      # Circuit breaker
│   └── rate-limit.ts           # Rate limiting
├── streaming/
│   ├── stream-manager.ts       # Unified streaming
│   └── chunk-parser.ts         # Chunk parsing
└── errors/
    ├── llm-errors.ts           # Error types
    └── error-handler.ts        # Error handling
```

**Example Implementation:**
```typescript
// lib/llm/providers/base-provider.ts
export abstract class BaseLLMProvider {
  abstract readonly name: string;
  abstract readonly models: string[];
  
  protected readonly retryMiddleware = createRetryMiddleware();
  protected readonly fallbackMiddleware = createFallbackMiddleware();
  
  async generate(messages: LLMMessage[], options: LLMOptions): Promise<LLMResponse> {
    const request = this.buildRequest(messages, options);
    
    return this.retryMiddleware.execute(
      async () => {
        const response = await this.doGenerate(request);
        return this.parseResponse(response);
      },
      { maxAttempts: options.retryAttempts ?? 3 }
    );
  }
  
  async *generateStream(messages: LLMMessage[], options: LLMOptions): AsyncIterable<StreamingChunk> {
    const request = this.buildRequest(messages, { ...options, stream: true });
    const stream = await this.doGenerateStream(request);
    
    for await (const chunk of stream) {
      yield this.parseChunk(chunk);
    }
  }
  
  protected abstract doGenerate(request: ProviderRequest): Promise<ProviderResponse>;
  protected abstract doGenerateStream(request: ProviderRequest): AsyncIterable<any>;
  protected abstract buildRequest(messages: LLMMessage[], options: LLMOptions): ProviderRequest;
  protected abstract parseResponse(response: ProviderResponse): LLMResponse;
  protected abstract parseChunk(chunk: any): StreamingChunk;
}
```

**Benefits:**
- ✅ Clear separation of concerns
- ✅ Testable in isolation
- ✅ Reusable middleware
- ✅ Consistent streaming interface
- ✅ Easier to add new providers

---

## 4. Context Management & Engineering Issues

### 4.1 Problem: No Unified Context System

**Current State:**
- Context scattered across:
  - `lib/context/` (if exists)
  - `lib/streaming/enhanced-buffer-manager.ts` - Buffer management
  - `lib/api/reflection-engine.ts` - Reflection context
  - `lib/virtual-filesystem/` - Filesystem context
  - Agent loop conversation history

**Issues:**
1. **No context prioritization** - All context treated equally
2. **No context compression** - Token limits hit quickly
3. **No context versioning** - Hard to track context changes
4. **Duplicate context storage** - Same data stored in multiple places

### 4.2 Recommendation: Context Engineering System

**Proposed Structure:**
```typescript
// lib/context/context-manager.ts (NEW)
export interface ContextItem {
  id: string;
  type: 'conversation' | 'file' | 'tool_result' | 'system' | 'user_profile';
  priority: 'critical' | 'high' | 'medium' | 'low';
  content: string;
  tokens: number;
  createdAt: number;
  lastAccessed: number;
  metadata: Record<string, any>;
}

export interface ContextWindow {
  items: ContextItem[];
  totalTokens: number;
  maxTokens: number;
  utilization: number;
}

class ContextManager {
  private items = new Map<string, ContextItem>();
  private maxTokens = 128000; // Configurable per model
  
  addItem(item: ContextItem): void {
    this.items.set(item.id, item);
    this.compressIfNeeded();
  }
  
  getContextForRequest(intent: RequestIntent): ContextWindow {
    // Prioritize by intent
    const priorities = this.getPrioritiesForIntent(intent);
    
    const sorted = Array.from(this.items.values())
      .sort((a, b) => {
        // Sort by priority, then recency
        const priorityDiff = priorities[b.priority] - priorities[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return b.lastAccessed - a.lastAccessed;
      });
    
    // Fill context window up to max tokens
    const result: ContextItem[] = [];
    let totalTokens = 0;
    
    for (const item of sorted) {
      if (totalTokens + item.tokens > this.maxTokens) break;
      result.push(item);
      totalTokens += item.tokens;
    }
    
    return {
      items: result,
      totalTokens,
      maxTokens: this.maxTokens,
      utilization: totalTokens / this.maxTokens,
    };
  }
  
  private compressIfNeeded(): void {
    const currentTokens = this.getCurrentTokenCount();
    if (currentTokens > this.maxTokens * 0.9) {
      this.compress();
    }
  }
  
  private compress(): void {
    // Remove low-priority, old items
    const sorted = Array.from(this.items.values())
      .sort((a, b) => {
        const priorityDiff = this.getPriorityScore(a) - this.getPriorityScore(b);
        if (priorityDiff !== 0) return priorityDiff;
        return a.lastAccessed - b.lastAccessed;
      });
    
    // Remove bottom 20%
    const toRemove = sorted.slice(0, Math.floor(sorted.length * 0.2));
    for (const item of toRemove) {
      this.items.delete(item.id);
    }
  }
}
```

**Benefits:**
- ✅ Intelligent context prioritization
- ✅ Automatic compression
- ✅ Token budget management
- ✅ Context versioning (add metadata tracking)
- ✅ Better model performance

---

## 5. Error Handling Inconsistencies

### 5.1 Problem: Multiple Error Handling Patterns

**Current Patterns:**
1. **Throw errors** - `lib/api/llm-providers.ts`
2. **Return error objects** - `lib/sandbox/sandbox-tools.ts`
3. **Emit events** - `lib/sandbox/sandbox-events.ts`
4. **Promise rejection** - Various async functions
5. **Custom error classes** - `enhanced-code-system/core/error-types.ts`

**Issues:**
1. **Inconsistent error propagation** - Hard to trace errors across layers
2. **No error categorization** - All errors treated the same
3. **Poor error context** - Missing metadata for debugging
4. **No error recovery strategies** - Errors just propagate up

### 5.2 Recommendation: Unified Error System

**Proposed Structure:**
```typescript
// lib/errors/base-error.ts (NEW)
export enum ErrorCategory {
  VALIDATION = 'VALIDATION',
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  RATE_LIMIT = 'RATE_LIMIT',
  TIMEOUT = 'TIMEOUT',
  PROVIDER = 'PROVIDER',
  SANDBOX = 'SANDBOX',
  TOOL = 'TOOL',
  CONTEXT = 'CONTEXT',
  SYSTEM = 'SYSTEM',
}

export enum ErrorSeverity {
  LOW = 'LOW',           // Can be ignored
  MEDIUM = 'MEDIUM',     // Should be handled
  HIGH = 'HIGH',         // Must be handled
  CRITICAL = 'CRITICAL', // System failure
}

export interface ErrorContext {
  userId?: string;
  requestId?: string;
  provider?: string;
  operation?: string;
  metadata?: Record<string, any>;
  cause?: Error;
  timestamp?: number;
}

export abstract class BaseError extends Error {
  abstract readonly category: ErrorCategory;
  abstract readonly severity: ErrorSeverity;
  readonly code: string;
  readonly context: ErrorContext;
  readonly recoverable: boolean;
  
  constructor(
    message: string,
    code: string,
    context: ErrorContext = {},
    recoverable = false
  ) {
    super(message);
    this.code = code;
    this.context = {
      ...context,
      timestamp: Date.now(),
    };
    this.recoverable = recoverable;
    this.name = this.constructor.name;
  }
  
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      severity: this.severity,
      code: this.code,
      recoverable: this.recoverable,
      context: this.context,
      stack: this.stack,
    };
  }
}

// Specific error types
export class ProviderError extends BaseError {
  readonly category = ErrorCategory.PROVIDER;
  readonly severity = ErrorSeverity.HIGH;
  
  constructor(
    message: string,
    provider: string,
    cause?: Error
  ) {
    super(message, `PROVIDER_${provider.toUpperCase()}_ERROR`, { provider }, true);
  }
}

export class SandboxError extends BaseError {
  readonly category = ErrorCategory.SANDBOX;
  readonly severity = ErrorSeverity.HIGH;
  
  constructor(
    message: string,
    sandboxId: string,
    operation: string
  ) {
    super(message, `SANDBOX_${operation.toUpperCase()}_ERROR`, { sandboxId, operation }, false);
  }
}

// Error handler with recovery strategies
class ErrorHandler {
  private recoveryStrategies = new Map<ErrorCategory, RecoveryStrategy>();
  
  registerRecovery(category: ErrorCategory, strategy: RecoveryStrategy): void {
    this.recoveryStrategies.set(category, strategy);
  }
  
  async handle(error: BaseError, context: ErrorContext): Promise<RecoveryResult> {
    const strategy = this.recoveryStrategies.get(error.category);
    
    if (!strategy) {
      return { success: false, error };
    }
    
    try {
      return await strategy.execute(error, context);
    } catch (recoveryError) {
      return { success: false, error: recoveryError };
    }
  }
}

// Usage example
const errorHandler = new ErrorHandler();

errorHandler.registerRecovery(ErrorCategory.PROVIDER, {
  async execute(error, context) {
    // Try fallback provider
    const fallback = await quotaManager.findAlternative('tool', context.provider!);
    if (fallback) {
      return { success: true, fallbackProvider: fallback };
    }
    return { success: false };
  }
});
```

**Benefits:**
- ✅ Consistent error handling across system
- ✅ Error categorization for better monitoring
- ✅ Built-in recovery strategies
- ✅ Rich error context for debugging
- ✅ Better user error messages

---

## 6. Streaming Architecture Issues

### 6.1 Problem: Duplicated Streaming Logic

**Current Files:**
1. `lib/streaming/enhanced-streaming.ts` - Basic streaming
2. `lib/streaming/enhanced-buffer-manager.ts` - Buffer management
3. `enhanced-code-system/streaming/enhanced-streaming-manager.ts` - Code streaming
4. `lib/api/llm-providers.ts` - Provider-specific streaming

**Issues:**
1. **Duplicated chunk parsing** - Each file has its own parser
2. **Inconsistent buffer management** - Different buffering strategies
3. **No unified streaming interface** - Each provider streams differently
4. **Hard to add new stream types** - Code changes needed in multiple files

### 6.2 Recommendation: Unified Streaming System

**Proposed Structure:**
```typescript
// lib/streaming/stream-manager.ts (NEW)
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'metadata';
  content: string | any;
  metadata?: {
    provider?: string;
    model?: string;
    tokens?: number;
    timestamp?: number;
  };
}

export interface StreamOptions {
  provider: string;
  model: string;
  bufferSize?: number;
  flushInterval?: number;
  transform?: (chunk: StreamChunk) => StreamChunk;
}

class StreamManager {
  private buffers = new Map<string, StreamChunk[]>();
  private subscribers = new Map<string, Set<(chunk: StreamChunk) => void>>();
  
  async *createStream(options: StreamOptions): AsyncIterable<StreamChunk> {
    const streamId = generateSecureId('stream');
    this.buffers.set(streamId, []);
    
    try {
      const provider = await this.getProvider(options.provider);
      const stream = provider.generateStream(options);
      
      for await (const chunk of stream) {
        const parsed = this.parseChunk(chunk, options);
        const transformed = options.transform?.(parsed) ?? parsed;
        
        this.bufferChunk(streamId, transformed);
        this.notifySubscribers(streamId, transformed);
        
        yield transformed;
      }
      
      this.flushBuffer(streamId);
    } finally {
      this.buffers.delete(streamId);
    }
  }
  
  private parseChunk(chunk: any, options: StreamOptions): StreamChunk {
    // Unified chunk parsing for all providers
    if (typeof chunk === 'string') {
      return { type: 'text', content: chunk };
    }
    
    if (chunk.choices?.[0]?.delta?.content) {
      return { 
        type: 'text', 
        content: chunk.choices[0].delta.content,
        metadata: {
          provider: options.provider,
          model: options.model,
        }
      };
    }
    
    if (chunk.type === 'tool_call') {
      return { type: 'tool_call', content: chunk };
    }
    
    return { type: 'text', content: JSON.stringify(chunk) };
  }
  
  private bufferChunk(streamId: string, chunk: StreamChunk): void {
    const buffer = this.buffers.get(streamId) || [];
    buffer.push(chunk);
    
    // Auto-flush if buffer too large
    if (buffer.length > 100) {
      this.flushBuffer(streamId);
    }
  }
  
  subscribe(streamId: string, callback: (chunk: StreamChunk) => void): () => void {
    if (!this.subscribers.has(streamId)) {
      this.subscribers.set(streamId, new Set());
    }
    this.subscribers.get(streamId)!.add(callback);
    
    return () => {
      this.subscribers.get(streamId)!.delete(callback);
    };
  }
  
  private notifySubscribers(streamId: string, chunk: StreamChunk): void {
    const subscribers = this.subscribers.get(streamId);
    if (subscribers) {
      for (const callback of subscribers) {
        try {
          callback(chunk);
        } catch (error) {
          console.error('[StreamManager] Subscriber error:', error);
        }
      }
    }
  }
}

export const streamManager = new StreamManager();
```

**Benefits:**
- ✅ Single streaming interface for all providers
- ✅ Unified chunk parsing
- ✅ Automatic buffer management
- ✅ Easy to add new stream types
- ✅ Better error handling in streams

---

## 7. Agent Loop & Chat Handling Issues

### 7.1 Problem: Agent Logic Scattered

**Current Files:**
1. `lib/sandbox/agent-loop.ts` - Basic agent loop
2. `lib/api/fast-agent-service.ts` - Fast-Agent integration
3. `lib/api/priority-request-router.ts` - Request routing
4. `app/api/agent/route.ts` - API endpoint
5. `app/api/chat/route.ts` - Chat endpoint

**Issues:**
1. **No clear agent abstraction** - Agent logic mixed with routing
2. **Duplicate conversation management** - Each service manages its own history
3. **No agent state management** - Hard to pause/resume agents
4. **Inconsistent tool execution** - Different agents execute tools differently

### 7.2 Recommendation: Agent Orchestration System

**Proposed Structure:**
```typescript
// lib/agents/orchestrator.ts (NEW)
export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  provider: string;
  systemPrompt: string;
  tools: string[];
  maxSteps: number;
  temperature: number;
}

export interface AgentState {
  id: string;
  config: AgentConfig;
  conversation: ConversationHistory;
  currentStep: number;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  context: ContextWindow;
  metadata: {
    createdAt: number;
    lastActive: number;
    totalSteps: number;
    totalTokens: number;
  };
}

class AgentOrchestrator {
  private agents = new Map<string, AgentState>();
  private toolRegistry: UnifiedToolRegistry;
  private contextManager: ContextManager;
  private streamManager: StreamManager;
  
  async createAgent(config: AgentConfig): Promise<string> {
    const agentId = generateSecureId('agent');
    
    const state: AgentState = {
      id: agentId,
      config,
      conversation: new ConversationHistory(),
      currentStep: 0,
      status: 'idle',
      context: this.contextManager.createWindow(),
      metadata: {
        createdAt: Date.now(),
        lastActive: Date.now(),
        totalSteps: 0,
        totalTokens: 0,
      },
    };
    
    this.agents.set(agentId, state);
    return agentId;
  }
  
  async execute(agentId: string, message: string): AsyncIterable<AgentEvent> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    
    agent.status = 'running';
    agent.conversation.addUserMessage(message);
    
    try {
      for (let step = 0; step < agent.config.maxSteps; step++) {
        agent.currentStep = step;
        
        // Get context for this step
        const context = this.contextManager.getContextForRequest('agent');
        
        // Generate response
        const response = await this.generateResponse(agent, context);
        
        // Check for tool calls
        if (response.toolCalls?.length > 0) {
          for (const toolCall of response.toolCalls) {
            yield { type: 'tool_call', data: toolCall };
            
            const result = await this.toolRegistry.execute(
              toolCall.function.name,
              JSON.parse(toolCall.function.arguments),
              { agentId, conversationId: agent.id }
            );
            
            yield { type: 'tool_result', data: result };
            agent.conversation.addToolResult(toolCall, result);
          }
          continue;
        }
        
        // Final response
        agent.conversation.addAssistantMessage(response.content);
        yield { type: 'final_response', data: response.content };
        agent.status = 'completed';
        break;
      }
    } catch (error) {
      agent.status = 'error';
      yield { type: 'error', data: error };
      throw error;
    } finally {
      agent.metadata.lastActive = Date.now();
      agent.metadata.totalSteps += agent.currentStep;
    }
  }
  
  async pause(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'paused';
      await this.persistState(agent);
    }
  }
  
  async resume(agentId: string): Promise<AsyncIterable<AgentEvent>> {
    const agent = this.agents.get(agentId);
    if (agent?.status !== 'paused') {
      throw new Error(`Agent ${agentId} is not paused`);
    }
    
    agent.status = 'running';
    return this.execute(agentId, agent.conversation.getLastMessage()!);
  }
  
  private async generateResponse(agent: AgentState, context: ContextWindow): Promise<LLMResponse> {
    const provider = await this.getProvider(agent.config.provider);
    
    return provider.generate(
      agent.conversation.getMessages(),
      {
        model: agent.config.model,
        temperature: agent.config.temperature,
        tools: agent.config.tools.map(name => this.toolRegistry.get(name)),
        context: context.items.map(item => item.content),
      }
    );
  }
  
  private async persistState(agent: AgentState): Promise<void> {
    // Save to database for recovery
    await db.agentStates.save(agent);
  }
}

export const agentOrchestrator = new AgentOrchestrator();
```

**Benefits:**
- ✅ Clear agent abstraction
- ✅ Unified conversation management
- ✅ Agent state persistence
- ✅ Pause/resume capability
- ✅ Consistent tool execution

---

## 8. File Organization Recommendations

### 8.1 Proposed New Structure

```
lib/
├── index.ts                    # Public API exports
├── types/                      # Shared types
│   ├── index.ts
│   ├── common.ts
│   ├── llm.ts
│   ├── sandbox.ts
│   └── tools.ts
├── errors/                     # Error system
│   ├── index.ts
│   ├── base-error.ts
│   ├── provider-errors.ts
│   ├── sandbox-errors.ts
│   └── error-handler.ts
├── llm/                        # LLM providers
│   ├── index.ts
│   ├── registry.ts
│   ├── base-provider.ts
│   ├── providers/
│   ├── middleware/
│   └── streaming/
├── sandbox/                    # Sandbox providers
│   ├── index.ts
│   ├── base-provider.ts
│   ├── providers/
│   ├── sandbox-service.ts     # Consolidated service
│   └── tools/
├── tools/                      # Tool system
│   ├── index.ts
│   ├── registry.ts
│   ├── definitions/
│   ├── handlers/
│   └── utilities.ts
├── agents/                     # Agent orchestration
│   ├── index.ts
│   ├── orchestrator.ts
│   ├── agent-state.ts
│   └── conversation.ts
├── context/                    # Context management
│   ├── index.ts
│   ├── context-manager.ts
│   ├── prioritization.ts
│   └── compression.ts
├── streaming/                  # Unified streaming
│   ├── index.ts
│   ├── stream-manager.ts
│   ├── chunk-parser.ts
│   └── buffer-manager.ts
└── utils/                      # Utilities
    ├── index.ts
    ├── id-generator.ts
    ├── path-utils.ts
    └── validation.ts
```

### 8.2 Migration Strategy

**Phase 1: Foundation (Week 1-2)**
1. Create new directory structure
2. Implement base error system
3. Implement unified types
4. Set up build system for new structure

**Phase 2: Core Abstractions (Week 3-4)**
1. Implement base provider classes
2. Implement tool registry
3. Implement context manager
4. Implement stream manager

**Phase 3: Migration (Week 5-8)**
1. Migrate sandbox providers to base class
2. Migrate LLM providers to abstraction
3. Migrate tool integrations to registry
4. Migrate agent logic to orchestrator

**Phase 4: Cleanup (Week 9-10)**
1. Remove old duplicated code
2. Update all imports
3. Update tests
4. Update documentation

---

## 9. Priority Recommendations

### Critical (Do First)
1. **Unified Error System** - Improves debugging across entire system
2. **Base Provider Class** - Reduces 60-70% code duplication
3. **Tool Registry** - Simplifies tool integration and routing

### High Priority
4. **Context Manager** - Better token management, improved model performance
5. **Stream Manager** - Unified streaming interface
6. **Agent Orchestrator** - Clear agent abstraction

### Medium Priority
7. **LLM Provider Abstraction** - Better testability
8. **File Reorganization** - Improved maintainability

### Low Priority
9. **Documentation Updates** - After refactoring complete
10. **Performance Optimization** - After architecture stable

---

## 10. Testing Strategy

### Current State
- Tests scattered across `__tests__/`, `test/`, `tests/e2e/`
- Inconsistent test patterns
- Limited integration testing
- No contract testing between services

### Recommendations

**Proposed Test Structure:**
```
__tests__/
├── unit/                       # Unit tests
│   ├── errors/
│   ├── llm/
│   ├── sandbox/
│   ├── tools/
│   └── context/
├── integration/                # Integration tests
│   ├── provider-integration.test.ts
│   ├── tool-integration.test.ts
│   └── agent-integration.test.ts
├── contract/                   # Contract tests
│   ├── provider-contract.test.ts
│   └── tool-contract.test.ts
└── e2e/                        # E2E tests
    ├── agent-workflow.test.ts
    └── tool-workflow.test.ts
```

**Contract Testing Example:**
```typescript
// __tests__/contract/provider-contract.test.ts
describe('Sandbox Provider Contract', () => {
  const providers = ['daytona', 'blaxel', 'sprites', 'microsandbox'];
  
  for (const providerName of providers) {
    describe(`${providerName}`, () => {
      let provider: SandboxProvider;
      
      beforeEach(() => {
        provider = getSandboxProvider(providerName as any);
      });
      
      it('should create sandbox', async () => {
        const handle = await provider.createSandbox({});
        expect(handle.id).toBeDefined();
        expect(handle.workspaceDir).toBeDefined();
      });
      
      it('should execute command', async () => {
        const handle = await provider.createSandbox({});
        const result = await handle.executeCommand('echo test');
        expect(result.success).toBe(true);
        expect(result.output).toContain('test');
      });
      
      it('should handle errors consistently', async () => {
        const handle = await provider.createSandbox({});
        const result = await handle.executeCommand('invalid-command-12345');
        expect(result.success).toBe(false);
        expect(result.exitCode).toBeDefined();
      });
    });
  }
});
```

---

## Conclusion

This architecture review identified **significant opportunities** for improvement:

1. **Code Reduction**: 60-70% reduction through base classes and shared utilities
2. **Improved Maintainability**: Clear separation of concerns, consistent patterns
3. **Better Testing**: Contract testing, easier mocking, isolated unit tests
4. **Enhanced Debugging**: Unified error system with rich context
5. **Scalability**: Modular architecture supports easy addition of new features

**Estimated Effort**: 8-10 weeks for full refactoring  
**Recommended Approach**: Incremental migration with feature flags  
**Risk Level**: Medium (mitigated by comprehensive testing)

---

**Next Steps:**
1. Review and prioritize recommendations
2. Create detailed implementation plan for Phase 1
3. Set up tracking metrics for code quality improvements
4. Begin with critical priority items

**Document Status:** 📋 Ready for Review  
**Last Updated:** 2026-02-27
