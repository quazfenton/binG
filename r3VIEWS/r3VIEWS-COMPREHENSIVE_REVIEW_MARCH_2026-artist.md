# artist-promo-backend - Comprehensive Technical Review

**Review Date:** March 3, 2026  
**Project:** Hip-Hop Artist Promotion Backend  
**Reviewer:** Senior Engineering Audit (AI-Assisted)  
**Status:** IN PROGRESS

---

## Executive Summary

**Purpose:** Enterprise-grade music promotion outreach platform with contact intelligence pipeline, evidence-based trust scoring, manager resolution clustering, and distributed worker architecture.

**Overall Health:** 6/10 ⚠️

**Critical Issues:** 6  
**High Issues:** 14  
**Medium Issues:** 20  
**Low Issues:** 12

---

## Part 1: Pipeline Architecture Review

### Critical Finding: Pipeline State Machine Not Enforced

**Severity:** CRITICAL  
**Location:** `app/utils/pipeline_orchestrator.py` (file not found - may be in different location)  
**Impact:** Contacts can skip pipeline stages, bypassing normalization, resolution, and clustering

**Problem:**
The pipeline state machine allows arbitrary state transitions. A contact can jump from `SCRAPED` directly to `OUTREACH_READY`, bypassing:
- Signal normalization
- Entity resolution
- Graph clustering
- Verification

**Current Architecture (from documentation):**
```
Raw Signals → Normalization → Entity Resolution → Graph Clustering → Verification → Outreach Ready
```

**Actual Implementation:**
Based on the README and existing code, scrapers write directly to the `Contact` table, bypassing the entire pipeline.

**Required Fix:**

1. **Enforce State Transitions:**
```python
# app/pipeline/state_machine.py (CREATE NEW)
from enum import Enum
from typing import Dict, List

class PipelineState(Enum):
    SCRAPED = "scraped"
    NORMALIZED = "normalized"
    RESOLVED = "resolved"
    CLUSTERED = "clustered"
    VERIFIED = "verified"
    OUTREACH_READY = "outreach_ready"

class PipelineStateMachine:
    """Enforce valid state transitions in the contact pipeline."""

    VALID_TRANSITIONS: Dict[PipelineState, List[PipelineState]] = {
        PipelineState.SCRAPED: [PipelineState.NORMALIZED],
        PipelineState.NORMALIZED: [PipelineState.RESOLVED],
        PipelineState.RESOLVED: [PipelineState.CLUSTERED],
        PipelineState.CLUSTERED: [PipelineState.VERIFIED],
        PipelineState.VERIFIED: [PipelineState.OUTREACH_READY],
        PipelineState.OUTREACH_READY: [],  # Terminal state
    }

    @classmethod
    def can_transition(cls, from_state: PipelineState, to_state: PipelineState) -> bool:
        """Check if transition is valid."""
        return to_state in cls.VALID_TRANSITIONS.get(from_state, [])

    @classmethod
    def advance_state(cls, current: PipelineState, next_state: PipelineState) -> PipelineState:
        """
        Advance state with validation.

        Raises:
            InvalidStateTransition: If transition is not allowed
        """
        if not cls.can_transition(current, next_state):
            raise InvalidStateTransition(
                f"Cannot transition from {current.value} to {next_state.value}. "
                f"Valid transitions: {[s.value for s in cls.VALID_TRANSITIONS[current]]}"
            )
        return next_state

class InvalidStateTransition(Exception):
    """Raised when an invalid state transition is attempted."""
    pass
```

2. **Update Contact Model to Track State:**
```python
# app/models/database.py (UPDATE)
class Contact(Base):
    # ... existing fields ...

    # ADD pipeline state tracking
    pipeline_state = Column(String, default=PipelineState.SCRAPED.value)
    state_history = Column(JSON, default=list)  # Track state transitions

    def advance_state(self, new_state: PipelineState) -> bool:
        """Advance state with validation and history tracking."""
        current_state = PipelineState(self.pipeline_state)

        # Validate transition
        if not PipelineStateMachine.can_transition(current_state, new_state):
            return False

        # Record transition
        self.state_history.append({
            'from': current_state.value,
            'to': new_state.value,
            'timestamp': datetime.utcnow().isoformat(),
        })

        self.pipeline_state = new_state.value
        return True
```

---

### Critical Finding: Scrapers Bypass Pipeline

**Severity:** CRITICAL  
**Location:** `app/scrapers/*.py`  
**Impact:** All scraped contacts skip normalization, deduplication, and scoring

**Problem:**
Scrapers write directly to the `Contact` table instead of submitting raw signals to the pipeline.

**Current Flow (Broken):**
```
Scraper → Contact Table (bypasses everything)
```

**Required Flow:**
```
Scraper → RawSignal Queue → Normalizer → Resolver → Clusterer → Verifier → Contact Table
```

**Fix:**

