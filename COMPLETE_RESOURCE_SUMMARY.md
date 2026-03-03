# 📊 Complete Resource Requirements - binG Full Stack

**Last Updated:** 2026-03-02  
**Includes:** Docker Compose + Microsandbox (port 5555) + OpenCode CLI

---

## 🎯 Quick Reference

### **Production (All Services)**
- **CPU:** 12.5 cores total
- **Memory:** 11.75 GB total
- **Disk:** 172 GB total
- **Services:** 7 (App, MinIO, Prometheus, Grafana, Node Exporter, Microsandbox, OpenCode CLI)

### **Development (All Services)**
- **CPU:** 7.5 cores total
- **Memory:** 6.5 GB total
- **Disk:** 83 GB total
- **Services:** 7 (App-dev, MinIO, Prometheus, Grafana, Redis, Microsandbox, OpenCode CLI)

### **Minimal (Development)**
- **CPU:** 3.5 cores total
- **Memory:** 3.5 GB total
- **Disk:** 51 GB total
- **Services:** 5 (App, MinIO, Microsandbox, OpenCode CLI)

---

## 📋 Complete Service Breakdown

### **Production Configuration**

| Service | CPU Limit | Memory Limit | CPU Request | Memory Request | Disk | Port(s) |
|---------|-----------|--------------|-------------|----------------|------|---------|
| **binG App** | 4 cores | 4 GB | 2 cores | 2 GB | 10 GB | 3000, 8080 |
| **MinIO** | 2 cores | 2 GB | 1 core | 1 GB | 100 GB* | 9000, 9001 |
| **Prometheus** | 1 core | 1 GB | 0.5 core | 512 MB | 50 GB* | 9090 |
| **Grafana** | 1 core | 512 MB | 0.5 core | 256 MB | 5 GB | 3001 |
| **Node Exporter** | 0.5 core | 256 MB | 0.25 core | 128 MB | 1 GB | 9100 |
| **Microsandbox** | 2 cores | 2 GB | 1 core | 1 GB | 5 GB | 5555 |
| **OpenCode CLI** | 1 core | 512 MB | 0.5 core | 256 MB | 1 GB | - |
| **TOTAL** | **12.5 cores** | **11.75 GB** | **5.75 cores** | **5.1 GB** | **172 GB** | - |

\* Variable based on data retention

---

### **Development Configuration**

| Service | CPU Limit | Memory Limit | CPU Request | Memory Request | Disk | Port(s) |
|---------|-----------|--------------|-------------|----------------|------|---------|
| **binG App (dev)** | 2 cores | 2 GB | 1 core | 1 GB | 5 GB | 3000, 8080 |
| **MinIO** | 1 core | 1 GB | 0.5 core | 512 MB | 50 GB* | 9000, 9001 |
| **Prometheus** | 0.5 core | 512 MB | 0.25 core | 256 MB | 20 GB* | 9090 |
| **Grafana** | 0.5 core | 256 MB | 0.25 core | 128 MB | 2 GB | 3001 |
| **Redis** | 0.5 core | 256 MB | 0.25 core | 128 MB | 1 GB | 6379 |
| **Microsandbox** | 1 core | 1 GB | 0.5 core | 512 MB | 3 GB | 5555 |
| **OpenCode CLI** | 1 core | 512 MB | 0.5 core | 256 MB | 1 GB | - |
| **TOTAL** | **7.5 cores** | **6.5 GB** | **3.75 cores** | **3.2 GB** | **83 GB** | - |

\* Variable based on data retention

---

## 🔧 Microsandbox Details (Port 5555)

### **Configuration**

```yaml
microsandbox:
  image: node:20-alpine
  ports:
    - "5555:5555"  # Microsandbox daemon API
  environment:
    - NODE_ENV=production
    - MSB_PORT=5555
    - MSB_MAX_INSTANCES=100
    - MSB_INSTANCE_TTL_HOURS=2
    - WORKSPACE_DIR=/workspace
  volumes:
    - microsandbox-workspaces:/workspace
    - /var/run/docker.sock:/var/run/docker.sock  # Required for sandbox isolation
  resources:
    limits:
      cpus: '2'
      memory: 2G
```

