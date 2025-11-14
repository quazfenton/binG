# Cloudflare Worker Deployment Guide

## Complete Setup and Integration

This guide walks you through deploying the Cloudflare Worker orchestration layer and integrating it with your existing Next.js app, Fast-Agent, and n8n.

---

## Prerequisites

- Cloudflare account with Workers enabled
- Node.js 18+ and npm/pnpm installed
- Fast-Agent endpoint running
- n8n instance (optional but recommended)
- Your Next.js app running

---

## Step 1: Cloudflare Setup

### 1.1 Install Wrangler CLI

```bash
npm install -g wrangler
```

### 1.2 Login to Cloudflare

```bash
wrangler login
```

### 1.3 Get Your Account ID

```bash
wrangler whoami
```

Copy your Account ID and update `cloudflare-worker/wrangler.toml`:

```toml
account_id = "YOUR_ACCOUNT_ID_HERE"
```

---

## Step 2: Create Resources

### 2.1 Create KV Namespaces

```bash
cd cloudflare-worker

# Create cache namespace
wrangler kv:namespace create CACHE_KV

# Create config namespace
wrangler kv:namespace create CONFIG_KV
```

You'll get output like:
```
{ binding = "CACHE_KV", id = "abc123..." }
{ binding = "CONFIG_KV", id = "def456..." }
```

Update `wrangler.toml` with these IDs:

```toml
[[kv_namespaces]]
binding = "CACHE_KV"
id = "abc123..."

[[kv_namespaces]]
binding = "CONFIG_KV"
id = "def456..."
```

### 2.2 Configure Secrets

```bash
# Fast-Agent API key
wrangler secret put FAST_AGENT_KEY
# Enter your Fast-Agent key when prompted

# n8n webhook secret (for verifying callbacks)
wrangler secret put N8N_SECRET
# Enter a random secret

# HMAC secret (for request signing)
wrangler secret put HMAC_SECRET
# Enter a random secret

# n8n webhook URLs
wrangler secret put N8N_WEBHOOK_QUICK
# Enter: https://your-n8n.com/webhook/quick-test

wrangler secret put N8N_WEBHOOK_ASYNC
# Enter: https://your-n8n.com/webhook/async-test
```

---

## Step 3: Deploy Worker

### 3.1 Install Dependencies

```bash
npm install
```

### 3.2 Test Locally

```bash
npm run dev
```

This starts the worker at `http://localhost:8787`

### 3.3 Deploy to Production

```bash
npm run deploy
```

You'll get a URL like: `https://ai-orchestrator.YOUR_SUBDOMAIN.workers.dev`

---

## Step 4: Setup n8n Workflows

### 4.1 Quick Test Workflow (Synchronous)

Create a new workflow in n8n:

```
1. Webhook Trigger
   - Method: POST
   - Path: /webhook/quick-test
   - Authentication: Header Auth
   - Header Name: x-n8n-secret
   - Header Value: [your N8N_SECRET]

2. Code Node (Run Linter)
   - Language: JavaScript
   - Code:
     const code = $json.text;
     // Run quick syntax check
     try {
       new Function(code);
       return { passRate: 0.9, passed: true };
     } catch (e) {
       return { passRate: 0.3, passed: false, error: e.message };
     }

3. Respond to Webhook
   - Return all the data from previous node
```

### 4.2 Async Test Workflow (Full Tests)

```
1. Webhook Trigger
   - Method: POST
   - Path: /webhook/async-test

2. Code Node (Setup Test Environment)
   - Extract code and sessionId from webhook

3. Docker Node (Run Tests)
   - Image: node:18
   - Command: npm test
   - Mount code as volume

4. HTTP Request (Callback to Worker)
   - Method: POST
   - URL: https://your-worker.dev/session/{{$json.sessionId}}/callback
   - Body: { "passRate": {{$json.passRate}}, "details": {...} }
   - Headers: x-n8n-signature: [HMAC of body]
```

---

## Step 5: Update Next.js App

### 5.1 Add Environment Variables

In your `.env.local`:

```env
CLOUDFLARE_WORKER_URL=https://ai-orchestrator.YOUR_SUBDOMAIN.workers.dev
WORKER_AUTH_TOKEN=your_random_token
```

### 5.2 Create API Routes

