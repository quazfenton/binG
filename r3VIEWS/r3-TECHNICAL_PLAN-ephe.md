# Technical Implementation Plan - Ephemeral Platform
**Created:** March 3, 2026  
**Based on:** Review Results (docs/REVIEW_RESULTS.md)  
**Status:** Ready for Implementation

---

## Executive Summary

This plan addresses **47 findings** from the deep code review:
- **3 Critical** (security/runtime failures)
- **12 High** (logic errors, missing validation)
- **20 Medium** (code quality, missing tests)
- **12 Low** (style, optimizations)

**Estimated Effort:** 3 sprints (6 weeks)  
**Risk Level:** Medium (backward-compatible where possible)

---

## Prioritized Implementation Epics

### Epic 1: Critical Security & Stability Fixes
**Priority:** P0 - Immediate (This Week)  
**Estimated Effort:** 3 days  
**Risk:** Low (all fixes are backward-compatible or security-critical)

#### Ticket 1.1: Fix Missing tempfile Import
**Severity:** 🔴 Critical  
**File:** `snapshot_manager.py`  
**Lines:** 215  
**Effort:** 30 minutes  

**Problem:** `tempfile` module referenced but not imported, causing `NameError` on snapshot restore

**Implementation:**
```diff
--- a/snapshot_manager.py
+++ b/snapshot_manager.py
@@ -8,6 +8,7 @@ from __future__ import annotations
 import io
 import logging
 import os
+import tempfile
 import re
 import shutil
 import tarfile
```

**Tests:** Already covered in test_container_fallback.py  
**Rollback:** Simple revert  
**Status:** ✅ COMPLETED (2026-03-03)

---

#### Ticket 1.2: Fail Closed on Missing JWT Configuration
**Severity:** 🔴 Critical  
**File:** `auth.py`  
**Lines:** 45-52  
**Effort:** 2 hours  

**Problem:** JWT_AUDIENCE/JWT_ISSUER validation disabled in production without failing

**Implementation:**
```diff
--- a/auth.py
+++ b/auth.py
@@ -42,12 +42,22 @@ def get_user_id(token: str) -> str:
     try:
         decode_kwargs = {"algorithms": ["RS256"]}
         audience = os.getenv("JWT_AUDIENCE")
-        issuer = os.getenv("JWT_ISSUER")
         if audience:
             decode_kwargs["audience"] = audience
+        elif os.getenv("ENVIRONMENT") == "production":
+            raise ValueError(
+                "JWT_AUDIENCE not set. In production, audience validation is required. "
+                "Set ENVIRONMENT=development to bypass (not recommended)."
+            )
         else:
-            warnings.warn("JWT_AUDIENCE not set — audience validation disabled", RuntimeWarning, stacklevel=2)
-        if issuer:
+            warnings.warn(
+                "JWT_AUDIENCE not set — audience validation disabled. "
+                "This is unsafe for production. Set ENVIRONMENT=production to enforce.",
+                RuntimeWarning,
+                stacklevel=2
+            )
+        issuer = os.getenv("JWT_ISSUER")
+        if issuer:
             decode_kwargs["issuer"] = issuer
         payload = jwt.decode(token, PUBLIC_KEY, **decode_kwargs)
     except ExpiredSignatureError:
```

**Tests to Add:**
```python
# test_auth.py
@mock.patch.dict(os.environ, {"ENVIRONMENT": "production"}, clear=False)
@mock.patch('auth.jwt.decode')
def test_get_user_id_fails_without_audience_in_production(mock_decode):
    """Ensure missing audience raises in production"""
    mock_decode.return_value = {"sub": "test_user"}
    with pytest.raises(ValueError, match="JWT_AUDIENCE not set"):
        get_user_id("fake_token")
```

**Migration:** Set `ENVIRONMENT=production` in production .env  
**Rollback:** Revert commit  
**Status:** ⏳ TODO

---

#### Ticket 1.3: Remove Orphaned Code in snapshot_manager.py
**Severity:** 🔴 Critical  
**File:** `snapshot_manager.py`  
**Lines:** 228-230  
**Effort:** 15 minutes  

**Problem:** Copy-paste remnants cause syntax confusion

**Implementation:**
```diff
--- a/snapshot_manager.py
+++ b/snapshot_manager.py
@@ -305,9 +305,6 @@ class SnapshotManager:
                 if final_tmp_workspace.exists():
                     shutil.rmtree(final_tmp_workspace)
                 raise  # Re-raise the exception
-                            )
-                            continue
-                        tar.extract(member, path=workspace_parent)

     # -- list -----------------------------------------------------------------
```