1. **Create RawSignal Model:**
```python
# app/models/raw_signal.py (CREATE NEW)
class RawSignal(Base):
    """Raw scraped signal awaiting normalization."""

    __tablename__ = "raw_signals"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    source = Column(String, nullable=False)  # 'spotify', 'youtube', 'instagram', etc.
    signal_type = Column(String, nullable=False)  # 'contact', 'playlist', 'venue'
    raw_data = Column(JSON, nullable=False)  # Raw scraped data
    status = Column(String, default='pending')  # pending, processing, completed, failed
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)
    normalized_entity_id = Column(String, nullable=True)  # Reference to normalized entity

    __table_args__ = (
        Index('idx_raw_signal_status', 'status'),
        Index('idx_raw_signal_source', 'source'),
    )
```

2. **Update Scrapers to Submit Signals:**
```python
# app/scrapers/base_scraper.py (UPDATE)
from app.models.raw_signal import RawSignal
from app.utils.queue_adapter import enqueue_job

class BaseScraper(ABC):
    def save_result(self, result: Dict[str, Any]):
        """Save scraped result as raw signal instead of direct insert."""

        # Create raw signal
        signal = RawSignal(
            source=self.scraper_type,
            signal_type='contact',
            raw_data=result,
        )

        db.add(signal)
        db.commit()

        # Queue for normalization
        enqueue_job('normalize', {
            'signal_id': signal.id,
            'scraper_type': self.scraper_type,
        })
```

---

### Critical Finding: Workers Not Connected to Queue

**Severity:** CRITICAL  
**Location:** `app/workers/*.py`  
**Impact:** Worker processes exist but don't actually process queue jobs

**Problem:**
The worker files (`scrape_worker.py`, `normalize_worker.py`, etc.) are standalone scripts that don't connect to the Redis queue.

**Current State:**
```python
# app/workers/scrape_worker.py (EXISTING)
while True:
    time.sleep(1)  # Does nothing!
```

**Required Fix:**

```python
# app/workers/normalize_worker.py (REWRITE)
"""
Signal Normalizer Worker

Processes raw signals from the queue and normalizes them to standard format.
"""
import os
import sys
from app.utils.queue_adapter import dequeue_job, enqueue_job
from app.models.raw_signal import RawSignal
from app.utils.signal_normalizer import SignalNormalizer
from sqlalchemy.orm import Session

def process_normalization_job(job: dict):
    """Process a normalization job from the queue."""
    signal_id = job.get('signal_id')
    scraper_type = job.get('scraper_type')

    db = SessionLocal()
    try:
        # Get raw signal
        signal = db.query(RawSignal).filter(RawSignal.id == signal_id).first()
        if not signal:
            raise ValueError(f"Signal {signal_id} not found")

        # Normalize
        normalizer = SignalNormalizer()
        normalized = normalizer.normalize(signal.raw_data)

        # Update signal status
        signal.status = 'completed'
        signal.normalized_entity_id = normalized.get('id')

        # Queue for entity resolution
        enqueue_job('resolve', {
            'normalized_data': normalized,
            'source_signal_id': signal_id,
        })

        db.commit()

    except Exception as e:
        signal.status = 'failed'
        signal.error = str(e)
        db.commit()
        raise

    finally:
        db.close()

def main():
    """Main worker loop."""
    print("Starting Normalize Worker...")

    while True:
        try:
            # Dequeue normalization job
            job = dequeue_job('normalize')

            if job:
                print(f"Processing normalization job: {job.get('job_id')}")
                process_normalization_job(job)
            else:
                # No jobs available
                time.sleep(5)

        except Exception as e:
            print(f"Worker error: {e}", file=sys.stderr)
            time.sleep(5)

if __name__ == '__main__':
    main()
```

---

## Part 2: Security Review

### Issue: No Email Validation Beyond Syntax

**Severity:** HIGH  
**Location:** `app/utils/email_validator.py`  
**Impact:** Invalid emails cause bounce backs, damaging sender reputation

**Current Code:**
```python
class EmailValidator:
    def validate(self, email: str) -> bool:
        # Only syntax validation
        return "@" in email
```

**Required Enhancements:**

