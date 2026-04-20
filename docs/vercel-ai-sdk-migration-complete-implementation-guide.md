---
id: vercel-ai-sdk-migration-complete-implementation-guide
title: Vercel AI SDK Migration - Complete Implementation Guide
aliases:
  - VERCEL_AI_SDK_COMPLETE
  - VERCEL_AI_SDK_COMPLETE.md
  - vercel-ai-sdk-migration-complete-implementation-guide
  - vercel-ai-sdk-migration-complete-implementation-guide.md
tags:
  - sdk
  - implementation
  - guide
layer: core
summary: "# Vercel AI SDK Migration - Complete Implementation Guide\r\n\r\n## Overview\r\n\r\nThe binG project has been fully migrated to use **Vercel AI SDK** for unified streaming across all LLM providers, with complete feature parity and enhanced capabilities compared to the previous OpenAI SDK-only approach.\r\n\r\n#"
anchors:
  - Overview
  - Installation
  - Supported Providers (15+)
  - Direct Vercel AI SDK Providers
  - OpenAI-Compatible Providers (via createOpenAI)
  - Custom Providers (via Compatibility Wrapper)
  - Legacy Fallback (via original SDK)
  - Feature Comparison
  - Files Created/Modified
  - New Files
  - Modified Files
  - Provider Mapping Implementation
  - enhanced-llm-service.ts (Lines 374-420)
  - vercel-ai-streaming.ts (Lines 40-90)
  - Tool Integration
  - From capabilities.ts to Vercel Tools
  - Available Tools
  - File System Tools
  - Sandbox Tools
  - Web Tools
  - Creating Custom Tools
  - Telemetry & Logging
  - Existing Logging (Preserved)
  - Vercel AI SDK Telemetry (Additional)
  - Per-Model Logging
  - Event Handling & UI Responses
  - SSE Events (All Preserved)
  - Event Emission (route.ts Lines 1078-1157)
  - Fallback Mechanisms
  - Automatic Fallback Chain
  - Manual Rollback
  - Usage Examples
  - Basic Streaming (All Providers)
  - With Tool Calling
  - With Automatic Provider Selection
  - Environment Variables
  - Testing
  - Verify Provider Mapping
  - Verify Tool Integration
  - Verify Telemetry
  - Troubleshooting
  - Provider Not Working
  - Tools Not Executing
  - Telemetry Not Logging
  - Migration Checklist
  - Resources
---
# Vercel AI SDK Migration - Complete Implementation Guide

## Overview

The binG project has been fully migrated to use **Vercel AI SDK** for unified streaming across all LLM providers, with complete feature parity and enhanced capabilities compared to the previous OpenAI SDK-only approach.

## Installation

```bash
pnpm add @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google @ai-sdk/mistral ai
```

## Supported Providers (15+)

### Direct Vercel AI SDK Providers
| Provider | SDK Package | Status |
|----------|-------------|--------|
| OpenAI | `@ai-sdk/openai` | ✅ Full support |
| Anthropic | `@ai-sdk/anthropic` | ✅ Full support |
| Google | `@ai-sdk/google` | ✅ Full support |
| Mistral | `@ai-sdk/mistral` | ✅ Full support |

### OpenAI-Compatible Providers (via createOpenAI)
| Provider | Base URL | API Key Env | Status |
|----------|----------|-------------|--------|
| OpenRouter | https://openrouter.ai/api/v1 | OPENROUTER_API_KEY | ✅ Full support |
| NVIDIA NIM | https://integrate.api.nvidia.com/v1 | NVIDIA_API_KEY | ✅ Full support |
| GitHub Models | https://models.inference.ai.azure.com | GITHUB_MODELS_API_KEY | ✅ Full support |
| Chutes AI | https://llm.chutes.ai/v1 | CHUTES_API_KEY | ✅ Full support |
| Zen AI | https://api.zen.ai/v1 | ZEN_API_KEY | ✅ Full support |
| Together AI | https://api.together.xyz/v1 | TOGETHER_API_KEY | ✅ Full support |
| Groq | https://api.groq.com/openai/v1 | GROQ_API_KEY | ✅ Full support |
| Fireworks AI | https://api.fireworks.ai/inference/v1 | FIREWORKS_API_KEY | ✅ Full support |
| Anyscale | https://api.endpoints.anyscale.com/v1 | ANYSCALE_API_KEY | ✅ Full support |
| DeepInfra | https://api.deepinfra.com/v1/openai | DEEPINFRA_API_KEY | ✅ Full support |
| Lepton AI | https://models.lepton.ai/v1 | LEPTON_API_KEY | ✅ Full support |

