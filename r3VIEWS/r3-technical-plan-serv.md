# Technical Implementation Plan - Coordination Cosmos

**Document Type:** Technical Planning & Roadmap  
**Created:** March 3, 2026  
**Status:** DRAFT  
**Review Cycle:** Weekly updates during implementation

---

## Executive Summary

This technical plan outlines the prioritized implementation tasks required to transform the Coordination Cosmos codebase from a prototype state to production-ready software. The plan is organized into epics and tickets with estimated complexity, risk assessments, and rollout strategies.

**Total Estimated Effort:** 300-400 hours (8-12 weeks full-time)  
**Critical Path:** Security fixes → Core functionality → Stability → Testing  
**Risk Level:** HIGH (if security fixes delayed)

---

## Epic 1: Security Hardening (P0 - CRITICAL)

**Goal:** Eliminate critical security vulnerabilities  
**Estimated Effort:** 40-60 hours  
**Priority:** MUST COMPLETE BEFORE ANY PRODUCTION USE  
**Risk if Skipped:** CRITICAL - System vulnerable to attacks, data breaches

### Ticket 1.1: Implement Cryptographically Secure Session IDs
**ID:** SEC-001  
**Complexity:** LOW (2 hours)  
**Risk:** LOW  
**Files:** `backend/server.ts`

**Acceptance Criteria:**
- [ ] Replace `Math.random()` with `crypto.randomBytes(32)`
- [ ] Update session ID format to include timestamp + random bytes
- [ ] Add unit tests for uniqueness and entropy
- [ ] Verify no session ID collisions in 100K iterations

**Implementation:**
```typescript
import { randomBytes } from 'crypto';

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(16).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}
```

**Tests:** `tests/security/session-id.test.ts`  
**Rollback:** Revert commit - no data migration needed

---

### Ticket 1.2: Add Input Sanitization Middleware
**ID:** SEC-002  
**Complexity:** MEDIUM (4 hours)  
**Risk:** LOW  
**Files:** `backend/server.ts`, `backend/middleware/sanitize.ts` (new)

**Acceptance Criteria:**
- [ ] Create sanitization middleware function
- [ ] Apply to all POST/PUT endpoints
- [ ] Test XSS prevention
- [ ] Test prototype pollution prevention

**Implementation:**
```typescript
import sanitizeHtml from 'sanitize-html';

function sanitizeInput(input: any): any {
  if (typeof input === 'string') {
    return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} });
  }
  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }
  if (typeof input === 'object' && input !== null) {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === '__proto__') return {}; // Prevent prototype pollution
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  return input;
}

// Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.body) {
    req.body = sanitizeInput(req.body);
  }
  next();
});
```

**Tests:** `tests/security/input-sanitization.test.ts`  
**Rollback:** Disable middleware in config

---

### Ticket 1.3: Implement Rate Limiting
**ID:** SEC-003  
**Complexity:** MEDIUM (6 hours)  
**Risk:** MEDIUM (may block legitimate users if misconfigured)  
**Files:** `backend/server.ts`, `backend/middleware/rateLimit.ts` (new)

**Acceptance Criteria:**
- [ ] Configure general API rate limiter (100 req/15min)
- [ ] Configure strict limiter for creation endpoints (10/hr)
- [ ] Add rate limit headers to responses
- [ ] Test rate limit enforcement
- [ ] Test rate limit bypass prevention

**Implementation:**
```typescript
import rateLimit from 'express-rate-limit';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
});

const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many creation attempts' },
});

app.use('/api/', apiLimiter);
app.use('/api/profile', createLimiter);
app.use('/api/listings', createLimiter);
```

**Tests:** `tests/security/rate-limiting.test.ts`  
**Rollback:** Disable limiters, keep code
**Monitoring:** Alert on >10% rate limit hits

---

### Ticket 1.4: WebSocket Message Validation
**ID:** SEC-004  
**Complexity:** MEDIUM (4 hours)  
**Risk:** LOW  
**Files:** `backend/server.ts`

**Acceptance Criteria:**
- [ ] Define Zod schemas for all WebSocket message types
- [ ] Validate all incoming messages
- [ ] Return structured error responses
- [ ] Test invalid message handling

**Implementation:** See `docs/review-results.md` Fix 5  
**Tests:** `tests/websocket/validation.test.ts`  
**Rollback:** Revert to unvalidated parsing

