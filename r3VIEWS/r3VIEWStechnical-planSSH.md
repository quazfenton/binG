# sshBox - Technical Implementation Plan

**Document Type:** Engineering Roadmap  
**Date:** March 3, 2026  
**Version:** 1.0  
**Status:** Ready for Implementation

---

## Executive Summary

This technical plan outlines the prioritized implementation roadmap for addressing findings from the comprehensive code review. The plan is organized into 4 phases over 6 weeks, with clear milestones, rollback procedures, and success metrics.

### Implementation Goals

1. **Security Hardening** - Address all MEDIUM+ security findings
2. **Implementation Gaps** - Complete mock/partial implementations
3. **Quality Improvements** - Increase test coverage to 90%
4. **Architecture Cleanup** - Remove technical debt and duplication

### Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Production Ready | 87% | 95% | Review checklist |
| Test Coverage | 87% | 90% | pytest --cov |
| Critical Issues | 10 | 0 | review-results.md |
| Security Score | 8/10 | 9/10 | bandit scan |
| Code Quality | B | A | codacy/sonar |

---

## Phase 1: Critical Fixes (Week 1)

### Sprint Goal
Address all CRITICAL and MEDIUM severity issues that could cause production incidents.

### Updated Tasks (Including Session 2 Findings)

#### Task 1.1: Fix TTL Range Validation
- **Issue:** 2.1 in review-results.md
- **File:** `api/security.py:178-180`
- **Complexity:** LOW (2 hours)
- **Risk:** LOW
- **Acceptance Criteria:**
  - TTL < 60 rejected with clear error
  - TTL > 7200 rejected with clear error
  - Tests pass for boundary cases
- **Implementation:**
  ```python
  # Replace lines 178-180:
  max_ttl = getattr(settings, 'max_ttl', 7200)
  min_ttl = 60  # Default minimum
  
  if ttl < min_ttl or ttl > max_ttl:
      raise TokenValidationError(
          f"TTL must be between {min_ttl} and {max_ttl} seconds",
          "INVALID_TTL_RANGE"
      )
  ```
- **Tests:** `tests/test_security.py::test_ttl_range_validation`
- **Rollback:** Revert to always-pass validation (not recommended)

---

#### Task 1.2: Add Session ID UUID Suffix
- **Issue:** 1.3 in review-results.md
- **File:** `api/gateway_fastapi.py:618`
- **Complexity:** LOW (1 hour)
- **Risk:** LOW
- **Acceptance Criteria:**
  - Session IDs unique under concurrent creation
  - Existing session lookups still work
- **Implementation:**
  ```python
  # Replace line 618:
  import uuid
  session_id = f"box_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
  ```
- **Tests:** `tests/test_gateway.py::test_session_id_uniqueness`
- **Rollback:** Revert to timestamp-only IDs (not recommended)

---

#### Task 1.3: Add Destroy Retry Logic
- **Issue:** 1.4 in review-results.md
- **File:** `api/gateway_fastapi.py:388-420`
- **Complexity:** MEDIUM (4 hours)
- **Risk:** LOW
- **Acceptance Criteria:**
  - Failed destroys retry 3 times with exponential backoff
  - Dead letter queue for persistent failures
  - Metrics exported for retry attempts
- **Implementation:**
  ```python
  # Add to imports:
  from tenacity import retry, stop_after_attempt, wait_exponential
  
  # Add before schedule_destroy function:
  @retry(
      stop=stop_after_attempt(3),
      wait=wait_exponential(multiplier=1, min=5, max=60)
  )
  def destroy_with_retry(container_name: str) -> subprocess.CompletedProcess:
      return subprocess.run(
          ['./scripts/box-destroy.sh', container_name],
          capture_output=True,
          text=True,
          timeout=30
      )
  
  # In destroy_task(), replace subprocess.run call:
  try:
      result = destroy_with_retry(container_name)
      # ... rest of logic
  except Exception as e:
      logger.error(f"Destroy failed after retries: {e}")
      # Add to dead letter queue
      redis_client.lpush(
          "sshbox:dead_letter:destroy",
          json.dumps({
              "session_id": session_id,
              "container_name": container_name,
              "error": str(e),
              "timestamp": datetime.utcnow().isoformat()
          })
      )
  ```