### Custom Providers (via Compatibility Wrapper)
| Provider | API Endpoint | API Key Env | Status |
|----------|-------------|-------------|--------|
| Zo AI | https://api.zo.computer/zo/ask | ZO_API_KEY | ✅ Full support with wrapper |

**Adding Custom Providers:**

To add a custom provider that doesn't support OpenAI format:

```typescript
// lib/chat/openai-compat-wrapper.ts
registerCustomProvider('myprovider', {
  name: 'myprovider',
  baseURL: 'https://api.myprovider.com',
  apiKeyEnv: 'MYPROVIDER_API_KEY',
  customRequestTransform: async (messages, options) => {
    // Convert OpenAI messages → Provider format
    return { input: messages.map(m => m.content).join('\n') };
  },
  customResponseTransform: async (response) => {
    // Convert Provider response → OpenAI format
    return {
      choices: [{ message: { content: response.output } }],
    };
  },
});
```

### Legacy Fallback (via original SDK)
| Provider | Status |
|----------|--------|
| Cohere | ⚠️ Legacy fallback |
| Replicate | ⚠️ Legacy fallback |
| Portkey | ⚠️ Legacy fallback |

## Feature Comparison

| Feature | OpenAI SDK | Vercel AI SDK | Implementation Status |
|---------|-----------|---------------|----------------------|
| **Unified Interface** | ❌ Provider-specific code | ✅ Single `streamText()` for all providers | ✅ **COMPLETE** |
| **Automatic Fallback** | ❌ Manual implementation | ✅ Built-in via provider mapping | ✅ **COMPLETE** |
| **Streaming** | ✅ `stream: true` | ✅ `streamText()` with better UX | ✅ **COMPLETE** |
| **Tool Calling** | ❌ Manual parsing | ✅ Automatic via `tools` option | ✅ **COMPLETE** |
| **Continuation** | ❌ Manual | ✅ `continue` function | 🔄 Ready to implement |
| **Telemetry** | ❌ Manual | ✅ Built-in OpenTelemetry | ✅ **COMPLETE** (with existing logging) |
| **Caching** | ❌ Manual | ✅ Built-in via `experimental_cache` | 🔄 Ready to implement |
| **Type Safety** | ⚠️ Basic | ✅ Full Zod validation | ✅ **COMPLETE** |
| **React Integration** | ❌ None | ✅ `useChat`, `useCompletion` hooks | 🔄 Ready to implement |
| **Edge Compatibility** | ⚠️ Limited | ✅ Full edge runtime support | ✅ **COMPLETE** |

## Files Created/Modified

### New Files
| File | Purpose | Lines |
|------|---------|-------|
| `lib/chat/vercel-ai-streaming.ts` | Unified streaming layer for all providers | ~390 |
| `lib/chat/vercel-ai-tools.ts` | Tool integration layer (capabilities → Vercel tools) | ~350 |
| `docs/VERCEL_AI_SDK_MIGRATION.md` | Complete migration documentation | ~400 |

### Modified Files
| File | Changes |
|------|---------|
| `lib/chat/enhanced-llm-service.ts` | Added Vercel AI SDK integration with 15+ provider mappings |
| `lib/chat/llm-providers.ts` | Extended `StreamingResponse` interface with all fields |
| `package.json` | Added Vercel AI SDK dependencies |

## Provider Mapping Implementation

