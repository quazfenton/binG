# AI Orchestrator - Cloudflare Worker

Advanced orchestration layer for Fast-Agent with quality-focused iterative refinement, parallel exploration, and n8n integration.

## Features

- **Parallel Exploration**: Test multiple approaches simultaneously
- **Iterative Refinement**: Automatic quality-driven improvement loops
- **Reflect & Critic**: Dual-perspective generation and synthesis
- **Session Management**: Durable Objects for long-running jobs
- **Streaming**: Real-time progress updates via SSE
- **Caching**: Intelligent response caching in KV
- **n8n Integration**: External test execution and workflow orchestration

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Secrets

```bash
wrangler secret put FAST_AGENT_KEY
wrangler secret put N8N_SECRET
wrangler secret put HMAC_SECRET
wrangler secret put N8N_WEBHOOK_QUICK
wrangler secret put N8N_WEBHOOK_ASYNC
```

### 3. Create KV Namespaces

```bash
wrangler kv:namespace create CACHE_KV
wrangler kv:namespace create CONFIG_KV
```

Update `wrangler.toml` with the generated IDs.

### 4. Deploy

```bash
npm run deploy
```

## API Endpoints

### POST /session/start

Start a new orchestration session.

**Request:**
```json
{
  "prompt": "Write a function to calculate fibonacci",
  "mode": "quality",
  "options": {
    "maxIterations": 3,
    "qualityThreshold": 0.85,
    "parallelVariants": [
      { "name": "creative", "modifier": "Be innovative" },
      { "name": "robust", "modifier": "Handle edge cases" }
    ]
  }
}
```

**Response:**
```json
{
  "id": "session-uuid",
  "sessionUrl": "/session/session-uuid"
}
```

### GET /session/{id}/status

Get session status and results.

**Response:**
```json
{
  "meta": {
    "id": "session-uuid",
    "status": "succeeded",
    "candidates": [...],
    "winner": {...},
    "final": {...}
  },
  "events": [...]
}
```

### GET /session/{id}/stream

Stream real-time progress updates (SSE).

### POST /session/{id}/cancel

Cancel a running session.

### POST /proxy

Simple proxy to Fast-Agent with caching.

## Integration with Next.js

### API Route

```typescript
// app/api/ai/advanced/route.ts
export async function POST(request: NextRequest) {
  const body = await request.json();
  
  const response = await fetch(`${WORKER_URL}/session/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  return NextResponse.json(await response.json());
}
```

### Client Hook

```typescript
const { data, error } = useSWR(
  `/api/ai/status/${jobId}`,
  fetcher,
  { refreshInterval: 1000 }
);
```

## Configuration

Configuration is stored in KV and can be overridden per-request.

### Default Configuration

See `src/config.js` for default values.

### Runtime Configuration

```typescript
// Update config via KV
await env.CONFIG_KV.put('orchestration-config', JSON.stringify({
  orchestration: {
    maxIterations: 5,
    qualityThreshold: 0.90
  }
}));
```

## Monitoring

### Logs

```bash
wrangler tail
```

### Metrics

Events are stored in session storage and can be queried via `/session/{id}/status`.

## Development

```bash
npm run dev
```

## Testing

```bash
npm test
```

## Architecture

```
Client → Worker → Durable Object (Session)
                      ├─ Fast-Agent (multiple variants)
                      ├─ n8n (testing/scoring)
                      └─ KV (caching)
```

## Next Steps

1. Configure your Fast-Agent endpoint in `wrangler.toml`
2. Setup n8n webhooks for test execution
3. Integrate with your Next.js app
4. Monitor and tune parameters based on metrics