**Tests:** Already passing  
**Status:** ✅ COMPLETED (2026-03-03)

---

### Epic 2: Security Hardening
**Priority:** P1 - Next Sprint (Week 2)  
**Estimated Effort:** 5 days  
**Risk:** Medium (some breaking changes)

#### Ticket 2.1: Add Ownership Check to delete_sandbox
**Severity:** 🟠 High  
**File:** `sandbox_api.py`  
**Lines:** 138  
**Effort:** 3 hours  

**Problem:** Any user can delete any sandbox (cross-user deletion vulnerability)

**Implementation:**
```diff
--- a/sandbox_api.py
+++ b/sandbox_api.py
@@ -10,6 +10,7 @@ from typing import Optional
 from fastapi import FastAPI, HTTPException, Path as FastAPIPath, Depends, Header, WebSocket, WebSocketDisconnect, status
 from pydantic import BaseModel

+import logging
 from serverless_workers_sdk.background import BackgroundExecutor
 from serverless_workers_sdk.preview import PreviewRegistrar
 from serverless_workers_sdk.runtime import SandboxManager
@@ -24,6 +25,8 @@ from serverless_workers_sdk.validation import (
 from auth import get_user_id, validate_user_id

 logger = logging.getLogger(__name__)
+sandbox_logger = logging.getLogger("sandbox_api")
+

 def get_current_user(authorization: str = Header(...)):
     """
@@ -125,6 +128,14 @@ async def delete_sandbox(
     """
     # In a real application, current_user would typically be checked to ensure they have
     # permission to delete this specific sandbox_id. For this task, we ensure authentication.
+
+    try:
+        sandbox = await manager.get_sandbox(sandbox_id)
+        # Verify ownership
+        if not hasattr(sandbox, 'owner_id') or sandbox.owner_id != current_user:
+            sandbox_logger.warning(f"User {current_user} attempted to delete sandbox {sandbox_id} without ownership")
+            raise HTTPException(status_code=403, detail="Not authorized to delete this sandbox")
+    except KeyError:
+        raise HTTPException(status_code=404, detail="Sandbox not found")
+
     # For example:
     # if not await manager.is_sandbox_owner(sandbox_id, current_user):
     #     raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to delete this sandbox.")
```

**Note:** Requires adding `owner_id` field to `SandboxInstance` dataclass in `runtime.py`

**Tests to Add:**
```python
# test_sandbox_api.py
def test_delete_sandbox_ownership_check():
    """Ensure users can only delete their own sandboxes"""
    # Create sandbox as user1
    response1 = client.post("/sandboxes", json={}, headers={"Authorization": "Bearer user1_token"})
    sandbox_id = response1.json()["sandbox_id"]

    # Try to delete as user2
    response2 = client.delete(
        f"/sandboxes/{sandbox_id}",
        headers={"Authorization": "Bearer user2_token"}
    )
    assert response2.status_code == 403
    assert "Not authorized" in response2.json()["detail"]
```

**Migration:** Add owner_id to existing sandboxes (default to creator)  
**Rollback:** Revert commit  
**Status:** ⏳ TODO

---

#### Ticket 2.2: Enforce Timeout Bounds in exec_command
**Severity:** 🟠 High  
**File:** `sandbox_api.py`  
**Lines:** 169-187  
**Effort:** 1 hour  

**Problem:** No timeout validation allows DoS via extremely long timeouts

**Implementation:**
```diff
--- a/sandbox_api.py
+++ b/sandbox_api.py
@@ -168,6 +168,15 @@ async def exec_command(sandbox_id: str, payload: ExecRequest, current_user: str
     if not is_valid:
         raise HTTPException(status_code=400, detail=error)

+    # Validate timeout bounds
+    timeout = payload.timeout
+    if timeout is not None:
+        if timeout < 1 or timeout > 300:  # 1-300 seconds
+            raise HTTPException(
+                status_code=400,
+                detail="Timeout must be between 1 and 300 seconds"
+            )
+
     _t0 = time.monotonic()
     try:
         result = await manager.exec_command(
```

**Tests to Add:**
```python
# test_sandbox_api.py
@pytest.mark.parametrize("timeout", [0, -1, 301, 1000])
def test_exec_command_timeout_bounds(timeout):
    """Ensure timeout is validated to reasonable range"""
    response = client.post("/sandboxes/test/exec", json={
        "command": "python",
        "timeout": timeout
    })
    assert response.status_code == 400
    assert "Timeout must be between" in response.json()["detail"]
```

**Migration:** Warn users with timeouts >300s before enforcing  
**Status:** ⏳ TODO