### **Resource Usage Per Sandbox Instance**

| Metric | Value |
|--------|-------|
| **Memory per instance** | 50-100 MB |
| **CPU per instance** | 0.1-0.2 cores |
| **Max instances** | 100 |
| **TTL** | 2 hours (auto-cleanup) |
| **Disk per instance** | 50-100 MB |

### **Accessing Microsandbox**

```bash
# Health check
curl http://localhost:5555/health

# API endpoint
curl http://localhost:5555/api/v1/sandbox/create

# Via binG App
# Set SANDBOX_PROVIDER=microsandbox in .env
```

---

## 🖥️ OpenCode CLI Integration

### **Resource Requirements**

| Component | CPU | Memory | Disk |
|-----------|-----|--------|------|
| **CLI Process** | 1 core | 512 MB | 1 GB |
| **LLM API Calls** | Network only | - | - |
| **Total** | **1 core** | **512 MB** | **1 GB** |

### **Installation**

```bash
# Install globally
npm install -g opencode-cli

# Or use via npx
npx opencode-cli
```

### **Configuration**

```bash
# .env file
OPENCODE_API_KEY=your-api-key
OPENCODE_MODEL=your-preferred-model
OPENCODE_MAX_TOKENS=4096
```

---

## 🚀 Quick Start Commands

### **Production**

```bash
# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View resources
docker stats

# Access services
# - App: http://localhost:3000
# - Microsandbox: http://localhost:5555
# - MinIO: http://localhost:9001
# - Prometheus: http://localhost:9090
# - Grafana: http://localhost:3001
```

### **Development**

```bash
# Start all services
docker-compose -f docker-compose.dev.yml up -d

# Start with Microsandbox only
docker-compose -f docker-compose.dev.yml up -d app microsandbox

# View logs
docker-compose -f docker-compose.dev.yml logs -f microsandbox
```

### **Minimal (Resource-Constrained)**

```bash
# Create minimal compose file
cat > docker-compose.minimal.yml << 'EOF'
version: '3.8'
services:
  app:
    image: bing-app:latest
    ports:
      - "3000:3000"
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
  
  microsandbox:
    image: node:20-alpine
    ports:
      - "5555:5555"
    command: msb server start --dev --port 5555
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
EOF

# Start minimal services
docker-compose -f docker-compose.minimal.yml up -d
```

---

## 📈 Monitoring Resource Usage

### **Docker Stats**

```bash
# Real-time all containers
docker stats

# Specific service
docker stats bing-microsandbox

# Format output
docker stats --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
```

### **Prometheus Queries**

```promql
# Microsandbox memory
container_memory_usage_bytes{container="bing-microsandbox"}

# App CPU usage
rate(container_cpu_usage_seconds_total{container="bing-app"}[5m])

# Total memory available
node_memory_MemAvailable_bytes

# Disk usage
node_filesystem_avail_bytes{mountpoint="/"}
```

### **Grafana Dashboards**

Access at http://localhost:3001

**Pre-configured Dashboards:**
- Node.js Application Metrics
- Docker Container Metrics
- System Overview
- Microsandbox Instance Tracking

---

## ⚠️ Troubleshooting

### **Out of Memory**

**Symptoms:**
- Containers restart with OOMKilled
- `docker stats` shows >90% memory

**Solutions:**
```bash
# 1. Increase memory in docker-compose.yml
# Edit deploy.resources.limits.memory

# 2. Reduce Microsandbox instances
# Edit MSB_MAX_INSTANCES=50 (default: 100)

# 3. Enable swap on host
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### **Microsandbox Not Starting**

**Symptoms:**
- Port 5555 not accessible
- Health check fails

**Solutions:**
```bash
# 1. Check Docker socket access
docker-compose exec microsandbox ls -la /var/run/docker.sock

# 2. Check logs
docker-compose logs microsandbox

# 3. Restart daemon
docker-compose restart microsandbox

# 4. Manual start
docker-compose exec microsandbox msb server start --dev --port 5555
```

### **High CPU Usage**

**Symptoms:**
- Slow response times
- `docker stats` shows >80% CPU

**Solutions:**
```bash
# 1. Scale horizontally
docker-compose up -d --scale app=2

