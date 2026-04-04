# Log Analysis: OpenRouter Failure & Model Switching

## Executive Summary

Analysis of terminal and browser console logs from RUN #1 (Mistral) and RUN #2 (OpenRouter) reveals:

1. **OpenRouter API Failure**: Vercel AI SDK using incompatible Responses API format
2. **Model Switching**: Expected fallback behavior (not random)
3. **Secondary Error**: `filesystemEdits` initialization bug in fallback path

---

## Issue 1: OpenRouter "Invalid Responses API Request"

### Error Details

**Timestamp:** 2026-04-01T19:20:47.215Z  
**Request ID:** `chat_1775071247198_vzo3iPK8Y`  
**Provider:** `openrouter`  
**Model:** `nvidia/nemotron-3-nano-30b-a3b:free`

**Error Message:**
```
Error [AI_APICallError]: Invalid Responses API request
URL: https://openrouter.ai/api/v1/responses
Status: 400
```

**OpenRouter API Response:**
```json
{
  "error": {
    "code": "invalid_prompt",
    "message": "Invalid Responses API request"
  },
  "metadata": {
    "raw": [
      {
        "expected": "string",
        "message": "Invalid input: expected string, received array",
        "path": []
      },
      {
        "expected": "reasoning_text",
        "path": ["content", 0, "type"]
      },
      {
        "expected": "user",
        "path": ["role"]
      }
    ]
  }
}
```

### Root Cause

**Vercel AI SDK Format Mismatch:**

The Vercel AI SDK (v4+) uses the **new Responses API format**:
```javascript
{
  type: "message",
  role: "user",
  content: [
    { type: "text", text: "Hello" }
  ]
}
```

But **OpenRouter's NVIDIA endpoint** expects the **legacy Chat Completions format**:
```javascript
{
  role: "user",
  content: "Hello"
}
```

### Why This Happens

1. **Vercel AI SDK Auto-Detection**: The SDK automatically uses the Responses API format for providers that support it
2. **OpenRouter Inconsistency**: OpenRouter supports Responses API for some models but NOT for the free NVIDIA endpoint
3. **No Format Fallback**: The SDK doesn't fall back to Chat Completions format when Responses API fails

### Fix Options

**Option A: Force Chat Completions Format for OpenRouter**
```typescript
// In lib/chat/vercel-ai-streaming.ts or llm-provider-router.ts
if (provider === 'openrouter') {
  // Force legacy format
  experimental_prepareRequestBody: (options) => {
    return {
      model: options.model,
      messages: options.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : 
                 m.content.map(c => c.type === 'text' ? c.text : '').join('')
      })),
      // ... other options
    }
  }
}
```

**Option B: Use Different OpenRouter Model**
Some OpenRouter models support Responses API:
- `openai/gpt-4-turbo`
- `anthropic/claude-3-opus`
- Avoid: `nvidia/*` free tier models

**Option C: Catch and Retry with Different Format**
```typescript
try {
  await streamText({ model: openrouter(model) })
} catch (error) {
  if (error.message.includes('Invalid Responses API')) {
    // Retry with chat completions format
    await streamText({ 
      model: openrouter(model),
      experimental_prepareRequestBody: legacyFormat 
    })
  }
}
```

---

## Issue 2: Model Switching (NOT Random - It's Fallback)

### What's Happening

**Terminal Log:**
```
19:20:47.554Z [WARN] Streaming failed for primary provider
  provider: 'openrouter'
  error: 'Invalid Responses API request'

19:20:47.555Z [INFO] Falling back to streaming provider
  provider: 'mistral'
  model: 'mistral-large-latest'
```

### This is EXPECTED Behavior

The code has a **fallback chain** in `app/api/chat/route.ts`:

```typescript
try {
  // Try primary provider (openrouter)
  await streamWithVercelAI({ provider, model, ... })
} catch (error) {
  // Fallback to next available provider
  chatLogger.warn('Streaming failed for primary provider')
  return streamWithVercelAI({ 
    provider: 'mistral',  // Next in fallback chain
    model: 'mistral-large-latest',
    ...
  })
}
```

### Why It Looks "Random"

The user sees:
1. Selected: `openrouter` → `nvidia/nemotron-3-nano-30b-a3b:free`
2. Response comes back as: `mistral` → `mistral-large-latest`

**What's actually happening:**
1. OpenRouter API rejects the request (400 error)
2. Fallback logic triggers automatically
3. Mistral is the next provider in the fallback chain

### How to Fix the Confusion

