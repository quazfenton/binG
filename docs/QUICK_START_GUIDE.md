# Quick Start Guide - New API System

## 🚀 TL;DR

Your API system now uses **priority-based routing** with automatic fallback. No API errors will ever reach users.

---

## ⚡ Quick Test

```bash
# 1. Start the app
npm run dev

# 2. Make a chat request through the UI
# 3. Check console logs for routing info
```

Look for logs like:
```
[Router] Starting request routing
[Router] Routing to fast-agent (priority 1)
[Router] Request successfully handled by fast-agent in 234ms
```

---

## 🔧 Current Configuration

By default, the system uses:
- ✅ **Fast-Agent** (Priority 1) - If enabled and running
- ✅ **Original System** (Priority 4) - Always available

Additional services (currently disabled, ready when needed):
- ⏸️ **n8n Agents** (Priority 2) - Set `N8N_ENABLED=true` when ready
- ⏸️ **Custom Fallback** (Priority 3) - Set `CUSTOM_FALLBACK_ENABLED=true` when ready

---

## 📝 Key Changes

### What's Different?
- ✅ Requests route through priority chain (not just intercept)
- ✅ Automatic fallback if services fail
- ✅ Never shows API errors to users
- ✅ Better logging and visibility

### What's the Same?
- ✅ Fast-Agent still handles advanced requests
- ✅ UI unchanged
- ✅ Response format unchanged
- ✅ All other functionality preserved

---

## 🎯 Priority Routing

```
Request Flow:

1. Fast-Agent (if enabled & healthy & can handle)
   ↓ (if fails or declines)
   
2. n8n Agents (if enabled & healthy & can handle)
   ↓ (if fails or declines)
   
3. Custom Fallback (if enabled, always accepts)
   ↓ (if fails)
   
4. Original System (always available)
   ↓ (if fails)
   
5. Emergency Fallback (friendly message)
```

---

## ⚙️ Enable Additional Services

### Enable n8n Agent Chaining

In `.env`:
```env
N8N_ENABLED=true
N8N_ENDPOINT=https://your-n8n-instance.com/webhook/llm-agent
N8N_API_KEY=your_api_key
```

### Enable Custom Fallback

In `.env`:
```env
CUSTOM_FALLBACK_ENABLED=true
CUSTOM_FALLBACK_ENDPOINT=https://your-intermediate-server.com/api/llm
CUSTOM_FALLBACK_API_KEY=your_api_key
```

---

## 🐛 Troubleshooting

### Not routing to Fast-Agent?
Check:
- Is `FAST_AGENT_ENABLED=true`?
- Is Fast-Agent running on the configured endpoint?
- Check logs for health check status

### Requests always going to original system?
This is normal if:
- External services are disabled
- Fast-Agent is unhealthy
- Request doesn't match routing criteria

### Seeing API errors?
**This should NOT happen!** If you see API errors:
1. Check that code changes were applied
2. Restart the dev server
3. Review `app/api/chat/route.ts`

---

## 📊 Monitoring

### Check Routing Statistics

Add this to your code temporarily:
```typescript
import { priorityRequestRouter } from '@/lib/api/priority-request-router';

console.log('Routing stats:', priorityRequestRouter.getStats());
```

### Check Service Health

Each service has a `healthCheck()` method you can call.

---

## 🎉 That's It!

Your system is now more robust and will never show API errors to users. Test it out and enable additional services when ready.

For full details, see: `API_SYSTEM_IMPLEMENTATION_COMPLETE.md`

---

**Questions?**
- All external services optional
- System works great with just Fast-Agent + Original System
- Add n8n and Custom Fallback when you're ready