- **Tests:** `tests/test_gateway.py::test_destroy_retry_logic`
- **Rollback:** Remove @retry decorator, use original subprocess.run

---

#### Task 1.4: Add Configuration Validation
- **Issue:** 3.1 in review-results.md
- **File:** `api/config_enhanced.py`
- **Complexity:** MEDIUM (4 hours)
- **Risk:** MEDIUM
- **Acceptance Criteria:**
  - Invalid config caught at startup
  - Clear error messages for each validation failure
  - Feature flag for strict mode
- **Implementation:**
  ```python
  # Add to Config class in config_enhanced.py:
  def validate(self, strict: bool = False) -> List[str]:
      """Validate all configuration and return list of errors"""
      errors = []
      
      # Security validation
      if not self.security.gateway_secret:
          errors.append("SSHBOX_SECURITY_GATEWAY_SECRET is required")
      elif len(self.security.gateway_secret) < self.security.secret_min_length:
          errors.append(
              f"Gateway secret must be at least {self.security.secret_min_length} characters"
          )
      
      # Database validation
      if self.database.db_type == "sqlite":
          db_dir = os.path.dirname(self.database.sqlite_path)
          if not os.access(db_dir, os.W_OK):
              errors.append(f"SQLite path not writable: {self.database.sqlite_path}")
      
      # Storage validation
      if not os.access(self.storage.recordings_dir, os.W_OK):
          errors.append(f"Recordings directory not writable: {self.storage.recordings_dir}")
      
      # In strict mode, raise exception on errors
      if strict and errors:
          raise ConfigurationError(f"Configuration validation failed: {errors}")
      
      return errors
  
  # In get_config():
  config = Config()
  strict = os.environ.get('SSHBOX_CONFIG_VALIDATION_STRICT', 'false').lower() == 'true'
  errors = config.validate(strict=strict)
  if errors:
      logger.error(f"Configuration validation failed: {errors}")
      if strict:
          sys.exit(1)
  ```
- **Tests:** `tests/test_config.py::test_config_validation`
- **Rollback:** Set `SSHBOX_CONFIG_VALIDATION_STRICT=false`

---

#### Task 1.6: Add Firecracker IP Allocation Locking
- **Issue:** 11.2 in review-results.md
- **File:** `api/provisioner_enhanced.py:230-270`
- **Complexity:** MEDIUM (4 hours)
- **Risk:** MEDIUM
- **Acceptance Criteria:**
  - File-based IP allocation uses proper locking
  - No IP collisions under concurrent provisioning
  - Atomic file writes with temp file + rename
- **Implementation:** See review-results.md Issue 11.2
- **Tests:** `tests/test_provisioner.py::test_ip_allocation_concurrent`
- **Rollback:** Revert to non-locked allocation (not recommended)

---

#### Task 1.7: Add Authentication to Interview API
- **Issue:** 13.1 in review-results.md
- **File:** `api/interview_api.py` (throughout)
- **Complexity:** MEDIUM (6 hours)
- **Risk:** HIGH
- **Acceptance Criteria:**
  - All interview endpoints require authentication
  - Role-based access control (admin, interviewer only)
  - Clear error messages for unauthorized access
- **Implementation:** See review-results.md Issue 13.1
- **Feature Flag:** `SSHBOX_INTERVIEW_REQUIRE_AUTH`
- **Rollback:** Set flag to false

---

### Phase 1 Deliverables (Updated)

- [ ] TTL range validation fixed and tested
- [ ] Session ID collision risk eliminated
- [ ] Destroy retry logic with dead letter queue
- [ ] Configuration validation at startup
- [ ] 5 critical tests implemented
- [ ] **NEW:** Firecracker IP allocation with proper locking
- [ ] **NEW:** Interview API authentication
- [ ] Test coverage: 87% → 89%

### Phase 1 Rollback Plan

If issues arise:
1. Set `SSHBOX_CONFIG_VALIDATION_STRICT=false` (immediate)
2. Revert session ID change if collisions detected (unlikely)
3. Disable retry logic by removing @retry decorator (last resort)

---

## Phase 2: Security Hardening (Week 2)

