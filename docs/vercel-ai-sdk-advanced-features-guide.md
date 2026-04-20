---
id: vercel-ai-sdk-advanced-features-guide
title: Vercel AI SDK - Advanced Features Guide
aliases:
  - VERCEL_AI_SDK_ADVANCED
  - VERCEL_AI_SDK_ADVANCED.md
  - vercel-ai-sdk-advanced-features-guide
  - vercel-ai-sdk-advanced-features-guide.md
tags:
  - sdk
  - guide
layer: core
summary: "# Vercel AI SDK - Advanced Features Guide\r\n\r\n## Overview\r\n\r\nThis guide covers advanced Vercel AI SDK features implemented in binG:\r\n- Token & Memory Caching\r\n- React Hooks\r\n- Reasoning UI\r\n- Retry Handling\r\n- Middleware Pipeline\r\n\r\n## Table of Contents\r\n\r\n1. [Token & Memory Caching](#token--memory-c"
anchors:
  - Overview
  - Table of Contents
  - Token & Memory Caching
  - Token Usage Tracking
  - Token Limit Prevention
  - AI Cache
  - React Hooks
  - useChatEnhanced
  - useReasoningUI
  - useTokenUsage
  - useRetryHandler
  - useAIChat (Combined Hook)
  - Reasoning UI
  - extractReasoningMiddleware
  - Reasoning UI Component
  - Retry Handling
  - RetryError
  - Automatic Retry Configuration
  - Middleware Pipeline
  - Combine Multiple Middleware
  - Smooth Streaming
  - Error Handling
  - Token Limit Errors
  - Abort Handling
  - Complete Example
  - Resources
---
# Vercel AI SDK - Advanced Features Guide

## Overview

This guide covers advanced Vercel AI SDK features implemented in binG:
- Token & Memory Caching
- React Hooks
- Reasoning UI
- Retry Handling
- Middleware Pipeline

## Table of Contents

