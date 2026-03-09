# Debug Logging Guide

This document describes the enhanced debug logging added throughout the binG0 system.

## Overview

Comprehensive debug logging has been added to help diagnose issues with:
- Sandbox provider initialization and lifecycle
- Provider fallback chains and quota management
- Session store operations
- File-based log export

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Minimum log level to display |
| `LOG_TO_FILE` | `false` | Enable file logging |
| `LOG_FILE_PATH` | `logs/app.log` | Path to log file |
| `LOG_MAX_FILE_SIZE` | `10` | Max file size in MB before rotation |
| `LOG_MAX_FILES` | `5` | Number of rotated files to keep |
| `SANDBOX_PROVIDER` | `daytona` | Primary sandbox provider |
| `SANDBOX_PROVIDER_FALLBACK_CHAIN` | (auto) | Comma-separated fallback order |

### Example Configuration

```bash
# Enable verbose debug logging with file export
LOG_LEVEL=debug LOG_TO_FILE=true LOG_FILE_PATH=/var/log/bing0/app.log npm run dev

# Track sandbox provider issues specifically
LOG_LEVEL=debug SANDBOX_PROVIDER=e2b npm run dev
```

## Log Components

### 1. SandboxService (`[SandboxService]`)

Logs sandbox creation, provider selection, and fallback behavior.

**Key log messages:**
```
[SandboxService] SandboxService initialized with primary provider: daytona
[SandboxService] Initializing primary provider: daytona
[SandboxService] Primary provider daytona initialized successfully
[SandboxService] Creating workspace for user abc123
[SandboxService] Getting candidate provider types, primary: daytona
[SandboxService] Checking provider availability: daytona
[SandboxService] Provider daytona is available
[SandboxService] Candidate providers: daytona, runloop, blaxel
[SandboxService] Attempting to create sandbox with provider: daytona
[SandboxService] Creating sandbox with provider daytona for user abc123
[SandboxService] Provider daytona instance obtained, creating sandbox...
[SandboxService] Sandbox created successfully with ID: daytona-xyz789
[SandboxService] Successfully created sandbox with provider daytona: daytona-xyz789
[SandboxService] Workspace session created: session-123 (sandbox: daytona-xyz789)
```

**On failure:**
```
[SandboxService] Provider failed (daytona): API error: 401; trying next fallback
[SandboxService] Attempting to create sandbox with provider: runloop
[SandboxService] All providers failed for workspace creation
```

### 2. SandboxProviders (`[SandboxProviders]`)

Logs provider initialization, circuit breaker state, and retry attempts.

**Key log messages:**
```
[SandboxProviders] getSandboxProvider called with type: daytona
[SandboxProviders] Starting initialization for provider daytona
[SandboxProviders] Provider daytona initialization attempt 1/3
[SandboxProviders] Provider daytona initialized successfully in 0.234s
[SandboxProviders] Provider daytona already initialized and healthy
[SandboxProviders] Provider daytona circuit breaker OPEN
[SandboxProviders] Provider daytona initialization failed (attempt 2/3): API key invalid
[SandboxProviders] Provider daytona failed after 3 attempts: API key invalid
```

### 3. QuotaManager (`[QuotaManager]`)

Logs quota tracking and provider chain selection.

**Key log messages:**
```
[QuotaManager] Getting sandbox provider chain for primary: daytona
[QuotaManager] Provider chain for daytona: daytona, runloop, blaxel, sprites
[QuotaManager] Picked available provider: daytona
[QuotaManager] Recording usage for provider daytona: 1
[QuotaManager] Provider daytona usage: 150/5000
[QuotaManager] Provider 'daytona' has reached its monthly limit (5000/5000). Disabled until 2026-04-01
```

### 4. SessionStore (`[SessionStore]`)

Logs session lifecycle operations.

**Key log messages:**
```
[SessionStore] Saving session: session-123 (sandbox: daytona-xyz789, user: abc123)
[SessionStore] Session session-123 saved to SQLite
[SessionStore] Getting session: session-123
[SessionStore] Session session-123 found in SQLite
[SessionStore] Getting active session for user: abc123
[SessionStore] Active session found for user abc123: session-123
[SessionStore] Updating session session-123: {"status":"destroyed"}
[SessionStore] Deleting session: session-123
```

## Log File Format

Logs are written in JSON format for easy parsing:

```json
{"timestamp":"2026-03-09T12:34:56.789Z","level":"debug","source":"SandboxService","message":"Creating workspace for user abc123"}
{"timestamp":"2026-03-09T12:34:57.123Z","level":"info","source":"SandboxService","message":"Workspace session created: session-123"}
{"timestamp":"2026-03-09T12:34:58.456Z","level":"error","source":"SandboxProviders","message":"Provider daytona failed after 3 attempts"}
```

## Troubleshooting Common Issues

### All Providers Failing

1. **Check API keys are set:**
   ```bash
   echo $DAYTONA_API_KEY
   echo $E2B_API_KEY
   ```

2. **Enable debug logging:**
   ```bash
   LOG_LEVEL=debug npm run dev
   ```

3. **Look for these patterns in logs:**
   - `[SandboxProviders] Provider X initialization failed` - Provider SDK error
   - `[SandboxProviders] Provider X circuit breaker OPEN` - Too many failures, waiting
   - `[QuotaManager] Provider 'X' has reached its monthly limit` - Quota exceeded

### Provider Fallback Not Working

1. **Check fallback chain:**
   ```
   [QuotaManager] Provider chain for daytona: daytona, runloop, blaxel
   ```

2. **Verify each provider initializes:**
   ```
   [SandboxProviders] Provider runloop initialized successfully
   ```

3. **Check for quota blocks:**
   ```
   [QuotaManager] Provider 'runloop' is disabled (quota exceeded)
   ```

### Session Issues

1. **Track session lifecycle:**
   ```
   [SessionStore] Saving session: session-123
   [SessionStore] Session session-123 saved to SQLite
   [SessionStore] Getting session: session-123
   [SessionStore] Session session-123 not found
   ```

2. **Check for expired sessions:**
   ```
   [SessionStore] Session session-123 expired, removing from memory
   ```

## Log Rotation

When `LOG_TO_FILE=true`, logs automatically rotate:
- Files rotate when they exceed `LOG_MAX_FILE_SIZE` (default: 10MB)
- Keeps `LOG_MAX_FILES` (default: 5) rotated files
- Format: `app.log`, `app.1.log`, `app.2.log`, etc.

## Performance Considerations

- Debug logging adds minimal overhead (<1ms per operation)
- File I/O is buffered and non-blocking
- In production, consider `LOG_LEVEL=info` to reduce log volume
- SQLite session storage is preferred for production (faster lookups)

## Related Files

- `lib/utils/logger.ts` - Core logging utility
- `lib/sandbox/core-sandbox-service.ts` - Sandbox lifecycle
- `lib/sandbox/providers/index.ts` - Provider registry
- `lib/services/quota-manager.ts` - Quota tracking
- `lib/sandbox/session-store.ts` - Session persistence
