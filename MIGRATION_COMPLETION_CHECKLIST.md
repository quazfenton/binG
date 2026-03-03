# Migration Completion Checklist

**Date:** 2026-03-02
**Status:** ⚠️ **PARTIAL - ephemeral/ CANNOT be deleted yet**

---

## Critical Finding: ephemeral/ is STILL NEEDED

**DO NOT DELETE ephemeral/ yet!** The TypeScript backend I created is a **re-implementation** but ephemeral/ contains critical production Python code that hasn't been migrated:

### What WAS Migrated (TypeScript Implementation)

✅ **WebSocket Terminal** - `websocket-terminal.ts`
✅ **S3 Storage Backend** - `storage-backend.ts`
✅ **Firecracker Runtime** - `firecracker-runtime.ts`
✅ **Prometheus Metrics** - `metrics.ts`
✅ **Resource Quotas** - `quota.ts`
✅ **Agent Workspace API** - `agent-workspace.ts`
✅ **Preview Router** - `preview-router.ts`
✅ **Sandbox Manager** - `sandbox-manager.ts`

### What WAS NOT Migrated (Still in ephemeral/)

❌ **JWT Authentication** - `auth.py` (uses python-jose)
❌ **FastAPI Backend** - Production Python APIs
❌ **Docker Compose** - Production deployment config
❌ **Dockerfile** - Container build config
❌ **Prometheus Config** - `prometheus.yml`
❌ **Shell Scripts** - `create_snapshot.sh`, `restore_snapshot.sh`
❌ **Snapshot Manager** - `snapshot_manager.py` (Python implementation with retry logic)
❌ **Virtual FS** - `virtual_fs.py`
❌ **Background Executor** - `background.py`
❌ **Event Recorder** - `recorder.py`
❌ **Container Runtime SDK** - `container_runtime.py` (Firecracker + Process)
❌ **Preview Registrar** - `preview.py`

---

## Missing Environment Variables

Add these to `.env.example`:

```bash
# ===========================================
# AUTHENTICATION (from ephemeral/)
# ===========================================

# JWT Configuration
JWT_SECRET_KEY=your-secret-key-change-in-production
JWT_ALGORITHM=RS256
JWT_EXPIRATION_HOURS=24

# Identity Provider Public Key (for JWT validation)
# Get from your IdP (Auth0/Clerk/Supabase/Keycloak)
AUTH0_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
CLERK_JWT_KEY=your_clerk_jwt_key
SUPABASE_JWT_SECRET=your_supabase_jwt_secret

# Identity Provider Configuration
IDP_TYPE=auth0  # auth0, clerk, supabase, or keycloak
IDP_ISSUER=https://your-domain.auth0.com/
IDP_AUDIENCE=https://your-api.com

# ===========================================
# DOCKER/CONTAINER CONFIGURATION
# ===========================================

# Docker Compose Configuration
DOCKER_COMPOSE_FILE=docker-compose.yml
DOCKER_NETWORK=ephemeral-network
DOCKER_VOLUME_DRIVER=local

# Container Configuration
CONTAINER_IMAGE=ubuntu:22.04
CONTAINER_USER=1000:1000
CONTAINER_WORKDIR=/workspace

# ===========================================
# SNAPSHOT CONFIGURATION
# ===========================================

# Snapshot Directory
SNAPSHOT_DIR=/srv/snapshots
WORKSPACE_DIR=/srv/workspaces

# Snapshot Retention
SNAPSHOT_RETENTION_COUNT=5
SNAPSHOT_RETENTION_DAYS=30

# Snapshot Compression
SNAPSHOT_COMPRESSION=zstd
SNAPSHOT_COMPRESSION_LEVEL=3

# ===========================================
# PREVIEW ROUTER CONFIGURATION
# ===========================================

# Preview Router Port
PREVIEW_ROUTER_PORT=8001

# Preview Router Configuration
PREVIEW_ROUTER_FALLBACK_ENABLED=true
PREVIEW_ROUTER_HEALTH_CHECK_INTERVAL=30

# ===========================================
# BACKGROUND JOBS CONFIGURATION
# ===========================================

# Background Job Configuration
BACKGROUND_JOB_INTERVAL=5
BACKGROUND_JOB_MAX_JOBS_PER_SANDBOX=10

# ===========================================
# EVENT RECORDING CONFIGURATION
# ===========================================

# Event Recorder Configuration
EVENT_RECORDER_ENABLED=true
EVENT_RECORDER_FILE=/tmp/events.jsonl
EVENT_RECORDER_FLUSH_INTERVAL=60

# ===========================================
# SERVERLESS WORKERS SDK CONFIGURATION
# ===========================================

# Worker Configuration
WORKER_TIMEOUT=15
WORKER_ALLOWED_COMMANDS=python,node
WORKER_NATIVE_COMMANDS=

# Fallback Configuration
FALLBACK_ENABLED=true
FALLBACK_IMAGE=ubuntu:22.04

# ===========================================
# MONITORING & LOGGING CONFIGURATION
# ===========================================

# Logging Configuration
LOG_LEVEL=INFO
LOG_FORMAT=json
LOG_FILE=/var/log/ephemeral.log

# Prometheus Configuration
PROMETHEUS_PORT=9090
PROMETHEUS_SCRAPE_INTERVAL=15s

# Grafana Configuration
GRAFANA_ENABLED=true
GRAFANA_PORT=3000
GRAFANA_ADMIN_PASSWORD=admin

# ===========================================
# MINIO/S3 CONFIGURATION (Production)
# ===========================================

# MinIO Configuration (for local development)
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_CONSOLE_PORT=9001

# S3 Configuration (for production)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_DEFAULT_REGION=us-east-1
AWS_S3_BUCKET=ephemeral-snapshots
```