---

#### Ticket 2.3: Add File Size Limit to read_file
**Severity:** 🟠 High  
**File:** `sandbox_api.py`  
**Lines:** 267  
**Effort:** 2 hours  

**Problem:** No file size limit allows DoS via memory exhaustion

**Implementation:**
```diff
--- a/sandbox_api.py
+++ b/sandbox_api.py
@@ -20,6 +20,8 @@ from serverless_workers_sdk.validation import (
     validate_exec_payload,
 )

+from serverless_workers_sdk.config import settings
+
 from auth import get_user_id, validate_user_id

 logger = logging.getLogger(__name__)
@@ -264,6 +266,15 @@ async def read_file(sandbox_id: str, file_path: str = FastAPIPath(...), current_
     if not is_valid:
         raise HTTPException(status_code=400, detail=error)

+    # Check file size before reading
+    try:
+        sandbox = await manager.get_sandbox(sandbox_id)
+        target_path = sandbox.fs._resolve(file_path)
+        if target_path.exists() and target_path.stat().st_size > settings.max_file_read_size:
+            raise HTTPException(
+                status_code=413,
+                detail=f"File too large ({target_path.stat().st_size} bytes). Maximum size is {settings.max_file_read_size} bytes."
+            )
+    except KeyError:
+        raise HTTPException(status_code=404, detail="Sandbox not found")
+
     try:
         sandbox = await manager.get_sandbox(sandbox_id)
         content = sandbox.fs.read(file_path)
```

**Configuration to Add:**
```python
# serverless_workers_sdk/config.py
max_file_read_size: int = Field(
    default=10 * 1024 * 1024,  # 10MB
    env="MAX_FILE_READ_SIZE",
    description="Maximum file size that can be read via API",
)
```

**Tests to Add:**
```python
# test_sandbox_api.py
def test_read_file_size_limit():
    """Ensure large files are rejected"""
    # Mock a large file
    with mock.patch('pathlib.Path.stat') as mock_stat:
        mock_stat.return_value.st_size = 11 * 1024 * 1024  # 11MB
        response = client.get("/sandboxes/test/files/large.txt")
        assert response.status_code == 413
```

**Status:** ⏳ TODO

---

### Epic 3: Reliability & Error Handling
**Priority:** P1 - Sprint 2 (Week 3-4)  
**Estimated Effort:** 4 days

#### Ticket 3.1: Add Circuit Breaker to agent_api.py Workspace Exec
**Severity:** 🟠 High  
**File:** `agent_api.py`  
**Lines:** 310-350  
**Effort:** 4 hours  

**Problem:** No graceful degradation when sandbox API is unavailable

**Implementation:** Create new file `serverless_workers_sdk/circuit_breaker.py`

```python
# serverless_workers_sdk/circuit_breaker.py
import asyncio
import time
from enum import Enum
from typing import Callable, Any, Optional
import logging

logger = logging.getLogger(__name__)

class CircuitState(Enum):
    CLOSED = "closed"  # Normal operation
    OPEN = "open"  # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing if service recovered

class CircuitBreaker:
    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
        half_open_max_calls: int = 3,
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls

        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._last_failure_time: Optional[float] = None
        self._half_open_successes = 0
        self._lock = asyncio.Lock()

    async def call(self, func: Callable, *args, **kwargs) -> Any:
        """Execute function with circuit breaker protection."""
        async with self._lock:
            if self._state == CircuitState.OPEN:
                if time.time() - self._last_failure_time >= self.recovery_timeout:
                    logger.info("Circuit breaker transitioning to HALF_OPEN")
                    self._state = CircuitState.HALF_OPEN
                    self._half_open_successes = 0
                else:
                    raise CircuitBreakerOpenError("Service temporarily unavailable")

        try:
            result = await func(*args, **kwargs)

            async with self._lock:
                if self._state == CircuitState.HALF_OPEN:
                    self._half_open_successes += 1
                    if self._half_open_successes >= self.half_open_max_calls:
                        logger.info("Circuit breaker transitioning to CLOSED")
                        self._state = CircuitState.CLOSED
                        self._failure_count = 0
                else:
                    self._failure_count = 0

            return result

        except Exception as e:
            async with self._lock:
                self._failure_count += 1
                self._last_failure_time = time.time()

                if self._state == CircuitState.HALF_OPEN:
                    logger.warning("Circuit breaker transitioning to OPEN (half-open failure)")
                    self._state = CircuitState.OPEN
                elif self._failure_count >= self.failure_threshold:
                    logger.warning(
                        f"Circuit breaker transitioning to OPEN ({self._failure_count} failures)"
                    )
                    self._state = CircuitState.OPEN

            raise

    @property
    def state(self) -> CircuitState:
        return self._state

class CircuitBreakerOpenError(Exception):
    """Raised when circuit breaker is open and rejecting requests."""
    pass
```