### enhanced-llm-service.ts (Lines 374-420)
```typescript
const vercelProviderMap: Record<string, VercelProvider> = {
  // Direct Vercel AI SDK providers
  'openai': 'openai',
  'anthropic': 'anthropic',
  'google': 'google',
  'mistral': 'mistral',
  'openrouter': 'openrouter',
  // OpenAI-compatible providers
  'chutes': 'openai',
  'github': 'openai',
  'zen': 'openai',
  'nvidia': 'openai',
  'together': 'openai',
  'groq': 'openai',
  'fireworks': 'openai',
  'anyscale': 'openai',
  'deepinfra': 'openai',
  'lepton': 'openai',
};
```

### vercel-ai-streaming.ts (Lines 40-90)
```typescript
const OPENAI_COMPATIBLE_PROVIDERS: Record<string, OpenAICompatibleConfig> = {
  nvidia: {
    baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: 'NVIDIA_API_KEY',
  },
  github: {
    baseURL: process.env.GITHUB_MODELS_BASE_URL || 'https://models.inference.ai.azure.com',
    apiKeyEnv: 'GITHUB_MODELS_API_KEY',
  },
  // ... 10 more providers
};
```

## Tool Integration

### From capabilities.ts to Vercel Tools

**Before (Manual):**
```typescript
// Each tool required manual parsing
const toolCalls = response.choices[0].message.tool_calls;
for (const call of toolCalls) {
  const args = JSON.parse(call.function.arguments);
  // Manual execution
}
```

**After (Automatic):**
```typescript
import { createFileSystemTools, createSandboxTools } from '@/lib/chat/vercel-ai-tools';

const tools = {
  ...createFileSystemTools({ userId }),
  ...createSandboxTools({ userId }),
};

const result = streamText({
  model: openai('gpt-4o'),
  messages,
  tools,
});

// Tool calls automatically parsed and executed
const toolCalls = await result.toolCalls;
```

### Available Tools

#### File System Tools
- `read_file` - Read file contents
- `write_file` - Write content to file
- `delete_file` - Delete file or directory
- `list_directory` - List directory contents

#### Sandbox Tools
- `execute_code` - Execute code in sandbox
- `run_shell` - Run shell command

#### Web Tools
- `browse_url` - Fetch and parse web pages

### Creating Custom Tools

```typescript
import { createToolFromCapability } from '@/lib/chat/vercel-ai-tools';
import { z } from 'zod';

const myTool = createToolFromCapability(
  'file.read',
  async (args: { path: string }) => {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');
    const file = await virtualFilesystem.readFile(userId, args.path);
    return { content: file.content };
  },
  {
    description: 'Read contents of a file',
    parameters: z.object({
      path: z.string().describe('File path to read'),
    }),
  }
);
```

## Telemetry & Logging

### Existing Logging (Preserved)

All existing logging mechanisms continue to work:

```typescript
// In-memory logging (chatLogger)
chatLogger.info('Vercel AI SDK streaming completed', { 
  requestId, 
  provider, 
  model 
}, {
  latencyMs: streamLatency,
  tokensUsed: usage?.totalTokens || 0,
  toolCallsCount: toolCalls?.length || 0,
});
```

### Vercel AI SDK Telemetry (Additional)

```typescript
const result = streamText({
  model: openai('gpt-4o'),
  messages,
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'llm-stream',
    metadata: { provider, model },
  },
});
```

### Per-Model Logging

The existing per-model logging is preserved and enhanced:

```typescript
// Logs per request with model info
chatLogger.info('Using Vercel AI SDK for streaming', { 
  requestId, 
  provider: primaryProvider, 
  model: llmRequest.model 
});

chatLogger.info('Vercel AI SDK streaming completed', { 
  requestId, 
  provider: primaryProvider, 
  model: llmRequest.model 
}, {
  latencyMs: streamLatency,
});
```

## Event Handling & UI Responses

### SSE Events (All Preserved)

All existing SSE events continue to work:

| Event | Purpose | Status |
|-------|---------|--------|
| `token` | Stream text content | ✅ Working |
| `reasoning` | Reasoning traces (o1, R1) | ✅ Supported |
| `tool_call` | Tool call detection | ✅ Working |
| `tool_invocation` | Tool execution results | ✅ Working |
| `file_edit` | File edit detection | ✅ Working |
| `request_files` | File requests | ✅ Working |
| `diffs` | Diff operations | ✅ Working |
| `done` | Stream completion | ✅ Working |
| `error` | Error handling | ✅ Working |

