# Changelog

All notable changes made in this session are documented below.

## [Unreleased]

### Fixed

#### `packages/shared/agent/workforce-state.ts`
- **loadState bare catch (regression fix):** Previously, any error during state loading (YAML parse failure, permission denied, corrupted file) would silently fall back to `DEFAULT_STATE`, causing data loss. Now only `ENOENT` or errors with `not found`/`ENOENT` in the message trigger the fallback. All other errors are logged and rethrown.
- **saveState error handling (new):** Added explicit try/catch around `yaml.dump` and `writeFile`. Previously, if serialization or VFS write failed, the error propagated silently. Now both stages log context before rethrowing.

#### `packages/shared/agent/opencode-direct.ts`
- **Sandbox sync failure reporting (bug fix):** Previously, if the sandbox-to-VFS sync failed, the catch block only logged a warning and returned `success: true` — silently reporting a failed sync as success. Now returns `{ success: false, error: 'Sandbox sync failed: ...' }` preserving response/steps/fileChanges.
- **OpenCodeDirectResult type (type error fix):** Added `error?: string` field to `OpenCodeDirectResult` interface — the sync-failure return path was returning an `error` property not declared in the interface.

#### `packages/shared/agent/nullclaw-integration.ts`
- **Health check retry logging (observability fix):** The `waitForHealth` retry loop was silently swallowing all health check failures, making it impossible to debug why a container appeared unhealthy. Now logs each failed attempt at debug level with `{ attempt, maxAttempts, containerId, error }` context.

#### `packages/shared/agent/progress-emitter.ts`
- **getEmitEvent cached rejection recovery (reliability fix):** The lazy-loaded event bus import cached a rejected promise permanently if the module failed to load, causing all future calls to fail until process restart. Added `.catch()` that resets `_emitEventPromise = null` before rethrowing, enabling transient errors to be retried.
- **Payload field overwrite prevention (correctness fix):** The `...update` spread came *after* required fields (`type`, `userId`, `sessionId`, `timestamp`), so a malicious or buggy `update` object could overwrite critical fields. Moved `...update` to the first position so required fields always win.

#### `packages/shared/agent/bootstrapped-agency.ts`
- **userId ?? fallback operator (correctness fix):** Changed `this.config.userId || this.config.sessionId` to `this.config.userId ?? this.config.sessionId ?? 'anonymous'` (2 occurrences). The `||` operator would incorrectly fall back for a numeric `0` userId value. `??` limits fallback to `null`/`undefined` only, which is correct for a string userId field. Additionally, if both `userId` and `sessionId` are undefined/null, falls back to `'anonymous'` to prevent both fields being undefined in the capability router context.

#### `web/lib/tools/router.ts`
- **file.create_directory capability (new feature):** Added `file.create_directory` to both `VFSProvider` and `MCPFilesystemProvider` capabilities arrays, with a handler that delegates to the MCP `create_directory` tool and throws on failure. Enables `create_directory`/`mkdir` capability routing.
- **batch_write error propagation (bug fix):** Changed `file.batch_write` handler from `return { success: result.success, ... }` to `if (!result.success) throw` + `return result.output`. Previously, a `success: false` result from the MCP tool was wrapped by `executeToolCapability` as `{ success: true, output: { success: false, ... } }` — a false positive. Now the handler throws so `executeToolCapability`'s catch block properly returns `{ success: false, error }`.

#### `web/lib/orchestra/unified-agent-service.ts`
- **create_directory/mkdir capability routing (bug fix):** Mapped `create_directory`/`mkdir` to `file.create_directory` instead of `file.write`. The `file.write` handler requires `content` in its arguments, which directory creation calls don't provide, causing schema validation failures for these tool calls.

#### `web/lib/virtual-filesystem/virtual-filesystem-service.ts`
- **DELETE tracking silent catch (observability fix):** When deleting a path, the code reads `originalContent` for git transaction tracking. Previously, if `readFile` failed (e.g. file already deleted), the error was silently swallowed with no trace. Now logs a warning with `{ path, error }` so operators can correlate missing `originalContent` in git commits.

### Added

#### `packages/shared/agent/__tests__/workforce-state.test.ts`
- 7 unit tests covering: happy path (valid YAML), ENOENT fallback via code, ENOENT fallback via `not found` in message, ENOENT fallback via `ENOENT` in message, YAML parse error rethrow, permission-denied rethrow (non-ENOENT), invalid content fallback (`tasks: null` → default state).

### Security

- **bootstrapped-agency.ts:** Replaced falsy-prone `||` with `??` for userId session fallback to prevent an empty string userId from being silently accepted as valid.
- **progress-emitter.ts:** Moved `...update` spread before required fields to prevent field overwrite attacks via crafted update payloads.