# Premature Shutdown Analysis

## Root Cause

The 27-second premature shutdown was caused by a cascade of startup failures:

1. **No startup health check loop**: The process had no heartbeat/keepalive mechanism to stay alive
   while initialization was still in progress. If initialization took longer than expected
   or encountered errors, the process would exit without logging the cause.

2. **OpenTelemetry init failure**: `response-router-telemetry.ts:139` — the `Resource` class import
   from `@opentelemetry/resources` failed silently, causing the telemetry subsystem to degrade
   to in-memory-only metrics. While this shouldn't crash the process, it masked other issues
   by consuming error-handling paths without surfacing them.

3. **SQLite fallback misleading**: When the SQLite module couldn't be resolved
   (`terminal-session-manager.ts:122` — relative path resolution failure), the system
   degraded to in-memory sessions silently. The `prematureStopp.md` placeholder was
   created but never populated with analysis.

4. **Unhandled rejections**: Fire-and-forget promises without proper error handling
   (e.g., `.catch(err => logger.warn(...))` patterns) could become unhandled rejections
   if the logger itself threw, crashing the process prematurely.

## Fixes Applied

- **`session-manager.ts`**: Added `startHeartbeat()` method logging uptime, session count,
  and memory usage every 60 seconds. SIGTERM/SIGINT handlers now log uptime and reason.
  Added `unhandledRejection` handler logging the stack trace.
- **`response-router-telemetry.ts`**: Changed Resource import from single fallback to
  multi-strategy resolution (`Resource ?? default?.Resource ?? default`).
- **`terminal-session-manager.ts`**: Changed from bare `require()` to `require.resolve()`
  with process.cwd()-absolute paths.
- **`utils/logger.ts`**: Changed `flushLogs()` from async setTimeout to synchronous
  `writeStream.end()` + `uncork()` so logs flush before Node exits.

## Remaining Recommendations

- Add a startup timeout: if initialization takes >30s, log all pending operations and
  exit with a clear error code.
- Add a per-session timeout in `destroySession()` (5s) with force-remove after.
- Consider WAL mode + retry for SQLite migration runner on dev restart.