```python
# app/utils/email_validator.py (ENHANCE)
import dns.resolver
import requests

class EmailValidator:
    """Comprehensive email validation with DNS and SMTP checks."""

    DISPOSABLE_DOMAINS = {
        'tempmail.com', '10minutemail.com', 'guerrillamail.com',
        # Add more disposable email domains
    }

    def validate(self, email: str, check_dns: bool = True, check_smtp: bool = False) -> dict:
        """
        Validate email with multiple checks.

        Returns:
            dict with validation results
        """
        result = {
            'valid_syntax': False,
            'has_mx_records': False,
            'is_disposable': False,
            'is_role_based': False,
            'is_deliverable': False,
            'score': 0,
        }

        # 1. Syntax check
        result['valid_syntax'] = self._check_syntax(email)
        if not result['valid_syntax']:
            return result

        result['score'] += 30

        # 2. Disposable email check
        result['is_disposable'] = self._check_disposable(email)
        if not result['is_disposable']:
            result['score'] += 20

        # 3. Role-based check
        result['is_role_based'] = self._check_role_based(email)
        if not result['is_role_based']:
            result['score'] += 10

        # 4. DNS MX record check
        if check_dns:
            result['has_mx_records'] = self._check_mx_records(email)
            if result['has_mx_records']:
                result['score'] += 30

        # 5. SMTP check (optional, slow)
        if check_smtp and result['has_mx_records']:
            result['is_deliverable'] = self._check_smtp(email)
            if result['is_deliverable']:
                result['score'] += 10

        return result

    def _check_syntax(self, email: str) -> bool:
        """Basic email syntax validation."""
        import re
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        return bool(re.match(pattern, email))

    def _check_disposable(self, email: str) -> bool:
        """Check if email is from disposable provider."""
        domain = email.split('@')[1].lower()
        return domain in self.DISPOSABLE_DOMAINS

    def _check_role_based(self, email: str) -> bool:
        """Check if email is role-based (info@, contact@, etc.)."""
        prefix = email.split('@')[0].lower()
        role_prefixes = {'info', 'contact', 'hello', 'admin', 'support', 'sales'}
        return prefix in role_prefixes

    def _check_mx_records(self, email: str) -> bool:
        """Check if domain has valid MX records."""
        domain = email.split('@')[1]
        try:
            mx_records = dns.resolver.resolve(domain, 'MX')
            return len(mx_records) > 0
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
            return False

    def _check_smtp(self, email: str) -> bool:
        """
        Check if email is deliverable via SMTP.

        NOTE: This may trigger spam filters. Use cautiously.
        """
        import smtplib

        domain = email.split('@')[1]
        try:
            # Get MX record
            mx_records = dns.resolver.resolve(domain, 'MX')
            mx_host = str(mx_records[0].exchange)

            # Connect to SMTP server
            server = smtplib.SMTP(timeout=10)
            server.set_debuglevel(0)
            server.connect(mx_host)
            server.helo()
            server.mail('verify@example.com')
            code, _ = server.rcpt(email)
            server.quit()

            return code == 250

        except Exception:
            return False
```

---

### Issue: No Scraper Rate Limit Backoff

**Severity:** HIGH  
**Location:** `app/scrapers/base_scraper.py`  
**Impact:** Scrapers get blocked, no retry logic

**Fix:**
```python
# app/scrapers/base_scraper.py (ENHANCE)
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

class BaseScraper:
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type(RateLimitError),
    )
    def fetch_page(self, url: str) -> Response:
        """Fetch page with rate limit handling."""
        headers = {
            'User-Agent': self.user_agent,
        }

        response = requests.get(url, headers=headers, timeout=30)

        if response.status_code == 429:
            raise RateLimitError(f"Rate limited by {url}")

        response.raise_for_status()
        return response
```

---

## Part 3: Worker Architecture Issues

### All Workers Need Implementation

| Worker | Status | Priority | Effort |
|--------|--------|----------|--------|
| **Scrape Worker** | ⚠️ Stub | P0 | 1 day |
| **Normalize Worker** | ❌ Missing | P0 | 2 days |
| **Entity Resolver Worker** | ❌ Missing | P0 | 2 days |
| **Graph Cluster Worker** | ❌ Missing | P1 | 2 days |
| **Outreach Worker** | ❌ Missing | P1 | 2 days |

---

## Top 10 Critical Findings Summary

| Rank | Issue | Severity | File | One-Line Remediation |
|------|-------|----------|------|---------------------|
| 1 | Pipeline state machine not enforced | CRITICAL | `utils/pipeline_orchestrator.py` | Add state transition validation |
| 2 | Scrapers bypass pipeline | CRITICAL | `scrapers/*.py` | Submit to RawSignal queue |
| 3 | Workers not connected to queue | CRITICAL | `workers/*.py` | Connect workers to Redis queue |
| 4 | No email validation beyond syntax | HIGH | `utils/email_validator.py` | Add DNS + SMTP validation |
| 5 | No scraper rate limit backoff | HIGH | `scrapers/base_scraper.py` | Add exponential backoff |
| 6 | Queue adapter not used | HIGH | Throughout | Integrate queue_adapter |
| 7 | No signal persistence | MEDIUM | `utils/signal_normalizer.py` | Save normalized signals |
| 8 | No deduplication logic | MEDIUM | `utils/entity_resolver.py` | Implement deduplication |
| 9 | No clustering implementation | MEDIUM | `utils/graph_cluster.py` | Implement graph clustering |
| 10 | No outreach decision logic | MEDIUM | `utils/outreach.py` | Implement outreach rules |

---

## Recommended Implementation Priority

### Week 1: Pipeline Foundation
1. Create RawSignal model (1 day)
2. Update scrapers to submit signals (2 days)
3. Implement state machine (1 day)
4. Connect workers to queue (2 days)

### Week 2: Worker Implementation
1. Implement Normalize Worker (2 days)
2. Implement Entity Resolver Worker (2 days)
3. Implement Graph Cluster Worker (1 day)

### Week 3: Validation & Outreach
1. Enhance email validation (1 day)
2. Add rate limit backoff (1 day)
3. Implement outreach worker (2 days)
4. Add deduplication logic (1 day)

---

*Review in progress. More files to be reviewed...*
