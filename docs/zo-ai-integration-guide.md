---
id: zo-ai-integration-guide
title: Zo AI Integration Guide
aliases:
  - CUSTOM_AI_INTEGRATION
  - CUSTOM_AI_INTEGRATION.md
  - zo-ai-integration-guide
  - zo-ai-integration-guide.md
tags:
  - guide
layer: core
summary: "# Zo AI Integration Guide\r\n\r\n## Overview\r\n\r\nZo AI uses a non-OpenAI API format. The compatibility wrapper (`openai-compat-wrapper.ts`) provides seamless integration by:\r\n\r\n1. Converting OpenAI messages → Zo format\r\n2. Calling Zo API directly\r\n3. Converting Zo response → OpenAI format\r\n\r\nThis allows"
anchors:
  - Overview
  - Setup
  - 1. Add Environment Variable
  - 2. Usage with Vercel AI SDK
  - 3. Direct API Usage (Without Vercel SDK)
  - How It Works
  - Request Transformation
  - Response Transformation
  - Adding More Custom Providers
  - Fallback Behavior
  - Troubleshooting
  - '"ZO_API_KEY not configured"'
  - '"Zo API error (401)"'
  - Streaming Not Working
  - Performance
  - Resources
relations:
  - type: example-of
    id: zeroboot-integration-guide
    title: Zeroboot Integration Guide
    path: zeroboot-integration-guide.md
    confidence: 0.309
    classified_score: 0.42
    auto_generated: true
    generator: apply-classified-suggestions
  - type: example-of
    id: opentelemetry-setup-guide
    title: OpenTelemetry Setup Guide
    path: opentelemetry-setup-guide.md
    confidence: 0.308
    classified_score: 0.375
    auto_generated: true
    generator: apply-classified-suggestions
  - type: example-of
    id: mcp-integration-guide
    title: MCP Integration Guide
    path: mcp-integration-guide.md
    confidence: 0.308
    classified_score: 0.421
    auto_generated: true
    generator: apply-classified-suggestions
  - type: example-of
    id: figma-integration-guide
    title: Figma Integration Guide
    path: figma-integration-guide.md
    confidence: 0.308
    classified_score: 0.421
    auto_generated: true
    generator: apply-classified-suggestions
  - type: example-of
    id: port-configuration-guide
    title: Port Configuration Guide
    path: port-configuration-guide.md
    confidence: 0.308
    classified_score: 0.405
    auto_generated: true
    generator: apply-classified-suggestions
---
# Zo AI Integration Guide

## Overview

Zo AI uses a non-OpenAI API format. The compatibility wrapper (`openai-compat-wrapper.ts`) provides seamless integration by:

1. Converting OpenAI messages → Zo format
2. Calling Zo API directly
3. Converting Zo response → OpenAI format

This allows Zo to work with the Vercel AI SDK streaming infrastructure.

## Setup

### 1. Add Environment Variable

```env
ZO_API_KEY=your_zo_api_key
```

### 2. Usage with Vercel AI SDK

```typescript
import { streamWithVercelAI } from '@/lib/chat/vercel-ai-streaming';

// Zo streaming works automatically via provider mapping
for await (const chunk of streamWithVercelAI(
  'zo',  // Provider name
  'zo',  // Model name
  messages,
  0.7,    // temperature
  2000    // maxTokens
)) {
  if (chunk.content) {
    emit('token', { content: chunk.content });
  }
  if (chunk.isComplete) {
    emit('done', { tokensUsed: chunk.tokensUsed });
  }
}
```

### 3. Direct API Usage (Without Vercel SDK)

```typescript
import { callZoAPI, streamZoAPI } from '@/lib/chat/openai-compat-wrapper';

// Non-streaming
const response = await callZoAPI([
  { role: 'user', content: 'Hello!' }
]);
console.log(response.choices[0].message.content);

// Streaming
for await (const chunk of streamZoAPI([
  { role: 'user', content: 'Hello!' }
])) {
  if (chunk.type === 'text-delta') {
    console.log(chunk.textDelta);
  }
}
```

## How It Works

### Request Transformation

**OpenAI Format (Input):**
```json
{
  "messages": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi there!" },
    { "role": "user", "content": "How are you?" }
  ]
}
```

**Zo Format (Transformed):**
```json
{
  "input": "User: Hello\n\nAssistant: Hi there!\n\nUser: How are you?"
}
```

### Response Transformation

**Zo API Response:**
```json
{
  "output": "I'm doing well, thank you!"
}
```

**OpenAI Format (Output):**
```json
{
  "id": "zo-compat-1234567890",
  "object": "chat.completion",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "I'm doing well, thank you!"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 8,
    "total_tokens": 18
  }
}
```

## Adding More Custom Providers

To add another custom provider:

```typescript
// lib/chat/openai-compat-wrapper.ts

registerCustomProvider('myprovider', {
  name: 'myprovider',
  baseURL: 'https://api.myprovider.com',
  apiKeyEnv: 'MYPROVIDER_API_KEY',
  
  // Convert OpenAI messages → Provider format
  customRequestTransform: async (messages, options) => {
    const prompt = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n');
    
    return {
      input: prompt,
      temperature: options.temperature,
      max_tokens: options.maxOutputTokens,
    };
  },
  
  // Convert Provider response → OpenAI format
  customResponseTransform: async (response) => {
    return {
      id: 'myprovider-' + Date.now(),
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: response.output || response.content,
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: response.usage?.prompt_tokens || 0,
        completion_tokens: response.usage?.completion_tokens || 0,
        total_tokens: response.usage?.total_tokens || 0,
      },
    };
  },
  
  models: ['model-1', 'model-2'],
});
```

Then add to provider mapping:

```typescript
// lib/chat/enhanced-llm-service.ts
const vercelProviderMap = {
  // ... existing providers
  'myprovider': 'myprovider',
};
```

## Fallback Behavior

If Zo API fails, the system automatically falls back:

1. **Try Zo compatibility wrapper** → Uses custom wrapper
2. **Fallback to legacy streaming** → Uses original SDK if available
3. **Fallback to alternative providers** → Uses configured fallback chain

Logs will show:
```
[Chat:EnhancedLLM] Using Vercel AI SDK for streaming { provider: 'zo', model: 'zo' }
[Chat:EnhancedLLM] Vercel AI SDK streaming completed { latencyMs: 1234 }
```

Or on failure:
```
[Chat:EnhancedLLM] Provider not supported by Vercel AI SDK, using legacy streaming { provider: 'zo' }
```

## Troubleshooting

### "ZO_API_KEY not configured"

Add to `.env.local`:
```env
ZO_API_KEY=your_actual_api_key
```

### "Zo API error (401)"

Check that your API key is valid:
```bash
curl -H "Authorization: Bearer $ZO_API_KEY" https://api.zo.computer/zo/ask
```

### Streaming Not Working

Zo doesn't support native streaming. The wrapper simulates streaming by:
1. Fetching complete response
2. Yielding chunks with small delays

This provides streaming-like UX even for non-streaming APIs.

## Performance

| Metric | Value |
|--------|-------|
| Average Latency | ~800ms |
| First Token | ~800ms (non-streaming) |
| Tokens/Second | N/A (simulated) |

## Resources

- [Zo API Documentation](https://zo.computer/docs/api)
- [OpenAI Compatibility Wrapper](./openai-compat-wrapper.ts)
- [Vercel AI SDK Complete Guide](./VERCEL_AI_SDK_COMPLETE.md)