1. [Token & Memory Caching](#token--memory-caching)
2. [React Hooks](#react-hooks)
3. [Reasoning UI](#reasoning-ui)
4. [Retry Handling](#retry-handling)
5. [Middleware Pipeline](#middleware-pipeline)
6. [Error Handling](#error-handling)

---

## Token & Memory Caching

### Token Usage Tracking

Track token consumption per model/provider automatically:

```typescript
import { tokenTracker } from '@/lib/chat/ai-caching';

// Record usage (automatically done by useChatEnhanced)
tokenTracker.recordUsage(
  'gpt-4o',           // model
  'openai',           // provider
  1500,               // promptTokens
  500,                // completionTokens
  2000                // totalTokens
);

// Get usage stats
const stats = tokenTracker.getUsage('openai', 'gpt-4o');
console.log(stats);
// {
//   model: 'gpt-4o',
//   provider: 'openai',
//   totalTokens: 2000,
//   requestCount: 1,
//   averageTokensPerRequest: 2000,
//   ...
// }
```

### Token Limit Prevention

Prevent "too many tokens" errors with cached breakdowns:

```typescript
import { tokenTracker } from '@/lib/chat/ai-caching';

// Check if request might exceed limit
const check = tokenTracker.mightExceedLimit(
  'openai',
  'gpt-4o',
  100000,  // estimated tokens
  0.9      // safety margin (90%)
);

if (check.wouldExceed) {
  console.warn(check.recommendedAction);
  // "Request estimated at 100,000 tokens (limit: 128,000). 
  //  Consider splitting the request..."
}
```

### AI Cache

Enable response caching:

```typescript
import { createAICache } from '@/lib/chat/ai-caching';

const cache = createAICache({
  namespace: 'bing-chat',
  ttl: 60 * 60 * 1000, // 1 hour
  storage: 'memory',   // or 'redis' in production
});

// Use with streamText
const result = await streamText({
  model,
  messages,
  experimental_cache: cache,
});
```

---

## React Hooks

### useChatEnhanced

Enhanced version of Vercel's `useChat` with binG features:

```typescript
'use client';

import { useChatEnhanced } from '@/lib/chat/use-chat-hooks';

export function ChatComponent() {
  const {
    messages,
    input,
    isLoading,
    error,
    append,
    tokenUsage,
    reasoning,
    toolCalls,
    retryCount,
    clearError,
  } = useChatEnhanced({
    provider: 'openai',
    model: 'gpt-4o',
    enableTokenTracking: true,
    enableReasoningDisplay: true,
    maxRetries: 3,
  });

  return (
    <div>
      {tokenUsage && (
        <div>
          Tokens: {tokenUsage.totalTokens}
        </div>
      )}
      {reasoning.map((r, i) => (
        <div key={i} className="reasoning">
          {r}
        </div>
      ))}
      {/* ... rest of UI */}
    </div>
  );
}
```

### useReasoningUI

Display reasoning/thinking content:

```typescript
import { useReasoningUI } from '@/lib/chat/use-chat-hooks';

function ReasoningDisplay({ reasoning }: { reasoning: string[] }) {
  const {
    reasoning: displayed,
    isExpanded,
    collapse,
    expand,
    toggle,
    count,
  } = useReasoningUI(reasoning);

  return (
    <div>
      <button onClick={toggle}>
        {isExpanded ? 'Hide' : 'Show'} Reasoning ({count})
      </button>
      {isExpanded && displayed.map((r, i) => (
        <div key={i}>{r}</div>
      ))}
    </div>
  );
}
```

### useTokenUsage

Display token usage statistics:

```typescript
import { useTokenUsage } from '@/lib/chat/use-chat-hooks';

function TokenDisplay({ provider, model }: { provider: string; model: string }) {
  const { usage, refresh } = useTokenUsage(provider, model);

  if (!usage) return null;

  return (
    <div>
      <div>Prompt: {usage.current.promptTokens}</div>
      <div>Completion: {usage.current.completionTokens}</div>
      <div>Total: {usage.current.totalTokens}</div>
      <div>Avg: {usage.average.totalTokens}/request</div>
      <div>Limit: {usage.limit.percentage.toFixed(1)}%</div>
    </div>
  );
}
```

### useRetryHandler

Handle retries with exponential backoff:

```typescript
import { useRetryHandler } from '@/lib/chat/use-chat-hooks';

function ChatWithRetry() {
  const {
    retryCount,
    lastError,
    handleRetry,
    reset,
    canRetry,
  } = useRetryHandler({
    maxRetries: 3,
    onRetry: (count, error) => {
      console.log(`Retry ${count}: ${error.message}`);
    },
  });

  const sendMessage = async () => {
    await handleRetry(
      async () => {
        // Your API call
        await fetch('/api/chat', { ... });
      },
      'send message'
    );
  };

  return (
    <div>
      {lastError && (
        <div>
          Error: {lastError.message}
          {canRetry && <button onClick={sendMessage}>Retry</button>}
        </div>
      )}
    </div>
  );
}
```

### useAIChat (Combined Hook)

All-in-one hook for complete AI chat experience:

```typescript
import { useAIChat } from '@/lib/chat/use-chat-hooks';

function ChatComponent() {
  const {
    messages,
    input,
    isLoading,
    error,
    handleSubmit,
    handleInputChange,
    // Reasoning
    reasoning: { reasoning, isExpanded, toggle },
    // Token usage
    tokenUsage: { usage },
    // Retry
    retry: { retryCount, handleRetry },
    // Abort
    abort: { abort, signal },
  } = useAIChat({
    provider: 'openai',
    model: 'gpt-4o',
    maxRetries: 3,
  });

  return (
    <form onSubmit={handleSubmit}>
      {/* UI */}
    </form>
  );
}
```

---

## Reasoning UI

### extractReasoningMiddleware

Extract reasoning/thinking from model responses:

```typescript
import { createReasoningMiddleware } from '@/lib/chat/ai-middleware';

const reasoningMiddleware = createReasoningMiddleware({
  startMarker: '<think>',
  endMarker: '</think>',
  includeInResponse: false, // Don't include in final response
  maxLength: 10000,
});

const result = await streamText({
  model: anthropic('claude-3-5-sonnet-latest'),
  messages,
  experimental_transform: reasoningMiddleware,
});

// Access reasoning separately
for await (const chunk of result.fullStream) {
  if (chunk.type === 'reasoning') {
    console.log('Reasoning:', chunk.reasoning);
  }
}
```

### Reasoning UI Component

```typescript
'use client';

import { useReasoningUI } from '@/lib/chat/use-chat-hooks';

export function ReasoningUI({ reasoning }: { reasoning: string[] }) {
  const { isExpanded, toggle, count } = useReasoningUI(reasoning);

  if (count === 0) return null;

  return (
    <div className="border rounded-lg p-4 bg-gray-50">
      <button
        onClick={toggle}
        className="flex items-center gap-2 text-sm text-gray-600"
      >
        <span>🧠</span>
        <span>Reasoning ({count} steps)</span>
        <span>{isExpanded ? '▼' : '▶'}</span>
      </button>
      
      {isExpanded && (
        <div className="mt-4 space-y-2">
          {reasoning.map((step, i) => (
            <div
              key={i}
              className="p-3 bg-white rounded border text-sm text-gray-700"
            >
              <div className="text-xs text-gray-500 mb-1">Step {i + 1}</div>
              {step}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## Retry Handling

### RetryError

Handle retry errors from Vercel AI SDK:

```typescript
import { RetryError } from 'ai';
import { withRetry } from '@/lib/chat/ai-middleware';

try {
  const result = await withRetry(
    () => streamText({ model, messages }),
    {
      maxRetries: 3,
      initialDelayMs: 1000,
      retryOn: ['rate limit', 'timeout'],
    }
  );
} catch (error) {
  if (error instanceof RetryError) {
    console.error('Max retries exceeded:', error.message);
    console.error('Cause:', error.cause);
  }
}
```

### Automatic Retry Configuration

```typescript
import { withRetry } from '@/lib/chat/ai-middleware';

// Default configuration
const result = await withRetry(() => operation());

// Custom configuration
const result = await withRetry(
  () => operation(),
  {
    maxRetries: 5,
    initialDelayMs: 500,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    retryOn: ['rate limit', 'timeout', 'network error'],
    dontRetryOn: ['authentication', 'invalid api key'],
    onRetry: (error, attempt) => {
      console.log(`Retry ${attempt}: ${error.message}`);
    },
  }
);
```

---

## Middleware Pipeline

### Combine Multiple Middleware

```typescript
import { createMiddlewarePipeline } from '@/lib/chat/ai-middleware';
import { createReasoningMiddleware } from '@/lib/chat/ai-middleware';
import { createSmoothStream } from '@/lib/chat/ai-middleware';

const reasoning = createReasoningMiddleware({
  startMarker: '<think>',
  endMarker: '</think>',
});

const smoothStream = createSmoothStream({
  minChunkSize: 3,
  maxChunkSize: 10,
  chunkDelayMs: 50,
});

const pipeline = createMiddlewarePipeline(
  reasoning,
  smoothStream
);

const result = await streamText({
  model,
  messages,
  experimental_transform: pipeline,
});
```

### Smooth Streaming

```typescript
import { createSmoothStream } from '@/lib/chat/ai-middleware';

const smoothStream = createSmoothStream({
  minChunkSize: 3,    // Minimum chars per chunk
  maxChunkSize: 10,   // Maximum chars per chunk
  chunkDelayMs: 50,   // Delay between chunks
  typingEffect: true, // Enable typing effect
  typingSpeed: 100,   // Characters per second
});
```

---

## Error Handling

### Token Limit Errors

```typescript
import {
  isTokenLimitError,
  handleTokenLimitError,
  createTokenLimitError,
} from '@/lib/chat/ai-middleware';

try {
  const result = await streamText({ model, messages });
} catch (error: any) {
  if (isTokenLimitError(error)) {
    const { canRecover, suggestion, actions } = handleTokenLimitError(error);
    
    console.log('Suggestion:', suggestion);
    for (const action of actions) {
      console.log('Action:', action.label);
      // action.action() to execute
    }
  }
}
```

### Abort Handling

```typescript
import { useAbortController } from '@/lib/chat/use-chat-hooks';

function StreamingComponent() {
  const { abort, reset, signal } = useAbortController();

  const startStreaming = async () => {
    reset();
    
    const result = await streamText({
      model,
      messages,
      signal, // Pass abort signal
    });
    
    // Stream...
  };

  return (
    <div>
      <button onClick={startStreaming}>Start</button>
      <button onClick={abort}>Stop</button>
    </div>
  );
}
```

---

## Complete Example

```typescript
'use client';

import { useAIChat } from '@/lib/chat/use-chat-hooks';
import { ReasoningUI } from '@/components/reasoning-ui';
import { TokenDisplay } from '@/components/token-display';

export function AdvancedChat() {
  const {
    messages,
    input,
    isLoading,
    error,
    handleSubmit,
    handleInputChange,
    reasoning,
    tokenUsage,
    retry: { retryCount, handleRetry },
    abort: { abort },
  } = useAIChat({
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-latest',
    enableTokenTracking: true,
    enableReasoningDisplay: true,
    maxRetries: 3,
  });

  return (
    <div className="max-w-4xl mx-auto p-4">
      {/* Token Usage */}
      <TokenDisplay provider="anthropic" model="claude-3-5-sonnet-latest" />

      {/* Reasoning UI */}
      <ReasoningUI reasoning={reasoning.reasoning} />

      {/* Messages */}
      {messages.map((message, i) => (
        <div key={i} className={`message ${message.role}`}>
          {message.content}
        </div>
      ))}

      {/* Input */}
      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Type your message..."
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Sending...' : 'Send'}
        </button>
        {isLoading && (
          <button type="button" onClick={abort}>
            Stop
          </button>
        )}
      </form>

      {/* Error with Retry */}
      {error && (
        <div className="error">
          <p>{error.message}</p>
          {retryCount < 3 && (
            <button onClick={() => handleRetry(() => handleSubmit()}>
              Retry ({3 - retryCount} left)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## Resources

- [Vercel AI SDK Docs](https://sdk.vercel.ai/docs)
- [AI SDK Caching](https://sdk.vercel.ai/docs/ai-sdk-core/caching)
- [AI SDK Middleware](https://sdk.vercel.ai/docs/ai-sdk-core/middleware)
- [useChat Hook](https://sdk.vercel.ai/docs/ai-sdk-ui/use-chat)
