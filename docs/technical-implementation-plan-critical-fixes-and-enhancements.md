---
id: technical-implementation-plan-critical-fixes-and-enhancements
title: Technical Implementation Plan - Critical Fixes & Enhancements
aliases:
  - r2TECHNICAL_IMPLEMENTATION_PLAN
  - r2TECHNICAL_IMPLEMENTATION_PLAN.md
  - technical-implementation-plan-critical-fixes-and-enhancements
  - technical-implementation-plan-critical-fixes-and-enhancements.md
tags:
  - implementation
  - review
layer: core
summary: "# Technical Implementation Plan - Critical Fixes & Enhancements\r\n\r\n**Created:** March 3, 2026  \r\n**Priority:** P0 - Production Blockers  \r\n**Estimated Effort:** 216 hours (5.4 weeks)\r\n\r\n---\r\n\r\n## Overview\r\n\r\nThis document provides detailed technical plans for addressing the critical issues identifie"
anchors:
  - Overview
  - Table of Contents
  - 1. Security Module Enhancements
  - 1.1 Path Traversal Protection
  - 1.2 JWT Authentication Enhancement
  - 1.3 Rate Limiting Middleware
  - 2. Backend Storage Implementation
  - 2.1 Real Storage Backend Wiring
  - 3. Provider Initialization & Fallback Chain
  - 3.1 Provider Registry Enhancement
  - 4. WebSocket Terminal Integration
  - 4.1 Frontend WebSocket Connection
  - 5. Agent & Tool Wiring
  - 5.1 Unified Agent Enhancement
  - 6. Metrics & Monitoring
  - 6.1 Metrics Wiring
  - 7. Error Handling & Retry Logic
  - 7.1 Retry Utility
  - 8. SDK Integration Enhancements
  - 8.1 Composio Session Workflow
  - Implementation Checklist
  - 'Phase 1: Security (Week 1)'
  - 'Phase 2: Backend (Week 2-3)'
  - 'Phase 3: Providers (Week 4-5)'
  - 'Phase 4: Agents (Week 6)'
  - 'Phase 5: Production (Week 7-8)'
---
# Technical Implementation Plan - Critical Fixes & Enhancements

**Created:** March 3, 2026  
**Priority:** P0 - Production Blockers  
**Estimated Effort:** 216 hours (5.4 weeks)

---

## Overview

This document provides detailed technical plans for addressing the critical issues identified in the comprehensive codebase review. Each section includes specific code changes, architectural decisions, and implementation steps.

---

## Table of Contents

