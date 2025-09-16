import { NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/database/db';
import { generateToken } from '@/lib/auth/jwt';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const db = await initializeDatabase();
    const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);

    if (!user) {
      // Don't reveal whether the email exists or not for security
      return NextResponse.json({ 
        message: 'If an account with that email exists, a password reset link has been sent.' 
      });
    }

    // Generate a password reset token (valid for 1 hour)
    const resetToken = generateToken({
      userId: user.id.toString(),
      email: user.email,
      type: 'password_reset'
    });

    // In a real application, you would:
    // 1. Store the reset token in the database with an expiration time
    // 2. Send an email with the reset link
    // 3. Create a password reset page that accepts the token
    
    // For now, we'll just log the reset token (in production, send via email)
    console.log(`Password reset token for ${email}: ${resetToken}`);
    console.log(`Reset URL would be: ${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${resetToken}`);

    // TODO: Implement email sending service
    // await sendPasswordResetEmail(email, resetToken);

    return NextResponse.json({ 
      message: 'If an account with that email exists, a password reset link has been sent.',
      // In development, include the token for testing
      ...(process.env.NODE_ENV === 'development' && { 
        resetToken,
        resetUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`
      })
    });
  } catch (error) {
    console.error('Password reset error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}