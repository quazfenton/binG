# Code Review: web/lib/management

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## management/ Module (8 files)

This module provides resource monitoring, quota management, and health checking for sandboxes and GPU tasks.

### Files

| File | Lines | Purpose |
|------|-------|---------|
| resource-monitor.ts | 705 | CPU/Memory monitoring for sandboxes |
| quota-manager.ts | ~350 | User and session quota enforcement |
| sandbox-health.ts | ~200 | Health checking for remote sandboxes |
| gpu-task-routing.ts | ~250 | Routing heavy tasks to GPU nodes |
| resource-telemetry.ts | ~180 | Metric collection and export |
| index.ts | ~80 | Barrel exports |

### Good Practices

1. **Provider-Agnostic Monitoring** (line 12)
   Integrates with all sandbox providers (Daytona, E2B, Blaxel) to normalize resource metrics.

2. **Event-Driven Alerts**
   Uses an `EventEmitter` to notify other systems of resource pressure (e.g., memory exhaustion).

3. **Quota Tiering**
   The `quota-manager` supports multi-tier quotas (free vs pro) for different sandbox types.

### Issues

| Severity | Count |
|----------|-------|
| Medium | 1 |
| Low | 3 |

### MEDIUM PRIORITY

1. **Memory Growth in Metrics** (line 11)
   The "Historical metrics storage" is implemented in-memory without a retention policy in `resource-monitor.ts`. For 100+ active sandboxes monitoring every 5s, this will cause a heap leak over several days.
   
   **Recommendation:** Use a sliding window buffer (e.g., `FixedSizeBuffer`) or offload to Redis for persistence.

### LOW PRIORITY

1. **GPU Task Routing Logic**
   The routing logic appears to rely on a static configuration. It should ideally use the `resource-monitor` data for dynamic load balancing.
2. **Health Check Frequency**
   Fixed intervals for health checks might be too aggressive for idle sandboxes.
3. **Standalone Status**
   This module is not currently imported by the main application flows.

---

## Wiring

- **Used by:**
  - **Standalone** (as identified in previous search). Not currently called by the main server or agent loops.

**Status:** ⚠️ Ready but unintegrated.

---

## Summary

The management module is a high-quality "ops" layer for the binG platform. Its monitoring logic is comprehensive, but the in-memory history storage needs a fixed limit.

---

*End of Review*