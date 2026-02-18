# Sandbox Caching Configuration Guide

## Overview

This document explains the sandbox caching options available in binG, including startup time estimates and storage requirements.

---

## Caching Methods

### Method 1: No Cache (Default) ❌
**Configuration:**
```env
SANDBOX_PRELOAD_PACKAGES=false
SANDBOX_PERSISTENT_CACHE=false
```

**Description:** No packages are pre-installed. Each sandbox starts with a minimal base image.

| Metric | Value |
|--------|-------|
| **First Sandbox Startup** | ~30 seconds |
| **Subsequent Startups** | ~30 seconds |
| **Package Install Time** | +5-10 minutes (on first use) |
| **Storage Required** | ~500 MB per sandbox |
| **Bandwidth per User** | ~1.2 GB |

**Best For:** Testing, minimal usage, or when storage is limited.

---

### Method 2: Per-Sandbox Cache (Current Default) ✅
**Configuration:**
```env
SANDBOX_PRELOAD_PACKAGES=true
SANDBOX_PERSISTENT_CACHE=false  # Default
SANDBOX_WARM_POOL=true
SANDBOX_WARM_POOL_SIZE=2
```

**Description:** Each sandbox has its own cache directories. Warm pool keeps 2 pre-provisioned sandboxes ready.

| Metric | Value |
|--------|-------|
| **First Sandbox Startup** | ~10 minutes (full install) |
| **Warm Pool Sandbox** | ~30 seconds (ready immediately) |
| **Subsequent Startups** | ~8-10 minutes |
| **Storage Required** | ~1.5 GB per sandbox |
| **Bandwidth per User** | ~600 MB (with warm pool) |

**Benefits:**
- ✅ No shared state between users
- ✅ Clean environment every time
- ✅ Warm pool provides instant sandboxes

**Trade-offs:**
- ⚠️ Duplicate package downloads across sandboxes
- ⚠️ Higher storage usage

**Best For:** Development, small teams (<10 users), security-sensitive environments.

---

### Method 3: Persistent Cache Volume (Recommended) 🚀
**Configuration:**
```env
SANDBOX_PRELOAD_PACKAGES=true
SANDBOX_PERSISTENT_CACHE=true  # Enable persistent cache
SANDBOX_CACHE_VOLUME_NAME=global-package-cache
SANDBOX_CACHE_SIZE=2GB
SANDBOX_WARM_POOL=true
SANDBOX_WARM_POOL_SIZE=2
```

**Description:** Shared cache volume mounted at `/opt/cache` across all sandboxes. Packages downloaded once, reused by all.

| Metric | Value |
|--------|-------|
| **First Sandbox Startup** | ~10 minutes (full install) |
| **Warm Pool Sandbox** | ~30 seconds (ready immediately) |
| **Subsequent Startups** | ~2-3 minutes (cache hits) |
| **Storage Required** | ~2 GB (shared) + ~500 MB per sandbox |
| **Bandwidth per User** | ~100 MB (90% reduction!) |

**Benefits:**
- ✅ Packages downloaded once, shared by all users
- ✅ 70-80% faster sandbox creation after first use
- ✅ 90% bandwidth reduction
- ✅ Cost-effective for multiple users

**Trade-offs:**
- ⚠️ Requires persistent storage setup
- ⚠️ Cache cleanup needed periodically
- ⚠️ Slightly more complex configuration

**Best For:** Production, teams with 10+ users, frequent sandbox creation.

---

### Method 4: Custom Pre-Built Image (Advanced) 🎯
**Configuration:**
```env
# Create custom Daytona image with all packages pre-installed
# See: https://docs.daytona.io/ for image building guide
SANDBOX_PRELOAD_PACKAGES=false  # Not needed, already in image
SANDBOX_PERSISTENT_CACHE=false
```

**Description:** Custom Docker image with all packages pre-installed. No installation needed at runtime.

