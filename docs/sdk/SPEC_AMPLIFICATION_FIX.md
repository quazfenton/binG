# Spec Amplification Fix - Duplicate Request ID

## Issue

**Error:**
```
[ChatRequestLogger] Failed to log request start: SqliteError: UNIQUE constraint failed: chat_request_logs.id
```

**Root Cause:**
The same `requestId` was being used for both:
1. Primary LLM request
2. Spec generation request (fast model)

Both requests tried to insert into `chat_request_logs` with the same ID, causing a constraint violation.

---

## Fix Applied

**File:** `lib/api/response-router.ts`

```typescript
// Generate unique request ID for spec generation to avoid duplicate key error
const specRequestId = `spec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

const specPromise = enhancedLLMService.generateResponse({
  provider: fastModel.provider,
  model: fastModel.model,
  messages: buildSpecPrompt(request.messages[0].content),
  maxTokens: 2000,
  stream: false,
  requestId: specRequestId  // ← Unique ID for spec generation
})
```

---

## How It Works Now

```
User Request (requestId: "chat-123")
    │
    ├─► Primary Request (requestId: "chat-123")
    │   └─► INSERT INTO chat_request_logs (id: "chat-123")
    │
    └─► Spec Generation (requestId: "spec-1709876543210-abc123")
        └─► INSERT INTO chat_request_logs (id: "spec-1709876543210-abc123")
```

**Both requests logged separately ✅**

---

## Testing

### Make a Request

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Build a Next.js app"}],
    "mode": "max"
  }'
```

### Expected Behavior

1. **No database errors** ✅
2. **Two entries in chat_request_logs:**
   - Primary request
   - Spec generation request
3. **Response includes spec amplification metadata:**
   ```json
   {
     "metadata": {
       "specAmplification": {
         "enabled": true,
         "mode": "max",
         "fastModel": "google/gemini-2.5-flash",
         "sectionsGenerated": 5,
         "specScore": 8
       }
     }
   }
   ```

---

## Verify Fix

### Check Database

```bash
sqlite3 data/binG.db "SELECT id, provider, model, latency_ms FROM chat_request_logs WHERE id LIKE 'spec-%' ORDER BY created_at DESC LIMIT 5;"
```

Should show spec generation requests with unique IDs.

### Check Logs

```
[API:ResponseRouter] Spec amplification enabled
  fastModel: google/gemini-2.5-flash
  mode: max
  provider: google

[ChatRequestLogger] Request logged: spec-1709876543210-abc123
```

---

## Status

✅ **Fixed** - Unique request IDs for spec generation

**Ready for testing!**
