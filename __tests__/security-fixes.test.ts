/**
 * Comprehensive Test Suite: Security & Performance Fixes
 * 
 * Tests for all implemented security and performance improvements
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================
// Token Blacklist Tests
// ============================================

describe('Token Blacklist', () => {
  let blacklistToken: (jti: string, expiresAt: Date) => void;
  let isTokenBlacklisted: (jti: string) => boolean;
  let getBlacklistStats: () => { size: number };

  beforeEach(async () => {
    // Clear any existing blacklist entries
    const module = await import('@/lib/auth/jwt');
    blacklistToken = module.blacklistToken;
    isTokenBlacklisted = module.isTokenBlacklisted;
    getBlacklistStats = module.getBlacklistStats;
  });

  it('should blacklist and detect token', () => {
    const jti = 'test-jti-123';
    const expiresAt = new Date(Date.now() + 3600000);
    
    blacklistToken(jti, expiresAt);
    
    expect(isTokenBlacklisted(jti)).toBe(true);
  });

  it('should allow non-blacklisted token', () => {
    expect(isTokenBlacklisted('non-existent-jti')).toBe(false);
  });

  it('should track blacklist size', () => {
    const initialSize = getBlacklistStats().size;
    
    blacklistToken('jti-1', new Date(Date.now() + 3600000));
    blacklistToken('jti-2', new Date(Date.now() + 3600000));
    
    expect(getBlacklistStats().size).toBe(initialSize + 2);
  });

  it('should cleanup expired entries', async () => {
    const jti = 'expired-jti';
    const expiresAt = new Date(Date.now() - 1000); // Already expired
    
    blacklistToken(jti, expiresAt);
    
    // Wait for cleanup (in production this is 5 minutes, we test the logic)
    // The cleanup interval removes entries where now > expiresAt
    expect(isTokenBlacklisted(jti)).toBe(false); // Should be cleaned up
  });
});

// ============================================
// PKCE Tests
// ============================================

describe('PKCE (Proof Key for Code Exchange)', () => {
  let generateCodeVerifier: () => string;
  let generateCodeChallenge: (verifier: string) => string;
  let verifyCodeChallenge: (verifier: string, challenge: string) => boolean;

  beforeEach(async () => {
    const module = await import('@/lib/auth/oauth-service');
    generateCodeVerifier = module.generateCodeVerifier;
    generateCodeChallenge = module.generateCodeChallenge;
    verifyCodeChallenge = module.verifyCodeChallenge;
  });

  it('should generate valid code verifier (43-128 chars)', () => {
    const verifier = generateCodeVerifier();
    
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('should generate consistent code challenge', () => {
    const verifier = generateCodeVerifier();
    const challenge1 = generateCodeChallenge(verifier);
    const challenge2 = generateCodeChallenge(verifier);
    
    expect(challenge1).toBe(challenge2);
  });

  it('should verify matching code challenge', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    
    expect(verifyCodeChallenge(verifier, challenge)).toBe(true);
  });

  it('should reject mismatched code challenge', () => {
    const verifier1 = generateCodeVerifier();
    const verifier2 = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier1);
    
    expect(verifyCodeChallenge(verifier2, challenge)).toBe(false);
  });

  it('should generate URL-safe challenge', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    
    // Should only contain URL-safe characters
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

// ============================================
// Token Refresh Tests
// ============================================

describe('Token Refresh', () => {
  let isTokenExpiringSoon: (expiresAt: number, threshold?: number) => boolean;
  let getTokenRemainingLifetime: (expiresAt: number) => number;

  beforeEach(async () => {
    const module = await import('@/lib/auth/jwt');
    isTokenExpiringSoon = module.isTokenExpiringSoon;
    getTokenRemainingLifetime = module.getTokenRemainingLifetime;
  });

  it('should detect expiring token', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 120; // 2 minutes from now
    
    expect(isTokenExpiringSoon(expiresAt, 5)).toBe(true);
  });

  it('should allow non-expiring token', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    
    expect(isTokenExpiringSoon(expiresAt, 5)).toBe(false);
  });

  it('should calculate remaining lifetime', () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now
    
    const remaining = getTokenRemainingLifetime(expiresAt);
    
    expect(remaining).toBeGreaterThan(290); // ~5 minutes in seconds
    expect(remaining).toBeLessThan(310);
  });

  it('should return 0 for expired token', () => {
    const expiresAt = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
    
    expect(getTokenRemainingLifetime(expiresAt)).toBe(0);
  });
});

// ============================================
// Rate Limiting Tests
// ============================================

describe('Rate Limiting', () => {
  let checkRateLimit: (
    identifier: string,
    maxRequests: number,
    windowMs: number
  ) => { allowed: boolean; remaining: number; resetAt: number; retryAfter?: number };
  let resetRateLimit: (identifier: string) => void;

  beforeEach(async () => {
    const module = await import('@/lib/middleware/rate-limit');
    checkRateLimit = module.checkRateLimit;
    resetRateLimit = module.resetRateLimit;
  });

  afterEach(() => {
    // Clean up test entries
    resetRateLimit('test-user');
    resetRateLimit('rate-limit-test');
  });

  it('should allow requests under limit', () => {
    const result = checkRateLimit('test-user', 10, 60000);
    
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('should block requests over limit', () => {
    // Make 5 requests
    for (let i = 0; i < 5; i++) {
      checkRateLimit('rate-limit-test', 5, 60000);
    }
    
    // 6th request should be blocked
    const result = checkRateLimit('rate-limit-test', 5, 60000);
    
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeDefined();
    expect(result.retryAfter!).toBeGreaterThan(0);
  });

  it('should reset after window expires', () => {
    // Use a very short window for testing
    const result1 = checkRateLimit('short-window', 2, 100);
    expect(result1.allowed).toBe(true);
    
    const result2 = checkRateLimit('short-window', 2, 100);
    expect(result2.allowed).toBe(true);
    
    const result3 = checkRateLimit('short-window', 2, 100);
    expect(result3.allowed).toBe(false);
    
    // Wait for window to expire
    setTimeout(() => {
      const result4 = checkRateLimit('short-window', 2, 100);
      expect(result4.allowed).toBe(true);
    }, 150);
  });

  it('should track remaining requests correctly', () => {
    let result;
    
    result = checkRateLimit('counter-test', 10, 60000);
    expect(result.remaining).toBe(9);
    
    result = checkRateLimit('counter-test', 10, 60000);
    expect(result.remaining).toBe(8);
    
    result = checkRateLimit('counter-test', 10, 60000);
    expect(result.remaining).toBe(7);
  });
});

// ============================================
// Input Validation Tests
// ============================================

describe('Input Validation', () => {
  let schemas: any;
  let sanitizeString: (input: string) => string;
  let sanitizeObject: <T extends Record<string, any>>(obj: T) => T;

  beforeEach(async () => {
    const module = await import('@/lib/middleware/validate');
    // Access schemas after module is loaded to avoid circular reference
    schemas = {
      email: module.schemas.email,
      password: module.schemas.password,
      uuid: module.schemas.uuid,
      login: module.schemas.login,
    };
    sanitizeString = module.sanitizeString;
    sanitizeObject = module.sanitizeObject;
  });

  describe('Email Schema', () => {
    it('should validate valid email', () => {
      const result = schemas.email.safeParse('test@example.com');
      expect(result.success).toBe(true);
    });

    it('should reject invalid email', () => {
      const result = schemas.email.safeParse('invalid-email');
      expect(result.success).toBe(false);
    });
  });

  describe('Password Schema', () => {
    it('should validate strong password', () => {
      const result = schemas.password.safeParse('SecurePass123');
      expect(result.success).toBe(true);
    });

    it('should reject short password', () => {
      const result = schemas.password.safeParse('Short1!');
      expect(result.success).toBe(false);
    });

    it('should reject password without uppercase', () => {
      const result = schemas.password.safeParse('lowercase123!');
      expect(result.success).toBe(false);
    });

    it('should reject password without number', () => {
      const result = schemas.password.safeParse('NoNumbers!');
      expect(result.success).toBe(false);
    });
  });

  describe('String Sanitization', () => {
    it('should remove HTML brackets', () => {
      const input = '<script>alert("xss")</script>';
      const sanitized = sanitizeString(input);
      
      expect(sanitized).not.toContain('<');
      expect(sanitized).not.toContain('>');
    });

    it('should remove javascript: protocol', () => {
      const input = 'javascript:alert(1)';
      const sanitized = sanitizeString(input);
      
      expect(sanitized).not.toContain('javascript:');
    });

    it('should remove event handlers', () => {
      const input = 'onclick=alert(1)';
      const sanitized = sanitizeString(input);
      
      expect(sanitized).not.toContain('onclick=');
    });

    it('should preserve safe content', () => {
      const input = 'Hello World!';
      const sanitized = sanitizeString(input);
      
      expect(sanitized).toBe('Hello World!');
    });
  });

  describe('Object Sanitization', () => {
    it('should sanitize all string fields', () => {
      const input = {
        name: '<script>alert(1)</script>',
        description: 'javascript:malicious',
        count: 42,
      };
      
      const sanitized = sanitizeObject(input);
      
      expect(sanitized.name).not.toContain('<');
      expect(sanitized.description).not.toContain('javascript:');
      expect(sanitized.count).toBe(42);
    });

    it('should handle nested objects', () => {
      const input = {
        user: {
          name: '<b>John</b>',
          settings: {
            theme: 'dark',
          },
        },
      };
      
      const sanitized = sanitizeObject(input);
      
      expect(sanitized.user.name).not.toContain('<');
      expect(sanitized.user.settings.theme).toBe('dark');
    });
  });
});

// ============================================
// Circuit Breaker Tests
// ============================================

describe('Circuit Breaker', () => {
  let ProviderCircuitBreaker: any;
  let circuitBreakerRegistry: any;

  beforeEach(async () => {
    const module = await import('@/lib/sandbox/circuit-breaker');
    ProviderCircuitBreaker = module.ProviderCircuitBreaker;
    circuitBreakerRegistry = module.circuitBreakerRegistry;
  });

  it('should start in CLOSED state', () => {
    const breaker = new ProviderCircuitBreaker('test-provider');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('should open after threshold failures', async () => {
    const breaker = new ProviderCircuitBreaker('test-provider-2', {
      failureThreshold: 3,
      timeoutMs: 1000,
    });

    // Simulate failures
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }
    }

    expect(breaker.getState()).toBe('OPEN');
  });

  it('should reject requests when OPEN', async () => {
    const breaker = new ProviderCircuitBreaker('test-provider-3', {
      failureThreshold: 1,
      timeoutMs: 10000,
    });

    // Open the circuit
    try {
      await breaker.execute(async () => {
        throw new Error('Test error');
      });
    } catch {
      // Expected
    }

    // Should reject new requests
    await expect(
      breaker.execute(async () => 'success')
    ).rejects.toThrow('Circuit breaker is OPEN');
  });

  it('should transition to HALF_OPEN after timeout', async () => {
    const breaker = new ProviderCircuitBreaker('test-provider-4', {
      failureThreshold: 1,
      timeoutMs: 100, // Short timeout for testing
    });

    // Open the circuit
    try {
      await breaker.execute(async () => {
        throw new Error('Test error');
      });
    } catch {
      // Expected
    }

    expect(breaker.getState()).toBe('OPEN');

    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 150));

    expect(breaker.getState()).toBe('HALF_OPEN');
  });

  it('should close after successful requests in HALF_OPEN', async () => {
    const breaker = new ProviderCircuitBreaker('test-provider-5', {
      failureThreshold: 1,
      successThreshold: 2,
      timeoutMs: 50,
    });

    // Open the circuit
    try {
      await breaker.execute(async () => {
        throw new Error('Test error');
      });
    } catch {
      // Expected
    }

    // Wait for half-open
    await new Promise(resolve => setTimeout(resolve, 100));

    // Successful requests
    await breaker.execute(async () => 'success');
    await breaker.execute(async () => 'success');

    expect(breaker.getState()).toBe('CLOSED');
  });

  it('should track statistics', () => {
    const breaker = new ProviderCircuitBreaker('test-provider-6');
    const stats = breaker.getStats();

    expect(stats).toHaveProperty('state');
    expect(stats).toHaveProperty('failureCount');
    expect(stats).toHaveProperty('successCount');
    expect(stats).toHaveProperty('halfOpenRequests');
  });
});

// ============================================
// MCP Connection Pool Tests
// ============================================

describe('MCP Connection Pool', () => {
  let MCPConnectionPool: any;

  beforeEach(async () => {
    const module = await import('@/lib/mcp/connection-pool');
    MCPConnectionPool = module.MCPConnectionPool;
  });

  it('should create pool with minimum connections', async () => {
    const pool = new MCPConnectionPool('test-server', {
      type: 'stdio',
      name: 'test',
      command: 'echo',
    }, {
      minConnections: 2,
      maxConnections: 5,
    });

    const stats = pool.getStats();
    
    expect(stats.totalConnections).toBeGreaterThanOrEqual(2);
    
    await pool.shutdown();
  });

  it('should acquire and release clients', async () => {
    const pool = new MCPConnectionPool('test-server-2', {
      type: 'stdio',
      name: 'test',
      command: 'echo',
    }, {
      minConnections: 1,
      maxConnections: 3,
    });

    // Wait for pool to initialize
    await new Promise(resolve => setTimeout(resolve, 100));

    const client1 = await pool.acquireClient();
    expect(client1).toBeDefined();

    pool.releaseClient(client1);

    const stats2 = pool.getStats();
    expect(stats2.inUseConnections).toBe(0);

    await pool.shutdown();
  });

  it('should respect max connections limit', async () => {
    const pool = new MCPConnectionPool('test-server-3', {
      type: 'stdio',
      name: 'test',
      command: 'echo',
    }, {
      minConnections: 1,
      maxConnections: 2,
    });

    // Wait for pool to initialize
    await new Promise(resolve => setTimeout(resolve, 100));

    // Acquire max connections
    const client1 = await pool.acquireClient();
    const client2 = await pool.acquireClient();

    // Try to acquire third (should wait or timeout)
    const acquirePromise = pool.acquireClient(100);
    
    await expect(acquirePromise).rejects.toThrow('Timeout');

    pool.releaseClient(client1);
    pool.releaseClient(client2);
    await pool.shutdown();
  });

  it('should provide statistics', async () => {
    const pool = new MCPConnectionPool('test-server-4', {
      type: 'stdio',
      name: 'test',
      command: 'echo',
    });

    const stats = pool.getStats();

    expect(stats).toHaveProperty('totalConnections');
    expect(stats).toHaveProperty('availableConnections');
    expect(stats).toHaveProperty('inUseConnections');
    expect(stats).toHaveProperty('pendingRequests');

    await pool.shutdown();
  });
});
