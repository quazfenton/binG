# Terminal WebSocket Proxy (Rust)

High-performance WebSocket terminal proxy for binG, designed to handle **10,000+ concurrent terminal connections** without Node.js event-loop blocking.

## Why Rust?

| Aspect | Node.js (ws) | Rust (tokio-tungstenite) |
|--------|--------------|--------------------------|
| **Connections** | ~1,000-2,000 concurrent | 10,000+ concurrent |
| **Memory/connection** | ~10-20KB | ~2-3KB |
| **CPU/message** | Higher (JS overhead) | Minimal |
| **Blocking** | Event-loop blocking | Truly async |

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────┐     ┌───────────────┐
│  xterm.js   │────▶│  Rust Proxy     │────▶│  Next.js     │────▶│  Sandbox      │
│  (Browser)  │◀────│  (Port 8080)    │◀────│  (Port 5555) │◀────│  Providers    │
└─────────────┘     └─────────────────┘     └──────────────┘     └───────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │    Redis     │
                    │  (Sessions)  │
                    └──────────────┘
```

## Features

- **JWT Authentication**: All connections validated against your auth system
- **Session Persistence**: Sessions stored in Redis for horizontal scaling
- **Rate Limiting**: Per-IP rate limiting to prevent abuse
- **Metrics**: Prometheus-compatible metrics on port 9090
- **Idle Timeout**: Auto-disconnect after configurable inactivity
- **Connection Pooling**: Efficient WebSocket to backend connections

## Quick Start

### Docker Compose (Recommended)

```bash
# Add to your docker-compose.yml:
# (already added to infra/alternatives/docker-compose.v2.yml)

terminal-proxy:
  build:
    context: ./infra/terminal-proxy
    dockerfile: Dockerfile
  ports:
    - "8080:8080"  # WebSocket
    - "9090:9090"  # Metrics
  environment:
    - REDIS_URL=redis://redis:6379
    - TERMINAL_PROXY_BACKEND_URL=http://app:5555
    - JWT_SECRET=${JWT_SECRET}
    - TERMINAL_PROXY_MAX_CONNECTIONS=10000
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TERMINAL_PROXY_ADDR` | `0.0.0.0:8080` | Listen address |
| `TERMINAL_PROXY_WORKERS` | `4` | Worker threads |
| `TERMINAL_PROXY_MAX_CONNECTIONS` | `10000` | Max concurrent |
| `TERMINAL_PROXY_IDLE_TIMEOUT_MS` | `900000` | 15 min idle timeout |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `JWT_SECRET` | `change-me` | JWT verification secret |
| `TERMINAL_PROXY_BACKEND_URL` | `http://localhost:3000` | Backend server |
| `TERMINAL_PROXY_METRICS_PORT` | `9090` | Metrics HTTP port |
| `RUST_LOG` | `info` | Log level |

### Next.js Configuration

Point your Next.js app to the Rust proxy:

```bash
# .env
NEXT_PUBLIC_WEBSOCKET_URL=ws://terminal-proxy:8080
```

Or for development:

```bash
NEXT_PUBLIC_WEBSOCKET_PORT=8080
```

## Building

```bash
# Build Docker image
cd infra/terminal-proxy
docker build -t binG/terminal-proxy:latest .

# Or build locally (requires Rust 1.75+)
cargo build --release
./target/release/terminal-proxy
```

## Metrics

Available at `http://localhost:9090/metrics`:

```
# HELP terminal_proxy_active_connections Number of active WebSocket connections
# TYPE terminal_proxy_active_connections gauge
terminal_proxy_active_connections 42

# HELP terminal_proxy_total_sessions Total number of sessions created
# TYPE terminal_proxy_total_sessions counter
terminal_proxy_total_sessions 1234

# HELP terminal_proxy_auth_failure_total Failed authentication attempts
# TYPE terminal_proxy_auth_failure_total counter
terminal_proxy_auth_failure_total 5
```

## Production Deployment

For 10K+ concurrent users:

1. **Horizontal Scaling**: Deploy 2+ replicas (already in docker-compose with `replicas: 2`)
2. **Load Balancing**: Put the Rust proxy behind Traefik or your reverse proxy
3. **Redis HA**: Use Redis Cluster or Sentinel for session persistence
4. **Connection Limits**: Each proxy handles 10K connections comfortably

## File Structure

```
infra/terminal-proxy/
├── Cargo.toml          # Rust dependencies
├── Dockerfile          # Multi-stage build
├── src/
│   ├── main.rs         # Entry point
│   ├── config.rs       # Configuration
│   ├── auth.rs         # JWT authentication
│   ├── session.rs      # In-memory session store
│   ├── redis_store.rs  # Redis persistence
│   ├── connection.rs   # WebSocket handler
│   ├── router.rs       # Request routing
│   └── metrics.rs      # Prometheus metrics
└── README.md
```