| Metric | Value |
|--------|-------|
| **First Sandbox Startup** | ~30 seconds |
| **Subsequent Startups** | ~30 seconds |
| **Storage Required** | ~2 GB per image |
| **Bandwidth per User** | ~0 MB |

**Benefits:**
- ✅ Fastest possible startup
- ✅ No package installation delays
- ✅ Consistent environment

**Trade-offs:**
- ⚠️ Need to rebuild image to update packages
- ⚠️ Larger image size
- ⚠️ Requires Docker knowledge

**Best For:** Large-scale production, enterprise deployments.

---

## Startup Time Comparison

| Method | First Use | Warm Pool | Subsequent | Best For |
|--------|-----------|-----------|------------|----------|
| **No Cache** | 30s | N/A | 30s + 5-10min install | Testing |
| **Per-Sandbox** | 10min | 30s | 8-10min | Development |
| **Persistent Cache** | 10min | 30s | **2-3min** ⭐ | **Production** |
| **Custom Image** | 30s | 30s | 30s | Enterprise |

---

## Storage Requirements

### Persistent Cache Volume Sizes

| Cache Size | Contents | Recommended For |
|------------|----------|-----------------|
| **1 GB** | Download caches only | Small teams (<10 users) |
| **2 GB** ⭐ | Downloads + Node modules | Medium teams (10-50 users) |
| **4 GB** | Full cache including Python libs | Large teams (50+ users) |

### Breakdown by Package Type

| Package Type | Download Size | Installed Size | Shareable? |
|--------------|--------------|----------------|------------|
| System (apt) | 60 MB | 170 MB | ❌ No |
| Build Tools | 120 MB | 380 MB | ❌ No |
| Node Globals | 65 MB | 170 MB | ✅ Yes |
| Node Libraries | 40 MB | 110 MB | ✅ Yes |
| Python Libraries | 132 MB | 405 MB | ⚠️ Partial |
| **Total** | **~437 MB** | **~1.3 GB** | |

---

## Configuration Examples

### Example 1: Development Setup (Default)
```env
# .env
SANDBOX_PROVIDER=daytona
DAYTONA_API_KEY=your_key_here
SANDBOX_WARM_POOL=true
SANDBOX_WARM_POOL_SIZE=2
SANDBOX_PRELOAD_PACKAGES=true
SANDBOX_PERSISTENT_CACHE=false  # Default
```

**Expected Performance:**
- First sandbox: ~10 minutes
- Warm pool: Instant
- Storage: ~3 GB total

---

### Example 2: Production Setup (Recommended)
```env
# .env
SANDBOX_PROVIDER=daytona
DAYTONA_API_KEY=your_key_here
SANDBOX_WARM_POOL=true
SANDBOX_WARM_POOL_SIZE=3
SANDBOX_PRELOAD_PACKAGES=true
SANDBOX_PERSISTENT_CACHE=true
SANDBOX_CACHE_VOLUME_NAME=global-package-cache
SANDBOX_CACHE_SIZE=2GB
```

**Expected Performance:**
- First sandbox: ~10 minutes
- Subsequent: ~2-3 minutes
- Storage: ~2 GB shared + ~1.5 GB per sandbox

---

### Example 3: High-Performance Setup
```env
# .env
SANDBOX_PROVIDER=daytona
DAYTONA_API_KEY=your_key_here
SANDBOX_WARM_POOL=true
SANDBOX_WARM_POOL_SIZE=5
SANDBOX_PRELOAD_PACKAGES=true
SANDBOX_PERSISTENT_CACHE=true
SANDBOX_CACHE_VOLUME_NAME=global-package-cache
SANDBOX_CACHE_SIZE=4GB
```

**Expected Performance:**
- First sandbox: ~10 minutes
- Subsequent: ~1-2 minutes
- Storage: ~4 GB shared + ~1.5 GB per sandbox

---

## Rollback Instructions