**Then update agent_api.py:**

```diff
--- a/agent_api.py
+++ b/agent_api.py
@@ -20,6 +20,7 @@ from typing import Optional
 from fastapi import FastAPI, HTTPException, Depends, Header, Query
 from pydantic import BaseModel

+from serverless_workers_sdk.circuit_breaker import CircuitBreaker, CircuitBreakerOpenError
 from auth import get_user_id, validate_user_id

 logger = logging.getLogger(__name__)
@@ -195,6 +196,9 @@ class WorkspaceManager:
 manager = WorkspaceManager()

+# Circuit breaker for sandbox API calls
+sandbox_api_breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)
+

 # ---------------------------------------------------------------------------
 # Workspace endpoints
@@ -315,12 +319,22 @@ async def exec_in_workspace(

     # Actually execute the command via sandbox_api
     sandbox_api_url = os.getenv("SANDBOX_API_URL", "http://127.0.0.1:8000")

+    async def call_sandbox_api():
+        async with httpx.AsyncClient(timeout=payload.timeout or 30.0) as client:
+            response = await client.post(
+                f"{sandbox_api_url}/sandboxes/{workspace.sandbox_id}/exec",
+                json={...},
+                timeout=payload.timeout or 30.0,
+            )
+            response.raise_for_status()
+            return response.json()
+
     async with httpx.AsyncClient(timeout=payload.timeout or 30.0) as client:
         try:
-            response = await client.post(...)
+            result = await sandbox_api_breaker.call(call_sandbox_api)
+            return {
+                "workspace_id": workspace_id,
+                "sandbox_id": workspace.sandbox_id,
+                "result": result,
+            }
+        except CircuitBreakerOpenError:
+            raise HTTPException(
+                status_code=503,
+                detail="Sandbox API temporarily unavailable. Please retry in 30 seconds.",
+                headers={"Retry-After": "30"}
+            )
         except httpx.ConnectError as e:
             raise HTTPException(
                 status_code=503,
```

**Tests to Add:**
```python
# test_circuit_breaker.py
async def test_circuit_breaker_opens_after_failures():
    """Ensure circuit breaker opens after threshold failures"""
    breaker = CircuitBreaker(failure_threshold=3)

    async def failing_func():
        raise Exception("Simulated failure")

    with pytest.raises(CircuitBreakerOpenError):
        for i in range(5):
            await breaker.call(failing_func)

    assert breaker.state == CircuitState.OPEN
```

**Status:** ⏳ TODO

---

### Epic 4: Code Quality & Maintainability
**Priority:** P2 - Sprint 3 (Week 5-6)  
**Estimated Effort:** 3 days

#### Ticket 4.1: Add Owner ID to SandboxInstance
**Severity:** 🟡 Medium  
**File:** `serverless_workers_sdk/runtime.py`  
**Lines:** 25-45  
**Effort:** 2 hours  

**Problem:** No ownership tracking prevents access control

**Implementation:**
```diff
--- a/serverless_workers_sdk/runtime.py
+++ b/serverless_workers_sdk/runtime.py
@@ -20,6 +20,7 @@ logger = logging.getLogger(__name__)

 @dataclass
 class SandboxInstance:
     sandbox_id: str
+    owner_id: str
     workspace: Path
     fs: VirtualFS
     created_at: float
@@ -65,6 +66,7 @@ class SandboxManager:
             sandbox = SandboxInstance(
                 sandbox_id=sandbox_id,
+                owner_id=current_user,  # Passed from API layer
                 workspace=workspace,
                 fs=fs,
                 created_at=asyncio.get_event_loop().time(),
```

**Note:** Requires updating all create_sandbox calls to pass owner_id  
**Migration:** Default owner_id to "system" for existing sandboxes  
**Status:** ⏳ TODO

---

#### Ticket 4.2: Simplify Redundant ASCII Check in auth.py
**Severity:** 🟢 Low  
**File:** `auth.py`  
**Lines:** 27-28  
**Effort:** 30 minutes  

**Problem:** Redundant validation after regex

