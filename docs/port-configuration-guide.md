---
id: port-configuration-guide
title: Port Configuration Guide
aliases:
  - PORT_CONFIGURATION
  - PORT_CONFIGURATION.md
  - port-configuration-guide
  - port-configuration-guide.md
tags:
  - guide
layer: core
summary: "# Port Configuration Guide\r\n\r\n## Overview\r\n\r\nbinG uses **two separate ports** for different purposes:\r\n\r\n| Port | Default | Protocol | Purpose |\r\n|------|---------|----------|---------|\r\n| **HTTP** | 3000 | HTTP/HTTPS | Next.js web application, API routes |\r\n| **WebSocket** | 8080 | WebSocket | Real"
anchors:
  - Overview
  - Why Different Ports?
  - Next.js HTTP Server (Port 3000)
  - WebSocket Server (Port 8080)
  - Configuration
  - Environment Variables
  - Changing Ports
  - Checking Port Availability
  - Linux/Mac
  - Windows
  - Accessing Services
  - Development
  - Production
  - Troubleshooting
  - '"Port 8080 is already in use"'
  - '"Permission denied for port"'
  - WebSocket Connection Fails
  - Production Deployment
  - Docker Configuration
  - Nginx Reverse Proxy
  - Architecture Diagram
  - Quick Reference
---
# Port Configuration Guide

## Overview

binG uses **two separate ports** for different purposes:

| Port | Default | Protocol | Purpose |
|------|---------|----------|---------|
| **HTTP** | 3000 | HTTP/HTTPS | Next.js web application, API routes |
| **WebSocket** | 8080 | WebSocket | Real-time terminal streaming |

---

## Why Different Ports?

### Next.js HTTP Server (Port 3000)
- Handles **regular HTTP requests** (GET, POST, PUT, DELETE)
- Serves React components
- Processes API routes (`/api/*`)
- Stateles request/response pattern

### WebSocket Server (Port 8080)
- Handles **bidirectional WebSocket connections**
- Real-time terminal I/O streaming
- Persistent connection (stays open)
- Lower latency than HTTP polling

**They cannot share the same port** because:
1. Different protocols (HTTP vs WebSocket)
2. Different connection patterns (stateless vs persistent)
3. Different server implementations (Next.js vs `ws` library)

---

## Configuration

### Environment Variables

```bash
# .env.local or .env

# Next.js HTTP Server
PORT=3000

# WebSocket Server (MUST be different from PORT)
WEBSOCKET_PORT=8080
```

### Changing Ports

If you need to change ports (e.g., port conflict):

```bash
# .env.local
PORT=3001          # Change Next.js to 3001
WEBSOCKET_PORT=8081  # Change WebSocket to 8081
```

**Important:** Both ports must be:
- Different from each other
- Not in use by other applications
- Allowed through firewall (for production)

---

## Checking Port Availability

### Linux/Mac
```bash
# Check if port 3000 is in use
lsof -i :3000

# Check if port 8080 is in use
lsof -i :8080

# Kill process using port
lsof -ti :8080 | xargs kill -9
```

### Windows
```cmd
# Check if port is in use
netstat -ano | findstr :3000
netstat -ano | findstr :8080

# Kill process using port (replace PID)
taskkill /PID <PID> /F
```

---

## Accessing Services

### Development

| Service | URL | Port |
|---------|-----|------|
| Web App | http://localhost:3000 | 3000 |
| API Routes | http://localhost:3000/api/* | 3000 |
| WebSocket Terminal | ws://localhost:8080/sandboxes/{id}/terminal | 8080 |
| Backend Health | http://localhost:3000/api/backend/health | 3000 |
| Metrics | http://localhost:3000/api/metrics | 3000 |

### Production

Replace `localhost` with your server domain/IP:

| Service | URL |
|---------|-----|
| Web App | https://your-domain.com |
| WebSocket Terminal | wss://your-domain.com:8080/sandboxes/{id}/terminal |

**Note:** For production, consider using a reverse proxy (Nginx, Caddy) to handle WebSocket on standard ports (443 for WSS).

---

## Troubleshooting

### "Port 8080 is already in use"

**Error Message:**
```
Error: Port 8080 is already in use. Try: 1) lsof -i :8080 && kill -9 <PID>, or 2) Set WEBSOCKET_PORT to a different value
```

**Solution:**
1. Check what's using port 8080:
   ```bash
   lsof -i :8080
   ```
2. Kill the process or change `WEBSOCKET_PORT` in `.env.local`

### "Permission denied for port"

**Error Message:**
```
Error: Permission denied for port 8080. Try using a port > 1024 or run with sudo
```

**Solution:**
- Ports below 1024 require root/admin privileges
- Use a port above 1024 (e.g., 8080, 8081, 9000)
- Or run with `sudo` (not recommended for production)

### WebSocket Connection Fails

**Symptoms:**
- Terminal doesn't connect
- Console shows WebSocket connection errors

**Check:**
1. WebSocket server is running:
   ```bash
   lsof -i :8080
   ```
2. Firewall allows port 8080:
   ```bash
   # Linux
   sudo ufw allow 8080/tcp
   
   # Windows Firewall
   netsh advfirewall firewall add rule name="WebSocket" dir=in action=allow protocol=TCP localport=8080
   ```
3. Frontend is connecting to correct URL:
   ```typescript
   const ws = new WebSocket(`ws://localhost:${process.env.WEBSOCKET_PORT || 8080}/sandboxes/${id}/terminal`);
   ```

---

## Production Deployment

### Docker Configuration

```yaml
# docker-compose.yml
services:
  app:
    image: bing-app:latest
    ports:
      - "3000:3000"  # HTTP
      - "8080:8080"  # WebSocket
    environment:
      - PORT=3000
      - WEBSOCKET_PORT=8080
```

### Nginx Reverse Proxy

For production, use Nginx to proxy both HTTP and WebSocket:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    # HTTP/HTTPS proxy
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket proxy
    location /sandboxes/*/terminal {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;  # Long timeout for persistent connection
    }
}
```

This allows both services to be accessed on standard HTTPS port (443).

---

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│           Client Browser                │
└──────────────┬──────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
   HTTP (3000)   WebSocket (8080)
        │             │
        ▼             ▼
┌─────────────────────────────────────────┐
│         binG Server                     │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │  Next.js    │  │  WebSocket      │  │
│  │  HTTP       │  │  Terminal       │  │
│  │  Server     │  │  Server         │  │
│  │  (Port 3000)│  │  (Port 8080)    │  │
│  └─────────────┘  └─────────────────┘  │
└─────────────────────────────────────────┘
```

---

## Quick Reference

```bash
# Start development server
npm run dev:ws

# Check what's running
lsof -i :3000  # Next.js
lsof -i :8080  # WebSocket

# Change ports (in .env.local)
PORT=3001
WEBSOCKET_PORT=8081

# Test WebSocket connection
wscat -c ws://localhost:8080/sandboxes/test123/terminal
```

---

**Last Updated:** March 3, 2026  
**Version:** 1.0