---

### Ticket 1.5: Configure CORS & Helmet
**ID:** SEC-005  
**Complexity:** LOW (3 hours)  
**Risk:** LOW  
**Files:** `backend/server.ts`

**Acceptance Criteria:**
- [ ] Configure CORS with allowed origins from env
- [ ] Configure Helmet with CSP
- [ ] Test cross-origin requests blocked
- [ ] Test security headers present

**Implementation:**
```typescript
import helmet from 'helmet';
import cors from 'cors';

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  credentials: true,
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https://api.dicebear.com']
    }
  }
}));
```

**Tests:** `tests/security/cors.test.ts`, `tests/security/headers.test.ts`  
**Rollback:** Revert to permissive CORS

---

### Ticket 1.6: Implement JWT Authentication
**ID:** SEC-006  
**Complexity:** HIGH (12 hours)  
**Risk:** MEDIUM (breaking change for existing clients)  
**Files:** `backend/middleware/auth.ts` (new), `backend/server.ts`

**Acceptance Criteria:**
- [ ] Create JWT generation function
- [ ] Create JWT verification middleware
- [ ] Add login endpoint
- [ ] Protect all authenticated endpoints
- [ ] Support token refresh
- [ ] Add token blacklisting for logout

**Implementation:**
```typescript
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

interface AuthToken {
  profileId: string;
  sessionId: string;
  iat: number;
  exp: number;
}

function generateAuthToken(profileId: string, sessionId: string): string {
  return jwt.sign(
    { profileId, sessionId },
    process.env.JWT_SECRET!,
    { expiresIn: '24h' }
  );
}

function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const auth = jwt.verify(token, process.env.JWT_SECRET!) as AuthToken;
    (req as any).auth = auth;
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}
```

**Tests:** `tests/security/authentication.test.ts`  
**Rollback:** Keep session-id as fallback for 1 release cycle  
**Migration:** Dual support for 2 weeks, then deprecate session-id

---

## Epic 2: Core Functionality (P0 - CRITICAL)

**Goal:** Implement real functionality to replace mock/stub code  
**Estimated Effort:** 60-80 hours  
**Priority:** REQUIRED FOR BASIC OPERATION  
**Risk if Skipped:** HIGH - Core features non-functional

### Ticket 2.1: Implement Real LLM API Calls
**ID:** FUNC-001  
**Complexity:** HIGH (16 hours)  
**Risk:** MEDIUM (API costs, rate limits)  
**Files:** `src/modules/LLMClient.ts`

**Acceptance Criteria:**
- [ ] Implement OpenAI API integration
- [ ] Implement Anthropic API integration
- [ ] Implement Google Gemini API integration
- [ ] Add timeout handling
- [ ] Add error handling for all API errors
- [ ] Add token usage tracking
- [ ] Test with real API keys

**Implementation:** See `docs/review-results.md` Fix 3  
**Tests:** `tests/llm-client/api-integration.test.ts`  
**Rollback:** Feature flag to revert to mock mode  
**Env:** Add `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`

---

### Ticket 2.2: Add Request Timeouts
**ID:** FUNC-002  
**Complexity:** MEDIUM (6 hours)  
**Risk:** LOW  
**Files:** `backend/server.ts`, `src/modules/LLMClient.ts`, all async operations

**Acceptance Criteria:**
- [ ] Create `withTimeout()` utility function
- [ ] Apply to all database operations
- [ ] Apply to all LLM API calls
- [ ] Apply to all external service calls
- [ ] Test timeout enforcement
- [ ] Test graceful error responses

**Implementation:** See `docs/review-results.md` Fix 2  
**Tests:** `tests/timeouts/request-timeout.test.ts`  
**Rollback:** Increase timeout values, don't remove

---

### Ticket 2.3: Implement Retry Logic with Exponential Backoff
**ID:** FUNC-003  
**Complexity:** MEDIUM (8 hours)  
**Risk:** LOW  
**Files:** `src/modules/LLMClient.ts`, `mechanisms/llmOrchestration/utils.ts`

**Acceptance Criteria:**
- [ ] Create RetryManager class
- [ ] Implement exponential backoff with jitter
- [ ] Configure retryable error types
- [ ] Add max retry limits
- [ ] Test retry behavior
- [ ] Test non-retryable errors fail immediately