# 2. Reduce sandbox creation rate
# Edit MAX_CONCURRENT_SANDBOXES in .env

# 3. Check for runaway processes
docker-compose exec app top
```

---

## 💰 Cloud Hosting Costs

### **DigitalOcean (Recommended for Dev)**

| Droplet | vCPU | RAM | Storage | Monthly |
|---------|------|-----|---------|---------|
| **Basic** | 2 | 4 GB | 80 GB | $24/mo |
| **Basic** | 4 | 8 GB | 160 GB | $48/mo ⭐ |
| **Premium** | 4 | 8 GB | 160 GB | $60/mo |

**Recommended:** Basic 4vCPU/8GB - **$48/month**

### **AWS (Production)**

| Instance | vCPU | RAM | Storage | Monthly |
|----------|------|-----|---------|---------|
| **t3.large** | 2 | 8 GB | EBS | $60/mo |
| **t3.xlarge** | 4 | 16 GB | EBS | $120/mo ⭐ |
| **t3.2xlarge** | 8 | 32 GB | EBS | $240/mo |

**Recommended:** t3.xlarge - **$120/month**

### **Google Cloud**

| Instance | vCPU | RAM | Storage | Monthly |
|----------|------|-----|---------|---------|
| **e2-standard-2** | 2 | 8 GB | 50 GB | $50/mo |
| **e2-standard-4** | 4 | 16 GB | 100 GB | $100/mo ⭐ |
| **e2-standard-8** | 8 | 32 GB | 200 GB | $200/mo |

**Recommended:** e2-standard-4 - **$100/month**

---

## 📊 Resource Optimization Tips

### **Reduce Memory Usage**

1. **Disable unused services:**
   ```yaml
   # Comment out in docker-compose.yml
   # grafana:
   # prometheus:
   # node-exporter:
   ```

2. **Reduce Microsandbox instances:**
   ```bash
   MSB_MAX_INSTANCES=50  # Default: 100
   ```

3. **Use local storage instead of MinIO:**
   ```bash
   STORAGE_TYPE=local
   ```

### **Reduce CPU Usage**

1. **Scale down Prometheus retention:**
   ```yaml
   command:
     - '--storage.tsdb.retention.time=7d'  # Default: 15d
   ```

2. **Reduce Grafana refresh rate:**
   ```yaml
   environment:
     - GF_REFRESH_INTERVAL=1m  # Default: 30s
   ```

3. **Limit concurrent sandboxes:**
   ```bash
   MAX_CONCURRENT_SANDBOXES=5  # Default: 10
   ```

### **Reduce Disk Usage**

1. **Clean old snapshots:**
   ```bash
   docker-compose exec app npm run cleanup-snapshots
   ```

2. **Reduce Prometheus retention:**
   ```yaml
   command:
     - '--storage.tsdb.retention.time=3d'
   ```

3. **Use external S3 for snapshots:**
   ```bash
   STORAGE_TYPE=s3
   S3_BUCKET=your-bucket
   ```

---

## ✅ Production Checklist

- [ ] Set strong JWT_SECRET_KEY
- [ ] Change MinIO credentials
- [ ] Change Grafana admin password
- [ ] Enable HTTPS (reverse proxy)
- [ ] Configure backup strategy
- [ ] Set up alerting (Prometheus Alertmanager)
- [ ] Configure resource limits
- [ ] Enable log aggregation
- [ ] Test disaster recovery
- [ ] Document runbook
- [ ] Monitor Microsandbox instances
- [ ] Configure auto-scaling

---

## 📞 Support

For issues or questions:
1. Check logs: `docker-compose logs -f`
2. Review metrics: `http://localhost:9090`
3. Check documentation: `DEPLOYMENT.md`, `RESOURCE_REQUIREMENTS.md`
4. Review Microsandbox docs: `lib/sandbox/microsandbox-daemon.ts`

---

**Version:** 1.0  
**Last Updated:** 2026-03-02  
**Maintained By:** binG Team
