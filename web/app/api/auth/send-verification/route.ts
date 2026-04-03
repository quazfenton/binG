import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import { rateLimitMiddleware } from '@/lib/middleware/rate-limiter';

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
    if (!rateLimitResult.success) {
      return rateLimitResult.response;
    }

    const db = getDatabase();

    // Find user by email
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = TRUE').get(email) as any;

    // Create response with rate limit headers for all paths
    const createResponse = () => {
      const response = NextResponse.json({
        success: true,
        message: 'If the email exists, a verification link has been sent',
      });
      // Propagate rate limit headers so clients can see remaining attempts
      if (rateLimitResult.success && rateLimitResult.headers) {
        Object.entries(rateLimitResult.headers).forEach(([key, value]) => {
          response.headers.set(key, String(value));
        });
      }
      return response;
    };

    if (!user) {
      // Don't reveal if email exists or not (security best practice)
      return createResponse();
    }

    // Check if already verified
    if (user.email_verified) {
      // SECURITY: Return same response as user-not-found to prevent email enumeration
      // This prevents attackers from determining if an email is registered AND verified
      return createResponse();
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

    // DEV LOGGING: Log verification sent (without exposing sensitive data)
    if (process.env.NODE_ENV === 'development') {
      console.log('\n🔐 VERIFICATION EMAIL SENT (Development):');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📧 To: ${email.substring(0, 2)}***@${email.split('@')[1]}`);
      console.log(`⏰ Token expires: ${expiresAt.toLocaleString()}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }

    const response = NextResponse.json({
      success: true,
      message: 'If the email exists, a verification link has been sent',
    });

    // Add accurate rate limit headers from the middleware result
    if (rateLimitResult.success && rateLimitResult.headers) {
      Object.entries(rateLimitResult.headers).forEach(([key, value]) => {
        response.headers.set(key, String(value));
      });
    }

    return response;

  } catch (error) {
    console.error('Send verification API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