**Implementation:**
```typescript
class RetryManager {
  private config = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true
  };

  async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (!this.isRetryable(error)) {
          throw error;
        }

        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }

    throw new Error(`Failed after ${this.config.maxAttempts} attempts: ${lastError!.message}`);
  }

  private calculateDelay(attempt: number): number {
    let delay = this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attempt - 1);
    delay = Math.min(delay, this.config.maxDelay);

    if (this.config.jitter) {
      const jitterRange = delay * 0.25;
      delay += (Math.random() - 0.5) * 2 * jitterRange;
    }

    return Math.max(delay, 0);
  }

  private isRetryable(error: Error): boolean {
    const retryableErrors = [
      'TIMEOUT',
      'NETWORK_ERROR',
      'RATE_LIMIT_EXCEEDED',
      'TEMPORARY_UNAVAILABLE'
    ];
    return retryableErrors.some(code => error.message.includes(code));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

**Tests:** `tests/retry/retry-logic.test.ts`  
**Rollback:** Set `maxAttempts: 1`

---

### Ticket 2.4: Implement Circuit Breaker Pattern
**ID:** FUNC-004  
**Complexity:** MEDIUM (8 hours)  
**Risk:** LOW  
**Files:** `src/modules/LLMClient.ts`, `mechanisms/llmOrchestration/utils.ts`

**Acceptance Criteria:**
- [ ] Create CircuitBreaker class
- [ ] Implement OPEN/CLOSED/HALF_OPEN states
- [ ] Configure failure threshold
- [ ] Configure recovery timeout
- [ ] Test state transitions
- [ ] Integrate with LLM provider calls

**Implementation:** Use existing `CircuitBreaker` from `mechanisms/llmOrchestration/utils.ts`  
**Tests:** `tests/circuit-breaker/circuit-breaker.test.ts`  
**Rollback:** Disable circuit breaker

---

### Ticket 2.5: Fix Database Connection Resilience
**ID:** FUNC-005  
**Complexity:** MEDIUM (6 hours)  
**Risk:** MEDIUM (data integrity)  
**Files:** `backend/db/adapter.ts`

**Acceptance Criteria:**
- [ ] Add retry logic with backoff for connection
- [ ] Add connection health checks
- [ ] Add reconnection logic on disconnect
- [ ] Add graceful shutdown for DB connections
- [ ] Test connection failures
- [ ] Test reconnection

**Implementation:**
```typescript
async function initializeDatabaseAdapters(maxRetries = 3): Promise<...> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const prisma = new PrismaClient({
        log: ['error', 'warn'],
      });

      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`; // Health check

      // Add reconnection logic
      prisma.$use(async (params, next) => {
        try {
          return await next(params);
        } catch (error) {
          if (error.code === 'P1001') { // Connection timeout
            await prisma.$connect(); // Reconnect
            return await next(params);
          }
          throw error;
        }
      });

      return { /* ... */ };
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}
```

**Tests:** `tests/database/connection.test.ts`  
**Rollback:** Revert to in-memory storage

---

### Ticket 2.6: Implement Real Quality Metrics
**ID:** FUNC-006  
**Complexity:** MEDIUM (8 hours)  
**Risk:** LOW  
**Files:** `src/modules/LLMClient.ts`

**Acceptance Criteria:**
- [ ] Implement relevance calculation
- [ ] Implement coherence calculation
- [ ] Implement creativity calculation
- [ ] Implement accuracy calculation
- [ ] Test quality assessments
- [ ] Benchmark against human ratings

**Implementation:** See `COMPREHENSIVE_CODE_REVIEW.md` Quality Assessment section  
**Tests:** `tests/llm-client/quality-metrics.test.ts`  
**Rollback:** Revert to random values (not recommended)

---

## Epic 3: Stability & Observability (P1 - HIGH)

**Goal:** Add production-grade stability and monitoring features  
**Estimated Effort:** 40-60 hours  
**Priority:** REQUIRED FOR PRODUCTION OPERATIONS  
**Risk if Skipped:** MEDIUM - Difficult to debug and maintain

### Ticket 3.1: Add Comprehensive Logging
**ID:** OBS-001  
**Complexity:** MEDIUM (8 hours)  
**Risk:** LOW  
**Files:** `backend/server.ts`, `backend/middleware/logger.ts` (new)

