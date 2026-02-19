import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.redirect(
        new URL('/verify-email?error=missing-token', request.url)
      );
    }

    const db = getDatabase();

    // Find user with this verification token
    const user = db.prepare(`
      SELECT * FROM users 
      WHERE email_verification_token = ? 
        AND is_active = TRUE
        AND email_verification_expires > CURRENT_TIMESTAMP
    `).get(token) as any;

    if (!user) {
      // Token not found or expired
      return NextResponse.redirect(
        new URL('/verify-email?error=invalid-or-expired', request.url)
      );
    }

    // Verify the email
    db.prepare(`
      UPDATE users 
      SET email_verified = TRUE, 
          email_verification_token = NULL,
          email_verification_expires = NULL
      WHERE id = ?
    `).run(user.id);

    // Redirect to success page
    return NextResponse.redirect(
      new URL('/verify-email?success=true', request.url)
    );

  } catch (error) {
    console.error('Verify email API error:', error);
    return NextResponse.redirect(
      new URL('/verify-email?error=unknown', request.url)
    );
  }
}
