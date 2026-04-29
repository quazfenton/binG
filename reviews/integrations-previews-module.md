# Code Review: web/lib/integrations & previews Modules

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  
**Module:** web/lib/integrations/ (6 files), previews/ (6 files)

---

## Integrations Module Overview

The integrations module provides external service integrations (Nango, Composio, Arcade) for tool execution.

---

## Files

### integrations/
- nango-service.ts (1224 lines) - Nango API integration
- composio-service.ts - Composio integration
- arcade-service.ts - Arcade integration
- execution-audit.ts - Execution auditing
- action-registry.ts - Action registry
- composio-mcp-service.ts - MCP bridge

### previews/
- preview-router.ts - Preview routing
- enhanced-port-detector.ts - Port detection
- vercel-preview-service.ts - Vercel integration
- live-preview-offloading.ts - Offloading logic

---

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 2 |
| Medium | 3 |
| Low | 4 |

---

## Detailed Findings

### CRITICAL

#### 1. API Keys in Memory (nango-service.ts)
**File:** nango-service.ts  
**Lines:** ~100-150

**Issue:** API keys stored in instance without encryption. Could be accessed via memory dump.

**Recommendation:** Use secure key storage or encrypt at rest.

---

### HIGH PRIORITY

#### 2. No Request Timeout (nango-service.ts)
**File:** nango-service.ts  
**Lines:** ~70-80

```typescript
timeout: 30000, // Hardcoded
```

**Issue:** 30s timeout may be insufficient for long requests.

**Recommendation:** Make timeout configurable.

---

#### 3. Connection Map Not Cleaned (nango-service.ts:66)
**File:** nango-service.ts  
**Line:** 66

```typescript
private connections = new Map<string, NangoConnection>();
```

**Issue:** Connections accumulate. No cleanup mechanism.

**Recommendation:** Add TTL-based cleanup.

---

### MEDIUM PRIORITY

1. **Missing error handling** - Some methods don't handle failures gracefully
2. **No retry logic** - Failed requests don't retry
3. **Magic strings** - Provider names not validated

---

## Security Assessment

### Good
1. Connection management tracking
2. OAuth flow handling
3. Execution audit trail

### Concerns
1. **API key security** - CRITICAL
2. No request signing
3. Missing rate limiting

---

## Summary

Integrations provide valuable external tool access. Main concerns are around API key security and connection management.

---

*End of Review*