**Acceptance Criteria:**
- [ ] Configure Winston logger
- [ ] Add request logging middleware
- [ ] Add structured logging (JSON format)
- [ ] Add log levels (error, warn, info, debug)
- [ ] Add request correlation IDs
- [ ] Configure log rotation
- [ ] Test log output

**Implementation:**
```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = generateId('req');
  (req as any).requestId = requestId;

  logger.info('Request started', {
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip
  });

  res.on('finish', () => {
    logger.info('Request completed', {
      requestId,
      status: res.statusCode,
      duration: Date.now()
    });
  });

  next();
});
```

**Tests:** `tests/observability/logging.test.ts`  
**Rollback:** Revert to console.log  
**Env:** Add `LOG_LEVEL=info`, `LOG_FILE=logs/app.log`

---

### Ticket 3.2: Add Health Check Endpoints
**ID:** OBS-002  
**Complexity:** LOW (4 hours)  
**Risk:** LOW  
**Files:** `backend/server.ts`

**Acceptance Criteria:**
- [ ] Add `/health` endpoint (basic)
- [ ] Add `/health/ready` endpoint (dependency checks)
- [ ] Add `/health/live` endpoint (liveness probe)
- [ ] Check database connectivity
- [ ] Check external service availability
- [ ] Test health checks

**Implementation:**
```typescript
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/health/ready', async (req: Request, res: Response) => {
  try {
    // Check database
    await profilesRepo.getAll();

    // Check external services (optional)
    // await checkLLMProviders();

    res.json({
      status: 'ready',
      checks: {
        database: 'ok',
        llmProviders: 'ok'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      error: error.message
    });
  }
});
```

**Tests:** `tests/observability/health-checks.test.ts`  
**Rollback:** Remove endpoints

---

### Ticket 3.3: Fix WebSocket Memory Leaks
**ID:** STAB-001  
**Complexity:** MEDIUM (6 hours)  
**Risk:** LOW  
**Files:** `backend/server.ts`

**Acceptance Criteria:**
- [ ] Add ping/pong heartbeat mechanism
- [ ] Add cleanup on 'terminate' event
- [ ] Add connection limits
- [ ] Test memory usage over time
- [ ] Test cleanup on abnormal disconnect

**Implementation:** See `COMPREHENSIVE_CODE_REVIEW.md` WebSocket section  
**Tests:** `tests/websocket/memory-leak.test.ts`  
**Rollback:** Disable heartbeat

---

### Ticket 3.4: Implement Graceful Shutdown
**ID:** STAB-002  
**Complexity:** MEDIUM (4 hours)  
**Risk:** LOW  
**Files:** `backend/server.ts`

**Acceptance Criteria:**
- [ ] Handle SIGTERM signal
- [ ] Handle SIGINT signal
- [ ] Close HTTP server
- [ ] Close all WebSocket connections
- [ ] Disconnect database
- [ ] Clear all intervals
- [ ] Test graceful shutdown

**Implementation:** See `docs/review-results.md` Issue 1.8  
**Tests:** `tests/stability/shutdown.test.ts`  
**Rollback:** N/A

---

## Epic 4: Testing Infrastructure (P1 - HIGH)

**Goal:** Achieve 80%+ test coverage  
**Estimated Effort:** 60-80 hours  
**Priority:** REQUIRED FOR MAINTAINABILITY  
**Risk if Skipped:** MEDIUM - Technical debt, regression risk

### Ticket 4.1: Set Up Testing Framework
**ID:** TEST-001  
**Complexity:** LOW (4 hours)  
**Risk:** LOW  
**Files:** `jest.config.js` (new), `tests/setup.ts` (new)

**Acceptance Criteria:**
- [ ] Install Jest and dependencies
- [ ] Configure Jest for TypeScript
- [ ] Set up test utilities
- [ ] Create test directory structure
- [ ] Add test scripts to package.json

