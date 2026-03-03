# binG Backend - Docker Deployment Guide

## Quick Start

### Production Deployment

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your production settings

# 2. Start all services
docker-compose up -d

# 3. Check status
docker-compose ps

# 4. View logs
docker-compose logs -f app

# 5. Stop all services
docker-compose down
```

### Development Deployment

```bash
# 1. Start development environment
docker-compose -f docker-compose.dev.yml up -d

# 2. Access services
# - App: http://localhost:3000
# - MinIO Console: http://localhost:9001
# - Prometheus: http://localhost:9090
# - Grafana: http://localhost:3001

# 3. Stop development environment
docker-compose -f docker-compose.dev.yml down
```

---

## Services

| Service | Port | Description |
|---------|------|-------------|
| **binG App** | 3000 | Next.js application + WebSocket terminal |
| **MinIO** | 9000/9001 | S3-compatible object storage |
| **Prometheus** | 9090 | Metrics collection |
| **Grafana** | 3001 | Metrics visualization |
| **Node Exporter** | 9100 | System metrics |
| **Redis** (dev) | 6379 | Session cache |

---

## Environment Variables

### Required

```bash
# Authentication
JWT_SECRET_KEY=your-secret-key-here

# MinIO (optional - uses local storage by default)
STORAGE_TYPE=s3
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=ephemeral-snapshots
```

### Optional

```bash
# Quotas
MAX_EXECUTIONS_PER_HOUR=1000
MAX_CONCURRENT_SANDBOXES=10
MAX_MEMORY_MB=2048
MAX_STORAGE_MB=10240

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Runtime
RUNTIME_TYPE=process  # or 'firecracker'
```

---

## Volumes

| Volume | Purpose |
|--------|---------|
| `app-workspaces` | Sandbox workspace files |
| `app-snapshots` | Snapshot storage |
| `minio-data` | MinIO object storage |
| `prometheus-data` | Prometheus metrics data |
| `grafana-data` | Grafana dashboards and config |

---

## Monitoring

### Access Prometheus

```bash
# Open browser
http://localhost:9090

# Query metrics
bing_app_sandbox_created_total
bing_app_snapshot_restored_total
bing_app_http_requests_total
```

### Access Grafana

```bash
# Open browser
http://localhost:3001

# Login
Username: admin
Password: admin

# Import dashboard
1. Go to Dashboards → Import
2. Use dashboard ID: 10778 (Node.js Application)
3. Select Prometheus data source
```

### Key Metrics

```promql
# Sandbox creation rate
rate(bing_app_sandbox_created_total[5m])

# Snapshot operations
rate(bing_app_snapshot_created_total[5m])
rate(bing_app_snapshot_restored_total[5m])

# HTTP request latency
histogram_quantile(0.95, rate(bing_app_http_request_duration_seconds_bucket[5m]))

# Active sandboxes
bing_app_sandbox_active

# Quota violations
rate(bing_app_quota_violations_total[5m])
```

---

## Backup & Restore

### Backup Snapshots

```bash
# Stop services
docker-compose down

# Backup snapshot volume
docker run --rm \
  -v bing-app-snapshots:/source \
  -v $(pwd)/backup:/backup \
  alpine tar czf /backup/snapshots-$(date +%Y%m%d).tar.gz /source

# Restart services
docker-compose up -d
```

### Restore Snapshots

```bash
# Stop services
docker-compose down

# Restore snapshot volume
docker run --rm \
  -v bing-app-snapshots:/target \
  -v $(pwd)/backup:/backup \
  alpine tar xzf /backup/snapshots-20260302.tar.gz -C /target

# Restart services
docker-compose up -d
```

---

## Troubleshooting

### App Won't Start

```bash
# Check logs
docker-compose logs app

# Common issues:
# - Port already in use: Change PORT in .env
# - Permission errors: chmod 777 /tmp/workspaces
# - Memory issues: Increase memory limits in docker-compose.yml
```

### WebSocket Connection Fails

```bash
# Check WebSocket port
docker-compose logs app | grep WebSocket

# Verify port is exposed
docker-compose ps

# Test connection
wscat -c ws://localhost:8080/sandboxes/test123/terminal
```

### Metrics Not Showing

```bash
# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# Check app metrics endpoint
curl http://localhost:3000/api/metrics

# Verify scrape config
docker-compose exec prometheus cat /etc/prometheus/prometheus.yml
```

---

## Scaling

### Horizontal Scaling

```yaml
# In docker-compose.yml
deploy:
  replicas: 3
  resources:
    limits:
      cpus: '4'
      memory: 4G
```

### Resource Limits

```yaml
# Adjust in docker-compose.yml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 4G
        reservations:
          cpus: '2'
          memory: 2G
```

---

## Security

### Non-Root User

The production Dockerfile runs as non-root user `nextjs` (UID 1001).

### Network Isolation

All services are on isolated `bing-network` bridge network.

### Secrets

Use Docker secrets or environment variables for sensitive data:

```bash
# Docker secrets (Swarm mode)
docker secret create jwt_secret jwt_secret.txt

# Environment variables
docker-compose up -d
```

---

## Production Checklist

- [ ] Set strong `JWT_SECRET_KEY`
- [ ] Configure S3 storage (not local)
- [ ] Enable HTTPS (use reverse proxy)
- [ ] Set up backup strategy
- [ ] Configure alerting (Prometheus Alertmanager)
- [ ] Set resource limits
- [ ] Enable log aggregation
- [ ] Set up monitoring dashboards
- [ ] Test disaster recovery
- [ ] Document runbook

---

## Support

For issues or questions:
1. Check logs: `docker-compose logs -f`
2. Review metrics: `http://localhost:9090`
3. Check documentation: `MIGRATION_FINAL_SUMMARY.md`