Already created in your app:
- `app/api/ai/advanced/route.ts` - Start advanced jobs
- `app/api/ai/status/[jobId]/route.ts` - Poll status
- `app/api/ai/stream/[jobId]/route.ts` - SSE streaming

### 5.3 Update Priority Router Integration

Edit `lib/api/priority-request-router.ts` to add Cloudflare Worker as Priority 0 (before Fast-Agent):

```typescript
private initializeEndpoints(): EndpointConfig[] {
  const endpoints: EndpointConfig[] = [
    // Priority 0: Cloudflare Worker Orchestration (Advanced mode)
    {
      name: 'cloudflare-orchestration',
      priority: 0,
      enabled: process.env.CLOUDFLARE_WORKER_URL ? true : false,
      service: cloudflareOrchestratorService,
      healthCheck: () => cloudflareOrchestratorService.healthCheck(),
      canHandle: (req) => req.mode === 'advanced' || req.requiresOrchestration,
      processRequest: async (req) => {
        // Start async job and return immediately
        const response = await cloudflareOrchestratorService.startJob(req);
        return response;
      }
    },
    // Priority 1: Fast-Agent (existing)
    // ... rest of your existing priorities
  ];
}
```

---

## Step 6: Create Cloudflare Service Module

Create `lib/api/cloudflare-orchestrator-service.ts`:

```typescript
class CloudflareOrchestratorService {
  private config: {
    enabled: boolean;
    endpoint: string;
    authToken?: string;
  };

  constructor() {
    this.config = {
      enabled: !!process.env.CLOUDFLARE_WORKER_URL,
      endpoint: process.env.CLOUDFLARE_WORKER_URL || '',
      authToken: process.env.WORKER_AUTH_TOKEN,
    };
  }

  shouldHandle(request: any): boolean {
    // Use orchestration for complex requests
    return request.mode === 'advanced' || 
           request.requiresOrchestration ||
           request.enableParallelExploration;
  }

  async startJob(request: any): Promise<any> {
    const response = await fetch(`${this.config.endpoint}/session/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.authToken && {
          'Authorization': `Bearer ${this.config.authToken}`
        })
      },
      body: JSON.stringify({
        prompt: request.messages[request.messages.length - 1].content,
        mode: request.mode || 'quality',
        options: {
          maxIterations: request.maxIterations || 3,
          qualityThreshold: request.qualityThreshold || 0.85,
          parallelVariants: request.variants,
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Cloudflare Worker responded with ${response.status}`);
    }

    return await response.json();
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config.enabled) return false;

    try {
      const response = await fetch(`${this.config.endpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const cloudflareOrchestratorService = new CloudflareOrchestratorService();
```

---

## Step 7: Test the Integration

### 7.1 Test Health Endpoint

```bash
curl https://ai-orchestrator.YOUR_SUBDOMAIN.workers.dev/health
```

Expected: `{"status":"ok","timestamp":1234567890}`

### 7.2 Test Simple Proxy

```bash
curl -X POST https://ai-orchestrator.YOUR_SUBDOMAIN.workers.dev/proxy \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Hello world"}'
```

### 7.3 Test Session Creation

```bash
curl -X POST https://ai-orchestrator.YOUR_SUBDOMAIN.workers.dev/session/start \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Write a function to reverse a string",
    "mode": "quality"
  }'
```

Expected: `{"id":"some-uuid","sessionUrl":"/session/some-uuid"}`

### 7.4 Check Session Status

```bash
curl https://ai-orchestrator.YOUR_SUBDOMAIN.workers.dev/session/some-uuid/status
```

### 7.5 Test from Next.js App

```bash
curl -X POST http://localhost:3000/api/ai/advanced \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Write a function to reverse a string",
    "mode": "quality"
  }'
```

---

## Step 8: Frontend Integration

### 8.1 Update Chat Component

In `components/conversation-interface.tsx`:

```typescript
const handleAdvancedMode = async (prompt: string) => {
  setLoading(true);
  
  // Start job
  const response = await fetch('/api/ai/advanced', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      prompt, 
      mode: 'quality',
      options: {
        maxIterations: 3,
        qualityThreshold: 0.85
      }
    })
  });
  
  const { jobId, streamUrl } = await response.json();
  
  // Setup SSE for progress
  const eventSource = new EventSource(streamUrl);
  
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'placeholder') {
      setPlaceholder(data.message);
    } else if (data.type === 'progress') {
      setProgress(data);
    } else if (data.type === 'complete') {
      setLoading(false);
      fetchFinalResult(jobId);
      eventSource.close();
    }
  };
};
```

### 8.2 Add Mode Selector

```typescript
<select value={mode} onChange={(e) => setMode(e.target.value)}>
  <option value="fast">Fast Mode</option>
  <option value="balanced">Balanced Mode</option>
  <option value="quality">Quality Mode (Advanced)</option>
