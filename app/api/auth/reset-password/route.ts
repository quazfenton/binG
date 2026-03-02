import { NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/database/db';
import { generateToken } from '@/lib/auth/jwt';

interface EmailService {
  sendPasswordReset(email: string, resetToken: string, resetUrl: string): Promise<boolean>;
}

const emailService: EmailService = {
  async sendPasswordReset(email: string, resetToken: string, resetUrl: string): Promise<boolean> {
    console.log(`[Email] Sending password reset to ${email}`);
    console.log(`[Email] Reset link: ${resetUrl}`);
    
    // In production, integrate with email provider (SendGrid, AWS SES, etc.)
    const emailProvider = process.env.EMAIL_PROVIDER;
    
    if (emailProvider === 'sendgrid') {
      // await sendgrid.send({
      //   to: email,
      //   from: process.env.EMAIL_FROM || 'noreply@example.com',
      //   subject: 'Password Reset Request',
      //   html: `Click <a href="${resetUrl}">here</a> to reset your password.`,
      // });
      console.log('[Email] Would send via SendGrid');
    } else if (emailProvider === 'ses') {
      // await ses.sendEmail({ ... });
      console.log('[Email] Would send via AWS SES');
    } else {
      console.log('[Email] No email provider configured, logging only');
    }
    
    return true;
  }
};

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
    
    // Send password reset email
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
    await emailService.sendPasswordReset(email, resetToken, resetUrl);

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