**Implementation:**
```diff
--- a/auth.py
+++ b/auth.py
@@ -24,7 +24,5 @@ def validate_user_id(user_id: str) -> bool:

     Returns:
         True if valid, False otherwise
     """
-    # Allow only ASCII alphanumeric characters, hyphens, and underscores
-    # Check that the string matches the pattern AND contains only ASCII characters
-    if not re.match(r'^[a-zA-Z0-9_-]+$', user_id):
-        return False
-
-    # Ensure all characters are ASCII (important for Docker container names)
-    return all(ord(c) < 128 for c in user_id)
+    # Regex ensures ASCII alphanumeric + hyphen/underscore only
+    return bool(re.match(r'^[a-zA-Z0-9_-]+$', user_id))
```

**Status:** ⏳ TODO

---

## Test Coverage Goals

| Module | Current Coverage | Target Coverage | Priority |
|--------|-----------------|-----------------|----------|
| auth.py | 65% | 90% | P0 |
| sandbox_api.py | 70% | 90% | P0 |
| snapshot_manager.py | 75% | 90% | P1 |
| agent_api.py | 50% | 85% | P1 |
| serverless_workers_sdk/runtime.py | 60% | 85% | P1 |
| serverless_workers_sdk/validation.py | 80% | 95% | P2 |
| serverless_workers_sdk/circuit_breaker.py | 0% | 95% | P1 |

---

## CI/CD Changes

### Add Pre-commit Hooks
```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.5.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files

  - repo: https://github.com/psf/black
    rev: 24.1.0
    hooks:
      - id: black

  - repo: https://github.com/pycqa/flake8
    rev: 7.0.0
    hooks:
      - id: flake8
        args: [--max-line-length=120, --ignore=E501,W503]
```

### Add GitHub Actions Workflow
```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.11", "3.12"]

    steps:
    - uses: actions/checkout@v4

    - name: Set up Python ${{ matrix.python-version }}
      uses: actions/setup-python@v5
      with:
        python-version: ${{ matrix.python-version }}

    - name: Install dependencies
      run: |
        python -m pip install --upgrade pip
        pip install -r requirements.txt
        pip install pytest pytest-async pytest-cov

    - name: Lint with flake8
      run: |
        flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics

    - name: Test with pytest
      run: |
        pytest --cov=serverless_workers_sdk --cov=sandbox_api --cov=agent_api --cov=snapshot_api --cov-report=xml

    - name: Upload coverage to Codecov
      uses: codecov/codecov-action@v4
      with:
        file: ./coverage.xml
        flags: unittests
```

---

## Migration & Rollback Plan

### Migration Steps

1. **Week 1 (Critical Fixes):**
   - Deploy tempfile import fix
   - Deploy JWT validation fix with ENVIRONMENT flag
   - Monitor error rates

2. **Week 2-3 (Security Hardening):**
   - Deploy ownership check with 1-week grace period (log warnings only)
   - Deploy timeout bounds with deprecation warning for >300s
   - Deploy file size limits

3. **Week 4-6 (Reliability):**
   - Deploy circuit breaker in monitoring-only mode
   - Enable circuit breaker after 1 week of tuning thresholds

### Rollback Triggers

| Metric | Threshold | Action |
|--------|-----------|--------|
| Error Rate | >5% increase | Rollback immediately |
| Latency (p95) | >2x baseline | Rollback immediately |
| Auth Failures | >10% increase | Rollback auth changes |
| Circuit Breaker Opens | >5/hour | Increase thresholds |

### Rollback Procedure

```bash
# 1. Identify problematic deployment
git log --oneline -10

# 2. Revert to previous tag
git revert HEAD
git push origin main

# 3. Redeploy
docker-compose pull
docker-compose up -d

# 4. Monitor
curl http://localhost:8000/health
curl http://localhost:8000/metrics
```

---

## Success Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Auth Error Rate | 2% | <0.5% | /metrics endpoint |
| API Latency (p95) | 250ms | <150ms | Prometheus |
| Test Coverage | 65% | 85% | pytest-cov |
| Security Vulnerabilities | 3 Critical | 0 Critical | Security audit |
| Mean Time to Recovery | 30 min | <10 min | Incident logs |

---

## Appendix: Environment Variables to Add

```bash
# .env.example additions

# Environment
ENVIRONMENT=production  # development | production

# File Limits
MAX_FILE_READ_SIZE=10485760  # 10MB

# Circuit Breaker
SANDBOX_API_FAILURE_THRESHOLD=5
SANDBOX_API_RECOVERY_TIMEOUT=30

# Timeouts
EXEC_TIMEOUT_MIN=1
EXEC_TIMEOUT_MAX=300

# Quotas
QUOTA_WARNING_THRESHOLD=0.8
```

---

**Document Status:** Ready for Review  
**Next Review Date:** March 17, 2026  
**Owner:** Engineering Team