</select>
```

---

## Step 9: Monitoring and Tuning

### 9.1 View Logs

```bash
wrangler tail
```

### 9.2 Check KV Storage

```bash
# List keys
wrangler kv:key list --namespace-id=abc123...

# Get value
wrangler kv:key get "orchestration-config" --namespace-id=def456...
```

### 9.3 Update Configuration

Create `scripts/update-worker-config.js`:

```javascript
const config = {
  orchestration: {
    maxIterations: 4,
    qualityThreshold: 0.90
  }
};

await fetch('https://ai-orchestrator.YOUR_SUBDOMAIN.workers.dev/config', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(config)
});
```

### 9.4 Monitor Metrics

Check Cloudflare dashboard for:
- Request count
- Error rate
- CPU time
- KV operations

---

## Step 10: Production Optimization

### 10.1 Add Custom Domain

In `wrangler.toml`:

```toml
[env.production]
route = { pattern = "ai-worker.yourdomain.com/*", zone_name = "yourdomain.com" }
```

Deploy:

```bash
wrangler deploy --env production
```

### 10.2 Enable Caching

Already enabled in the code. Tune TTL in `src/config.js`:

```javascript
caching: {
  enabled: true,
  ttl: 86400, // 24 hours
}
```

### 10.3 Rate Limiting

Add rate limiting in worker:

```javascript
// In src/index.js
const rateLimiter = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const requests = rateLimiter.get(ip) || [];
  const recent = requests.filter(t => now - t < 60000); // Last minute
  
  if (recent.length > 10) {
    throw new Error('Rate limit exceeded');
  }
  
  recent.push(now);
  rateLimiter.set(ip, recent);
}
```

---

## Troubleshooting

### Worker not deploying

```bash
# Check syntax
npm run build

# Check account
wrangler whoami

# Verbose deploy
wrangler deploy --verbose
```

### Secrets not working

```bash
# List secrets
wrangler secret list

# Update secret
wrangler secret put FAST_AGENT_KEY
```

### KV not accessible

```bash
# Verify namespace binding
wrangler kv:namespace list

# Test KV access
wrangler dev
```

### n8n callbacks failing

- Check webhook URLs are correct
- Verify N8N_SECRET matches in both places
- Check HMAC signature generation
- Enable n8n webhook logging

### Session not found

- Durable Objects need consistent routing by ID
- Check `idFromName()` usage
- Verify sessionId is UUID format

---

## Cost Estimation

Cloudflare Workers pricing (as of 2025):

- **Free tier**: 100,000 requests/day
- **Paid ($5/month)**: 10M requests/month
- **KV**: $0.50 per million reads
- **Durable Objects**: $0.15 per million requests

Estimated cost for 10,000 requests/day:
- Workers: Free (under 100k/day)
- KV: ~$0.01/day
- DO: ~$0.05/day
- **Total: ~$2/month**

---

## Summary

You now have:

✅ Cloudflare Worker deployed with orchestration  
✅ Durable Objects for session management  
✅ KV storage for caching and config  
✅ n8n integration for testing  
✅ Next.js API routes connected  
✅ SSE streaming for real-time updates  
✅ Priority routing with fallback  

Your architecture:

```
Client App
    ↓
Next.js API
    ↓
Priority Router
    ├─ 0: Cloudflare Worker (advanced mode)
    │     ├─ Durable Object (session)
    │     ├─ Fast-Agent (parallel)
    │     ├─ n8n (testing)
    │     └─ KV (cache)
    ├─ 1: Fast-Agent (direct)
    ├─ 2: n8n Agents
    ├─ 3: Custom Fallback
    └─ 4: Original System
```

**Next: Monitor performance and tune parameters for optimal quality!**
