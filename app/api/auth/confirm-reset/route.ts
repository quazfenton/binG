import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

// SECURITY: JWT_SECRET is now required - no fallback to predictable default
// This ensures reset tokens can only be verified with the correct secret
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('[Security] JWT_SECRET environment variable is not set');
  throw new Error('JWT_SECRET is required but not configured');
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
      decoded = jwt.verify(token, JWT_SECRET, {
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

    const db = getDatabase();

    // Extract the JWT ID (jti) from the decoded token payload.
    // This jti is expected to be stored in the database's reset_token column
    // to link the active reset token to the user and prevent replay attacks.
    const tokenJti = decoded.jti;

    // It's a critical security measure that `jti` is present in the token when issued.
    if (!tokenJti) {
      console.error(`[Security] JWT ID (jti) missing from decoded token for userId: ${userId}`);
      return NextResponse.json(
        { success: false, error: 'Invalid reset token payload' },
        { status: 400 }
      );
    }

    // SECURITY: Verify user exists, is active, AND has a valid reset token that matches the one provided.
    // This prevents token replay attacks where a captured token could be reused.
    const user = db.prepare(`
      SELECT id, email, is_active, reset_token, reset_token_expires
      FROM users WHERE id = ?
    `).get(userId) as any;

    if (!user) {
      // Do not reveal if user exists or not for security reasons (user enumeration).
      // A user might have been deleted after a token was issued.
      return NextResponse.json(
        { success: false, error: 'Invalid reset token' },
        { status: 400 }
      );
    }

    if (!user.is_active) {
      return NextResponse.json(
        { success: false, error: 'Account is deactivated' },
        { status: 403 }
      );
    }

    // SECURITY: Verify the token matches the stored reset_token and hasn't expired
    if (!user.reset_token || user.reset_token !== tokenJti) {
      console.warn(`[Security] Password reset token mismatch or replay attempt for user ${user.email} (ID: ${userId})`);
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid reset token'
        },
        { status: 400 }
      );
    }

    if (user.reset_token_expires && new Date(user.reset_token_expires) < new Date()) {
      console.warn(`[Security] Expired password reset token used for user ${user.email} (ID: ${userId})`);
      return NextResponse.json(
        {
          success: false,
          error: 'Reset token has expired. Please request a new password reset.'
        },
        { status: 400 }
      );
    }
    `).get(userId) as any;

    if (!user) {
      // Do not reveal if user exists or not for security reasons (user enumeration).
      // A user might have been deleted after a token was issued.
      return NextResponse.json(
        { success: false, error: 'Invalid reset token' },
        { status: 400 }
      );
    }

    if (!user.is_active) {
      return NextResponse.json(
        { success: false, error: 'Account is deactivated' },
        { status: 403 }
      );
    }

    // SECURITY: Check if the reset token stored in the database exists and matches the provided token's JTI.
    // If user.reset_token is NULL, it means the token has already been used or was never issued/invalidated.
    // If user.reset_token does not match tokenJti, it means a different or invalid token was provided.
    if (!user.reset_token || user.reset_token !== tokenJti) {
      console.warn(`[Security] Password reset token mismatch or already used for user ${user.email} (ID: ${userId}). 
                   Stored JTI: ${user.reset_token}, Provided JTI: ${tokenJti}`);
      return NextResponse.json(
        { 
          success: false, 
          error: 'This password reset link is invalid or has already been used. Please request a new one.' 
        },
        { status: 400 }
      );
    }

    // SECURITY: Check if the database-stored reset token has expired.
    // This is an additional check beyond the JWT's internal 'exp' claim,
    // allowing for server-side invalidation or shorter effective lifetimes.
    if (user.reset_token_expires && new Date(user.reset_token_expires) < new Date()) {
      console.warn(`[Security] Password reset token expired in DB for user ${user.email} (ID: ${userId})`);
      return NextResponse.json(
        { 
          success: false, 
          error: 'This password reset link has expired. Please request a new one.' 
        },
        { status: 400 }
      );
    }
    // SECURITY: Check if reset token has already been used or doesn't exist
    // A consumed token will have reset_token set to NULL
    if (!user.reset_token) {
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

    // Hash new password
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update password and invalidate all sessions
    db.prepare(`
      UPDATE users
      SET password_hash = ?,
          reset_token = NULL,
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
      const decoded: any = jwt.verify(token, JWT_SECRET, {
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
