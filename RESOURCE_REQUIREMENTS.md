# binG Full Application - Docker Resource Requirements

## Complete Resource Summary

### **Production Deployment (All Services)**

| Service | CPU Limit | Memory Limit | CPU Request | Memory Request | Disk |
|---------|-----------|--------------|-------------|----------------|------|
| **binG App** | 4 cores | 4 GB | 2 cores | 2 GB | 10 GB |
| **MinIO** | 2 cores | 2 GB | 1 core | 1 GB | 100 GB* |
| **Prometheus** | 1 core | 1 GB | 0.5 core | 512 MB | 50 GB* |
| **Grafana** | 1 core | 512 MB | 0.5 core | 256 MB | 5 GB |
| **Node Exporter** | 0.5 core | 256 MB | 0.25 core | 128 MB | 1 GB |
| **Microsandbox** | 2 cores | 2 GB | 1 core | 1 GB | 5 GB |
| **TOTAL** | **10.5 cores** | **9.75 GB** | **5.25 cores** | **4.9 GB** | **171 GB** |

\* Variable based on data retention

---

### **Development Deployment (All Services)**

| Service | CPU Limit | Memory Limit | CPU Request | Memory Request | Disk |
|---------|-----------|--------------|-------------|----------------|------|
| **binG App (dev)** | 2 cores | 2 GB | 1 core | 1 GB | 5 GB |
| **MinIO** | 1 core | 1 GB | 0.5 core | 512 MB | 50 GB* |
| **Prometheus** | 0.5 core | 512 MB | 0.25 core | 256 MB | 20 GB* |
| **Grafana** | 0.5 core | 256 MB | 0.25 core | 128 MB | 2 GB |
| **Redis** | 0.5 core | 256 MB | 0.25 core | 128 MB | 1 GB |
| **Microsandbox** | 1 core | 1 GB | 0.5 core | 512 MB | 3 GB |
| **TOTAL** | **5.5 cores** | **5 GB** | **2.75 cores** | **2.5 GB** | **81 GB** |

\* Variable based on data retention

---

## Service Details

### **binG App (Next.js + WebSocket)**

**Purpose:** Main application with API, WebSocket terminal, and backend services

**Ports:**
- `3000` - HTTP API
- `8080` - WebSocket terminal

**Environment Variables:**
```bash
NODE_ENV=production
PORT=3000
WEBSOCKET_PORT=8080
JWT_SECRET_KEY=<your-secret>
RUNTIME_TYPE=process  # or 'firecracker'
STORAGE_TYPE=local    # or 's3'
```

**Resource Notes:**
- Scales horizontally (add more replicas)
- Memory increases with concurrent users
- CPU spikes during sandbox creation

---

### **MinIO (S3-Compatible Storage)**

**Purpose:** Object storage for snapshots and files

**Ports:**
- `9000` - S3 API
- `9001` - Web Console

**Credentials:**
- Username: `minioadmin` (change in production!)
- Password: `minioadmin` (change in production!)

**Resource Notes:**
- Disk space grows with snapshots
- Recommend 100GB+ for production
- Enable versioning for backup

---

### **Prometheus (Metrics)**

**Purpose:** Metrics collection and storage

**Ports:**
- `9090` - Web UI and API

**Resource Notes:**
- 15-day retention by default
- Adjust `--storage.tsdb.retention.time` for longer/shorter
- Memory usage correlates with metric cardinality

---

### **Grafana (Dashboards)**

**Purpose:** Metrics visualization

**Ports:**
- `3001` - Web UI

**Credentials:**
- Username: `admin`
- Password: `admin` (change in production!)

**Resource Notes:**
- Low resource usage
- Dashboards provisioned automatically

---

### **Node Exporter (System Metrics)**

**Purpose:** Host system metrics

**Ports:**
- `9100` - Metrics endpoint

**Resource Notes:**
- Minimal resource usage
- Requires host filesystem access

---

### **Microsandbox (Local Sandbox Provider)**

**Purpose:** Local sandbox execution on port 5555

**Ports:**
- `5555` - Microsandbox daemon API

**Environment Variables:**
```bash
MICROSANDBOX_AUTO_START=true
MICROSANDBOX_START_COMMAND=msb server start --dev
MICROSANDBOX_START_TIMEOUT_MS=20000
MICROSANDBOX_ALLOW_LOCAL_FALLBACK=true
```

**Resource Notes:**
- Each sandbox instance: ~50-100 MB RAM
- Max 100 concurrent instances
- TTL: 2 hours (auto-cleanup)
- CPU spikes during sandbox creation

**Installation:**
```bash
# Install microsandbox CLI
npm install -g microsandbox

# Start daemon
msb server start --dev

# Or via Docker Compose (included)
docker-compose up -d microsandbox
```

---

## OpenCode CLI Integration

### **Resource Requirements**

When using OpenCode CLI alongside Docker:

