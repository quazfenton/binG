# ARCHITECTURE REVIEW: Platform Abstraction Layer

**Module:** `packages/platform/`  
**Review Date:** 2026-04-29  
**Severity:** 🟡 MEDIUM (Security & Design Issues)  
**Overall Risk:** Medium — Core cross-platform layer with implementation gaps

---

## Executive Summary

The `packages/platform` package provides cross-platform abstractions for filesystem, storage, secrets, clipboard, notifications, jobs, and environment detection between web (browser) and desktop (Tauri) environments. The architecture is sound with proxy pattern, but contains **security weaknesses** in secrets management, **incomplete feature parity**, and **error-handling gaps**.

**Critical Findings:** 0  
**High Severity:** 1  
**Medium Severity:** 4  
**Low Severity:** 6

---

## 1. SECRETS MANAGEMENT — HIGH RISK

### 🟠 HIGH-1: Web Secrets Encryption Provides False Security

**File:** `packages/platform/src/secrets/web.ts`  
**Lines:** 33-37, 104-145

**How it works:**
1. Per-browser **salt** stored in IndexedDB (META_STORE)
2. Hardcoded **pepper** constant (`HARDCODED_PEPPER` at line 33)
3. PBKDF2 derivation (100k iterations) → AES-256-GCM key
4. Secrets encrypted with AES-GCM, stored in IndexedDB

**The fatal flaw:**
```typescript
// Line 33: const HARDCODED_PEPPER = 'bing-platform-secrets-pepper-v1';
// Line 38: Both salt AND pepper stored in IndexedDB META_STORE
// Line 135: Base64 encode pepper (same for all users)
```

**Attacker with browser access** (XSS, physical access, devtools) can:
1. Read `META_STORE` to extract salt
2. Read hardcoded pepper from bundle (public JavaScript)
3. Run PBKDF2 locally to derive key
4. Decrypt all stored secrets

**Impact:** "Encryption" is **security through obscurity** — protects against casual inspection but NOT against determined attacker with browser access.

**Comparison with desktop:**
- Desktop uses **system keychain** (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux) — that's proper hardware/OS-backed secure storage.
- Web version should use **Web Crypto with user-derived key** (passphrase prompt) instead of storing key material alongside ciphertext.

**Remediation:**
- **Option A:** Use `window.crypto.subtle.deriveKey` with user passphrase (prompt user for password, never store)
- **Option B:** If transparent encryption needed, acknowledge it's only defense-in-depth, not true security
- Document threat model: web secrets are **obfuscated, not secured** against determined attacker

---

### 🟠 HIGH-2: Desktop Secrets Fallback Creates Split-Brain

**File:** `packages/platform/src/secrets/desktop.ts`  
**Lines:** 76-81, 104-110, 131-136

**Logic:**
```typescript
try {
  // Try Tauri invoke for keychain
  const result = await invoke('store_secret', ...);
} catch (error) {
  if (isTauriUnavailableError(error)) {
    // Fallback to web implementation (localStorage)
    return webSet(key, value);
  }
  throw error; // Real error — don't fallback
}
```

**Issue:** The `isTauriUnavailableError` check determines if Tauri module failed to load vs runtime error. If categorization is wrong (e.g., Tauri error misclassified as unavailable), secrets silently written to **insecure localStorage** while user thinks they're in keychain.

**Impact:** Data stored in two different locations → app behavior changes if run as Tauri vs web. Worse, secrets stored in localStorage (less secure) when keychain expected.

