import { NextRequest, NextResponse } from 'next/server';


import { getDatabase } from '@/lib/database/connection';
import { rateLimitMiddleware } from '@/lib/middleware/rate-limiter';
import { hashValue } from '@/lib/utils/crypto';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Verification token is missing' },
        { status: 400 }
      );
    }

    // Rate limiting: Check before processing
    const rateLimitResult = rateLimitMiddleware(request, 'verifyEmail');
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response;
    }

    const db = getDatabase();

    // Debug: Check if token exists at all
    const tokenHash = hashValue(token);
    const debugUser = db.prepare(`
      SELECT email_verification_token_hash, email_verification_expires, email_verified, is_active
      FROM users
      WHERE email_verification_token_hash = ?
    `).get(tokenHash) as any;

    console.log('[Verify Email] Debug:', {
      tokenProvided: token,
      tokenFound: !!debugUser,
      stored: debugUser?.email_verification_token_hash,
      expires: debugUser?.email_verification_expires,
      verified: debugUser?.email_verified,
      isActive: debugUser?.is_active,
      now: new Date().toISOString(),
    });

    // Find user with this verification token (compare hash)
    // SECURITY: Pass current time as ISO string parameter for correct comparison
    // SQLite's datetime('now') returns 'YYYY-MM-DD HH:MM:SS' format which doesn't
    // compare correctly with ISO 8601 strings stored in email_verification_expires
    const nowIso = new Date().toISOString();
    const user = db.prepare(`
      SELECT * FROM users
      WHERE email_verification_token_hash = ?
        AND is_active = TRUE
        AND email_verification_expires > ?
    `).get(tokenHash, nowIso) as any;

    console.log('[Verify Email] Query result:', !!user);

    if (!user) {
      // Token not found or expired
      return NextResponse.json(
        { success: false, error: 'Verification token is invalid or has expired' },
        { status: 400 }
      );
    }

    // Verify the email
    db.prepare(`
      UPDATE users
      SET email_verified = TRUE,
          email_verification_token_hash = NULL,
          email_verification_expires = NULL
      WHERE id = ?
    `).run(user.id);

    return NextResponse.json({
      success: true,
      message: 'Email verified successfully',
    });

  } catch (error) {
    console.error('Verify email API error:', error);
    return NextResponse.json(
      { success: false, error: 'Verification failed' },
      { status: 500 }
    );
  }
}