### Event Emission (route.ts Lines 1078-1157)

```typescript
for await (const streamChunk of unifiedResponse.stream as AsyncGenerator<StreamingResponse>) {
  // Token streaming
  if (streamChunk.content) {
    realEmit('token', { 
      content: streamChunk.content, 
      timestamp: Date.now(),
      type: 'token'
    });
  }

  // Reasoning traces
  if (streamChunk.reasoning) {
    realEmit('reasoning', {
      reasoning: streamChunk.reasoning,
      timestamp: Date.now(),
    });
  }

  // Tool calls
  if (streamChunk.toolCalls) {
    for (const toolCall of streamChunk.toolCalls) {
      realEmit('tool_call', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args: toolCall.arguments,
        timestamp: Date.now(),
      });
    }
  }

  // File edits
  if (streamChunk.files) {
    for (const file of streamChunk.files) {
      realEmit('file_edit', {
        path: file.path,
        status: file.operation === 'delete' ? 'deleted' : 'detected',
        operation: file.operation,
        content: file.content,
        timestamp: Date.now(),
      });
    }
  }

  // Completion
  if (streamChunk.isComplete) {
    realEmit('done', {
      requestId: streamRequestId,
      timestamp: Date.now(),
      success: true,
      finishReason: streamChunk.finishReason,
      tokensUsed: streamChunk.tokensUsed,
      usage: streamChunk.usage,
    });
  }
}
```

## Fallback Mechanisms

### Automatic Fallback Chain

```typescript
try {
  // Try Vercel AI SDK first
  const vercelProvider = vercelProviderMap[primaryProvider];
  
  if (vercelProvider) {
    yield* streamWithVercelAI(vercelProvider, model, messages, ...);
    return;
  }

  // Fallback to legacy streaming
  chatLogger.warn('Provider not supported by Vercel AI SDK, using legacy streaming');
  yield* llmService.generateStreamingResponse(fullRequest);
  
} catch (error) {
  // Fallback to alternative providers
  const availableFallbacks = fallbacks.filter(fallbackProvider =>
    this.endpointConfigs.has(fallbackProvider) &&
    this.isProviderHealthy(fallbackProvider) &&
    PROVIDERS[fallbackProvider]?.supportsStreaming
  );
  
  if (availableFallbacks.length > 0) {
    yield* llmService.generateStreamingResponse(fallbackRequest);
  } else {
    throw this.createEnhancedError('No streaming fallback providers available', ...);
  }
}
```

### Manual Rollback

To rollback to legacy streaming:

```typescript
// In enhanced-llm-service.ts, comment out Vercel AI SDK usage:
/*
const { streamWithVercelAI } = await import('./vercel-ai-streaming');
yield* streamWithVercelAI(...);
*/

// Use legacy streaming directly:
const fullRequest = { ...llmRequest, provider: primaryProvider };
yield* llmService.generateStreamingResponse(fullRequest);
```

## Usage Examples

### Basic Streaming (All Providers)

```typescript
import { streamWithVercelAI } from '@/lib/chat/vercel-ai-streaming';

// Works with ANY supported provider
for await (const chunk of streamWithVercelAI(
  'nvidia',  // or 'github', 'groq', 'together', etc.
  'meta/llama-3.1-405b-instruct',
  messages,
  0.7,
  2000
)) {
  if (chunk.content) {
    emit('token', { content: chunk.content });
  }
  if (chunk.isComplete) {
    emit('done', { tokensUsed: chunk.tokensUsed });
  }
}
```

### With Tool Calling

```typescript
import { streamWithTools } from '@/lib/chat/vercel-ai-streaming';
import { createFileSystemTools } from '@/lib/chat/vercel-ai-tools';

const tools = createFileSystemTools({ userId });

for await (const chunk of streamWithTools(
  'anthropic',
  'claude-3-5-sonnet-latest',
  messages,
  tools
)) {
  if (chunk.toolCalls) {
    emit('tool_call', { calls: chunk.toolCalls });
  }
}
```