### Sprint Goal
Implement security enhancements to prevent attacks and improve resilience.

### Updated Tasks (Including Session 2 Findings)

#### Task 2.1: Add Token Replay Prevention
- **Issue:** 2.2 in review-results.md
- **File:** `api/security.py`
- **Complexity:** MEDIUM (6 hours)
- **Risk:** MEDIUM
- **Acceptance Criteria:**
  - Tokens cannot be reused within TTL window
  - Nonce tracking with automatic cleanup
  - Metrics for replay attempts
- **Implementation:** See review-results.md Issue 2.1
- **Feature Flag:** `SSHBOX_TOKEN_REPLAY_PREVENTION`
- **Rollback:** Set flag to false

---

#### Task 2.2: Add WebSocket Connection Limit
- **Issue:** 9.1 in review-results.md
- **File:** `web/websocket_bridge.py`
- **Complexity:** LOW (3 hours)
- **Risk:** LOW
- **Acceptance Criteria:**
  - Max 100 concurrent connections (configurable)
  - Clear error message when limit reached
  - Metrics for connection count
- **Implementation:** See review-results.md Issue 9.1
- **Rollback:** Remove connection limit code

---

#### Task 2.3: Add WebSocket Heartbeat
- **Issue:** 9.2 in review-results.md
- **File:** `web/websocket_bridge.py`
- **Complexity:** LOW (3 hours)
- **Risk:** LOW
- **Acceptance Criteria:**
  - Ping sent every 30 seconds
  - Dead connections detected and cleaned up
  - Metrics for heartbeat failures
- **Implementation:** See review-results.md Issue 9.2
- **Rollback:** Remove heartbeat task

---

#### Task 2.5: Add Exception Sensitive Data Redaction
- **Issue:** 15.1 in review-results.md
- **File:** `api/exceptions.py:14-20`
- **Complexity:** LOW (2 hours)
- **Risk:** LOW
- **Acceptance Criteria:**
  - Sensitive fields redacted in exception to_dict()
  - Fields checked: password, secret, token, key, auth
  - Tests verify redaction works
- **Implementation:** See review-results.md Issue 15.1
- **Tests:** `tests/test_exceptions.py::test_sensitive_data_redaction`
- **Rollback:** Remove redaction logic (not recommended)

---

#### Task 2.6: Add Observer Token Security
- **Issue:** 13.2 in review-results.md
- **File:** `api/interview_api.py:165-170`
- **Complexity:** MEDIUM (4 hours)
- **Risk:** MEDIUM
- **Acceptance Criteria:**
  - Observer tokens not exposed in URL parameters
  - POST endpoint for observer session generation
  - Short-lived signed tokens
- **Implementation:** See review-results.md Issue 13.2
- **Feature Flag:** `SSHBOX_INTERVIEW_SECURE_OBSERVER_TOKENS`
- **Rollback:** Set flag to false

---

### Phase 2 Deliverables (Updated)

- [ ] Token replay prevention implemented
- [ ] WebSocket connection limiting
- [ ] WebSocket heartbeat for dead connection detection
- [ ] Resource limit checks in provisioner
- [ ] **NEW:** Exception sensitive data redaction
- [ ] **NEW:** Observer token security
- [ ] Test coverage: 89% → 90%

### Phase 2 Rollback Plan

If issues arise:
1. Set `SSHBOX_TOKEN_REPLAY_PREVENTION=false` (immediate)
2. Increase `SSHBOX_WEBSOCKET_MAX_CONNECTIONS` if limit too low
3. Disable heartbeat if causing issues (unlikely)

---

## Phase 3: Implementation Gaps (Week 3-4)

### Sprint Goal
Complete partial implementations and close critical functionality gaps.

### Tasks

#### Task 3.1: Implement SSH Proxy Recorder
- **Issue:** 4.1 in review-results.md
- **File:** Create `api/ssh_proxy_recorder.py`
- **Complexity:** HIGH (16 hours)
- **Risk:** HIGH
- **Acceptance Criteria:**
  - Actual SSH sessions captured and recorded
  - Asciinema cast format support
  - Metadata linked to recording files
  - Playback functionality working
