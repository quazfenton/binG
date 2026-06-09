# infra/

## Production

**`oracle/docker-compose.yml`** — The production deployment for Oracle ARM A1 (Always Free) VM.

- Caddy reverse proxy + cloudflared tunnel (no host port mappings)
- Three containers: `caddy`, `backend` (Hono), `ninerouter` (LLM gateway)
- Loads config from repo-root `.env` file
- All containers communicate via Docker internal network only

```bash
# Deploy:
cd /opt/bing && docker compose -f infra/oracle/docker-compose.yml up -d --build
```

## Alternatives (not production)

All other compose files live in `alternatives/`. These are dev configs, experimental setups, or alternative deployment strategies — **none are used in production**.

| File | Purpose |
|------|---------|
| `alternatives/docker-compose.yml` | Full-stack compose with Grafana, Prometheus, MinIO, microsandbox, etc. |
| `alternatives/docker-compose.dev.yml` | Local development with hot-reload |
| `alternatives/docker-compose.v2.yml` | V2 multi-agent architecture (Traefik, planners, workers, Qdrant) |
| `alternatives/docker-compose.backend.yml` | Hono backend override (to be used with `-f`) |
| `alternatives/docker-compose.modes.yml` | Standard vs OpenCode mode profiles |
| `alternatives/docker-compose.prod.yml` | Traefik-based V2 setup (experimental) |

## Other files

| File | Purpose |
|------|---------|
| `Caddyfile` | Caddy reverse proxy config (used by oracle/ deployment) |
| `Dockerfile` | Main Next.js app image |
| `Dockerfile.gateway` | Agent Gateway image |
| `Dockerfile.worker` | Agent Worker image |
| `Dockerfile.agent` | Generic agent service image |
| `Dockerfile.sandbox` | Sandbox pool image |
| `Dockerfile.mcp` | MCP tool server image |
| `Dockerfile.dev` | Development Dockerfile |
| `Dockerfile.preview` | Preview/router image |
| `Dockerfile.terminal-r2` | Terminal/R2 image |
| `queue.ts` | BullMQ queue type definitions |
| `README.oci.md` | Oracle Cloud Infrastructure setup guide |