### With Automatic Provider Selection

```typescript
// In enhanced-llm-service.ts
const vercelProvider = vercelProviderMap[primaryProvider];

if (vercelProvider) {
  // Use Vercel AI SDK (unified interface)
  yield* streamWithVercelAI(vercelProvider, model, messages, ...);
} else {
  // Fallback to legacy (preserved for rollback)
  yield* llmService.generateStreamingResponse(fullRequest);
}
```

## Environment Variables

Add to `.env.local`:

```env
# NVIDIA NIM
NVIDIA_API_KEY=nvapi-...
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1

# GitHub Models
GITHUB_MODELS_API_KEY=ghp_...
GITHUB_MODELS_BASE_URL=https://models.inference.ai.azure.com

# Groq
GROQ_API_KEY=gsk_...
GROQ_BASE_URL=https://api.groq.com/openai/v1

# Together AI
TOGETHER_API_KEY=...
TOGETHER_BASE_URL=https://api.together.xyz/v1

# Fireworks AI
FIREWORKS_API_KEY=...
FIREWORKS_BASE_URL=https://api.fireworks.ai/inference/v1

# Anyscale
ANYSCALE_API_KEY=...
ANYSCALE_BASE_URL=https://api.endpoints.anyscale.com/v1

# DeepInfra
DEEPINFRA_API_KEY=...
DEEPINFRA_BASE_URL=https://api.deepinfra.com/v1/openai

# Lepton AI
LEPTON_API_KEY=...
LEPTON_BASE_URL=https://models.lepton.ai/v1
```

## Testing

### Verify Provider Mapping

```bash
pnpm dev
# Make a streaming chat request with different providers
# Check logs for:
# "Using Vercel AI SDK for streaming" - Success
# "Provider not supported by Vercel AI SDK, using legacy streaming" - Fallback
```

### Verify Tool Integration

```typescript
// Test tool calling
const tools = createFileSystemTools({ userId: 'test' });
console.log(Object.keys(tools)); 
// ['read_file', 'write_file', 'delete_file', 'list_directory']
```

### Verify Telemetry

```bash
# Check logs for per-model telemetry
grep "Vercel AI SDK streaming completed" logs/*.log
# Should show: requestId, provider, model, latencyMs, tokensUsed, toolCallsCount
```

## Troubleshooting

### Provider Not Working

1. Check provider mapping in `enhanced-llm-service.ts`
2. Verify API key environment variable is set
3. Check `OPENAI_COMPATIBLE_PROVIDERS` in `vercel-ai-streaming.ts`

### Tools Not Executing

1. Ensure tools are created with correct context: `createFileSystemTools({ userId })`
2. Check tool parameters match Zod schema
3. Verify tool execution has required permissions

### Telemetry Not Logging

1. Check `chatLogger` is initialized
2. Verify `experimental_telemetry` is enabled in `streamText()` call
3. Check existing in-memory logging is preserved

## Migration Checklist

- [x] Vercel AI SDK packages installed
- [x] `vercel-ai-streaming.ts` created with unified streaming
- [x] `vercel-ai-tools.ts` created for tool integration
- [x] `enhanced-llm-service.ts` updated with 15+ provider mappings
- [x] Fallback to legacy streaming preserved
- [x] All SSE events preserved and working
- [x] Telemetry/logging preserved and enhanced
- [x] Tool calling support implemented
- [x] TypeScript types fixed
- [x] Documentation complete

## Resources

- [Vercel AI SDK Docs](https://sdk.vercel.ai/docs)
- [AI SDK GitHub](https://github.com/vercel/ai)
- [Stream Text API](https://sdk.vercel.ai/docs/reference/ai-sdk-core/stream-text)
- [Tool Calling](https://sdk.vercel.ai/docs/ai-sdk-core/tools)
- [Telemetry](https://sdk.vercel.ai/docs/ai-sdk-core/telemetry)
- [React Hooks](https://sdk.vercel.ai/docs/ai-sdk-ui/use-chat)
- [Provider Documentation](https://sdk.vercel.ai/docs/ai-sdk-core/providers)