**Implementation:**
```json
// package.json
{
  "devDependencies": {
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0",
    "ts-jest": "^29.0.0"
  },
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

**Tests:** N/A (infrastructure)  
**Rollback:** N/A

---

### Ticket 4.2: Write Unit Tests (Security)
**ID:** TEST-002  
**Complexity:** MEDIUM (12 hours)  
**Risk:** LOW  
**Files:** `tests/security/*.test.ts`

**Acceptance Criteria:**
- [ ] Session ID tests
- [ ] Rate limiting tests
- [ ] Input sanitization tests
- [ ] CORS tests
- [ ] Authentication tests
- [ ] Achieve 90%+ coverage for security code

**Tests:** 15-20 test files  
**Rollback:** N/A

---

### Ticket 4.3: Write Unit Tests (Core)
**ID:** TEST-003  
**Complexity:** HIGH (20 hours)  
**Risk:** LOW  
**Files:** `tests/llm-client/*.test.ts`, `tests/orchestrator/*.test.ts`

**Acceptance Criteria:**
- [ ] LLM client tests
- [ ] Orchestrator tests
- [ ] Tool router tests
- [ ] Memory manager tests
- [ ] Prompt registry tests
- [ ] Achieve 80%+ coverage

**Tests:** 25-30 test files  
**Rollback:** N/A

---

### Ticket 4.4: Write Integration Tests
**ID:** TEST-004  
**Complexity:** HIGH (16 hours)  
**Risk:** LOW  
**Files:** `tests/integration/*.test.ts`

**Acceptance Criteria:**
- [ ] Full pipeline tests
- [ ] Database integration tests
- [ ] WebSocket integration tests
- [ ] API endpoint tests
- [ ] Achieve 70%+ coverage for integration tests

**Tests:** 10-15 test files  
**Rollback:** N/A

---

## Epic 5: Code Quality & Refactoring (P2 - MEDIUM)

**Goal:** Improve code organization and maintainability  
**Estimated Effort:** 40-60 hours  
**Priority:** NICE TO HAVE (but recommended)  
**Risk if Skipped:** LOW - System functional but harder to maintain

### Ticket 5.1: Split server.ts into Modules
**ID:** REFACT-001  
**Complexity:** HIGH (12 hours)  
**Risk:** MEDIUM (breaking changes)  
**Files:** `backend/routes/*.ts` (new), `backend/server.ts`

**Acceptance Criteria:**
- [ ] Extract profile routes to `backend/routes/profiles.ts`
- [ ] Extract listing routes to `backend/routes/listings.ts`
- [ ] Extract connection routes to `backend/routes/connections.ts`
- [ ] Reduce server.ts to <200 lines
- [ ] Maintain API compatibility
- [ ] All tests pass

**Tests:** Regression tests  
**Rollback:** Revert commit

---

### Ticket 5.2: Add Service Layer
**ID:** REFACT-002  
**Complexity:** HIGH (16 hours)  
**Risk:** MEDIUM  
**Files:** `backend/services/*.ts` (new)

**Acceptance Criteria:**
- [ ] Create ProfileService
- [ ] Create ListingService
- [ ] Move business logic from routes to services
- [ ] Add service interfaces
- [ ] Update routes to use services
- [ ] All tests pass

**Tests:** Service unit tests  
**Rollback:** Revert commit

---

## Rollout Strategy

### Phase 1: Security Fixes (Weeks 1-2)
**Deployment:** Staged rollout
1. Deploy to staging environment
2. Run security penetration tests
3. Deploy to production with feature flags
4. Monitor for 1 week
5. Enable all features

**Feature Flags:**
```typescript
const featureFlags = {
  jwtAuth: false, // Enable after testing
  rateLimiting: true, // Enable immediately
  inputSanitization: true // Enable immediately
};
```

### Phase 2: Core Functionality (Weeks 3-4)
**Deployment:** Gradual rollout
1. Deploy LLM integration with mock fallback
2. Enable for 10% of requests
3. Monitor API costs and errors
4. Gradually increase to 100%
5. Remove mock fallback

**Monitoring:**
- API error rates
- Response times
- Token usage
- Costs

### Phase 3: Stability (Weeks 5-6)
**Deployment:** Standard rollout
1. Deploy to staging
2. Run load tests
3. Deploy to production
4. Monitor stability metrics

### Phase 4: Testing (Weeks 7-8)
**Deployment:** N/A (internal)
1. Write tests alongside fixes
2. Maintain 80%+ coverage
3. Add tests to CI pipeline

---

## CI/CD Pipeline

### GitHub Actions Workflow

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

    steps:
    - uses: actions/checkout@v3

    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Type check
      run: npm run type-check

    - name: Lint
      run: npm run lint

    - name: Test
      run: npm test -- --coverage

    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        file: ./coverage/coverage-final.json
        fail_ci_if_error: true

  build:
    runs-on: ubuntu-latest
    needs: test

    steps:
    - uses: actions/checkout@v3

    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'

    - name: Install dependencies
      run: npm ci

    - name: Build
      run: npm run build

  deploy-staging:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'

    steps:
    - name: Deploy to staging
      run: ./deploy.sh staging

  deploy-production:
    runs-on: ubuntu-latest
    needs: deploy-staging
    if: github.ref == 'refs/heads/main'

    steps:
    - name: Wait for staging tests
      run: sleep 300 # Wait 5 minutes

    - name: Deploy to production
      run: ./deploy.sh production
```

---

## Risk Mitigation

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| API costs exceed budget | MEDIUM | HIGH | Set usage limits, monitor costs daily |
| Database migration fails | LOW | HIGH | Test migration on staging, keep rollback plan |
| Breaking changes break clients | MEDIUM | MEDIUM | Dual support period, clear deprecation notices |
| Performance degradation | LOW | MEDIUM | Load test before deployment, monitor metrics |

### Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Team capacity insufficient | MEDIUM | HIGH | Prioritize P0 tickets, defer P2 features |
| Third-party API downtime | MEDIUM | MEDIUM | Circuit breakers, fallback providers |
| Security vulnerability discovered | LOW | CRITICAL | Immediate patching, security monitoring |

---

## Success Metrics

### Quality Metrics
- **Test Coverage:** >80% (unit), >70% (integration)
- **Type Safety:** 0 TypeScript errors, 0 `any` types in critical paths
- **Code Quality:** ESLint errors = 0, Code smell ratio <5%

### Performance Metrics
- **API Response Time:** p95 < 500ms, p99 < 1000ms
- **WebSocket Latency:** < 100ms
- **Database Query Time:** p95 < 100ms
- **Error Rate:** < 0.1%

### Security Metrics
- **Vulnerabilities:** 0 critical, 0 high
- **Rate Limit Hits:** < 5% of requests
- **Auth Failures:** < 1% of requests
- **Security Incidents:** 0

### Reliability Metrics
- **Uptime:** > 99.9%
- **MTTR:** < 1 hour
- **Deployment Success Rate:** > 95%

---

## Appendix: File Structure After Refactoring

```
coordination-cosmos/
├── backend/
│   ├── server.ts              # Entry point (<100 lines)
│   ├── app.ts                 # Express app setup
│   ├── routes/
│   │   ├── profiles.ts
│   │   ├── listings.ts
│   │   ├── connections.ts
│   │   └── system.ts
│   ├── services/
│   │   ├── profileService.ts
│   │   ├── listingService.ts
│   │   └── matchingService.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── validation.ts
│   │   ├── rateLimit.ts
│   │   ├── sanitize.ts
│   │   └── logger.ts
│   ├── repos/
│   │   ├── ProfilesRepo.ts
│   │   ├── ListingsRepo.ts
│   │   └── ConnectionsRepo.ts
│   ├── db/
│   │   └── adapter.ts
│   └── validation/
│       ├── schemas.ts
│       └── middleware.ts
├── src/
│   ├── orchestrator.ts
│   ├── modules/
│   │   ├── LLMClient.ts
│   │   ├── ToolRouter.ts
│   │   ├── MemoryManager.ts
│   │   └── PromptRegistry.ts
│   └── types/
│       └── Message.ts
├── mechanisms/
│   ├── llmOrchestration/
│   ├── agents/
│   ├── matching/
│   └── ...
├── tests/
│   ├── security/
│   ├── timeouts/
│   ├── llm-client/
│   ├── websocket/
│   ├── backend/
│   ├── mechanisms/
│   └── integration/
├── docs/
│   ├── review-results.md
│   ├── technical-plan.md
│   └── architecture.md
├── .env.example
├── .github/workflows/ci.yml
└── package.json
```

---

**Document Status:** DRAFT  
**Next Review:** Weekly during implementation  
**Last Updated:** March 3, 2026  
**Owner:** Engineering Team