**Option 1: Better Error Messaging**
```typescript
} catch (error) {
  chatLogger.warn('OpenRouter failed, falling back to Mistral', {
    originalProvider: 'openrouter',
    originalModel: model,
    fallbackProvider: 'mistral',
    fallbackModel: 'mistral-large-latest',
    reason: error.message
  })
  
  // Emit event to UI so user knows what happened
  realEmit('provider_fallback', {
    from: { provider: 'openrouter', model },
    to: { provider: 'mistral', model: 'mistral-large-latest' },
    reason: error.message
  })
}
```

**Option 2: Disable Fallback for Specific Errors**
```typescript
if (error.message.includes('Invalid Responses API')) {
  // Don't fallback - tell user to pick a different model
  throw new Error(
    `OpenRouter model ${model} is not compatible. ` +
    `Please select a different model or provider.`
  )
}
```

**Option 3: Validate Model Compatibility Before Sending**
```typescript
// In lib/chat/llm-provider-router.ts
const OPENROUTER_RESPONSE_API_MODELS = [
  'openai/gpt-4-turbo',
  'anthropic/claude-3-opus',
  // ... whitelist
]

if (provider === 'openrouter' && !OPENROUTER_RESPONSE_API_MODELS.includes(model)) {
  // Force chat completions format or reject
  throw new Error(
    `Model ${model} requires chat completions format. ` +
    `Use a supported model or switch providers.`
  )
}
```

---

## Issue 3: `filesystemEdits` Initialization Error

### Error Details

**Terminal (after fallback to Mistral):**
```
19:20:48.223Z [ERROR] LLM stream error
  error: "Cannot access 'filesystemEdits' before initialization"
```

### Root Cause

This is a **real bug** in the fallback path. The variable `filesystemEdits` is declared in the primary provider path but referenced in the fallback path before being initialized.

**Code Structure:**
```typescript
// Primary provider (openrouter) - line ~1238
let filesystemEdits = null
try {
  filesystemEdits = await applyFilesystemEditsFromResponse({...})
} catch (error) {
  // ...
}

// Fallback provider (mistral) - line ~1671
if (filesystemEdits && filesystemEdits.applied.length > 0) {
  // BUG: filesystemEdits might not be initialized if we're in fallback path
}
```

### Fix

**✅ FIXED:** Move `filesystemEdits` declaration to function scope.

**File:** `app/api/chat/route.ts`

**Before:**
```typescript
// Line ~1238 - Inside conditional block
let filesystemEdits = null;
try {
  filesystemEdits = await applyFilesystemEditsFromResponse({...})
} catch (error) {
  // ...
}

// Line ~1671 - Referenced in streaming path (BUG: may not be initialized)
if (filesystemEdits && filesystemEdits.applied.length > 0) {
  // ...
}

// Line ~2023 - Another declaration in fallback path (REDUNDANT)
let filesystemEdits: Awaited<ReturnType<typeof applyFilesystemEditsFromResponse>> | null = null;
```

**After:**
```typescript
// Line ~1120 - Declare at function scope (BEFORE any conditional blocks)
let filesystemEdits: Awaited<ReturnType<typeof applyFilesystemEditsFromResponse>> | null = null;

// Line ~1242 - Just assign value (no re-declaration)
try {
  filesystemEdits = await applyFilesystemEditsFromResponse({...})
} catch (error) {
  // ...
}

// Line ~1671 - Now safe to reference in streaming path
if (filesystemEdits && filesystemEdits.applied.length > 0) {
  // ...
}

// Line ~2023 - Fallback path uses same variable (no re-declaration)
if (enableFilesystemEdits) {
  filesystemEdits = await applyFilesystemEditsFromResponse({...})
}
```

---

## Summary

| Issue | Type | Severity | Fix |
|-------|------|----------|-----|
| OpenRouter API Failure | Format Mismatch | High | Force chat completions format or whitelist compatible models |
| Model Switching | Expected Fallback | Low | Add user notification about fallback |
| filesystemEdits Error | Scope Bug | Medium | Move declaration to function scope |

### Recommended Actions

1. **✅ COMPLETED:** Fix `filesystemEdits` scope issue
   - Moved declaration to line 1120 (function scope)
   - Removed duplicate declarations at lines 1238 and 2023
   - All code paths now safely share the same variable

2. **Short-term:** Add provider fallback notification to UI
   - Emit `provider_fallback` event when switching providers
   - Show toast notification to user

3. **Long-term:** Implement model compatibility validation or format auto-detection
   - Whitelist OpenRouter models that support Responses API
   - Force chat completions format for incompatible models

### Files Modified

- ✅ `app/api/chat/route.ts` - Fixed `filesystemEdits` scope (line 1120)
- `lib/chat/vercel-ai-streaming.ts` - Add OpenRouter format handling (TODO)
- `components/conversation-interface.tsx` - Show fallback notification to user (TODO)
