import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import { rateLimitMiddleware, getRateLimitHeaders } from '@/lib/middleware/rate-limiter';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // Rate limiting: Check before processing
    const rateLimitResult = rateLimitMiddleware(request, 'sendVerification', email);
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response;
    }

    const db = getDatabase();

    // Find user by email
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = TRUE').get(email) as any;

    if (!user) {
      // Don't reveal if email exists or not (security best practice)
      return NextResponse.json({
        success: true,
        message: 'If the email exists, a verification link has been sent',
      });
    }

    // Check if already verified
    if (user.email_verified) {
      // SECURITY: Return same response as user-not-found to prevent email enumeration
      // This prevents attackers from determining if an email is registered AND verified
      return NextResponse.json({
        success: true,
        message: 'If the email exists, a verification link has been sent',
      });
    }

    // Generate verification token
    const { v4: uuidv4 } = await import('uuid');
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Save token to database
    db.prepare(`
      UPDATE users 
      SET email_verification_token = ?, email_verification_expires = ?
      WHERE email = ?
    `).run(token, expiresAt.toISOString(), email);

    // Send verification email
    const { emailService } = await import('@/lib/email/email-service');
    const verificationUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/verify-email?token=${token}`;

    await emailService.sendVerificationEmail(email, { token, expiresAt, verificationUrl });

    const response = NextResponse.json({
      success: true,
      message: 'Verification email sent successfully',
    });

    // Add rate limit headers
    const config = { windowMs: 3600000, maxRequests: 3 }; // Match sendVerification config
    const headers = getRateLimitHeaders(config.maxRequests, 0, config.windowMs);
    Object.entries(headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;

  } catch (error) {
    console.error('Send verification API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
