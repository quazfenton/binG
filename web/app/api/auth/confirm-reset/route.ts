import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import { z } from 'zod';
import { hashValue } from '@/lib/utils/crypto';

// Lazy-loaded JWT module and secret to avoid build failures
// CRITICAL: These must be at module scope for use in route handlers
let jwtModule: any = null;
let jwtSecret: string | null = null;

/**
 * Get JWT module (lazy-loaded to avoid bundling issues)
 */
function getJwtModule() {
  if (!jwtModule) {
    jwtModule = require('jsonwebtoken');
  }
  return jwtModule;
}

/**
 * Get JWT secret (lazy-loaded to avoid build failures)
 */
function getJwtSecret(): string {
  if (jwtSecret) return jwtSecret;

  const env: any = typeof process !== 'undefined' ? process.env : {};
  const JWT_SECRET = env.JWT_SECRET;

  // Check if we're in a build environment
  const isBuild = env.SKIP_DB_INIT === 'true' ||
                  env.SKIP_DB_INIT === '1' ||
                  env.NEXT_BUILD === 'true' ||
                  env.NEXT_BUILD === '1' ||
                  env.NEXT_PHASE === 'build';

  if (isBuild) {
    console.warn('[Auth] Skipping JWT_SECRET validation during build');
    jwtSecret = 'dummy-key-for-build';
    return jwtSecret;
  }

  if (!JWT_SECRET) {
    console.error('[Security] JWT_SECRET environment variable is not set');
    throw new Error('JWT_SECRET is required but not configured');
  }

  jwtSecret = JWT_SECRET;
  return jwtSecret;
}

/**
 * Password reset confirmation schema
 */
const confirmResetSchema = z.object({
  token: z.string({
    required_error: 'Reset token is required',
  }),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Validate request body
    const validation = confirmResetSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          details: validation.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const { token, newPassword } = validation.data;

    // Verify JWT token
    let decoded: any;
    try {
      const jwt = getJwtModule();
      decoded = jwt.verify(token, getJwtSecret(), {
        algorithms: ['HS256'],
        issuer: 'bing-app',
        audience: 'bing-users',
      });
    } catch (jwtError) {
      const error = jwtError instanceof Error ? jwtError : new Error('Invalid token');
      
      if (error.name === 'TokenExpiredError') {
        return NextResponse.json(
          { success: false, error: 'Reset token has expired. Please request a new password reset.' },
          { status: 400 }
        );
      }
      
      return NextResponse.json(
        { success: false, error: 'Invalid reset token' },
        { status: 400 }
      );
    }

    // Validate token type
    if (decoded.type !== 'password_reset') {
      return NextResponse.json(
        { success: false, error: 'Invalid token type' },
        { status: 400 }
      );
    }

    const userId = decoded.userId;
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Invalid token payload' },
        { status: 400 }
      );
    }

    const db = getDatabase();

    // SECURITY: Verify user exists, is active, AND has a valid reset token
    // This prevents token replay attacks where a captured token could be reused
    const user = db.prepare(`
      SELECT id, email, is_active, reset_token_hash, reset_token_expires 
      FROM users WHERE id = ?
    `).get(userId) as any;

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 400 }
      );
    }

    if (!user.is_active) {
      return NextResponse.json(
        { success: false, error: 'Account is deactivated' },
        { status: 403 }
      );
    }

    // SECURITY: Check if reset token has already been used or doesn't exist
    // A consumed token will have reset_token_hash set to NULL
    if (!user.reset_token_hash) {
      console.warn(`[Security] Password reset token replay attempt for user ${user.email} (ID: ${userId})`);
      return NextResponse.json(
        { 
          success: false, 
          error: 'This password reset link has already been used. Please request a new one.' 
        },
        { status: 400 }
      );
    }

    // SECURITY: Verify reset token hasn't expired
    if (user.reset_token_expires) {
      const expiresAt = new Date(user.reset_token_expires);
      if (Date.now() > expiresAt.getTime()) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'This password reset link has expired. Please request a new one.' 
          },
          { status: 400 }
        );
      }
    }

    // SECURITY: Verify presented token matches stored hash
    const tokenHash = hashValue(token);
    if (user.reset_token_hash !== tokenHash) {
      return NextResponse.json(
        { success: false, error: 'Invalid reset token' },
        { status: 400 }
      );
    }

    // Hash new password
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update password and invalidate all sessions
    db.prepare(`
      UPDATE users
      SET password_hash = ?,
          reset_token_hash = NULL,
          reset_token_expires = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(passwordHash, userId);

    // Delete all user sessions to force re-login
    db.prepare(`
      DELETE FROM user_sessions WHERE user_id = ?
    `).run(userId);

    // Log security event
    console.log(`[Security] Password reset successful for user ${user.email} (ID: ${userId})`);

    return NextResponse.json({
      success: true,
      message: 'Password reset successfully. Please log in with your new password.',
    });

  } catch (error: any) {
    console.error('Confirm password reset error:', error);
    
    // SECURITY: Don't leak internal error details
    return NextResponse.json(
      { success: false, error: 'Password reset failed' },
      { status: 500 }
    );
  }
}

/**
 * GET - Validate reset token without using it
 * Useful for checking if a token is valid before showing the reset form
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token');
    
    if (!token) {
      return NextResponse.json(
        { valid: false, error: 'Token is required' },
        { status: 400 }
      );
    }

    // Verify JWT token
    try {
      const jwt = getJwtModule();
      const decoded: any = jwt.verify(token, getJwtSecret(), {
        algorithms: ['HS256'],
        issuer: 'bing-app',
        audience: 'bing-users',
      });

      // Validate token type
      if (decoded.type !== 'password_reset') {
        return NextResponse.json(
          { valid: false, error: 'Invalid token type' },
          { status: 400 }
        );
      }

      // Verify user still exists
      const db = getDatabase();
      const user = db.prepare(`
        SELECT id, is_active FROM users WHERE id = ?
      `).get(decoded.userId) as any;

      if (!user || !user.is_active) {
        return NextResponse.json(
          { valid: false, error: 'User not found or inactive' },
          { status: 400 }
        );
      }

      return NextResponse.json({ valid: true });
    } catch (jwtError) {
      const error = jwtError instanceof Error ? jwtError : new Error('Invalid token');
      
      if (error.name === 'TokenExpiredError') {
        return NextResponse.json(
          { valid: false, error: 'Token expired' },
          { status: 400 }
        );
      }
      
      return NextResponse.json(
        { valid: false, error: 'Invalid token' },
        { status: 400 }
      );
    }

  } catch (error: any) {
    console.error('Token validation error:', error);
    return NextResponse.json(
      { valid: false, error: 'Token validation failed' },
      { status: 500 }
    );
  }
}
