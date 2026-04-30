/**
 * MFA Challenge Endpoint
 *
 * MED-6 fix: Called during login flow after password verification succeeds
 * but before the session is fully established.
 *
 * Flow:
 * 1. POST /auth/login → password verified → returns { mfaRequired: true, mfaToken: ... }
 * 2. POST /auth/mfa/challenge → { mfaToken, code } → verifies → returns session + JWT
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateToken, verifyMfaToken } from '@/lib/auth/jwt';
import { verifyTotpCode, decryptTotpSecret, verifyBackupCode } from '@/lib/auth/totp';
import { csrfCheckOrReject } from '@/lib/auth/csrf';
import { createLogger } from '@/lib/utils/logger';

// Rate limiting for MFA challenge attempts
const MFA_CHALLENGE_MAX_ATTEMPTS = 10; // 10 attempts per 5-minute window
const MFA_CHALLENGE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const mfaChallengeAttempts = new Map<string, { count: number; resetAt: number }>();

function checkMfaRateLimit(identifier: string): { allowed: boolean; remaining: number } {
  const now = Date.now();

  // Evict expired entries to prevent unbounded Map growth (memory leak)
  if (mfaChallengeAttempts.size > 1000) {
    for (const [key, val] of mfaChallengeAttempts) {
      if (now > val.resetAt) mfaChallengeAttempts.delete(key);
    }
  }

  const entry = mfaChallengeAttempts.get(identifier);

  if (!entry || now > entry.resetAt) {
    mfaChallengeAttempts.set(identifier, { count: 1, resetAt: now + MFA_CHALLENGE_WINDOW_MS });
    return { allowed: true, remaining: MFA_CHALLENGE_MAX_ATTEMPTS - 1 };
  }

  if (entry.count >= MFA_CHALLENGE_MAX_ATTEMPTS) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: MFA_CHALLENGE_MAX_ATTEMPTS - entry.count };
}

const logger = createLogger('MFA:Challenge');

export async function POST(request: NextRequest) {
  // CSRF protection
  const csrfReject = csrfCheckOrReject(request);
  if (csrfReject) return csrfReject;

  try {
    const body = await request.json();
    const { mfaToken, code, backupCode } = body;

    if (!mfaToken) {
      return NextResponse.json({ success: false, error: 'MFA token is required' }, { status: 400 });
    }

    // Rate limit by IP to prevent brute-force of 6-digit TOTP codes
    const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const rateLimitResult = checkMfaRateLimit(clientIp);
    if (!rateLimitResult.allowed) {
      logger.warn('MFA challenge rate limit exceeded', { clientIp });
      return NextResponse.json(
        { success: false, error: 'Too many MFA attempts. Please try again in 5 minutes.' },
        { status: 429 }
      );
    }

    if (!code && !backupCode) {
      return NextResponse.json({ success: false, error: 'TOTP code or backup code is required' }, { status: 400 });
    }

    // Decode and validate the MFA token using jwt.ts wrapper
    let userId: string;
    try {
      const decoded = verifyMfaToken(mfaToken);
      userId = decoded.userId;
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid or expired MFA token' }, { status: 401 });
    }

    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) {
      return NextResponse.json({ success: false, error: 'Database not available' }, { status: 500 });
    }

    // Get MFA record
    const mfaRecord = db.prepare(
      'SELECT secret_encrypted, backup_codes, is_enabled FROM user_mfa WHERE user_id = ? AND mfa_type = ?'
    ).get(userId, 'totp') as any;

    if (!mfaRecord || !mfaRecord.is_enabled) {
      return NextResponse.json({ success: false, error: 'MFA not enabled for this account' }, { status: 400 });
    }

    // Verify TOTP code or backup code
    let verified = false;

    if (code) {
      const secret = decryptTotpSecret(mfaRecord.secret_encrypted);
      const totpResult = verifyTotpCode(secret, code);
      verified = totpResult.valid;
    } else if (backupCode && mfaRecord.backup_codes) {
      const result = verifyBackupCode(mfaRecord.backup_codes, backupCode);
      verified = result.valid;
      if (verified) {
        // Update backup codes (single-use)
        db.prepare('UPDATE user_mfa SET backup_codes = ? WHERE user_id = ? AND mfa_type = ?')
          .run(result.remainingHashes, userId, 'totp');
      }
    }

    if (!verified) {
      logger.warn('MFA challenge failed', { userId });

      // MED-5 fix: Log MFA challenge failure
      try {
        const { logMfaChallengeFailure } = await import('@/lib/auth/auth-audit-logger');
        logMfaChallengeFailure(userId, request);
      } catch (auditError) {
        console.warn('[MFA:Challenge] Audit log failed:', auditError);
      }

      return NextResponse.json({ success: false, error: 'Invalid code' }, { status: 401 });
    }

    // Update last_used_at
    db.prepare('UPDATE user_mfa SET last_used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND mfa_type = ?')
      .run(userId, 'totp');

    // Get user info for session
    const user = db.prepare('SELECT id, email, token_version FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Generate session and JWT (same as login success path)
    const { v4: uuidv4 } = require('uuid');
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    db.prepare(`
      INSERT INTO user_sessions (session_id, user_id, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      require('crypto').createHash('sha256').update(sessionId).digest('hex'),
      userId,
      expiresAt.toISOString(),
      ipAddress,
      userAgent
    );

    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);

    // HIGH-8 fix: email removed from JWT — use getUserEmail() from jwt.ts if needed
    const token = generateToken({
      userId: user.id.toString(),
      tokenVersion: user.token_version ?? 1,
    });

    // Set cookies and return
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        emailVerified: !!user.email_verified,
      },
      token,
      sessionId,
    });

    // Set session cookie
    response.cookies.set('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
    });

    // Set auth-token cookie
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging',
      sameSite: 'lax',
      maxAge: 60 * 60,
      path: '/',
    });

    // Set CSRF cookie
    const { generateCsrfToken, setCsrfCookie } = require('@/lib/auth/csrf');
    const csrfToken = generateCsrfToken();
    setCsrfCookie(response, csrfToken);

    // Clear anon session
    response.cookies.set('anon-session-id', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    // MED-5 fix: Log MFA challenge success
    try {
      const { logMfaChallengeSuccess } = await import('@/lib/auth/auth-audit-logger');
      logMfaChallengeSuccess(userId, request);
    } catch (auditError) {
      console.warn('[MFA:Challenge] Audit log failed:', auditError);
    }

    logger.info('MFA challenge succeeded', { userId });
    return response;
  } catch (error) {
    logger.error('MFA challenge error', error as Error);
    return NextResponse.json({ success: false, error: 'MFA challenge failed' }, { status: 500 });
  }
}
