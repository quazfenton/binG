---
id: websocket-configuration
title: WebSocket Configuration
aliases:
  - WEBSOCKET_CONFIG
  - WEBSOCKET_CONFIG.md
  - websocket-configuration
  - websocket-configuration.md
tags:
  - websocket
layer: core
summary: "# WebSocket Configuration\r\n\r\n## Overview\r\n\r\nThe binG application uses WebSockets for real-time terminal streaming. The WebSocket server is **integrated into the main Next.js server** and runs on the **same port** as the HTTP server.\r\n\r\n## Port Configuration\r\n\r\n### Development\r\n- **HTTP Server**: Por"
anchors:
  - Overview
  - Port Configuration
  - Development
  - Production
  - Running the Application
  - Development Mode
  - Production Mode
  - Docker Configuration
  - Production Dockerfile
  - Development Dockerfile
  - WebSocket Connection
  - Environment Variables
  - Architecture
  - Troubleshooting
  - WebSocket Connection Fails
  - Terminal Not Streaming
  - Docker Deployment
  - Reverse Proxy Configuration
  - nginx Example
  - Apache Example
---
# WebSocket Configuration

## Overview

The binG application uses WebSockets for real-time terminal streaming. The WebSocket server is **integrated into the main Next.js server** and runs on the **same port** as the HTTP server.

## Port Configuration

### Development
- **HTTP Server**: Port 5555 (configured via `PORT` env var)
- **WebSocket Server**: Port 5555 (same as HTTP - uses upgrade)
- **Nullclaw**: Port 3001 (separate container)

### Production
- **HTTP Server**: Port 3000
- **WebSocket Server**: Port 3000 (same as HTTP - uses upgrade)

## Running the Application

### Development Mode

```bash
# Standard development (includes WebSocket support)
pnpm run dev

# Or explicitly with WebSocket (same thing)
pnpm run dev:ws
```

Both commands start the WebSocket server automatically - no need to run a separate process.

### Production Mode

```bash
# Build first
pnpm run build

# Start production server (includes WebSocket)
pnpm run start

# Or explicitly
pnpm run start:ws
```

## Docker Configuration

### Production Dockerfile

The production `Dockerfile`:
- Exposes port 3000 for both HTTP and WebSocket
- Uses `server.js` which includes WebSocket support
- WebSocket connections upgrade from HTTP at `ws://localhost:3000`

### Development Dockerfile

The `Dockerfile.dev`:
- Exposes port 5555 for HTTP/WebSocket
- Exposes port 3001 for Nullclaw
- Hot-reload enabled

## WebSocket Connection

Clients connect to the WebSocket server using:

```javascript
// Development
const ws = new WebSocket('ws://localhost:5555');

// Production
const ws = new WebSocket('ws://your-domain.com:3000');
```

The WebSocket server handles:
- Terminal session management
- Real-time output streaming
- Bidirectional input/output
- Keep-alive ping/pong (30s interval, 60s timeout)
- Automatic reconnection support

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP and WebSocket server port |
| `NODE_ENV` | production | Environment mode |

**Note**: `WEBSOCKET_PORT` is NOT used - WebSocket runs on the same port as HTTP.

## Architecture

```
┌─────────────────────────────────────┐
│         Next.js Server              │
│         (Port 3000/5555)            │
├─────────────────────────────────────┤
│  HTTP Routes    │   WebSocket       │
│  /api/*         │   Upgrade         │
│  /              │   /ws             │
│  Static Files   │   Terminal Stream │
└─────────────────────────────────────┘
```

Both HTTP and WebSocket share the same server instance, with WebSocket connections upgrading from HTTP requests.

## Troubleshooting

### WebSocket Connection Fails

1. Check that the server is running: `curl http://localhost:3000/api/health`
2. Verify firewall allows the port
3. Check server logs for WebSocket errors

### Terminal Not Streaming

1. Verify WebSocket connection in browser dev tools
2. Check for ping/pong messages (keep-alive)
3. Ensure session ID is valid

### Docker Deployment

Make sure to:
1. Expose the correct port (3000 for production)
2. Don't block WebSocket upgrade headers
3. Configure reverse proxy for WebSocket support if using nginx/Apache

## Reverse Proxy Configuration

### nginx Example

```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

### Apache Example

```apache
ProxyPass / ws://localhost:3000/
ProxyPassReverse / ws://localhost:3000/
```
