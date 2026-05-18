# 🚀 binG Modal Workers — Serverless GPU/CPU Compute

Modal provides burstable, serverless compute for binG's heavy agent workloads. When the OCI instance is under load or unavailable, agent tasks seamlessly offload to Modal's infrastructure.

## Architecture

```
User → Vercel/OCI Backend
            │
            ├── Light requests → handled locally (OCI Docker)
            │
            └── Heavy/burst requests → POST to Modal
                    ├── /api/agent/execute   → AgentExecutor (CPU)
                    ├── /api/agent/stream    → AgentExecutor SSE stream
                    ├── /api/sandbox/run     → SandboxExecutor (isolated)
                    └── /api/inference       → GPUInference (T4/A10G)
```

## Services

| Service | Class | GPU | Concurrency | Cold Start | Cost |
|---------|-------|-----|-------------|------------|------|
| Agent Executor | `AgentExecutor` | No (CPU) | 3 parallel | ~5s | $0.0001/s |
| Sandbox Executor | `SandboxExecutor` | No | 5 parallel | ~3s | $0.0001/s |
| GPU Inference | `GPUInference` | T4 | 1 | ~20s | $0.0002/s |

## Free Tier (Starter Plan)

| Resource | Limit | Adequate For |
|----------|-------|-------------|
| Compute credits | **$30/month** | ~300k agent executions or ~150k sandbox runs |
| Container count | 100 | Plenty |
| Concurrent GPUs | 10 | More than enough |
| Workspace seats | 3 | Team-sized |

## Quick Start

```bash
# 1. Install Modal CLI
pip install modal

# 2. Authenticate (follow the browser prompt)
modal token new

# 3. Configure secrets
cp env.example .env
# Edit .env with your API keys

# 4. Deploy
bash setup.sh
```

## Using from the Backend

### TypeScript Client (see `web/lib/modal/modal-client.ts`)

```typescript
import { ModalClient } from '@/lib/modal/modal-client';

const modal = new ModalClient(process.env.MODAL_API_URL!);

// Execute an agent task
const result = await modal.executeAgent({
  userMessage: 'Refactor this function',
  conversationId: 'abc-123',
  userId: 'user-1',
  model: 'gpt-4o',
  provider: 'openai',
});

// Run code in sandbox
const sandboxResult = await modal.runSandbox({
  code: 'print("hello")',
  language: 'python',
});
```

### Direct HTTP (any language)

```bash
# Health check
curl https://bing-agent-workers.modal.run/health

# Execute agent
curl -X POST https://bing-agent-workers.modal.run/api/agent/execute \
  -H "Content-Type: application/json" \
  -d '{
    "user_message": "Write a Python function to sort a list",
    "conversation_id": "test-123",
    "user_id": "user-1"
  }'

# Run sandbox code
curl -X POST https://bing-agent-workers.modal.run/api/sandbox/run \
  -H "Content-Type: application/json" \
  -d '{
    "code": "print(sum(range(100)))",
    "language": "python",
    "timeout_seconds": 15
  }'
```

## Local Testing

```bash
# Run the Modal app locally (simulates GPU/CPU)
modal run app.py

# This runs the @app.local_entrypoint() function
# which tests all services
```

## Secrets Reference

Set these via `modal secret create bing-modal-secrets`:

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | For OpenAI | LLM inference |
| `ANTHROPIC_API_KEY` | For Anthropic | LLM inference |
| `TOGETHER_API_KEY` | For Together | Open-source models + image gen |
| `MISTRAL_API_KEY` | For Mistral | LLM inference |
| `BACKEND_URL` | Optional | Tool execution callback URL |

## Monitoring

```bash
# View logs
modal logs bing-agent-workers

# View deployed functions
modal app ls

# Inspect a specific function
modal app inspect bing-agent-workers.AgentExecutor.execute
```

## Architecture Decisions

1. **Why Modal over OCI workers?** — Autoscales to zero, no idle cost. Perfect for bursty agent traffic.
2. **Why Python for Modal?** — Modal's native Python SDK is more mature. The TypeScript SDK exists but lacks sandbox support.
3. **Why GPU?** — Image generation, embedding computation, and potentially running small local LLMs benefit greatly.
4. **Why keep the OCI workers?** — For steady-state traffic that doesn't warrant cold start latency.