---

## Missing Dependencies

### Python Dependencies (from ephemeral/requirements.txt)

These need to be added if you want to run ephemeral/ Python code:

```txt
# Web Framework
fastapi>=0.109.1
uvicorn[standard]>=0.40.0

# Authentication
python-jose[cryptography]>=3.4.0
python-multipart>=0.0.6

# Data Validation
pydantic>=2.4.0

# HTTP Client
httpx>=0.25.0

# Environment Variables
python-dotenv>=1.0.0

# Compression Library
zstandard>=0.22.0

# S3/MinIO Storage
boto3>=1.34.0
aiobotocore>=2.9.0
```

### Node.js Dependencies (Already Added)

```bash
npm install @aws-sdk/client-s3 ws
```

---

## Missing Docker Configuration

### ephemeral/ has:
- ✅ `Dockerfile` - Production container build
- ✅ `docker-compose.yml` - Multi-service orchestration
- ✅ `docker-compose.dev.yml` - Development setup
- ✅ `prometheus.yml` - Prometheus monitoring config

### binG/ needs:
- ❌ `Dockerfile` - Create for TypeScript backend
- ❌ `docker-compose.yml` - Create for production deployment
- ❌ `docker-compose.dev.yml` - Create for development
- ❌ `prometheus.yml` - Create for metrics scraping

---

## Missing Shell Scripts

### ephemeral/ has:
- ✅ `create_snapshot.sh` - Snapshot creation with Docker fallback
- ✅ `restore_snapshot.sh` - Snapshot restoration with Docker fallback
- ✅ `manage_container.sh` - Container lifecycle management
- ✅ `docker_setup_guide.sh` - Docker setup automation
- ✅ `service_mount_alt.sh` - Service mount alternative

### binG/ needs:
- ❌ These are Python/Shell specific - may not need TypeScript equivalents

---

## What You CAN Delete NOW

✅ **SAFE TO DELETE:**
- `ephemeral/serverless_workers_router/` - Migrated to TypeScript
- `ephemeral/serverless_workers_sdk/` - Migrated to TypeScript
- `ephemeral/preview_router.py` - Migrated to TypeScript
- `ephemeral/sandbox_api.py` - Replaced by TypeScript backend
- `ephemeral/snapshot_api.py` - Replaced by TypeScript backend
- `ephemeral/agent_api.py` - Replaced by TypeScript backend

---

## What You CANNOT Delete Yet

❌ **KEEP THESE:**
- `ephemeral/auth.py` - JWT authentication (not migrated)
- `ephemeral/snapshot_manager.py` - Snapshot management with retry logic (not migrated)
- `ephemeral/container_fallback.py` - Container fallback (partially migrated)
- `ephemeral/virtual_fs.py` - Virtual filesystem (not migrated)
- `ephemeral/background.py` - Background jobs (not migrated)
- `ephemeral/recorder.py` - Event recording (not migrated)
- `ephemeral/container_runtime.py` - Container runtime SDK (partially migrated)
- `ephemeral/preview.py` - Preview registrar (not migrated)
- `ephemeral/Dockerfile` - Production Docker config
- `ephemeral/docker-compose.yml` - Production orchestration
- `ephemeral/docker-compose.dev.yml` - Development setup
- `ephemeral/prometheus.yml` - Prometheus config
- `ephemeral/create_snapshot.sh` - Snapshot creation script
- `ephemeral/restore_snapshot.sh` - Snapshot restoration script
- `ephemeral/manage_container.sh` - Container management
- `ephemeral/requirements.txt` - Python dependencies
- `ephemeral/identity_config.md` - Identity provider docs
- `ephemeral/data_models.md` - Architecture documentation
- `ephemeral/README.md` - Main documentation
- `ephemeral/REVIEW_2026-02-13.md` - Strategic review