### From Persistent Cache → Per-Sandbox Cache

1. **Update `.env`:**
   ```env
   SANDBOX_PERSISTENT_CACHE=false
   ```

2. **Restart the application:**
   ```bash
   pnpm dev
   ```

3. **(Optional) Delete persistent cache volume:**
   ```bash
   # In Daytona dashboard or via API
   daytona volume delete global-package-cache
   ```

**No data loss** - existing sandboxes continue to work normally.

---

## Monitoring Cache Effectiveness

### Check Cache Hit Rate
```typescript
// In dep-cache.ts, cache hits are logged
console.log('[dep-cache] Cache hit for package-lock.json')
```

### Monitor Storage Usage
```bash
# Check persistent cache volume size
daytona volume inspect global-package-cache
```

### Track Sandbox Creation Time
```bash
# Logs show provisioning time
[base-image] Provisioning completed in 180s
```

---

## Troubleshooting

### Issue: Slow sandbox creation even with persistent cache

**Solution:**
1. Verify cache volume is mounted:
   ```bash
   daytona sandbox exec <sandbox-id> -- ls -la /opt/cache
   ```

2. Check cache configuration:
   ```env
   SANDBOX_PERSISTENT_CACHE=true
   SANDBOX_CACHE_VOLUME_NAME=global-package-cache
   ```

3. Verify volume exists in Daytona dashboard

---

### Issue: Cache volume full

**Solution:**
1. Increase cache size:
   ```env
   SANDBOX_CACHE_SIZE=4GB
   ```

2. Or clean old cache:
   ```bash
   daytona sandbox exec <sandbox-id> -- rm -rf /opt/cache/npm/*
   ```

---

### Issue: Rollback needed

**Solution:**
1. Set `SANDBOX_PERSISTENT_CACHE=false`
2. Restart application
3. New sandboxes will use per-sandbox cache
4. Existing sandboxes unaffected

---

## Cost Analysis

### AWS EBS Pricing (us-east-1)
- **gp3 Storage:** $0.08/GB/month
- **2 GB Cache:** $0.16/month
- **50 sandboxes/month:** $8.00/month

### Bandwidth Savings
- **Without cache:** 1.2 GB/user × 50 users = 60 GB/month
- **With cache:** 100 MB/user × 50 users = 5 GB/month
- **Savings:** 55 GB/month × $0.09/GB = **$4.95/month**

**Net Cost:** $0.16 - $4.95 = **-$4.79/month (saves money!)**

---

## Recommendations Summary

| Team Size | Recommended Method | Expected Cost |
|-----------|-------------------|---------------|
| **1-5 users** | Per-Sandbox Cache | $0/month |
| **5-20 users** | Persistent Cache (2GB) | $0.16/month |
| **20-50 users** | Persistent Cache (4GB) | $0.32/month |
| **50+ users** | Custom Image + Cache | $1.00/month |

---

## Quick Reference

### Enable Persistent Cache
```bash
# 1. Update .env
echo "SANDBOX_PERSISTENT_CACHE=true" >> .env
echo "SANDBOX_CACHE_SIZE=2GB" >> .env

# 2. Restart
pnpm dev
```

### Disable Persistent Cache (Rollback)
```bash
# 1. Update .env
sed -i 's/SANDBOX_PERSISTENT_CACHE=true/SANDBOX_PERSISTENT_CACHE=false/' .env

# 2. Restart
pnpm dev
```

### Check Current Configuration
```bash
grep SANDBOX_ .env
```

---

## Additional Resources

- [Daytona Documentation](https://docs.daytona.io/)
- [Daytona Volumes API](https://docs.daytona.io/api/volumes)
- [npm Cache Documentation](https://docs.npmjs.com/cli/v9/commands/npm-cache)
- [pip Cache Documentation](https://pip.pypa.io/en/stable/topics/caching/)

---

**Last Updated:** 2024
**Version:** 1.0
