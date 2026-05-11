# 9Router VPS Deployment Guide

## Overview

This guide walks you through deploying the 9Router multi-tenant fork on a VPS with Docker. 9Router acts as an OAuth proxy and API router for multiple AI providers.

## Prerequisites

- A VPS with Ubuntu 20.04+ (DigitalOcean, Vultr, Linode, etc.)
- SSH access to the VPS
- Domain name (optional, for production)

## Step 1: Create a VPS

1. Create a new VPS (Ubuntu 20.04 LTS recommended)
2. Minimum specs: 1 CPU, 1GB RAM, 20GB SSD
3. Note the IP address

## Step 2: SSH into Your VPS

```bash
ssh root@your-vps-ip
```

## Step 3: Install Docker

```bash
# Update system
apt-get update -y
apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Enable and start Docker
systemctl enable docker
systemctl start docker

# Install Docker Compose plugin
apt-get install -y docker-compose-v2
```

## Step 4: Clone and Prepare 9Router

```bash
# Create application directory
mkdir -p /opt/9router
cd /opt/9router

# Clone your 9Router fork (replace with your actual fork URL)
git clone https://github.com/your-org/9router.git .

# Create the FORKS modifications
# Copy the migration and endpoint files from binG/web/lib/9router/FORKS/
mkdir -p src/lib/db/migrations
mkdir -p src/lib/oauth
mkdir -p src/app/api/oauth/[provider]/refresh

# Apply the modifications from the FORKS documentation:
# 1. 002-user-scoped-connections.js migration
# 2. 003-refresh-token-tracking.js migration  
# 3. connectionsRepo.js updates
# 4. refreshHandlers.js
# 5. refresh/route.js endpoint
```

## Step 5: Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit environment file
nano .env
```

Add your values:

```env
# REQUIRED: Generate with: openssl rand -hex 32
NINEROUTER_ADMIN_KEY=your-secret-admin-key

# Claude Code OAuth (from console.claude.ai)
CLAUDE_CODE_CLIENT_ID=your-client-id
CLAUDE_CODE_CLIENT_SECRET=your-client-secret

# GitHub OAuth (from github.com/settings/developers)
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret

# Add other providers as needed...
```

## Step 6: Create Dockerfile

Create `Dockerfile` in `/opt/9router/`:

```dockerfile
FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY src/ ./src/
COPY prisma/ ./prisma/
COPY .env.example .env

RUN mkdir -p /app/data

EXPOSE 20128

CMD [\"node\", \"src/index.js\"]
```

## Step 7: Create Docker Compose

Create `docker-compose.yml` in `/opt/9router/`:

```yaml
version: '3.8'

services:
  9router:
    build: .
    container_name: 9router
    restart: unless-stopped
    ports:
      - '20128:20128'
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:///app/data/9router.db
      - NINEROUTER_ADMIN_KEY=${NINEROUTER_ADMIN_KEY}
      - CLAUDE_CODE_CLIENT_ID=${CLAUDE_CODE_CLIENT_ID}
      - CLAUDE_CODE_CLIENT_SECRET=${CLAUDE_CODE_CLIENT_SECRET}
      - GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
      - GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET}
    volumes:
      - 9router-data:/app/data
      - 9router-uploads:/app/uploads
    healthcheck:
      test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:20128/api/health']
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  9router-data:
  9router-uploads:
```

## Step 8: Build and Start

```bash
# Build the Docker image
docker build -t 9router:latest .

# Start the container
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f
```

## Step 9: Verify Deployment

```bash
# Test health endpoint
curl http://localhost:20128/api/health

# Test providers endpoint
curl http://localhost:20128/api/providers

# Test refresh endpoint (after setup)
curl -X GET http://localhost:20128/api/oauth/claude-code/refresh
```

## Step 10: Configure Your binG App

Update your binG app's environment:

```env
NINEROUTER_BASE_URL=http://your-vps-ip:20128
NINEROUTER_ADMIN_KEY=your-secret-admin-key
```

## Managing the Service

### View Logs
```bash
docker compose logs -f
```

### Restart
```bash
docker compose restart
```

### Stop
```bash
docker compose down
```

### Update
```bash
cd /opt/9router
git pull
docker compose build
docker compose up -d
```

### Shell into Container
```bash
docker compose exec 9router sh
```

### Backup Database
```bash
docker compose exec 9router sh -c 'cp /app/data/9router.db /app/data/backup-$(date +%Y%m%d).db'
```

## SSL/HTTPS Setup (Recommended for Production)

### Option 1: Caddy (Automatic HTTPS)

Update `docker-compose.yml`:

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - 9router

  9router:
    # ... existing config
    expose:
      - '20128'

volumes:
  caddy-data:
  caddy-config:
```

Create `Caddyfile`:

```
your-domain.com {
    reverse_proxy 9router:20128
}
```

### Option 2: Nginx with Let's Encrypt

```bash
# Install nginx and certbot
apt-get install -y nginx certbot python3-certbot-nginx

# Get SSL certificate
certbot --nginx -d your-domain.com

# Configure nginx proxy...
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose logs

# Check if port is in use
netstat -tlnp | grep 20128

# Check Docker status
systemctl status docker
```

### Database Migration Issues

```bash
# Shell into container
docker compose exec 9router sh

# Run migrations manually
cd /app
node src/lib/db/migrate.js
```

### OAuth Not Working

1. Verify OAuth credentials in `.env`
2. Check redirect URI in OAuth app settings is `http://your-vps:20128/api/oauth/[provider]/callback`
3. Check logs for specific errors

### Token Refresh Not Working

1. Verify `003-refresh-token-tracking.js` migration was run
2. Check that connections have `refreshToken` stored
3. Verify `NINEROUTER_ADMIN_KEY` is set correctly

## Firewall Setup

```bash
# Allow SSH, HTTP, HTTPS
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp

# Allow 9Router port (if accessing directly)
ufw allow 20128/tcp

# Enable firewall
ufw enable
```

## Service Monitoring

### Create Systemd Service (Alternative to Docker Compose)

```ini
# /etc/systemd/system/9router.service
[Unit]
Description=9Router Multi-Tenant
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/9router
ExecStart=/usr/local/bin/docker compose up
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable 9router
systemctl start 9router
```

## Quick Reference

| Action | Command |
|--------|---------|
| Deploy | `docker compose up -d` |
| Restart | `docker compose restart` |
| Logs | `docker compose logs -f` |
| Shell | `docker compose exec 9router sh` |
| Backup DB | `docker compose exec 9router sh -c 'cp /app/data/9router.db /app/data/backup.db'` |
| Update | `git pull && docker compose build && docker compose up -d` |

## Next Steps

1. Configure OAuth provider apps with redirect URI pointing to your VPS
2. Test OAuth flow end-to-end
3. Configure your binG app to use the 9Router endpoint
4. Set up monitoring and backups
5. Consider adding SSL/TLS with Caddy or nginx