1. [Security Module Enhancements](#1-security-module-enhancements)
2. [Backend Storage Implementation](#2-backend-storage-implementation)
3. [Provider Initialization & Fallback Chain](#3-provider-initialization--fallback-chain)
4. [WebSocket Terminal Integration](#4-websocket-terminal-integration)
5. [Agent & Tool Wiring](#5-agent--tool-wiring)
6. [Metrics & Monitoring](#6-metrics--monitoring)
7. [Error Handling & Retry Logic](#7-error-handling--retry-logic)
8. [SDK Integration Enhancements](#8-sdk-integration-enhancements)

---

## 1. Security Module Enhancements

### 1.1 Path Traversal Protection

**File:** `lib/security/security-utils.ts` (create new)

```typescript
/**
 * Security Utilities
 * 
 * Path traversal protection, input validation, and command filtering
 */

import { z } from 'zod';
import { resolve, normalize } from 'path';

/**
 * Validate resource ID format (sandboxId, userId, etc.)
 */
export function isValidResourceId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Safely join paths with traversal protection
 */
export function safeJoin(base: string, ...paths: string[]): string {
  const resolved = resolve(base, ...paths);
  const normalizedBase = resolve(base);
  
  if (!resolved.startsWith(normalizedBase)) {
    throw new Error(
      `Path traversal detected: attempted to escape ${normalizedBase}`
    );
  }
  
  return resolved;
}

/**
 * Validate relative path within workspace
 */
export function validateRelativePath(
  path: string, 
  workspaceDir: string
): string {
  // Normalize to prevent .. attacks
  const normalized = normalize(path);
  
  // Check for obvious traversal attempts
  if (normalized.includes('..')) {
    throw new Error(`Invalid path: ${path}`);
  }
  
  // Construct full path and verify it's within workspace
  const fullPath = resolve(workspaceDir, normalized);
  if (!fullPath.startsWith(resolve(workspaceDir))) {
    throw new Error(`Path traversal detected: ${path}`);
  }
  
  return fullPath;
}

/**
 * Command validation schema
 */
export const commandSchema = z.string()
  .max(10000, 'Command too long (max 10000 characters)')
  .refine(
    (cmd) => {
      const dangerousPatterns = [
        /^rm\s+(-[rf]+\s+)?\/(\s|$)/,  // rm -rf /
        /^:()\{\s*:([&|])/,             // Fork bomb
        /wget\s+.*\|\s*bash/,           // wget | bash
        /curl\s+.*\|\s*bash/,           // curl | bash
        /chmod\s+777\s+\//,             // chmod 777 /
        /mkfs\./,                       // Format disk
        /dd\s+if=.*of=\/dev/,          // dd to device
        />\s*\/dev\/sd/,                // Overwrite disk
        /echo\s+.*>\s*\/etc/,           // Modify /etc
      ];
      
      return !dangerousPatterns.some(pattern => pattern.test(cmd));
    },
    {
      message: 'Dangerous command detected'
    }
  );

/**
 * Check if command is safe to execute
 */
export function isCommandSafe(command: string): boolean {
  try {
    commandSchema.parse(command);
    return true;
  } catch {
    return false;
  }
}

/**
 * Input validation schemas for API endpoints
 */
export const sandboxCreateSchema = z.object({
  language: z.string().optional(),
  autoStopInterval: z.number().min(60).max(1440).optional(),
  resources: z.object({
    cpu: z.number().min(0.1).max(16),
    memory: z.number().min(0.5).max(32),
  }).optional(),
  envVars: z.record(z.string()).optional(),
  labels: z.record(z.string()).optional(),
});

export const sandboxExecSchema = z.object({
  sandboxId: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid sandbox ID'),
  command: commandSchema,
  cwd: z.string().optional(),
  timeout: z.number().min(1000).max(600000).optional(),
});

export const fileOperationSchema = z.object({
  sandboxId: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid sandbox ID'),
  path: z.string().max(1000, 'Path too long'),
  content: z.string().max(10 * 1024 * 1024, 'File too large (max 10MB)').optional(),
});

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  commandsPerMinute: number;
  fileOpsPerMinute: number;
  sandboxCreationsPerHour: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  commandsPerMinute: 60,
  fileOpsPerMinute: 30,
  sandboxCreationsPerHour: 10,
};
```

**Implementation Steps:**
1. Create `lib/security/security-utils.ts` with above code
2. Export from `lib/security/index.ts`
3. Update all path operations to use `safeJoin()`
4. Add `validateRelativePath()` to all file operations
5. Apply `commandSchema` to all command executions

---

### 1.2 JWT Authentication Enhancement

**File:** `lib/security/jwt-auth.ts` (create new)

```typescript
/**
 * JWT Authentication
 * 
 * Complete JWT validation with jose library
 */

import { jwtVerify, SignJWT, importJWK, createRemoteJWKSet } from 'jose';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('JWT:Auth');

export interface JWTPayload {
  userId: string;
  email?: string;
  role?: 'user' | 'admin' | 'system';
  iat?: number;
  exp?: number;
  jti?: string;
}

export interface TokenOptions {
  expiresIn?: string;
  issuer?: string;
  audience?: string;
}

// Blacklist for revoked tokens (use Redis in production)
const tokenBlacklist = new Set<string>();

/**
 * Generate JWT token
 */
export async function generateToken(
  payload: JWTPayload,
  secret: string,
  options: TokenOptions = {}
): Promise<string> {
  const {
    expiresIn = '24h',
    issuer = 'binG',
    audience = 'binG-users',
  } = options;

  const jti = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  
  const token = await new SignJWT({ ...payload, jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(expiresIn)
    .setIssuer(issuer)
    .setAudience(audience)
    .sign(new TextEncoder().encode(secret));

  logger.debug('Token generated', { 
    userId: payload.userId, 
    jti,
    expiresIn 
  });

  return token;
}

/**
 * Verify JWT token
 */
export async function verifyToken(
  token: string,
  secret: string
): Promise<JWTPayload> {
  try {
    // Check blacklist
    const decoded = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString()
    );
    
    if (tokenBlacklist.has(decoded.jti)) {
      throw new Error('Token has been revoked');
    }

    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      {
        issuer: 'binG',
        audience: 'binG-users',
      }
    );

    return payload as JWTPayload;
  } catch (error: any) {
    logger.error('Token verification failed', { 
      error: error.message,
      tokenPrefix: token.slice(0, 10) 
    });
    throw new Error(`Invalid token: ${error.message}`);
  }
}

/**
 * Revoke token (add to blacklist)
 */
export function revokeToken(token: string): void {
  try {
    const decoded = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString()
    );
    tokenBlacklist.add(decoded.jti);
    logger.debug('Token revoked', { jti: decoded.jti });
  } catch (error: any) {
    logger.warn('Failed to revoke token', error);
  }
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Middleware for Next.js API routes
 */
export async function authMiddleware(
  request: Request,
  options: { 
    allowAnonymous?: boolean;
    requiredRole?: 'user' | 'admin';
  } = {}
): Promise<{ 
  authenticated: boolean;
  userId?: string;
  payload?: JWTPayload;
  error?: string;
}> {
  const authHeader = request.headers.get('authorization');
  const token = extractTokenFromHeader(authHeader);

  if (!token) {
    if (options.allowAnonymous) {
      return { authenticated: false };
    }
    return { 
      authenticated: false, 
      error: 'Authorization header required' 
    };
  }

  try {
    const secret = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
    const payload = await verifyToken(token, secret);

    if (options.requiredRole && payload.role !== options.requiredRole) {
      return {
        authenticated: false,
        error: `Required role: ${options.requiredRole}`,
      };
    }

    return {
      authenticated: true,
      userId: payload.userId,
      payload,
    };
  } catch (error: any) {
    return {
      authenticated: false,
      error: error.message,
    };
  }
}

/**
 * Refresh token rotation
 */
export async function refreshToken(
  oldToken: string,
  secret: string
): Promise<string> {
  const payload = await verifyToken(oldToken, secret);
  
  // Revoke old token
  revokeToken(oldToken);
  
  // Generate new token with same payload
  return generateToken(payload, secret);
}
```

**Implementation Steps:**
1. Install jose: `pnpm add jose`
2. Create `lib/security/jwt-auth.ts` with above code
3. Update all API routes to use `authMiddleware()`
4. Replace existing JWT validation with new implementation
5. Add token refresh endpoint

---

### 1.3 Rate Limiting Middleware

**File:** `lib/security/rate-limit-middleware.ts` (create new)

```typescript
/**
 * Rate Limiting Middleware
 * 
 * Token bucket rate limiting for API endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from './jwt-auth';

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

class RateLimiter {
  private buckets = new Map<string, RateLimitBucket>();
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per second

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
  }

  private getBucket(key: string): RateLimitBucket {
    if (!this.buckets.has(key)) {
      this.buckets.set(key, {
        tokens: this.capacity,
        lastRefill: Date.now(),
      });
    }
    return this.buckets.get(key)!;
  }

  private refill(bucket: RateLimitBucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    
    bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  async consume(key: string, tokens: number = 1): Promise<{
    allowed: boolean;
    remaining: number;
    resetIn: number;
  }> {
    const bucket = this.getBucket(key);
    this.refill(bucket);

    const allowed = bucket.tokens >= tokens;
    if (allowed) {
      bucket.tokens -= tokens;
    }

    const resetIn = Math.ceil((this.capacity - bucket.tokens) / this.refillRate);

    return {
      allowed,
      remaining: Math.floor(bucket.tokens),
      resetIn,
    };
  }
}

// Rate limiters for different operations
const commandLimiter = new RateLimiter(60, 1); // 60 per minute
const fileOpLimiter = new RateLimiter(30, 0.5); // 30 per minute
const sandboxCreateLimiter = new RateLimiter(10, 10 / 3600); // 10 per hour

export async function rateLimitMiddleware(
  request: NextRequest,
  operation: 'command' | 'file' | 'sandbox' | 'default'
): Promise<NextResponse | null> {
  // Get identifier (IP or userId)
  const authResult = await authMiddleware(request, { allowAnonymous: true });
  const identifier = authResult.userId || 
                     request.headers.get('x-forwarded-for') || 
                     'anonymous';

  const key = `${operation}:${identifier}`;
  
  let limiter: RateLimiter;
  switch (operation) {
    case 'command':
      limiter = commandLimiter;
      break;
    case 'file':
      limiter = fileOpLimiter;
      break;
    case 'sandbox':
      limiter = sandboxCreateLimiter;
      break;
    default:
      limiter = commandLimiter;
  }

  const result = await limiter.consume(key);

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: `Too many ${operation} operations`,
        retryAfter: result.resetIn,
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(limiter['capacity']),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(result.resetIn),
          'Retry-After': String(result.resetIn),
        },
      }
    );
  }

  // Add rate limit headers to response
  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Limit', String(limiter['capacity']));
  response.headers.set('X-RateLimit-Remaining', String(result.remaining));
  response.headers.set('X-RateLimit-Reset', String(result.resetIn));

  return response;
}
```

**Implementation Steps:**
1. Create `lib/security/rate-limit-middleware.ts`
2. Wrap all API route handlers with rate limiting
3. Configure different limits per operation type
4. Add rate limit headers to all responses

---

## 2. Backend Storage Implementation

### 2.1 Real Storage Backend Wiring

**File:** `lib/backend/storage-backend.ts` (enhance existing)

```typescript
/**
 * Storage Backend - Real Implementation
 * 
 * S3 and Local storage backends with retry logic
 */

import { EventEmitter } from 'events';
import { createReadStream, createWriteStream, mkdirSync, existsSync, statSync, unlinkSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { pipeline } from 'stream/promises';
import * as zlib from 'zlib';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

export interface StorageBackend {
  upload(localPath: string, remoteKey: string): Promise<void>;
  download(remoteKey: string, localPath: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  delete(remoteKey: string): Promise<void>;
}

export interface S3Config {
  endpointUrl?: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
  prefix?: string;
}

export interface LocalConfig {
  baseDir: string;
}

/**
 * S3 Storage Backend
 */
export class S3Backend extends EventEmitter implements StorageBackend {
  private client: S3Client;
  private bucket: string;
  private prefix: string;

  constructor(config: S3Config) {
    super();
    
    this.client = new S3Client({
      endpoint: config.endpointUrl,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      region: config.region,
      forcePathStyle: !!config.endpointUrl, // For MinIO compatibility
    });
    
    this.bucket = config.bucket;
    this.prefix = config.prefix || '';
  }

  async upload(localPath: string, remoteKey: string): Promise<void> {
    const key = this.prefix ? `${this.prefix}/${remoteKey}` : remoteKey;
    
    try {
      const fileStream = createReadStream(localPath);
      const stats = statSync(localPath);
      
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: fileStream,
        ContentLength: stats.size,
      });

      await this.client.send(command);
      this.emit('upload', { key, size: stats.size });
    } catch (error: any) {
      this.emit('error', { operation: 'upload', key, error: error.message });
      throw error;
    }
  }

  async download(remoteKey: string, localPath: string): Promise<boolean> {
    const key = this.prefix ? `${this.prefix}/${remoteKey}` : remoteKey;
    
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.client.send(command);
      
      // Ensure directory exists
      mkdirSync(dirname(localPath), { recursive: true });
      
      // @ts-ignore - Response.Body is Readable
      await pipeline(response.Body, createWriteStream(localPath));
      
      this.emit('download', { key, path: localPath });
      return true;
    } catch (error: any) {
      if (error.name === 'NoSuchKey') {
        return false;
      }
      this.emit('error', { operation: 'download', key, error: error.message });
      throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const fullPrefix = this.prefix ? `${this.prefix}/${prefix}` : prefix;
    
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: fullPrefix,
      });

      const response = await this.client.send(command);
      return (response.Contents || []).map(obj => obj.Key || '').filter(Boolean);
    } catch (error: any) {
      this.emit('error', { operation: 'list', prefix, error: error.message });
      throw error;
    }
  }

  async delete(remoteKey: string): Promise<void> {
    const key = this.prefix ? `${this.prefix}/${remoteKey}` : remoteKey;
    
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
      this.emit('delete', { key });
    } catch (error: any) {
      this.emit('error', { operation: 'delete', key, error: error.message });
      throw error;
    }
  }
}

/**
 * Local Storage Backend
 */
export class LocalBackend extends EventEmitter implements StorageBackend {
  private baseDir: string;

  constructor(baseDir: string) {
    super();
    this.baseDir = baseDir;
    mkdirSync(baseDir, { recursive: true });
  }

  async upload(localPath: string, remoteKey: string): Promise<void> {
    const destPath = join(this.baseDir, remoteKey);
    mkdirSync(dirname(destPath), { recursive: true });
    
    try {
      await pipeline(
        createReadStream(localPath),
        createWriteStream(destPath)
      );
      this.emit('upload', { key: remoteKey, path: destPath });
    } catch (error: any) {
      this.emit('error', { operation: 'upload', key: remoteKey, error: error.message });
      throw error;
    }
  }

  async download(remoteKey: string, localPath: string): Promise<boolean> {
    const sourcePath = join(this.baseDir, remoteKey);
    
    if (!existsSync(sourcePath)) {
      return false;
    }

    try {
      mkdirSync(dirname(localPath), { recursive: true });
      await pipeline(
        createReadStream(sourcePath),
        createWriteStream(localPath)
      );
      this.emit('download', { key: remoteKey, path: localPath });
      return true;
    } catch (error: any) {
      this.emit('error', { operation: 'download', key: remoteKey, error: error.message });
      throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const dirPath = join(this.baseDir, prefix);
    
    if (!existsSync(dirPath)) {
      return [];
    }

    try {
      const files: string[] = [];
      const walk = (dir: string, basePrefix: string) => {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          const relativePath = join(basePrefix, entry.name);
          
          if (entry.isDirectory()) {
            walk(fullPath, relativePath);
          } else {
            files.push(relativePath);
          }
        }
      };
      
      walk(dirPath, prefix);
      return files;
    } catch (error: any) {
      this.emit('error', { operation: 'list', prefix, error: error.message });
      throw error;
    }
  }

  async delete(remoteKey: string): Promise<void> {
    const path = join(this.baseDir, remoteKey);
    
    if (!existsSync(path)) {
      return;
    }

    try {
      unlinkSync(path);
      this.emit('delete', { key: remoteKey, path });
    } catch (error: any) {
      this.emit('error', { operation: 'delete', key: remoteKey, error: error.message });
      throw error;
    }
  }
}

/**
 * Factory functions
 */
export function getS3Backend(config: S3Config): S3Backend {
  return new S3Backend(config);
}

export function getLocalBackend(baseDir: string): LocalBackend {
  return new LocalBackend(baseDir);
}
```

**Implementation Steps:**
1. Replace existing `lib/backend/storage-backend.ts` with above code
2. Install AWS SDK: `pnpm add @aws-sdk/client-s3`
3. Wire to snapshot manager in `lib/backend/backend-service.ts`
4. Test with both S3 and local backends

---

## 3. Provider Initialization & Fallback Chain

### 3.1 Provider Registry Enhancement

**File:** `lib/sandbox/providers/index.ts` (enhance existing)

```typescript
/**
 * Enhanced Provider Registry
 * 
 * With proper initialization, health checks, and fallback chain
 */

import type { SandboxProvider } from './sandbox-provider';

// Provider registry with enhanced state tracking
interface ProviderEntry {
  provider: SandboxProvider | null;
  priority: number;
  enabled: boolean;
  available: boolean;
  healthy: boolean;
  lastHealthCheck: number;
  failureCount: number;
  factory?: () => SandboxProvider;
  healthCheck?: () => Promise<boolean>;
}

const providerRegistry = new Map<SandboxProviderType, ProviderEntry>();

// Circuit breaker configuration
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute

/**
 * Initialize provider with error recovery
 */
async function initializeProvider(
  type: SandboxProviderType,
  entry: ProviderEntry
): Promise<SandboxProvider> {
  if (entry.provider && entry.available) {
    return entry.provider;
  }

  if (!entry.factory) {
    throw new Error(`No factory for provider: ${type}`);
  }

  try {
    entry.provider = entry.factory();
    entry.available = true;
    entry.failureCount = 0;
    
    // Perform initial health check if available
    if (entry.healthCheck) {
      entry.healthy = await entry.healthCheck();
      entry.lastHealthCheck = Date.now();
    } else {
      entry.healthy = true; // Assume healthy if no health check
    }

    console.log(`[ProviderRegistry] ${type} initialized successfully`);
    return entry.provider;
  } catch (error: any) {
    entry.available = false;
    entry.healthy = false;
    entry.failureCount++;
    
    console.error(
      `[ProviderRegistry] Failed to initialize ${type}:`,
      error.message
    );
    
    throw new Error(
      `Failed to initialize provider ${type}: ${error.message}`
    );
  }
}

/**
 * Check if provider should be skipped (circuit breaker)
 */
function shouldSkipProvider(entry: ProviderEntry): boolean {
  if (entry.failureCount < CIRCUIT_BREAKER_THRESHOLD) {
    return false;
  }

  const elapsed = Date.now() - entry.lastHealthCheck;
  if (elapsed < CIRCUIT_BREAKER_TIMEOUT) {
    return true; // Circuit is open
  }

  // Try again after timeout
  entry.failureCount = 0;
  return false;
}

/**
 * Get provider with automatic fallback
 */
export async function getProviderWithFallback(
  primaryType: SandboxProviderType
): Promise<{ provider: SandboxProvider; type: SandboxProviderType }> {
  // Get all available providers sorted by priority
  const candidates = Array.from(providerRegistry.entries())
    .filter(([_, entry]) => entry.enabled && !shouldSkipProvider(entry))
    .sort((a, b) => (a[1].priority - b[1].priority));

  // Try each provider in priority order
  for (const [type, entry] of candidates) {
    try {
      await initializeProvider(type, entry);
      
      if (entry.available && entry.healthy) {
        return { provider: entry.provider!, type };
      }
    } catch (error: any) {
      console.warn(
        `[ProviderRegistry] ${type} failed, trying next:`,
        error.message
      );
      continue;
    }
  }

  throw new Error('All sandbox providers failed');
}

/**
 * Perform health check on all providers
 */
export async function performHealthChecks(): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  for (const [type, entry] of providerRegistry) {
    if (!entry.enabled) {
      results.set(type, false);
      continue;
    }

    try {
      if (entry.healthCheck) {
        entry.healthy = await entry.healthCheck();
        entry.lastHealthCheck = Date.now();
      } else {
        entry.healthy = entry.available;
      }
      results.set(type, entry.healthy);
    } catch (error: any) {
      entry.healthy = false;
      entry.failureCount++;
      results.set(type, false);
    }
  }

  return results;
}

// ... rest of existing exports
```

**Implementation Steps:**
1. Enhance provider registry with above code
2. Add health check methods to each provider
3. Update `getSandboxProvider()` to use fallback chain
4. Add periodic health check interval

---

## 4. WebSocket Terminal Integration

### 4.1 Frontend WebSocket Connection

**File:** `components/terminal/TerminalPanel.tsx` (enhance existing)

```typescript
/**
 * Enhanced Terminal Panel with Real WebSocket Connection
 */

import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';

interface WebSocketTerminalConfig {
  sandboxId: string;
  wsUrl: string;
  authToken?: string;
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

class WebSocketTerminal {
  private ws: WebSocket | null = null;
  private terminal: Terminal;
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectDelay: number;
  private config: WebSocketTerminalConfig;

  constructor(terminal: Terminal, config: WebSocketTerminalConfig) {
    this.terminal = terminal;
    this.config = config;
    this.maxReconnectAttempts = config.reconnectAttempts || 5;
    this.reconnectDelay = config.reconnectDelay || 1000;
  }

  connect(): void {
    const wsUrl = `${this.config.wsUrl}/sandboxes/${this.config.sandboxId}/terminal`;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('[WebSocketTerminal] Connected');
      this.reconnectAttempts = 0;
      
      // Send terminal size
      this.sendResize();
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'output') {
        this.terminal.write(data.data);
      } else if (data.type === 'error') {
        this.terminal.write(`\x1b[31m${data.data}\x1b[0m`);
      }
    };

    this.ws.onclose = () => {
      console.log('[WebSocketTerminal] Disconnected');
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('[WebSocketTerminal] Error:', error);
    };

    // Handle terminal input
    this.terminal.onData((data) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle terminal resize
    this.terminal.onResize(({ cols, rows }) => {
      this.sendResize();
    });
  }

  private sendResize(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const { cols, rows } = this.terminal;
      this.ws.send(JSON.stringify({
        type: 'resize',
        cols,
        rows,
      }));
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocketTerminal] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    
    console.log(
      `[WebSocketTerminal] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    setTimeout(() => this.connect(), delay);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Usage in TerminalPanel component
export function TerminalPanel({ sandboxId }: { sandboxId: string }) {
  const terminalRef = useRef<Terminal | null>(null);
  const wsTerminalRef = useRef<WebSocketTerminal | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    });

    terminal.open(document.getElementById('terminal'));
    terminalRef.current = terminal;

    const wsTerminal = new WebSocketTerminal(terminal, {
      sandboxId,
      wsUrl: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080',
      authToken: localStorage.getItem('token') || undefined,
    });

    wsTerminal.connect();
    wsTerminalRef.current = wsTerminal;

    wsTerminal.ws?.addEventListener('open', () => {
      setConnected(true);
    });

    return () => {
      wsTerminal.disconnect();
      terminal.dispose();
    };
  }, [sandboxId]);

  return (
    <div>
      <div className="terminal-status">
        {connected ? '🟢 Connected' : '🔴 Connecting...'}
      </div>
      <div id="terminal" />
    </div>
  );
}
```

**Implementation Steps:**
1. Create WebSocket terminal class
2. Update TerminalPanel to use real WebSocket
3. Add reconnection logic
4. Handle terminal resize events
5. Add authentication to WebSocket connection

---

## 5. Agent & Tool Wiring

### 5.1 Unified Agent Enhancement

**File:** `lib/agent/unified-agent.ts` (enhance existing)

```typescript
/**
 * Enhanced Unified Agent
 * 
 * With all capabilities properly wired
 */

import { enhancedTerminalManager } from '@/lib/sandbox/enhanced-terminal-manager';
import { getSandboxProvider } from '@/lib/sandbox/providers';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { MCPClient, type MCPToolResult } from '@/lib/mcp';
import { GitManager } from './git-manager';
import { E2BDesktopProvider, desktopSessionManager } from '@/lib/sandbox/providers/e2b-desktop-provider-enhanced';

export class UnifiedAgent {
  private config: UnifiedAgentConfig;
  private session: AgentSession | null = null;
  private terminalOutput: TerminalOutput[] = [];
  private desktopHandle: DesktopHandle | null = null;
  private mcpClient: MCPClient | null = null;
  private gitManager: GitManager | null = null;
  private onOutputCallback?: (output: TerminalOutput) => void;

  constructor(config: UnifiedAgentConfig) {
    this.config = config;
  }

  async initialize(): Promise<AgentSession> {
    const userId = this.config.userId || 'anonymous-agent';
    console.log(`[UnifiedAgent] Initializing session for ${userId}...`);

    // Create real sandbox session via bridge
    const workspaceSession = await sandboxBridge.getOrCreateSession(userId, {
      provider: this.config.provider,
      env: this.config.env,
    });

    this.session = {
      sessionId: workspaceSession.id,
      sandboxId: workspaceSession.sandboxId,
      userId,
      provider: this.config.provider,
      capabilities: this.config.capabilities || ['terminal', 'file-ops'],
      createdAt: Date.now(),
      lastActive: Date.now(),
    };

    // Initialize terminal if requested
    if (this.config.capabilities?.includes('terminal')) {
      await this.initializeTerminal();
    }

    // Initialize desktop if requested
    if (this.config.desktop?.enabled) {
      await this.initializeDesktop();
    }

    // Initialize MCP if requested
    if (this.config.mcp) {
      await this.initializeMCP();
    }

    // Initialize Git if requested
    if (this.config.capabilities?.includes('git')) {
      await this.initializeGit();
    }

    console.log(
      `[UnifiedAgent] Session initialized: ${this.session.sessionId}`
    );

    return this.session;
  }

  private async initializeTerminal(): Promise<void> {
    try {
      const handle = await enhancedTerminalManager.createTerminal({
        sandboxId: this.session!.sandboxId,
        userId: this.session!.userId,
      });

      handle.onOutput((output) => {
        this.terminalOutput.push({
          type: output.type,
          data: output.data,
          timestamp: Date.now(),
        });

        if (this.onOutputCallback) {
          this.onOutputCallback(this.terminalOutput[this.terminalOutput.length - 1]);
        }
      });

      console.log('[UnifiedAgent] Terminal initialized');
    } catch (error: any) {
      console.error('[UnifiedAgent] Terminal initialization failed:', error);
      throw error;
    }
  }

  private async initializeDesktop(): Promise<void> {
    try {
      const desktopProvider = new E2BDesktopProvider();
      
      this.desktopHandle = await desktopProvider.createDesktop({
        resolution: this.config.desktop?.resolution || { width: 1024, height: 768 },
      });

      console.log('[UnifiedAgent] Desktop initialized');
    } catch (error: any) {
      console.error('[UnifiedAgent] Desktop initialization failed:', error);
      throw error;
    }
  }

  private async initializeMCP(): Promise<void> {
    try {
      this.mcpClient = new MCPClient({
        servers: this.config.mcp || {},
      });

      await this.mcpClient.connect();
      console.log('[UnifiedAgent] MCP client initialized');
    } catch (error: any) {
      console.error('[UnifiedAgent] MCP initialization failed:', error);
      throw error;
    }
  }

  private async initializeGit(): Promise<void> {
    try {
      this.gitManager = new GitManager({
        workspacePath: this.session!.sandboxId,
      });

      console.log('[UnifiedAgent] Git manager initialized');
    } catch (error: any) {
      console.error('[UnifiedAgent] Git initialization failed:', error);
      throw error;
    }
  }

  // Terminal methods
  async terminalSend(command: string): Promise<void> {
    // Implementation using enhancedTerminalManager
  }

  // Desktop methods
  async desktopClick(coords: { x: number; y: number }): Promise<void> {
    if (!this.desktopHandle) {
      throw new Error('Desktop not initialized');
    }
    await this.desktopHandle.click(coords);
  }

  // MCP methods
  async mcpCall(toolName: string, params: any): Promise<MCPToolResult> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized');
    }
    return await this.mcpClient.callTool(toolName, params);
  }

  // Git methods
  async gitClone(url: string): Promise<void> {
    if (!this.gitManager) {
      throw new Error('Git manager not initialized');
    }
    await this.gitManager.clone(url);
  }

  async cleanup(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.disconnect();
    }

    if (this.desktopHandle) {
      await this.desktopHandle.cleanup();
    }

    this.session = null;
    console.log('[UnifiedAgent] Session cleaned up');
  }
}
```

**Implementation Steps:**
1. Enhance UnifiedAgent with all capability initializations
2. Wire terminal, desktop, MCP, and Git managers
3. Add proper error handling
4. Implement cleanup on disconnect

---

## 6. Metrics & Monitoring

### 6.1 Metrics Wiring

**File:** `app/api/metrics/route.ts` (enhance existing)

```typescript
/**
 * Enhanced Metrics with Real Collection
 */

import { NextRequest, NextResponse } from 'next/server';
import { Counter, Gauge, Histogram } from 'prom-client';

// Sandbox metrics
export const sandboxMetrics = {
  sandboxCreatedTotal: new Counter({
    name: 'sandbox_created_total',
    help: 'Total number of sandboxes created',
    labelNames: ['provider', 'language'],
  }),
  sandboxDestroyedTotal: new Counter({
    name: 'sandbox_destroyed_total',
    help: 'Total number of sandboxes destroyed',
    labelNames: ['provider'],
  }),
  sandboxActive: new Gauge({
    name: 'sandbox_active',
    help: 'Number of active sandboxes',
    labelNames: ['provider'],
  }),
  commandExecutedTotal: new Counter({
    name: 'command_executed_total',
    help: 'Total number of commands executed',
    labelNames: ['provider', 'status'],
  }),
  commandDuration: new Histogram({
    name: 'command_duration_seconds',
    help: 'Command execution duration in seconds',
    labelNames: ['provider'],
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
  }),
  fileOperationTotal: new Counter({
    name: 'file_operation_total',
    help: 'Total number of file operations',
    labelNames: ['operation', 'status'],
  }),
  errorsTotal: new Counter({
    name: 'errors_total',
    help: 'Total number of errors',
    labelNames: ['operation', 'provider'],
  }),
};

// Wire metrics into sandbox operations
// Example usage in sandbox-manager.ts:
/*
async createSandbox(config: SandboxConfig): Promise<SandboxHandle> {
  const startTime = Date.now();
  
  try {
    const handle = await provider.createSandbox(config);
    
    sandboxMetrics.sandboxCreatedTotal.inc({
      provider: provider.name,
      language: config.language || 'typescript',
    });
    sandboxMetrics.sandboxActive.inc({ provider: provider.name });
    
    return handle;
  } catch (error: any) {
    sandboxMetrics.errorsTotal.inc({
      operation: 'create_sandbox',
      provider: provider.name,
    });
    throw error;
  }
}
*/

export async function GET(request: NextRequest) {
  try {
    const { Registry } = await import('prom-client');
    const register = new Registry();
    
    // Register all metrics
    register.registerMetric(sandboxMetrics.sandboxCreatedTotal);
    register.registerMetric(sandboxMetrics.sandboxDestroyedTotal);
    register.registerMetric(sandboxMetrics.sandboxActive);
    register.registerMetric(sandboxMetrics.commandExecutedTotal);
    register.registerMetric(sandboxMetrics.commandDuration);
    register.registerMetric(sandboxMetrics.fileOperationTotal);
    register.registerMetric(sandboxMetrics.errorsTotal);

    const metrics = await register.metrics();

    return new NextResponse(metrics, {
      headers: {
        'Content-Type': 'text/plain; version=0.0.4',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Metrics collection failed', message: error.message },
      { status: 500 }
    );
  }
}
```

**Implementation Steps:**
1. Install prom-client: `pnpm add prom-client`
2. Wire metrics into all sandbox operations
3. Set up Prometheus scraping in docker-compose.yml
4. Create Grafana dashboard templates

---

## 7. Error Handling & Retry Logic

### 7.1 Retry Utility

**File:** `lib/utils/retry.ts` (create new)

```typescript
/**
 * Retry Utility with Exponential Backoff
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // ms
  maxDelay: number; // ms
  backoffMultiplier: number;
  jitter?: boolean;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2.0,
  jitter: true,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  operationName: string = 'operation'
): Promise<T> {
  const {
    maxRetries = DEFAULT_RETRY_CONFIG.maxRetries,
    baseDelay = DEFAULT_RETRY_CONFIG.baseDelay,
    maxDelay = DEFAULT_RETRY_CONFIG.maxDelay,
    backoffMultiplier = DEFAULT_RETRY_CONFIG.backoffMultiplier,
    jitter = DEFAULT_RETRY_CONFIG.jitter,
  } = config;

  let lastError: Error | null = null;
  let delay = baseDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      if (attempt === maxRetries) {
        console.error(
          `[Retry] ${operationName}: failed after ${maxRetries} attempts:`,
          error.message
        );
        throw error;
      }

      // Add jitter to prevent thundering herd
      const jitterFactor = jitter ? (0.5 + Math.random() * 0.5) : 1;
      const actualDelay = Math.min(delay * jitterFactor, maxDelay);

      console.warn(
        `[Retry] ${operationName}: attempt ${attempt} failed (${error.message}), ` +
        `retrying in ${(actualDelay / 1000).toFixed(1)}s`
      );

      await new Promise(resolve => setTimeout(resolve, actualDelay));
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**Implementation Steps:**
1. Create `lib/utils/retry.ts`
2. Wrap all API calls with `withRetry()`
3. Configure retry parameters per operation type
4. Add logging for retry attempts

---

## 8. SDK Integration Enhancements

### 8.1 Composio Session Workflow

**File:** `lib/api/composio-service.ts` (enhance existing)

```typescript
/**
 * Enhanced Composio Service with Session Workflow
 */

class ComposioServiceImpl implements ComposioService {
  private composio: any = null;
  private sessions: Map<string, any> = new Map();
  private config: ComposioServiceConfig;

  constructor(config: ComposioServiceConfig) {
    this.config = config;
  }

  async processToolRequest(request: ComposioToolRequest): Promise<ComposioToolResponse> {
    try {
      await this.ensureComposio();

      // Create or get session for user
      let session = this.sessions.get(request.userId);
      if (!session) {
        session = await this.composio.create(request.userId);
        this.sessions.set(request.userId, session);
      }

      // Get tools for session
      const tools = await session.tools();

      // Process request with session context
      const response = await session.execute_request({
        messages: request.messages,
        tools: request.enableAllTools ? tools : tools.filter(t => 
          request.toolkits?.includes(t.toolkitName)
        ),
      });

      return {
        content: response.output,
        toolCalls: response.toolCalls,
        metadata: {
          sessionId: session.id,
          toolsUsed: response.toolsUsed,
        },
      };
    } catch (error: any) {
      throw new Error(`Composio tool request failed: ${error.message}`);
    }
  }
}
```

**Implementation Steps:**
1. Enhance Composio service with session workflow
2. Store sessions in memory (or Redis for production)
3. Use session context for all tool calls
4. Add session cleanup on user logout

---

## Implementation Checklist

### Phase 1: Security (Week 1)

- [ ] Create `lib/security/security-utils.ts`
- [ ] Create `lib/security/jwt-auth.ts`
- [ ] Create `lib/security/rate-limit-middleware.ts`
- [ ] Update all path operations to use `safeJoin()`
- [ ] Add command filtering to all executions
- [ ] Wire JWT auth to all API routes
- [ ] Apply rate limiting to all endpoints
- [ ] Add input validation schemas

### Phase 2: Backend (Week 2-3)

- [ ] Replace storage backend implementation
- [ ] Wire S3 backend to snapshot manager
- [ ] Replace mock snapshot data
- [ ] Start WebSocket server on app init
- [ ] Update frontend to use real WebSocket
- [ ] Wire metrics counters to all operations
- [ ] Set up Prometheus scraping
- [ ] Enforce quotas consistently

### Phase 3: Providers (Week 4-5)

- [ ] Enhance provider registry
- [ ] Add health checks to all providers
- [ ] Implement fallback chain
- [ ] Add circuit breaker pattern
- [ ] Test each provider with real API keys
- [ ] Add integration tests

### Phase 4: Agents (Week 6)

- [ ] Wire all UnifiedAgent capabilities
- [ ] Register Mastra tools with agent
- [ ] Integrate CrewAI crews
- [ ] Add Git manager to workflows
- [ ] Implement session persistence

### Phase 5: Production (Week 7-8)

- [ ] Add retry logic everywhere
- [ ] Set up comprehensive logging
- [ ] Create Grafana dashboards
- [ ] Write runbooks
- [ ] Add integration tests
- [ ] Add load tests
- [ ] Update documentation

---

**Total Estimated Effort:** 216 hours  
**Critical Path:** Security → Backend → Providers → Agents → Production  
**Deployment Blocker:** Phase 1 & 2 must complete before production deployment