---

## Recommended Action Plan

### Phase 1: Complete Migration (Week 1-2)

**Priority: HIGH**

1. **Migrate Authentication**
   - Create `lib/backend/auth.ts` with JWT validation
   - Install `jose` package for Node.js JWT handling
   - Configure IdP public keys

2. **Migrate Snapshot Manager**
   - Create `lib/backend/snapshot-manager.ts`
   - Add retry logic with exponential backoff
   - Add retention enforcement

3. **Migrate Virtual FS**
   - Create `lib/backend/virtual-fs.ts`
   - Add path traversal protection

4. **Create Docker Configuration**
   - Create `Dockerfile` for TypeScript backend
   - Create `docker-compose.yml` for production
   - Create `docker-compose.dev.yml` for development

### Phase 2: Testing (Week 2-3)

**Priority: HIGH**

1. **Integration Tests**
   - Test with real MinIO/S3
   - Test with real Firecracker
   - Test WebSocket terminal with xterm.js

2. **Load Tests**
   - Test quota enforcement under load
   - Test metrics collection
   - Test snapshot creation/restoration

3. **Security Tests**
   - Test JWT validation
   - Test path traversal protection
   - Test quota bypass attempts

### Phase 3: Production Deployment (Week 3-4)

**Priority: MEDIUM**

1. **Deploy to Staging**
   - Deploy TypeScript backend
   - Run parallel with ephemeral/ Python
   - Compare metrics

2. **Gradual Migration**
   - Migrate 10% of traffic to TypeScript
   - Monitor for errors
   - Increase to 50%, then 100%

3. **Decommission Python**
   - Stop ephemeral/ Python services
   - Keep Python code for reference
   - Monitor TypeScript in production

---

## Current Status Summary

| Component | Status | Can Delete? |
|-----------|--------|-------------|
| **WebSocket Terminal** | ✅ Migrated | ✅ Yes (Python) |
| **S3 Storage** | ✅ Migrated | ✅ Yes (Python) |
| **Firecracker Runtime** | ✅ Migrated | ✅ Yes (Python) |
| **Metrics** | ✅ Migrated | ✅ Yes (Python) |
| **Quotas** | ✅ Migrated | ✅ Yes (Python) |
| **Agent Workspace** | ✅ Migrated | ✅ Yes (Python) |
| **Preview Router** | ✅ Migrated | ✅ Yes (Python) |
| **Sandbox Manager** | ✅ Migrated | ✅ Yes (Python) |
| **Authentication** | ❌ NOT Migrated | ❌ NO - Keep auth.py |
| **Snapshot Manager** | ❌ NOT Migrated | ❌ NO - Keep snapshot_manager.py |
| **Virtual FS** | ❌ NOT Migrated | ❌ NO - Keep virtual_fs.py |
| **Background Jobs** | ❌ NOT Migrated | ❌ NO - Keep background.py |
| **Event Recorder** | ❌ NOT Migrated | ❌ NO - Keep recorder.py |
| **Docker Config** | ❌ NOT Migrated | ❌ NO - Keep Dockerfile, docker-compose.yml |
| **Shell Scripts** | ❌ NOT Migrated | ❌ NO - Keep *.sh scripts |

---

## Final Recommendation

**DO NOT DELETE ephemeral/ yet!**

**Wait until:**
1. ✅ Authentication is migrated
2. ✅ Snapshot manager is migrated
3. ✅ Docker configuration is created
4. ✅ Production testing is complete
5. ✅ TypeScript backend is running in production

**Estimated time to full migration:** 2-4 weeks

**Current state:** TypeScript backend is **production-ready for testing** but ephemeral/ Python is still needed for:
- JWT authentication
- Snapshot management
- Docker deployment
- Production monitoring

---

**Action Required:**
1. Add missing env variables to `.env.example`
2. Create `lib/backend/auth.ts` for JWT validation
3. Create `lib/backend/snapshot-manager.ts` for snapshot management
4. Create `Dockerfile` and `docker-compose.yml`
5. Test with real workloads
6. Only then delete ephemeral/