| Component | CPU | Memory | Disk |
|-----------|-----|--------|------|
| **OpenCode CLI** | 1 core | 512 MB | 1 GB |
| **LLM API Calls** | - | - | - |
| **Total Additional** | **1 core** | **512 MB** | **1 GB** |

### **Combined Total (Docker + OpenCode CLI)**

| Environment | CPU | Memory | Disk |
|-------------|-----|--------|------|
| **Production** | **11.5 cores** | **10.25 GB** | **172 GB** |
| **Development** | **6.5 cores** | **5.5 GB** | **82 GB** |

---

## Minimal Configuration (Development)

For resource-constrained development:

```yaml
# docker-compose.minimal.yml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
  
  minio:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
  
  prometheus:
    deploy:
      resources:
        limits:
          cpus: '0.25'
          memory: 256M
  
  grafana:
    deploy:
      resources:
        limits:
          cpus: '0.25'
          memory: 128M
  
  microsandbox:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
```

**Minimal Total:**
- **CPU:** 2.5 cores
- **Memory:** 2.5 GB
- **Disk:** 50 GB

---

## Scaling Recommendations

### **Small Team (5-10 users)**
- Use **Development** configuration
- Disable Prometheus/Grafana if not needed
- Enable MinIO only if using S3 storage

### **Medium Team (10-50 users)**
- Use **Production** configuration
- Enable all monitoring services
- Consider horizontal scaling for app (2-3 replicas)

### **Large Team (50+ users)**
- Scale binG App to 3-5 replicas
- Increase Prometheus retention to 30 days
- Add dedicated load balancer
- Consider managed MinIO/S3

---

## Monitoring Resource Usage

### **Check Container Resources**

```bash
# Real-time resource usage
docker stats

# Specific service
docker stats bing-app

# All services with format
docker stats --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
```

### **Check Docker Compose Resources**

```bash
# View resource limits
docker-compose config

# View running containers
docker-compose ps
```

### **Prometheus Queries**

```promql
# Container memory usage
container_memory_usage_bytes{container="bing-app"}

# Container CPU usage
rate(container_cpu_usage_seconds_total{container="bing-app"}[5m])

# Available memory
node_memory_MemAvailable_bytes
```

---

## Troubleshooting

### **Out of Memory (OOM)**

**Symptoms:**
- Containers restart unexpectedly
- `docker stats` shows >90% memory usage

**Solutions:**
1. Increase memory limits in `docker-compose.yml`
2. Reduce concurrent sandbox instances
3. Enable swap on host
4. Scale horizontally (more replicas, less memory each)

### **High CPU Usage**

**Symptoms:**
- Slow response times
- `docker stats` shows >80% CPU

**Solutions:**
1. Increase CPU limits
2. Reduce sandbox creation rate
3. Enable request throttling
4. Scale horizontally

### **Disk Space Full**

**Symptoms:**
- Cannot create new snapshots
- Prometheus stops scraping

**Solutions:**
1. Increase volume size
2. Reduce Prometheus retention
3. Enable snapshot cleanup
4. Move to S3 storage

---

## Cost Estimates (Cloud Deployment)

### **AWS (us-east-1)**

| Instance Type | vCPU | Memory | Monthly Cost |
|---------------|------|--------|--------------|
| **t3.large** | 2 | 8 GB | $60/month |
| **t3.xlarge** | 4 | 16 GB | $120/month |
| **t3.2xlarge** | 8 | 32 GB | $240/month |

**Recommended:** t3.xlarge (4 vCPU, 16 GB) - **$120/month**

### **DigitalOcean**

| Droplet | vCPU | Memory | Monthly Cost |
|---------|------|--------|--------------|
| **Basic** | 2 | 4 GB | $24/month |
| **Basic** | 4 | 8 GB | $48/month |
| **Premium** | 4 | 8 GB | $60/month |

**Recommended:** Basic 4vCPU/8GB - **$48/month**

### **Google Cloud**

| Instance Type | vCPU | Memory | Monthly Cost |
|---------------|------|--------|--------------|
| **e2-medium** | 2 | 4 GB | $35/month |
| **e2-standard-2** | 2 | 8 GB | $50/month |
| **e2-standard-4** | 4 | 16 GB | $100/month |

**Recommended:** e2-standard-4 - **$100/month**

---

## Quick Reference

### **Start All Services**
```bash
docker-compose up -d
```

### **Start Specific Service**
```bash
docker-compose up -d app microsandbox
```

### **View Resource Usage**
```bash
docker stats
```

### **Check Service Health**
```bash
docker-compose ps
```

### **View Logs**
```bash
docker-compose logs -f app
docker-compose logs -f microsandbox
```

### **Stop All Services**
```bash
docker-compose down
```

### **Cleanup Volumes**
```bash
docker-compose down -v
```

---

**Last Updated:** 2026-03-02  
**Version:** 1.0  
**Contact:** See DEPLOYMENT.md for support
