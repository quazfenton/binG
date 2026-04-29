/**
 * Auth Event Audit Logger
 * 
 * MED-5 fix: Comprehensive logging of authentication events.
 * Tracks login success/failure, logout, registration, password reset,
 * token refresh, and MFA operations for security monitoring and compliance.
 * 
 * Complements admin_audit_log (HIGH-6) which tracks admin-specific actions.
 * 
 * Usage:
 *   import { logAuthEvent } from '@/lib/auth/auth-audit-logger';
 *   logAuthEvent({ eventType: 'login_success', userId, ip, userAgent, result: 'success' });
 */

import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Auth:Audit');

// Event types for auth audit log
export type AuthEventType =
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'register_success'
  | 'register_failure'
  | 'password_reset_request'
  | 'password_reset_complete'
  | 'password_reset_failure'
  | 'token_refresh'
  | 'token_refresh_failure'
  | 'mfa_setup'
  | 'mfa_setup_failure'
  | 'mfa_challenge_success'
  | 'mfa_challenge_failure'
  | 'mfa_disable'
  | 'mfa_disable_failure'
  | 'session_created'
  | 'session_revoked';

// Result types
export type AuthEventResult = 'success' | 'failure' | 'blocked';

// Failure reasons
export type AuthFailureReason =
  | 'invalid_credentials'
  | 'account_locked'
  | 'mfa_required'
  | 'mfa_failed'
  | 'token_expired'
  | 'token_invalid'
  | 'user_not_found'
  | 'user_inactive'
  | 'rate_limited'
  | 'csrf_invalid'
  | 'email_already_exists'
  | 'weak_password'
  | 'email_not_verified'
  | 'session_expired'
  | 'unknown';

/**
 * Extract client IP from request (handles proxy headers)
 */
function getClientIP(request?: NextRequest | string): string {
  if (!request) return 'unknown';
  
  if (typeof request === 'string') return request;
  
  const headers = [
    'cf-connecting-ip',      // Cloudflare
    'x-forwarded-for',       // Standard proxy
    'x-real-ip',             // Nginx
    'true-client-ip',        // Akamai
    'x-client-ip',           // Standard
  ];
  
  for (const header of headers) {
    const value = request.headers.get(header);
    if (value) {
      return value.split(',')[0].trim();
    }
  }
  
  return 'unknown';
}

/**
 * Extract user agent from request
 */
function getUserAgent(request?: NextRequest): string {
  if (!request) return 'unknown';
  return request.headers.get('user-agent') || 'unknown';
}

export interface AuthAuditEntry {
  eventType: AuthEventType;
  userId?: string;
  email?: string;
  ipAddress?: string;
  userAgent?: string;
  result: AuthEventResult;
  failureReason?: AuthFailureReason;
  metadata?: Record<string, unknown>;
}

/**
 * Log an authentication event to the auth_audit_log table.
 * Non-blocking: failures are logged but don't affect the auth operation.
 * 
 * @param entry Audit entry with event details
 * @param request Optional NextRequest for IP/user-agent extraction
 */
export function logAuthEvent(entry: AuthAuditEntry, request?: NextRequest): void {
  try {
    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) {
      logger.warn('Auth audit log skipped — DB not available');
      return;
    }

    const ipAddress = entry.ipAddress || getClientIP(request);
    const userAgent = entry.userAgent || getUserAgent(request);

    db.prepare(`
      INSERT INTO auth_audit_log (event_type, user_id, email, ip_address, user_agent, result, failure_reason, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.eventType,
      entry.userId || null,
      entry.email || null,
      ipAddress,
      userAgent,
      entry.result,
      entry.failureReason || null,
      entry.metadata ? JSON.stringify(entry.metadata) : null
    );

    logger.debug('Auth event logged', {
      eventType: entry.eventType,
      userId: entry.userId || 'unknown',
      result: entry.result,
      ip: ipAddress,
    });
  } catch (error) {
    // Non-blocking — log the error but don't throw
    logger.error('Failed to write auth audit log', error as Error, {
      eventType: entry.eventType,
      userId: entry.userId,
      result: entry.result,
    });
  }
}

/**
 * Get audit log entries for a user (for security review)
 */
export function getAuthAuditLog(userId: string, limit: number = 100): Array<{
  id: number;
  event_type: string;
  result: string;
  failure_reason: string | null;
  ip_address: string | null;
  created_at: string;
}> {
  try {
    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) return [];

    return db.prepare(`
      SELECT id, event_type, result, failure_reason, ip_address, created_at
      FROM auth_audit_log
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, limit) as Array<{
      id: number;
      event_type: string;
      result: string;
      failure_reason: string | null;
      ip_address: string | null;
      created_at: string;
    }>;
  } catch (error) {
    logger.error('Failed to get auth audit log', error as Error);
    return [];
  }
}

/**
 * Convenience wrapper for login events
 */
export function logLoginSuccess(userId: string, email: string, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'login_success',
    userId,
    email,
    result: 'success',
    metadata,
  }, request);
}

export function logLoginFailure(email: string, reason: AuthFailureReason, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'login_failure',
    email,
    result: reason === 'account_locked' ? 'blocked' : 'failure',
    failureReason: reason,
    metadata,
  }, request);
}

export function logLogout(userId: string, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'logout',
    userId,
    result: 'success',
    metadata,
  }, request);
}

export function logRegisterSuccess(userId: string, email: string, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'register_success',
    userId,
    email,
    result: 'success',
    metadata,
  }, request);
}

export function logRegisterFailure(email: string, reason: AuthFailureReason, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'register_failure',
    email,
    result: 'failure',
    failureReason: reason,
    metadata,
  }, request);
}

export function logPasswordResetRequest(userId: string, email: string, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'password_reset_request',
    userId,
    email,
    result: 'success',
    metadata,
  }, request);
}

export function logPasswordResetComplete(userId: string, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'password_reset_complete',
    userId,
    result: 'success',
    metadata,
  }, request);
}

export function logPasswordResetFailure(email: string, reason: AuthFailureReason, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'password_reset_failure',
    email,
    result: 'failure',
    failureReason: reason,
    metadata,
  }, request);
}

export function logTokenRefresh(userId: string, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'token_refresh',
    userId,
    result: 'success',
    metadata,
  }, request);
}

export function logMfaChallengeSuccess(userId: string, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'mfa_challenge_success',
    userId,
    result: 'success',
    metadata,
  }, request);
}

export function logMfaChallengeFailure(userId: string, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'mfa_challenge_failure',
    userId,
    result: 'failure',
    failureReason: 'mfa_failed',
    metadata,
  }, request);
}

export function logMfaSetup(userId: string, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'mfa_setup',
    userId,
    result: 'success',
    metadata,
  }, request);
}

export function logMfaSetupFailure(userId: string, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'mfa_setup_failure',
    userId,
    result: 'failure',
    failureReason: 'mfa_failed',
    metadata,
  }, request);
}

export function logMfaDisable(userId: string, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'mfa_disable',
    userId,
    result: 'success',
    metadata,
  }, request);
}

export function logMfaDisableFailure(userId: string, request?: NextRequest, metadata?: Record<string, unknown>): void {
  logAuthEvent({
    eventType: 'mfa_disable_failure',
    userId,
    result: 'failure',
    failureReason: 'mfa_failed',
    metadata,
  }, request);
}