- **Implementation:** Reference `docs/TECHNICAL_FINDINGS_AND_IMPROVEMENT_PLAN_2026-03-03.md`
- **Feature Flag:** `SSHBOX_RECORDING_ENABLE_SSH_PROXY`
- **Rollback:** Set flag to false, fall back to metadata-only recording

---

#### Task 3.2: Implement Code Evaluator
- **Issue:** 5.1 in review-results.md
- **File:** Add to `api/interview_mode.py`
- **Complexity:** MEDIUM (8 hours)
- **Risk:** MEDIUM
- **Acceptance Criteria:**
  - Candidate code executed against test cases
  - Timeout protection (30 seconds max)
  - Memory limit enforcement
  - Score calculated automatically
- **Implementation:** Reference `docs/TECHNICAL_FINDINGS_AND_IMPROVEMENT_PLAN_2026-03-03.md`
- **Feature Flag:** `SSHBOX_INTERVIEW_ENABLE_AUTO_SCORING`
- **Rollback:** Set flag to false, fall back to manual scoring

---

#### Task 3.3: Add Redis Session Caching
- **Issue:** 1.5 in review-results.md
- **File:** `api/gateway_fastapi.py`
- **Complexity:** MEDIUM (6 hours)
- **Risk:** LOW
- **Acceptance Criteria:**
  - Session lists cached for 60 seconds
  - Cache invalidated on session create/destroy
  - Metrics for cache hit/miss rate
- **Implementation:** See review-results.md Issue 1.5
- **Feature Flag:** `SSHBOX_REDIS_ENABLE_CACHING`
- **Rollback:** Set flag to false

---

#### Task 3.4: Add OPA Health Monitoring
- **Issue:** 7.1 in review-results.md
- **File:** `api/policy_engine.py`
- **Complexity:** LOW (4 hours)
- **Risk:** LOW
- **Acceptance Criteria:**
  - OPA health checked every 60 seconds
  - Automatic fallback to local evaluation
  - Metrics for OPA availability
- **Implementation:** See review-results.md Issue 7.1
- **Rollback:** Disable health monitoring thread

---

### Phase 3 Deliverables

- [ ] SSH proxy recorder implemented and wired
- [ ] Code evaluator for automated interview scoring
- [ ] Redis session caching for performance
- [ ] OPA health monitoring with automatic fallback
- [ ] Test coverage: 89% → 90%

### Phase 3 Rollback Plan

If issues arise:
1. Disable SSH proxy recording (fall back to metadata-only)
2. Disable auto-scoring (fall back to manual)
3. Disable Redis caching (fall back to DB-only)

---

## Phase 4: Quality Improvements (Week 5-6)

### Sprint Goal
Improve code quality, reduce technical debt, and prepare for production release.

### Tasks

#### Task 4.1: Deprecate config.py
- **Issue:** 3.2 in review-results.md
- **File:** `api/config.py`
- **Complexity:** LOW (4 hours)
- **Risk:** LOW
- **Acceptance Criteria:**
  - Deprecation warning added to config.py
  - Migration guide in docs
  - All modules migrated to config_enhanced.py
- **Implementation:**
  ```python
  # Add to top of api/config.py:
  import warnings
  warnings.warn(
      "api.config is deprecated. Use api.config_enhanced instead. "
      "Migration guide: docs/migration-config.md",
      DeprecationWarning,
      stacklevel=2
  )
  ```
- **Rollback:** Remove deprecation warning (delay migration)

---

#### Task 4.2: Add Circuit Breaker Metrics
- **Issue:** 8.1 in review-results.md
- **File:** `api/circuit_breaker.py`
- **Complexity:** LOW (3 hours)
- **Risk:** LOW
- **Acceptance Criteria:**
  - State changes exported to metrics
  - Consecutive failures tracked
  - Alerts on circuit open
- **Implementation:** See review-results.md Issue 8.1
- **Rollback:** Remove metrics calls (non-breaking)

---

#### Task 4.3: Add Remaining Tests
- **Issues:** Tests 6-10 in review-results.md
- **Complexity:** MEDIUM (8 hours)
- **Risk:** LOW
- **Acceptance Criteria:**
  - All 5 remaining tests implemented
  - Test coverage reaches 90%