**Remediation:**
- Make fallback **explicit opt-in** via config, not automatic
- Log **warning** when falling back to localStorage
- In Tauri apps, fail hard if keychain unavailable (don't degrade security)

---

## 2. STORAGE — MEDIUM ISSUES

### 🟡 MED-3: Storage Web Doesn't Handle Quota Exceeded

**File:** `packages/platform/src/storage/web.ts:26-27`

**Issue:**
```typescript
set(key: string, value: string): Promise<void> {
  return Promise.resolve(localStorage.setItem(key, value)); // No try-catch
}
```

`localStorage.setItem()` throws `QuotaExceededError` when full (~5-10MB). No catch → unhandled rejection.

**Impact:** App crash or unhandled promise rejection when localStorage full.

**Remediation:**
```typescript
try {
  localStorage.setItem(key, value);
} catch (error) {
  if (error.name === 'QuotaExceededError') {
    // Evict least-recently-used item or throw user-friendly error
    throw new Error('Storage quota exceeded');
  }
  throw error;
}
```

---

### 🟡 MED-4: Storage Interface Duplicated Across Files

**Files:**
- `packages/platform/src/storage/web.ts` — defines `StorageAdapter` interface
- `packages/platform/src/storage/desktop.ts` — duplicates same interface

**Issue:** Two separate `interface StorageAdapter` definitions. If they diverge, type checker won't catch.

**Remediation:** Extract shared interface to `storage/types.ts` and import in both implementations.

---

### 🟡 MED-5: Desktop Storage `ensureDir` Swallows Errors

**File:** `packages/platform/src/storage/desktop.ts:28-37`

```typescript
async ensureDir(): Promise<void> {
  try {
    await invoke('ensure_dir', { path: this.basePath });
  } catch (error) {
    console.error('Failed to create storage dir:', error);
    // Swallowed — set() continues and will fail later with confusing error
  }
}
```

**Impact:** Directory creation failure (disk full, permission denied) is logged but **ignored**. Later `set()` calls fail with opaque Tauri error instead of clear "directory creation failed".

**Remediation:** Re-throw error after logging or bubble up to caller.

---

## 3. FILESYSTEM — MEDIUM

### 🟡 MED-6: Web Filesystem Has Massive Feature Gap

**File:** `packages/platform/src/fs/web.ts` vs `desktop.ts`

**Web version implements only:**
- `readFile` (from File object, not path)
- `openFileDialog`
- `readAsDataURL`, `readAsArrayBuffer`
- `downloadFile`

**Desktop version implements full:**
- `readFile`, `writeFile`, `readBinaryFile`, `writeBinaryFile`
- `readDir`, `createDir`, `removeDir`, `removeFile`
- `exists`, `copyFile`, `stat`

**Problem:** Proxy `fs/index.ts` exports all methods but uses optional chaining (`adapter?.method?.()`). On web, most operations return `undefined` — **silent failure**.

**Impact:** Code expecting filesystem operations to work on web will get `undefined` and likely crash or misbehave. No clear error message.

**Remediation:**
- Either implement more web methods using **File System Access API** (where supported)
- Or throw explicit `NotImplementedError` for unsupported methods
- Document clearly: **web filesystem is read-only user-select only**

---

### 🟡 MED-7: Path Normalization Issues in Desktop Storage

**File:** `packages/platform/src/storage/desktop.ts:20-24`

```typescript
const sanitizedKey = key.replace(/[\\/]/g, '_');
```

Only replaces `/` and `\` with `_`. Doesn't handle `..` sequences which could result in `file..name` but still safe since Tauri restricts to AppData. Also potential **collision**: `a/b` and `a\b` both become `a_b`.

**Low risk** but could be cleaner using hash of key: `sha256(key).substring(0, 16)`.

---

## 4. ENVIRONMENT DETECTION — LOW

### 🟢 LOW-8: `isDesktopMode()` Mixes Client/Server Detection

**File:** `packages/platform/src/env.ts:14-31`

```typescript
export function isDesktopMode(): boolean {
  // Client-side: check __TAURI__ (works only in browser)
  if (typeof window !== 'undefined' && ('__TAURI__' in window)) return true;
  // Server-side: fall back to env var
  return process.env.DESKTOP_MODE === 'true';
}
```

**Issue:** During SSR (server-side rendering), `typeof window === 'undefined'` → falls back to env var. But server-side code might be running in Node.js container (not desktop) while desktop frontend thinks it's desktop. This creates **hydration mismatch**.

**Impact:** Could cause code to choose wrong implementation on client after SSR.

**Recommendation:** Separate `isTauriRuntime()` (client-only) from `isServerDesktopMode()` (env-based). Document when each should be used.

---

## 5. JOBS SYSTEM — LOW

### 🟢 LOW-9: Desktop Jobs Missing Error Distinction

**File:** `packages/platform/src/jobs.ts:53-73`

```typescript
try {
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke(jobName, { args });
  return { success: true, data: result };
} catch (error) {
  return { success: false, error: error.message };
}
```

If Tauri APIs unavailable, error caught and returned as job failure. Distinguishes "platform not available" vs "job execution failed"? No — both yield `success: false`. Could be improved with error codes.

**Not critical** — design is acceptable for local operations.

---

## 6. CLIPBOARD & NOTIFICATIONS — LOW

### 🟢 LOW-10: Clipboard Uses `require`-like Dynamic Import with `any`

**File:** `packages/platform/src/clipboard.ts:99, 113**

```typescript
const module = await import('@tauri-apps/api/clipboard');
(clipboard as any).writeFiles(...)
```

Loses type safety, but necessary due to Tauri typing gaps. Minor issue.

---

### 🟢 LOW-11: Notifications Desktop Falls Back Silently

**File:** `packages/platform/src/notifications.ts:50-64`

If Tauri notification fails, falls back to `new Notification()` with no indication to caller which backend succeeded.

**Improvement:** Return `{ backend: 'tauri' | 'web' }` from `notify()`.

---

## CORRECTNESS VERIFICATION

### ✅ All exports exist and function:

| Export | Verified | Notes |
|--------|----------|-------|
| `getFs()` | ✅ | Returns web or desktop FS adapter |
| `getStorage()` | ✅ | Lazy-initialized singleton |
| `getSecrets()` | ✅ | Lazy-initialized |
| `notify()` | ✅ | Desktop→web fallback |
| `copyToClipboard()` | ✅ | Desktop→web fallback |
| `runJob()` | ✅ | Desktop Tauri invoke, web in-memory |
| `isDesktopMode()` | ✅ | Dual-mode detection |
| `getShellCommand()` | ✅ | Desktop returns `/bin/bash`, web returns `bash` |

### ✅ Platform selection logic correct:
- Uses dynamic `import()` for Tauri modules (avoids bundling)
- Falls back gracefully when Tauri unavailable
- Works in both SSR and client

---

## SECURITY CONCERNS SUMMARY

| Issue | Severity | Exploitability | Impact | Fix Effort |
|-------|----------|----------------|--------|------------|
| Web secrets encryption trivial to break | HIGH | Easy (browser devtools) | Secret disclosure | 3 days |
| Desktop secrets fallback split-brain | HIGH | Medium (misclassification) | Inconsistent security | 2 days |
| Storage quota errors unhandled | MEDIUM | Easy (fill localStorage) | DoS/crash | 1h |
| Storage interface duplicated | MEDIUM | N/A (maintenance) | Future bugs | 2h |
| ensureDir error swallowing | MEDIUM | Medium (disk full) | Confusing errors | 1h |
| Web FS mostly unimplemented | MEDIUM | N/A (design) | Silent failure | 1 week |
| Path sanitization collision | LOW | Hard (collision) | Data loss risk | 2h |
| Desktop mode env detection SSR | LOW | Edge case | Hydration mismatch | 2h |
| Jobs error indistinct | LOW | N/A | Debugging harder | 1h |
| Clipboard as any | LOW | None | Type safety only | 30min |

---

## CONCURRENCY & RACE CONDITIONS

**Lazy initialization pattern** used in `getStorage()`, `getSecrets()`, `getFs()`:

```typescript
let storagePromise: Promise<StorageAdapter> | null = null;
export function getStorage(): Promise<StorageAdapter> {
  if (!storagePromise) {
    storagePromise = StorageAdapter.create(); // Async factory
  }
  return storagePromise;
}
```

**Race condition:** If two calls happen concurrently before promise resolves, both get same promise (good). Subsequent calls wait on same promise. No double-initialization.

**Write concurrency:**
- `localStorage` is synchronous — browser handles serialization
- Desktop file writes via Tauri — Tauri likely serializes
- No explicit locks but underlying implementations should be safe for single-writer (single user session)

**Conclusion:** ✅ Acceptable for **single-user-per-session** model.

---

## PERFORMANCE

- **Lazy loading**: Dynamic imports for Tauri modules — good for bundle size
- **Caching**: `storagePromise` cached — factory called once
- **Async all the way**: All I/O is async, no blocking main thread
- **Memoization**: None beyond lazy init — repeated `getStorage()` returns same cached promise (good)

No obvious performance bottlenecks.

---

## DOCUMENTATION GAPS

1. **No README** in `packages/platform/`
2. **No API reference** — what's exported, what each function does
3. **No threat model** — what attacks the web vs desktop implementations protect against
4. **No usage examples** — how should consumers import and use?
5. **Secrets security warning missing** — web encryption is not truly secure

---

## CONSUMER USAGE ANALYSIS

**Consumers found:**
- `desktop/src-tauri/web-assets/web/lib/sandbox/providers/desktop-provider.ts` — uses `env`, `shell` (good)
- `desktop/entry.ts` — uses `isTauriRuntime()`
- Various test files — mock platform APIs
- Integration tests verify workspace boundaries

**No misuse detected.** Consumers use dynamic imports correctly.

---

## ACTION ITEMS

### Immediate (P0)
1. **Add prominent warning to `@bing/platform` README:**
   > "Web secrets are obfuscated, not encrypted. Do NOT store high-value secrets (API keys, passwords) in browser storage. Use server-side vault for production secrets."

2. **Fix desktop storage `ensureDir` error handling** — re-throw or propagate.

### Short-term (P1)
3. **Implement proper secrets for web** — use Web Crypto with user passphrase, or remove encryption pretense
4. **Add `StorageAdapter` shared interface** (`storage/types.ts`)
5. **Implement missing FS methods or throw `NotImplementedError`**
6. **Add realpath check to `safeJoin`** (inherit from VFS materializer)

### Medium-term (P2)
7. **Add comprehensive test suite** for platform adapters
8. **Document platform detection pattern** and SSR considerations
9. **Add audit logging** for secret/storage access (optional)

---

## ARCHITECTURAL NOTES

**Pattern:** Proxy with lazy-loaded implementation — elegant and correct.

**Design trade-off:** Web implementation deliberately limited due to browser sandbox. This is fine, but should be **explicitly documented** to set correct expectations.

**Testing:** Test files exist (`desktop/__tests__/tauri-invoke-integration.test.ts`) but integration-only. No unit tests for individual adapters.

---

## SUMMARY TABLE

| Component | Health | Blockers | Notes |
|-----------|--------|----------|-------|
| FS abstraction | 🟡 Medium | Web incomplete | Throw errors for unsupported |
| Storage | 🟠 High | Quota errors | Add try-catch |
| Secrets | 🔴 High | False security | Rework or document |
| Clipboard | 🟢 Low | None | OK |
| Notifications | 🟢 Low | Silent fallback | Add backend indicator |
| Jobs | 🟢 Low | Error clarity | Distinguish platform vs job error |
| Env detection | 🟢 Low | SSR edge | Document usage |

---

**Recommendation:** Platform layer is **usable but needs hardening**. Secrets are the biggest concern — either fix encryption model or clearly document that web storage is **not** secure.

**Next steps:** Update `reviews/secrets-review.md` for deeper secrets analysis.
