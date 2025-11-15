# Fast-Agent Endpoint Migration

## What Changed

Fast-Agent now has its own dedicated `/api/agent` endpoint, separated from the main `/api/chat` endpoint.

---

## New Endpoint Structure

### Before
```
/api/chat  → Priority Router → Fast-Agent (Priority 1) → Other services
```

### After
```
/api/chat   → Priority Router → Fast-Agent (Priority 1) → Other services
/api/agent  → Direct Fast-Agent access (dedicated endpoint)
```

---

## When to Use Each Endpoint

### Use `/api/chat` (Main Chat) When:
✅ You want automatic routing and fallback  
✅ You want the system to choose the best service  
✅ You want zero API errors (automatic fallback)  
✅ Standard chat use cases  

### Use `/api/agent` (Fast-Agent Direct) When:
✅ You specifically need Fast-Agent features  
✅ You want to use MCP tools  
✅ You need file handling capabilities  
✅ You want quality optimization features  
✅ Testing Fast-Agent specifically  

---

## API Endpoints

### POST /api/agent
Direct Fast-Agent access

```typescript
const response = await fetch('/api/agent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Hello' }],
    provider: 'openrouter',
    model: 'deepseek/deepseek-r1',
    stream: true
  })
});
```

### GET /api/agent
Get Fast-Agent status

```typescript
const status = await fetch('/api/agent');
// Returns: { enabled, endpoint, supportedProviders, status }
```

### GET /api/agent/health
Health check

```typescript
const health = await fetch('/api/agent/health');
// Returns: { healthy, enabled, endpoint, status }
```

### POST /api/agent/workflows
Execute workflows (future)

```typescript
const result = await fetch('/api/agent/workflows', {
  method: 'POST',
  body: JSON.stringify({
    workflow: 'chaining',
    input: 'Your input',
    config: {...}
  })
});
```

---

## Migration Guide

### For Existing Code

**No changes needed!** The main `/api/chat` endpoint still works with Fast-Agent through the priority router.

### For New Code Targeting Fast-Agent

**Old way (still works):**
```typescript
// Uses priority router, Fast-Agent as Priority 1
const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ messages })
});
```

**New way (direct):**
```typescript
// Direct Fast-Agent access
const response = await fetch('/api/agent', {
  method: 'POST',
  body: JSON.stringify({ messages })
});
```

---

## Benefits of Separation

### 1. Clear Intent
- `/api/chat` = Smart routing with fallback
- `/api/agent` = Direct Fast-Agent access

### 2. Better Error Messages
Direct endpoint gives Fast-Agent-specific errors instead of generic routing errors

### 3. Dedicated Features
Agent endpoint can expose Fast-Agent-specific features:
- MCP tools
- Quality modes
- File operations
- Workflow execution

### 4. Easier Testing
Test Fast-Agent independently without routing logic

### 5. Better Monitoring
Separate metrics for Fast-Agent vs. general chat

---

## Configuration

No configuration changes needed. Uses existing environment variables:

```env
FAST_AGENT_ENABLED=true
FAST_AGENT_ENDPOINT=https://fast-agent.yourdomain.com/api/chat
FAST_AGENT_API_KEY=your_key
```

---

## Client Integration Examples

### React Hook

```typescript
// hooks/use-fast-agent.ts
export function useFastAgent() {
  const sendToAgent = async (message: string) => {
    const response = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: message }]
      })
    });
    return await response.json();
  };

  const checkHealth = async () => {
    const response = await fetch('/api/agent/health');
    return await response.json();
  };

  return { sendToAgent, checkHealth };
}
```

### Component Example

```typescript
function FastAgentChat() {
  const { sendToAgent } = useFastAgent();

  const handleSend = async (message: string) => {
    const result = await sendToAgent(message);
    console.log('Fast-Agent response:', result);
  };

  return (
    <div>
      <h2>Direct Fast-Agent Chat</h2>
      <ChatInterface onSend={handleSend} />
    </div>
  );
}
```

---

## Testing

### Test Main Chat (with routing)
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'
```

### Test Fast-Agent Direct
```bash
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'
```

### Test Health
```bash
curl http://localhost:3000/api/agent/health
```

---

## Summary

✅ **New Endpoint:** `/api/agent` for direct Fast-Agent access  
✅ **Backward Compatible:** `/api/chat` still works  
✅ **Clear Separation:** Dedicated vs. routed access  
✅ **Additional Endpoints:** Health check, workflows  
✅ **No Config Changes:** Uses existing environment variables  

---

**Migration Required:** None - existing code continues to work!

**New Features:** Direct access, health checks, workflow execution (coming soon)