- **Implementation:** See review-results.md "Tests to Add" section
- **Rollback:** N/A (tests only)

---

#### Task 4.4: Update Documentation
- **Complexity:** LOW (8 hours)
- **Risk:** LOW
- **Acceptance Criteria:**
  - README.md updated with new features
  - env.example updated with new variables
  - architecture.md created
  - Migration guides for breaking changes
- **Implementation:** See review-results.md "Documentation Updates Required"
- **Rollback:** N/A (documentation only)

---

### Phase 4 Deliverables

- [ ] config.py deprecated with migration path
- [ ] Circuit breaker metrics exported
- [ ] 5 additional tests implemented
- [ ] Documentation complete and up-to-date
- [ ] Test coverage: 90% achieved
- [ ] Production readiness checklist complete

### Phase 4 Rollback Plan

If issues arise:
1. Remove deprecation warning (delay config migration)
2. Disable circuit breaker metrics (non-breaking)

---

## CI/CD Pipeline Updates

### Add to `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'
      
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install slowapi tenacity watchdog
      
      - name: Configuration Validation
        run: |
          SSHBOX_CONFIG_VALIDATION_STRICT=true \
          SSHBOX_SECURITY_GATEWAY_SECRET="test-secret-key-min-32-chars-long" \
          python -c "from api.config_enhanced import get_config; c = get_config(); errors = c.validate(strict=True)"
      
      - name: Run tests with coverage
        run: |
          pytest tests/ --cov=api --cov-report=xml --cov-report=html
      
      - name: Check coverage threshold
        run: |
          python -c "
          import xml.etree.ElementTree as ET
          tree = ET.parse('coverage.xml')
          root = tree.getroot()
          coverage = float(root.attrib['line-rate']) * 100
          print(f'Coverage: {coverage:.1f}%')
          exit(0) if coverage >= 90 else exit(1)
          "
      
      - name: Security scan
        run: |
          pip install bandit
          bandit -r api/ -f json -o bandit-report.json
          python -c "
          import json
          report = json.load(open('bandit-report.json'))
          high = report['stats']['SEVERITY.HIGH']
          medium = report['stats']['SEVERITY.MEDIUM']
          print(f'Security issues: {high} high, {medium} medium')
          exit(0) if high == 0 else exit(1)
          "
      
      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage.xml
          flags: unittests

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'
      
      - name: Install linters
        run: |
          pip install black flake8 mypy
      
      - name: Run black
        run: black --check api/ web/ scripts/
      
      - name: Run flake8
        run: flake8 api/ web/ scripts/ --max-line-length=120
      
      - name: Run mypy
        run: mypy api/ --ignore-missing-imports
```

---

## Environment Variables to Add

### Add to `.env.example`:

```bash
# ===========================================
# Session Management (NEW)
# ===========================================
SSHBOX_SESSION_ID_USE_UUID=true
SSHBOX_SESSION_DESTROY_RETRY_ATTEMPTS=3
SSHBOX_SESSION_DESTROY_RETRY_DELAY=5
SSHBOX_SESSION_DEAD_LETTER_ENABLED=true

# ===========================================
# Redis Caching (NEW)
# ===========================================
SSHBOX_REDIS_ENABLE_CACHING=true
SSHBOX_REDIS_CACHE_TTL=300
SSHBOX_REDIS_CACHE_SESSIONS=true

# ===========================================
# WebSocket (NEW)
# ===========================================
SSHBOX_WEBSOCKET_MAX_CONNECTIONS=100
SSHBOX_WEBSOCKET_HEARTBEAT_INTERVAL=30

# ===========================================
# Configuration (NEW)
# ===========================================
SSHBOX_CONFIG_RELOAD_ON_CHANGE=false
SSHBOX_CONFIG_VALIDATION_STRICT=true

# ===========================================
# Security (ENHANCED)
# ===========================================
SSHBOX_TOKEN_REPLAY_PREVENTION=true
SSHBOX_TOKEN_NONCE_TTL=3600

# ===========================================
# Recording (ENHANCED)
# ===========================================
SSHBOX_RECORDING_ENABLE_SSH_PROXY=true
SSHBOX_RECORDING_SSH_PROXY_PORT=2222
SSHBOX_RECORDING_MAX_SIZE_MB=100

