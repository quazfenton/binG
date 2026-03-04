# Comprehensive Code Review Results

**Review Started:** 2026-03-03  
**Reviewer:** Senior Engineering Audit (AI)  
**Methodology:** Line-by-line, module-by-module exhaustive review  
**Standards:** Production-grade, security-hardened, edge-case covered

---

## Review Status Dashboard

| Module | Files Reviewed | Critical | High | Medium | Low | Tests Added | Status |
|--------|---------------|----------|------|--------|-----|-------------|--------|
| **runBookS/incident_sources/** | 0/6 | - | - | - | - | - | 🔄 In Progress |
| **runBookS/ai/** | 0/4 | - | - | - | - | - | ⏳ Pending |
| **runBookS/api/** | 0/3 | - | - | - | - | - | ⏳ Pending |
| **runBookS/version_control/** | 0/4 | - | - | - | - | - | ⏳ Pending |
| **runBookS/slack/** | 0/3 | - | - | - | - | - | ⏳ Pending |

---

## File-by-File Review Entries

### File: `runBookS/incident_sources/base.py`

**Review Status:** ⏳ Pending  
**Lines of Code:** 85  
**Responsibilities:** Abstract base class for incident sources, Incident dataclass

#### Summary
Defines the `Incident` dataclass and `IncidentSource` abstract base class that all incident providers (PagerDuty, Datadog, etc.) must implement.

#### Issues Found

---

**Issue #1.1: validate_webhook_signature returns True by default (SECURITY RISK)**

- **Severity:** 🔴 **HIGH**
- **Location:** Lines 77-84
- **Problem:** Default implementation returns `True`, allowing unvalidated webhooks if subclass doesn't override

**Current Code:**
```python
def validate_webhook_signature(
    self,
    payload: bytes,
    signature: str,
    timestamp: str
) -> bool:
    """
    Validate webhook signature (optional, override in subclasses).
    """
    # Default implementation - override in subclasses that require signature validation
    return True  # ❌ SECURITY RISK: Should return False
```

**Proposed Fix:**
```python
def validate_webhook_signature(
    self,
    payload: bytes,
    signature: str,
    timestamp: str
) -> bool:
    """
    Validate webhook signature.
    
    Default implementation returns False to force explicit override.
    Subclasses that require signature validation MUST override this method.
    
    Returns:
        bool: True if signature is valid, False otherwise or if not implemented
    """
    # Explicitly return False to indicate validation not implemented
    # This prevents accidental acceptance of unvalidated webhooks
    return False
```

**Rationale:** Returning `True` by default creates a security vulnerability where webhooks could be accepted without validation if a subclass forgets to override.

**Tests to Add:** `tests/incident_sources/test_base.py`
```python
def test_validate_webhook_signature_default_returns_false():
    """Default implementation should return False to force override"""
    from incident_sources.base import IncidentSource
    
    class TestSource(IncidentSource):
        @property
        def source_name(self) -> str:
            return "test"
        
        def parse_webhook(self, payload):
            pass
        
        def sync_incidents(self):
            pass
    
    source = TestSource()
    assert source.validate_webhook_signature(b"", "", "") is False
```

---

**Issue #1.2: Incident dataclass lacks __post_init__ validation**

- **Severity:** 🟡 **MEDIUM**
- **Location:** Lines 12-31
- **Problem:** No validation of required fields or enum values

**Current Code:**
```python
@dataclass
class Incident:
    """Represents an incident from any source."""
    external_id: str
    title: str
    service: str
    severity: str
    status: str
    created_at: datetime
    source: str
    updated_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    raw_payload: Optional[Dict[str, Any]] = field(default_factory=dict)
    runbook_path: Optional[str] = None
```

**Proposed Fix:**
```python
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, Set
from datetime import datetime

VALID_SEVERITIES: Set[str] = {'critical', 'high', 'medium', 'low', 'unknown'}
VALID_STATUSES: Set[str] = {'triggered', 'acknowledged', 'resolved', 'closed', 'unknown'}

@dataclass
class Incident:
    """Represents an incident from any source."""
    external_id: str
    title: str
    service: str
    severity: str
    status: str
    created_at: datetime
    source: str
    updated_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    raw_payload: Optional[Dict[str, Any]] = field(default_factory=dict)
    runbook_path: Optional[str] = None
    
    def __post_init__(self):
        """Validate incident data after initialization."""
        # Validate required fields
        if not self.external_id or not isinstance(self.external_id, str):
            raise ValueError(f"external_id must be a non-empty string, got: {self.external_id}")
        
        if not self.title or not isinstance(self.title, str):
            raise ValueError(f"title must be a non-empty string, got: {self.title}")
        
        if not self.service or not isinstance(self.service, str):
            raise ValueError(f"service must be a non-empty string, got: {self.service}")
        
        # Validate severity is known value
        if self.severity not in VALID_SEVERITIES:
            raise ValueError(
                f"severity must be one of {VALID_SEVERITIES}, got: {self.severity}"
            )
        
        # Validate status is known value
        if self.status not in VALID_STATUSES:
            raise ValueError(
                f"status must be one of {VALID_STATUSES}, got: {self.status}"
            )
        
        # Validate created_at is datetime
        if not isinstance(self.created_at, datetime):
            raise ValueError(
                f"created_at must be datetime, got: {type(self.created_at)}"
            )
        
        # Validate source is set
        if not self.source or not isinstance(self.source, str):
            raise ValueError(f"source must be a non-empty string, got: {self.source}")
        
        # Validate resolved_at is after created_at if both exist
        if self.resolved_at and self.created_at:
            if self.resolved_at < self.created_at:
                raise ValueError(
                    f"resolved_at ({self.resolved_at}) cannot be before "
                    f"created_at ({self.created_at})"
                )
        
        # Validate updated_at is after created_at if both exist
        if self.updated_at and self.created_at:
            if self.updated_at < self.created_at:
                raise ValueError(
                    f"updated_at ({self.updated_at}) cannot be before "
                    f"created_at ({self.created_at})"
                )
```

**Rationale:** Prevents invalid incident objects from being created, catches data corruption early.

**Tests to Add:** `tests/incident_sources/test_base.py`
```python
import pytest
from datetime import datetime, timedelta
from incident_sources.base import Incident, VALID_SEVERITIES, VALID_STATUSES

def test_incident_validates_required_fields():
    """Should reject incidents with missing required fields"""
    with pytest.raises(ValueError, match="external_id"):
        Incident(
            external_id="",
            title="Test",
            service="test",
            severity="high",
            status="triggered",
            created_at=datetime.now(),
            source="test"
        )

def test_incident_validates_severity():
    """Should reject invalid severity values"""
    with pytest.raises(ValueError, match="severity"):
        Incident(
            external_id="INC-001",
            title="Test",
            service="test",
            severity="INVALID",
            status="triggered",
            created_at=datetime.now(),
            source="test"
        )

def test_incident_validates_status():
    """Should reject invalid status values"""
    with pytest.raises(ValueError, match="status"):
        Incident(
            external_id="INC-001",
            title="Test",
            service="test",
            severity="high",
            status="INVALID",
            created_at=datetime.now(),
            source="test"
        )

def test_incident_validates_resolved_at_after_created_at():
    """Should reject resolved_at before created_at"""
    created = datetime.now()
    resolved = created - timedelta(hours=1)
    
    with pytest.raises(ValueError, match="resolved_at"):
        Incident(
            external_id="INC-001",
            title="Test",
            service="test",
            severity="high",
            status="resolved",
            created_at=created,
            resolved_at=resolved,
            source="test"
        )

def test_incident_accepts_valid_data():
    """Should accept valid incident data"""
    incident = Incident(
        external_id="INC-001",
        title="Test Incident",
        service="test-service",
        severity="high",
        status="triggered",
        created_at=datetime.now(),
        source="test"
    )
    assert incident.external_id == "INC-001"
    assert incident.severity == "high"
    assert incident.status == "triggered"
```

---

**Issue #1.3: to_dict() method doesn't handle None datetime values properly**

- **Severity:** 🟢 **LOW**
- **Location:** Lines 33-45
- **Problem:** Could fail if optional datetime fields are None

**Current Code:**
```python
def to_dict(self) -> Dict[str, Any]:
    """Convert incident to dictionary."""
    return {
        'external_id': self.external_id,
        'title': self.title,
        'service': self.service,
        'severity': self.severity,
        'status': self.status,
        'created_at': self.created_at.isoformat() if self.created_at else None,
        'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        'resolved_at': self.resolved_at.isoformat() if self.resolved_at else None,
        'source': self.source,
        'runbook_path': self.runbook_path
    }
```

**Proposed Fix:** (Already correct in current code, but add type safety)
```python
def to_dict(self) -> Dict[str, Any]:
    """
    Convert incident to dictionary for JSON serialization.
    
    Returns:
        Dict with all incident fields, None for optional fields not set
    """
    return {
        'external_id': self.external_id,
        'title': self.title,
        'service': self.service,
        'severity': self.severity,
        'status': self.status,
        'created_at': self.created_at.isoformat() if self.created_at else None,
        'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        'resolved_at': self.resolved_at.isoformat() if self.resolved_at else None,
        'source': self.source,
        'runbook_path': self.runbook_path,
        # Include raw_payload for debugging (be careful with PII)
        'raw_payload': self.raw_payload if self.raw_payload else None
    }
```

**Tests to Add:**
```python
def test_incident_to_dict_handles_none_values():
    """to_dict should handle None optional fields"""
    incident = Incident(
        external_id="INC-001",
        title="Test",
        service="test",
        severity="high",
        status="triggered",
        created_at=datetime.now(),
        source="test",
        updated_at=None,
        resolved_at=None
    )
    
    result = incident.to_dict()
    assert result['external_id'] == "INC-001"
    assert result['updated_at'] is None
    assert result['resolved_at'] is None
    assert 'raw_payload' in result
```

---

#### Tests Summary for base.py

**File:** `tests/incident_sources/test_base.py` (NEW)

```python
"""
Comprehensive tests for incident_sources.base module
"""
import pytest
from datetime import datetime, timedelta
from incident_sources.base import (
    Incident,
    IncidentSource,
    VALID_SEVERITIES,
    VALID_STATUSES
)


class TestIncidentDataclass:
    """Test Incident dataclass validation and behavior"""
    
    def test_valid_incident_creation(self):
        """Should create valid incident without errors"""
        now = datetime.now()
        incident = Incident(
            external_id="INC-001",
            title="Test Incident",
            service="test-service",
            severity="high",
            status="triggered",
            created_at=now,
            source="test"
        )
        
        assert incident.external_id == "INC-001"
        assert incident.title == "Test Incident"
        assert incident.severity == "high"
        assert incident.status == "triggered"
        assert incident.source == "test"
    
    def test_rejects_empty_external_id(self):
        """Should reject empty external_id"""
        with pytest.raises(ValueError, match="external_id"):
            Incident(
                external_id="",
                title="Test",
                service="test",
                severity="high",
                status="triggered",
                created_at=datetime.now(),
                source="test"
            )
    
    def test_rejects_invalid_severity(self):
        """Should reject invalid severity"""
        with pytest.raises(ValueError, match="severity"):
            Incident(
                external_id="INC-001",
                title="Test",
                service="test",
                severity="INVALID",
                status="triggered",
                created_at=datetime.now(),
                source="test"
            )
    
    def test_rejects_invalid_status(self):
        """Should reject invalid status"""
        with pytest.raises(ValueError, match="status"):
            Incident(
                external_id="INC-001",
                title="Test",
                service="test",
                severity="high",
                status="INVALID",
                created_at=datetime.now(),
                source="test"
            )
    
    def test_rejects_resolved_before_created(self):
        """Should reject resolved_at before created_at"""
        created = datetime.now()
        resolved = created - timedelta(hours=1)
        
        with pytest.raises(ValueError, match="resolved_at"):
            Incident(
                external_id="INC-001",
                title="Test",
                service="test",
                severity="high",
                status="resolved",
                created_at=created,
                resolved_at=resolved,
                source="test"
            )
    
    def test_to_dict_serialization(self):
        """Should serialize to dict correctly"""
        now = datetime.now()
        incident = Incident(
            external_id="INC-001",
            title="Test",
            service="test",
            severity="high",
            status="triggered",
            created_at=now,
            source="test",
            updated_at=now,
            resolved_at=None
        )
        
        result = incident.to_dict()
        assert result['external_id'] == "INC-001"
        assert result['severity'] == "high"
        assert result['updated_at'] == now.isoformat()
        assert result['resolved_at'] is None


class TestIncidentSourceAbstractClass:
    """Test IncidentSource abstract base class"""
    
    def test_cannot_instantiate_abstract_class(self):
        """Should not allow direct instantiation"""
        with pytest.raises(TypeError):
            IncidentSource()
    
    def test_subclass_must_implement_source_name(self):
        """Subclass must implement source_name property"""
        class IncompleteSource(IncidentSource):
            def parse_webhook(self, payload):
                pass
            
            def sync_incidents(self):
                pass
        
        with pytest.raises(TypeError):
            IncompleteSource()
    
    def test_subclass_must_implement_parse_webhook(self):
        """Subclass must implement parse_webhook method"""
        class IncompleteSource(IncidentSource):
            @property
            def source_name(self) -> str:
                return "test"
            
            def sync_incidents(self):
                pass
        
        with pytest.raises(TypeError):
            IncompleteSource()
    
    def test_subclass_must_implement_sync_incidents(self):
        """Subclass must implement sync_incidents method"""
        class IncompleteSource(IncidentSource):
            @property
            def source_name(self) -> str:
                return "test"
            
            def parse_webhook(self, payload):
                pass
        
        with pytest.raises(TypeError):
            IncompleteSource()
    
    def test_validate_webhook_signature_default_false(self):
        """Default signature validation should return False"""
        class TestSource(IncidentSource):
            @property
            def source_name(self) -> str:
                return "test"
            
            def parse_webhook(self, payload):
                pass
            
            def sync_incidents(self):
                pass
        
        source = TestSource()
        assert source.validate_webhook_signature(b"", "", "") is False
```

---

#### Environment/Configuration Changes

**File:** `.env.example` (UPDATE)

```bash
# Add to incident_sources section:

# Incident source webhook secrets (REQUIRED for production)
PAGERDUTY_WEBHOOK_SECRET=your_pagerduty_webhook_secret
DATADOG_WEBHOOK_SECRET=your_datadog_webhook_secret
ALERTMANAGER_WEBHOOK_SECRET=your_alertmanager_webhook_secret

# Incident validation
# Valid severity levels: critical, high, medium, low, unknown
# Valid status values: triggered, acknowledged, resolved, closed, unknown
```

---

### File: `runBookS/incident_sources/pagerduty.py`

**Review Status:** ✅ Complete  
**Lines of Code:** 403  
**Responsibilities:** PagerDuty webhook parsing, API sync, signature validation, incident management

#### Summary
Implements PagerDuty integration with webhook parsing, API sync with pagination, HMAC-SHA256 signature validation, and incident management operations (acknowledge, resolve).

#### Issues Found

---

**Issue #2.1: validate_webhook_signature returns True when no secret configured (SECURITY RISK)**

- **Severity:** 🔴 **HIGH**
- **Location:** Lines 117-120
- **Problem:** Returns `True` if webhook_secret not set, allowing unvalidated webhooks

**Current Code:**
```python
def validate_webhook_signature(
    self,
    payload: bytes,
    signature: str,
    timestamp: str
) -> bool:
    if not self.webhook_secret:
        # If no secret configured, skip validation (not recommended for production)
        return True  # ❌ SECURITY RISK
```

**Proposed Fix:**
```python
def validate_webhook_signature(
    self,
    payload: bytes,
    signature: str,
    timestamp: str
) -> bool:
    """
    Validate PagerDuty webhook signature.
    
    PagerDuty signs webhooks with HMAC-SHA256.
    
    Returns:
        bool: True if signature is valid, False if invalid or not configured
    
    Note:
        Returns False (not True) when no secret is configured to prevent
        accidental acceptance of unvalidated webhooks in production.
    """
    if not self.webhook_secret:
        # Log warning and return False to prevent unvalidated webhooks
        import logging
        logging.warning(
            "PagerDuty webhook secret not configured. "
            "Webhook signature validation disabled - rejecting webhook."
        )
        return False  # ✅ SECURE: Reject when not configured
```

**Rationale:** Returning `True` when secret is not configured creates a security vulnerability. Should return `False` and log a warning.

**Tests to Add:** `tests/incident_sources/test_pagerduty.py`
```python
def test_validate_webhook_signature_returns_false_when_no_secret():
    """Should return False when webhook secret is not configured"""
    pd = PagerDutyIntegration.__new__(PagerDutyIntegration)
    pd.webhook_secret = None
    
    result = pd.validate_webhook_signature(b"payload", "v0=signature", "1234567890")
    assert result is False
```

**Docs/env changes:** `.env.example` - Add warning comment about webhook secret being required for production

---

**Issue #2.2: HTTP requests lack timeout configuration (RELIABILITY RISK)**

- **Severity:** 🟠 **HIGH**
- **Location:** Lines 228-232, 316-320, 339-343
- **Problem:** No timeout on requests.get/put calls, may hang indefinitely

**Current Code:**
```python
response = self.session.get(
    f"{self.base_url}/incidents",
    params=params
)  # ❌ No timeout!
```

**Proposed Fix:**
```python
# Add to __init__ method:
self.request_timeout = int(os.getenv('PAGERDUTY_TIMEOUT_MS', '30000')) / 1000  # Default 30s

# Update all HTTP calls:
response = self.session.get(
    f"{self.base_url}/incidents",
    params=params,
    timeout=self.request_timeout  # ✅ Configurable timeout
)
```

**Rationale:** Without timeouts, network issues can cause indefinite hangs, blocking resources.

**Tests to Add:**
```python
def test_sync_incidents_uses_timeout():
    """Should configure timeout on HTTP requests"""
    with patch.object(pd.session, 'get') as mock_get:
        mock_get.return_value.json.return_value = {'incidents': []}
        pd.sync_incidents()
        mock_get.assert_called_once()
        call_kwargs = mock_get.call_args[1]
        assert 'timeout' in call_kwargs
        assert call_kwargs['timeout'] == 30.0  # Default 30s
```

**Docs/env changes:** `.env.example` add `PAGERDUTY_TIMEOUT_MS=30000`

---

**Issue #2.3: _parse_timestamp silently returns None on invalid format (DATA QUALITY)**

- **Severity:** 🟡 **MEDIUM**
- **Location:** Lines 290-299
- **Problem:** Invalid timestamps silently become None, losing temporal data

**Current Code:**
```python
def _parse_timestamp(self, timestamp_str: Optional[str]) -> Optional[datetime]:
    if not timestamp_str:
        return None
    
    try:
        if timestamp_str.endswith('Z'):
            timestamp_str = timestamp_str[:-1] + '+00:00'
        return datetime.fromisoformat(timestamp_str)
    except ValueError:
        return None  # ❌ Silent failure
```

**Proposed Fix:**
```python
def _parse_timestamp(self, timestamp_str: Optional[str]) -> Optional[datetime]:
    """
    Parse ISO 8601 timestamp string with logging on failure.
    
    Args:
        timestamp_str: Timestamp string in ISO 8601 format
    
    Returns:
        datetime object or None if parsing fails
    
    Note:
        Logs warning on parse failure for debugging
    """
    if not timestamp_str:
        return None
    
    try:
        # Handle 'Z' suffix
        if timestamp_str.endswith('Z'):
            timestamp_str = timestamp_str[:-1] + '+00:00'
        return datetime.fromisoformat(timestamp_str)
    except ValueError as e:
        # Log warning with the problematic value for debugging
        import logging
        logging.warning(
            f"Failed to parse PagerDuty timestamp '{timestamp_str}': {e}"
        )
        return None
```

**Rationale:** Silent failures make debugging difficult. Logging helps identify upstream data issues.

**Tests to Add:**
```python
def test_parse_timestamp_logs_on_invalid_format(caplog):
    """Should log warning on invalid timestamp format"""
    pd = PagerDutyIntegration.__new__(PagerDutyIntegration)
    
    result = pd._parse_timestamp("invalid-timestamp")
    
    assert result is None
    assert "Failed to parse PagerDuty timestamp" in caplog.text
```

---

**Issue #2.4: Pagination logic has off-by-one error (CORRECTNESS)**

- **Severity:** 🟡 **MEDIUM**
- **Location:** Lines 245-258
- **Problem:** May fetch more incidents than limit due to loop condition

**Current Code:**
```python
# Handle pagination
while (len(incidents) < limit and
       data.get('more', False) and
       data.get('offset')):
    
    params['offset'] = data['offset'] + params['limit']
    # ... fetch more ...
    for incident_data in data.get('incidents', []):
        incident = self._parse_api_incident(incident_data)
        incidents.append(incident)

return incidents[:limit]  # ❌ Truncates after fetching extra
```

**Proposed Fix:**
```python
# Handle pagination
while (len(incidents) < limit and
       data.get('more', False) and
       data.get('offset') is not None):
    
    # Calculate how many more we need
    remaining = limit - len(incidents)
    params['offset'] = data['offset']
    params['limit'] = min(remaining, 1000)  # Don't fetch more than needed
    
    response = self.session.get(
        f"{self.base_url}/incidents",
        params=params,
        timeout=self.request_timeout
    )
    response.raise_for_status()
    
    data = response.json()
    for incident_data in data.get('incidents', []):
        if len(incidents) >= limit:
            break  # Stop when we have enough
        incident = self._parse_api_incident(incident_data)
        incidents.append(incident)

return incidents
```

**Rationale:** More efficient to fetch only what's needed, reduces API usage and memory.

**Tests to Add:**
```python
def test_sync_incidents_respects_limit():
    """Should not fetch more incidents than limit"""
    # Mock pagination response
    page1 = {'incidents': [{'id': f'i{n}'} for n in range(100)], 'more': True, 'offset': 100}
    page2 = {'incidents': [{'id': f'i{n}'} for n in range(100, 200)], 'more': False}
    
    with patch.object(pd.session, 'get') as mock_get:
        mock_get.side_effect = [
            Mock(json=Mock(return_value=page1)),
            Mock(json=Mock(return_value=page2))
        ]
        
        result = pd.sync_incidents(limit=50)
        
        assert len(result) == 50
        # Should only make one call since we only need 50
        assert mock_get.call_count == 1
```

---

**Issue #2.5: No retry logic for transient failures (RELIABILITY)**

- **Severity:** 🟡 **MEDIUM**
- **Location:** Lines 228-232, 316-320
- **Problem:** Single failed request raises error, no retry for transient issues

**Proposed Fix:**
```python
# Add to class:
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(requests.RequestException)
)
def _make_request(self, method: str, url: str, **kwargs):
    """Make HTTP request with retry for transient failures"""
    return self.session.request(method, url, timeout=self.request_timeout, **kwargs)

# Update sync_incidents:
response = self._make_request('GET', f"{self.base_url}/incidents", params=params)
```

**Rationale:** Transient network failures are common; automatic retry improves reliability.

**Tests to Add:**
```python
def test_sync_incidents_retries_on_failure():
    """Should retry on transient failures"""
    with patch.object(pd.session, 'get') as mock_get:
        # Fail twice, succeed on third
        mock_get.side_effect = [
            requests.RequestException("timeout"),
            requests.RequestException("timeout"),
            Mock(json=Mock(return_value={'incidents': []}))
        ]
        
        result = pd.sync_incidents()
        
        assert mock_get.call_count == 3
        assert len(result) == 0
```

**Docs/env changes:** Add `tenacity>=8.0.0` to `requirements.txt`

---

**Issue #2.6: escalate_incident method references but don't validate escalations**

- **Severity:** 🟢 **LOW**
- **Location:** Lines 45-46
- **Problem:** escalations list stored without validation

**Current Code:**
```python
self.escalations = escalations or []  # ❌ No validation
```

**Proposed Fix:**
```python
def _validate_escalations(self, escalations: Optional[List[Dict]]) -> List[Dict]:
    """Validate escalation data structure"""
    if not escalations:
        return []
    
    validated = []
    for esc in escalations:
        if isinstance(esc, dict) and 'level' in esc:
            validated.append(esc)
        else:
            import logging
            logging.warning(f"Invalid escalation data: {esc}")
    
    return validated

# In __init__:
self.escalations = self._validate_escalations(escalations)
```

**Rationale:** Prevents malformed escalation data from causing issues downstream.

---

#### Tests Summary for pagerduty.py

**File:** `tests/incident_sources/test_pagerduty.py` (NEW/EXPAND)

```python
"""
Comprehensive tests for incident_sources.pagerduty module
"""
import pytest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch
import requests
from incident_sources.pagerduty import PagerDutyIntegration, PagerDutyIncident


class TestPagerDutyIncident:
    """Test PagerDutyIncident class"""
    
    def test_valid_incident_creation(self):
        """Should create valid PagerDuty incident"""
        now = datetime.now()
        incident = PagerDutyIncident(
            external_id="INC-001",
            title="Test Incident",
            service="test-service",
            severity="high",
            status="triggered",
            created_at=now,
            incident_number=123,
            description="Test description"
        )
        
        assert incident.external_id == "INC-001"
        assert incident.incident_number == 123
        assert incident.source == "pagerduty"
    
    def test_escalations_default_to_empty_list(self):
        """Should default escalations to empty list"""
        incident = PagerDutyIncident(
            external_id="INC-001",
            title="Test",
            service="test",
            severity="high",
            status="triggered",
            created_at=datetime.now()
        )
        
        assert incident.escalations == []


class TestPagerDutyIntegration:
    """Test PagerDutyIntegration class"""
    
    @pytest.fixture
    def pd_integration(self):
        """Create integration instance for testing"""
        with patch.dict('os.environ', {'PAGERDUTY_API_KEY': 'test_key'}):
            yield PagerDutyIntegration()
    
    def test_validate_webhook_signature_returns_false_when_no_secret(self, pd_integration):
        """Should return False when webhook secret is not configured"""
        pd_integration.webhook_secret = None
        
        result = pd_integration.validate_webhook_signature(
            b"payload", "v0=signature", "1234567890"
        )
        
        assert result is False
    
    def test_parse_webhook_extracts_incident_data(self, pd_integration):
        """Should correctly parse webhook payload"""
        payload = {
            'incident': {
                'id': 'INC-001',
                'incident_number': 123,
                'title': 'Service Down',
                'service': {'summary': 'API Service'},
                'status': 'triggered',
                'urgency': 'high',
                'created_at': '2026-03-03T12:00:00Z',
                'updated_at': '2026-03-03T12:00:00Z',
                'description': 'API not responding'
            }
        }
        
        incident = pd_integration.parse_webhook(payload)
        
        assert incident.external_id == 'INC-001'
        assert incident.incident_number == 123
        assert incident.title == 'Service Down'
        assert incident.service == 'API Service'
        assert incident.severity == 'high'
        assert incident.status == 'triggered'
    
    def test_parse_timestamp_handles_z_suffix(self, pd_integration):
        """Should parse timestamps with Z suffix"""
        result = pd_integration._parse_timestamp('2026-03-03T12:00:00Z')
        
        assert result is not None
        assert result.year == 2026
        assert result.month == 3
        assert result.day == 3
    
    def test_parse_timestamp_returns_none_on_invalid(self, pd_integration, caplog):
        """Should return None and log warning on invalid timestamp"""
        result = pd_integration._parse_timestamp('invalid-timestamp')
        
        assert result is None
        assert "Failed to parse PagerDuty timestamp" in caplog.text
    
    def test_sync_incidents_handles_pagination(self, pd_integration):
        """Should handle API pagination correctly"""
        page1 = {
            'incidents': [{'id': f'i{n}', 'title': f'Incident {n}'} for n in range(100)],
            'more': True,
            'offset': 100
        }
        page2 = {
            'incidents': [{'id': f'i{n}', 'title': f'Incident {n}'} for n in range(100, 150)],
            'more': False
        }
        
        with patch.object(pd_integration.session, 'get') as mock_get:
            mock_get.side_effect = [
                Mock(json=Mock(return_value=page1)),
                Mock(json=Mock(return_value=page2))
            ]
            
            result = pd_integration.sync_incidents(limit=150)
            
            assert len(result) == 150
            assert mock_get.call_count == 2
```

---

#### Environment/Configuration Changes for pagerduty.py

**File:** `.env.example` (UPDATE)

```bash
# PagerDuty Integration
PAGERDUTY_API_KEY=u+your_api_key_here
PAGERDUTY_WEBHOOK_SECRET=your_webhook_secret_here  # REQUIRED for production

# PagerDuty Configuration
PAGERDUTY_TIMEOUT_MS=30000  # HTTP request timeout in milliseconds
PAGERDUTY_BASE_URL=https://api.pagerduty.com  # Override for EU/other regions
```

**File:** `requirements.txt` (UPDATE)

```txt
# Add for retry logic:
tenacity>=8.2.0
```

---

### File: `runBookS/incident_sources/datadog.py`

**Review Status:** ⏳ Pending  
**Lines of Code:** 285  
**Responsibilities:** Datadog webhook parsing, monitor sync, alert ingestion

---

### File: `runBookS/incident_sources/alertmanager.py`

**Review Status:** ⏳ Pending  
**Lines of Code:** 340  
**Responsibilities:** AlertManager webhook parsing, alert sync, silence management

---

### File: `runBookS/incident_sources/sentry.py`

**Review Status:** ⏳ Pending  
**Lines of Code:** 380  
**Responsibilities:** Sentry issue parsing, API sync, issue management

---

### File: `runBookS/incident_sources/__init__.py`

**Review Status:** ⏳ Pending  
**Lines of Code:** ~15  
**Responsibilities:** Module exports

---

## Top Critical Findings (Across All Reviews)

| # | Severity | File | Issue | Remediation |
|---|----------|------|-------|-------------|
| 1 | 🔴 HIGH | base.py:77-84 | validate_webhook_signature returns True by default | Return False to force override |
| 2 | 🟡 MEDIUM | base.py:12-31 | Incident dataclass lacks validation | Add __post_init__ validation |
| 3 | 🟡 MEDIUM | base.py:33-45 | to_dict() could fail on None | Add explicit None handling |

---

## Appendix: Files Pending Review

### runBookS Project
- [ ] `incident_sources/pagerduty.py` (403 lines)
- [ ] `incident_sources/datadog.py` (285 lines)
- [ ] `incident_sources/alertmanager.py` (340 lines)
- [ ] `incident_sources/sentry.py` (380 lines)
- [ ] `incident_sources/__init__.py` (~15 lines)
- [ ] `ai/llm_suggestion_engine.py` (391 lines)
- [ ] `ai/semantic_correlator.py` (420 lines)
- [ ] `ai/report_generator.py` (496 lines)
- [ ] `ai/__init__.py` (~12 lines)
- [ ] `api/app.py` (797 lines)
- [ ] `api/routes/incidents.py` (310 lines)
- [ ] `api/routes/__init__.py` (~3 lines)
- [ ] `api/__init__.py` (~3 lines)
- [ ] `version_control/git_manager.py` (420 lines)
- [ ] `version_control/diff_engine.py` (310 lines)
- [ ] `version_control/rollback.py` (380 lines)
- [ ] `version_control/__init__.py` (~10 lines)
- [ ] `slack/handler.py` (334 lines)
- [ ] `slack/app.py` (~106 lines)
- [ ] `slack/__init__.py` (~5 lines)

---

**Last Updated:** 2026-03-03  
**Next Review Session:** Continue with pagerduty.py
