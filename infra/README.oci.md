# binG Backend — OCI Oracle Cloud Deployment

Deploy the full backend stack (Hono API server, PostgreSQL, Redis, agent services,
sandboxes, MinIO) on an Oracle Cloud Infrastructure (OCI) Always Free instance.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   OCI Instance                       │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │  Docker   │  │   OCI    │  │   Cloudflare       │  │
│  │  Compose  │  │  Fn Svc  │  │   Edge Gateway     │  │
│  │  (all     │  │  (light  │  │   (external)       │  │
│  │   svcs)   │  │  tasks)  │  │                    │  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
│       │                                               │
│       ▼                                               │
│  ┌─────────┐  ┌──────┐  ┌──────┐  ┌──────────────┐  │
│  │Postgres │  │Redis │  │MinIO │  │Agent Services │  │
│  │ 16-alp. │  │7-alp.│  │latest│  │Gateway+Worker │  │
│  └─────────┘  └──────┘  └──────┘  └──────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Prerequisites

1. **OCI Always Free Instance** (Ampere A1, 4 OCPU, 24GB RAM, 200GB storage)
2. **Ubuntu 22.04/24.04 LTS** on the instance
3. **Docker & Docker Compose** installed
4. **Cloudflare Edge Gateway** deployed (see `workers/README.md`)
5. **Domain** pointed to the OCI instance (optional, for production)

## Step 1: Provision OCI Instance

Create an Always Free VM in the OCI Console:
- **Shape**: VM.Standard.A1.Flex (4 OCPU, 24GB RAM)
- **Image**: Ubuntu 24.04 LTS
- **Storage**: Boot volume 200GB (free tier)
- **Network**: Assign public IP, open ports 80, 443, 22

After creation, SSH in:

```bash
ssh -i ~/.ssh/oci-bing ubuntu@<instance-ip>
```

## Step 2: Install Docker

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose
sudo apt install -y docker-compose-plugin

# Verify
docker --version
docker compose version
```

## Step 3: Clone & Configure

```bash
# Clone the repository
git clone https://github.com/yourorg/binG.git /home/ubuntu/bing
cd /home/ubuntu/bing

# Set up environment
cp infra/.env.oci.example infra/.env
nano infra/.env  # Fill in all values
```

Required env vars to set:
- `JWT_SECRET` — `openssl rand -base64 32`
- `ENCRYPTION_KEY` — `openssl rand -hex 32`
- `BLAXEL_SECRET_ENCRYPTION_KEY` — `openssl rand -hex 32`
- `FRONTEND_URL` — your Vercel deployment URL
- LLM API keys (at least one: OpenAI, Anthropic, etc.)
- Sandbox provider API keys

## Step 4: Deploy with Docker Compose

The OCI deployment uses **two compose files**:
- `docker-compose.yml` — Core infrastructure: PostgreSQL, Redis, MinIO, Prometheus/Grafana, agent services, Nullclaw, Microsandbox
- `docker-compose.backend.yml` — **Hono backend API server** (handles `/api/chat` on port 3001)

> ⚠️ Both compose files are **required** — without `docker-compose.backend.yml`, the backend won't start.

```bash
cd /home/ubuntu/bing/infra

# Start all services including the dedicated backend
docker compose \
  -f docker-compose.yml \
  -f docker-compose.backend.yml \
  --env-file .env \
  up -d

# Check status
docker compose ps

# View logs
docker compose logs -f --tail=50
```

> **Note**: The `backend` service is a standalone Hono API server built from `backend/Dockerfile`.
> It serves `/api/chat` on port 3001. This is separate from the `app` service (Next.js frontend on port 3000).

### Storage: MinIO vs Cloudflare R2

The `docker-compose.yml` includes **MinIO** for local S3-compatible storage. If you plan to use
**Cloudflare R2** instead (via the edge gateway), comment out MinIO to save resources:

```bash
# In docker-compose.yml, comment out the entire minio service block
# Then deploy:
docker compose \
  -f docker-compose.yml \
  -f docker-compose.backend.yml \
  --env-file .env \
  up -d
```

### Service Ports

| Service | Internal Port | Exposed Port | Notes |
|---------|---------------|-------------|-------|
| Hono Backend | 3001 | 3001 | Main API server |
| Agent Gateway | 3002 | 3002 | Session orchestration |
| Agent Worker | 3003 | 3003 | Tool execution (x3 replicas) |
| Nullclaw | 3000 | 3001 | Non-coding agency |
| Microsandbox | 5555 | 5555 | Docker sandbox provider |
| PostgreSQL | 5432 | 5432 | Persistent storage |
| Redis | 6379 | 6379 | Cache & queue |
| MinIO API | 9000 | 9000 | S3-compatible storage |
| MinIO Console | 9001 | 9001 | Admin UI |
| Prometheus | 9090 | 9090 | Metrics |
| Grafana | 3000 | 3001 (mapped) | Dashboards |

## Step 5: Configure Reverse Proxy (9router or Nginx)

Since the Cloudflare Edge Gateway handles routing at the edge, the OCI instance
just needs a simple reverse proxy to route `/api/chat` to port 3001.

### Using Nginx

```bash
sudo apt install -y nginx

# Create nginx config
sudo tee /etc/nginx/sites-available/bing << 'EOF'
server {
    listen 80;
    server_name _;

    # API endpoints → Hono backend
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    # Health check
    location = /health {
        proxy_pass http://localhost:3001;
    }

    # Default: health check
    location / {
        return 200 '{"status":"healthy","service":"oci-backend"}';
        add_header Content-Type application/json;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/bing /etc/nginx/sites-enabled/bing
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

## Step 6: Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## Step 7: Health Check

```bash
# Test locally
curl http://localhost:3001/health
# → {"status":"ok","service":"bing-backend"}

# Test via nginx
curl http://localhost/api/health
# → {"status":"ok","uptime":...}

# Test via Cloudflare (if domain is configured)
curl https://api.bing.dev/api/health
# → {"status":"ok","uptime":...}
```

## OCI CLI Helper (Optional)

For lightweight tasks, install the OCI CLI and use OCI Functions:

```bash
# Install OCI CLI
curl -L -O https://raw.githubusercontent.com/oracle/oci-cli/main/scripts/install/install.sh
bash install.sh

# Configure
oci setup config
# → Enter your OCI user OCID, tenancy OCID, region, and API key
```

## Maintenance

### Backup Database

```bash
docker exec bing-postgres pg_dump -U bing bing > backup_$(date +%Y%m%d).sql
```

### View Logs

```bash
# All services
docker compose -f infra/docker-compose.yml logs -f

# Specific service
docker compose -f infra/docker-compose.yml logs -f app

# Since last hour
docker compose -f infra/docker-compose.yml logs --since=1h
```

### Update

```bash
cd /home/ubuntu/bing
git pull
cd infra
docker compose down
docker compose --env-file .env up -d --build
```

### Monitoring

- **Grafana**: http://<instance-ip>:3001 (admin/admin_change_me)
- **Prometheus**: http://<instance-ip>:9090
- **MinIO Console**: http://<instance-ip>:9001

## Troubleshooting

- **Container won't start**: Check logs with `docker compose logs <service>`
- **Out of memory**: OCI A1 has 24GB RAM. Reduce `WORKER_REPLICAS` or lower `MAX_CONCURRENT_JOBS`
- **Disk full**: OCI free tier has 200GB. Run `docker system prune -af` periodically
- **Port conflict**: Change `NULLCLAW_EXTERNAL_PORT` in `.env` if ports clash
- **9router integration**: If using 9router, configure routes to forward `/api/*` to port 3001