# ===========================================
# Interview (ENHANCED)
# ===========================================
SSHBOX_INTERVIEW_ENABLE_AUTO_SCORING=true
SSHBOX_INTERVIEW_EVALUATION_TIMEOUT=30
SSHBOX_INTERVIEW_EVALUATION_MAX_MEMORY_MB=256
```

---

## Risk Assessment

### High Risk Tasks

| Task | Risk | Mitigation |
|------|------|------------|
| SSH Proxy Recorder | HIGH | Feature flag, extensive testing, staged rollout |
| Code Evaluator | MEDIUM | Feature flag, timeout/memory limits, sandboxed execution |
| Config Validation | MEDIUM | Non-strict mode first, gradual rollout |

### Medium Risk Tasks

| Task | Risk | Mitigation |
|------|------|------------|
| Token Replay Prevention | MEDIUM | Feature flag, monitor replay attempts |
| Destroy Retry Logic | LOW | Dead letter queue for manual intervention |

### Low Risk Tasks

All remaining tasks are low risk with minimal production impact.

---

## Rollback Strategy

### General Rollback Procedure

1. **Feature Flags First**
   - Most tasks have feature flags for immediate disable
   - Flags can be changed without redeployment (via Redis or env reload)

2. **Code Reverts Second**
   - If flags don't resolve issue, revert specific commits
   - Each PR should be atomic for easy revert

3. **Database Rollback Last**
   - Schema changes should be backward-compatible
   - Use expand/contract pattern for migrations

### Specific Rollback Triggers

| Trigger | Action |
|---------|--------|
| Error rate > 1% after deploy | Rollback immediately |
| Test coverage drops below 87% | Block merge |
| Security scan finds HIGH issues | Block merge |
| Performance regression > 10% | Investigate, consider rollback |

---

## Success Criteria

### Phase 1 Success
- [ ] All 5 tasks completed
- [ ] Zero production incidents from changes
- [ ] Test coverage >= 88%
- [ ] All critical tests passing

### Phase 2 Success
- [ ] All 4 tasks completed
- [ ] Security scan shows 0 HIGH issues
- [ ] Test coverage >= 89%
- [ ] WebSocket connection limit working

### Phase 3 Success
- [ ] SSH proxy recorder capturing actual sessions
- [ ] Code evaluator scoring interviews
- [ ] Redis cache hit rate > 50%
- [ ] Test coverage >= 90%

### Phase 4 Success
- [ ] All 4 tasks completed
- [ ] Documentation complete
- [ ] Config migration guide published
- [ ] Production readiness checklist 100%

---

## Post-Implementation Review

### Metrics to Track

| Metric | Baseline | Target | Frequency |
|--------|----------|--------|-----------|
| Error rate | < 1% | < 0.5% | Daily |
| P95 latency | < 100ms | < 80ms | Daily |
| Test coverage | 87% | 90% | Per PR |
| Security issues | 0 HIGH | 0 HIGH | Per PR |
| Session collisions | Rare | Zero | Daily |
| Destroy failures | < 5% | < 1% | Daily |
| Cache hit rate | N/A | > 50% | Daily |
| Token replay attempts | Unknown | Zero | Daily |

### Review Meetings

- **Daily Standup:** Phase progress, blockers
- **Weekly Sprint Review:** Demo completed work
- **Phase Retrospective:** What went well, improvements
- **Post-Implementation:** Overall success assessment

---

## Appendix: Task Complexity Estimates

### Complexity Scale

| Level | Hours | Description |
|-------|-------|-------------|
| LOW | 1-4 | Simple change, well-understood |
| MEDIUM | 4-8 | Moderate complexity, some unknowns |
| HIGH | 8-16 | Complex, multiple unknowns |
| VERY HIGH | 16+ | Major implementation, significant unknowns |

### Risk Scale

| Level | Description |
|-------|-------------|
| LOW | Minimal production impact, easy rollback |
| MEDIUM | Some production impact, feature flag available |
| HIGH | Significant production impact, extensive testing required |
| VERY HIGH | Breaking changes, migration required |

---

*Document Version: 1.0*  
*Last Updated: March 3, 2026*  
*Next Review: After Phase 1 completion*
