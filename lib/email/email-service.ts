/**
 * Email Service
 * Handles sending verification emails, password resets, and notifications
 * 
 * Supports multiple providers:
 * - Resend (recommended for simplicity)
 * - SendGrid
 * - SMTP (nodemailer)
 */

import { v4 as uuidv4 } from 'uuid';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailVerificationData {
  token: string;
  expiresAt: Date;
  verificationUrl: string;
}

class EmailService {
  private provider: 'resend' | 'sendgrid' | 'smtp' | 'mock';
  private apiKey?: string;
  private fromEmail: string;
  private appName: string;
  private appUrl: string;

  constructor() {
    // Determine email provider from environment
    if (process.env.RESEND_API_KEY) {
      this.provider = 'resend';
      this.apiKey = process.env.RESEND_API_KEY;
    } else if (process.env.SENDGRID_API_KEY) {
      this.provider = 'sendgrid';
      this.apiKey = process.env.SENDGRID_API_KEY;
    } else if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      this.provider = 'smtp';
    } else {
      this.provider = 'mock';
      console.warn('⚠️  No email provider configured. Emails will be logged to console only.');
      console.warn('Set RESEND_API_KEY, SENDGRID_API_KEY, or SMTP_* environment variables.');
    }

    this.fromEmail = process.env.EMAIL_FROM || 'noreply@bing.local';
    this.appName = process.env.APP_NAME || 'binG';
    this.appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  }

  /**
   * Generate email verification token and URL
   */
  generateVerificationData(): EmailVerificationData {
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const verificationUrl = `${this.appUrl}/verify-email?token=${token}`;

    return { token, expiresAt, verificationUrl };
  }

  /**
   * Send email verification email
   */
  async sendVerificationEmail(email: string, verificationData: EmailVerificationData): Promise<{ success: boolean; error?: string }> {
    const { verificationUrl } = verificationData;

    const subject = `Verify your email - ${this.appName}`;
    const html = this.buildVerificationEmailHtml(verificationUrl);
    const text = this.buildVerificationEmailText(verificationUrl);

    return this.sendEmail({
      to: email,
      subject,
      html,
      text,
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, resetUrl: string): Promise<{ success: boolean; error?: string }> {
    const subject = `Reset your password - ${this.appName}`;
    const html = this.buildPasswordResetEmailHtml(resetUrl);
    const text = this.buildPasswordResetEmailText(resetUrl);

    return this.sendEmail({
      to: email,
      subject,
      html,
      text,
    });
  }

  /**
   * Send a generic email
   */
  async sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.provider === 'mock') {
        console.log('📧 [MOCK EMAIL] Would send to:', options.to);
        console.log('📧 [MOCK EMAIL] Subject:', options.subject);
        console.log('📧 [MOCK EMAIL] Body:', options.html);
        return { success: true };
      }

      if (this.provider === 'resend') {
        return this.sendViaResend(options);
      }

      if (this.provider === 'sendgrid') {
        return this.sendViaSendGrid(options);
      }

      if (this.provider === 'smtp') {
        return this.sendViaSmtp(options);
      }

      return { success: false, error: 'No email provider configured' };
    } catch (error) {
      console.error('Email send error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to send email' 
      };
    }
  }

  /**
   * Send via Resend (https://resend.com)
   */
  private async sendViaResend(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        from: this.fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to send via Resend');
    }

    return { success: true };
  }

  /**
   * Send via SendGrid (https://sendgrid.com)
   */
  private async sendViaSendGrid(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: options.to }] }],
        from: { email: this.fromEmail, name: this.appName },
        subject: options.subject,
        content: [
          { type: 'text/html', value: options.html },
          ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to send via SendGrid');
    }

    return { success: true };
  }

  /**
   * Send via SMTP (nodemailer)
   */
  private async sendViaSmtp(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    // Lazy import nodemailer to avoid requiring it if not used
    const nodemailer = (await import('nodemailer')).default;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"${this.appName}" <${this.fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    return { success: true };
  }

  /**
   * Build verification email HTML
   */
  private buildVerificationEmailHtml(verificationUrl: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .container { background: #f9fafb; border-radius: 8px; padding: 32px; text-align: center; }
    .button { display: inline-block; background: #2563eb; color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 24px 0; }
    .button:hover { background: #1d4ed8; }
    .footer { margin-top: 32px; font-size: 14px; color: #6b7280; }
    .code { background: #f3f4f6; padding: 16px; border-radius: 4px; font-family: monospace; font-size: 18px; letter-spacing: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Verify Your Email</h1>
    <p>Thanks for signing up for ${this.appName}! Please verify your email address to complete your registration.</p>
    
    <a href="${verificationUrl}" class="button">Verify Email</a>
    
    <p>Or copy and paste this verification code:</p>
    <p class="code">${verificationUrl.split('token=')[1]}</p>
    
    <p>This link will expire in 24 hours.</p>
    
    <div class="footer">
      <p>If you didn't create an account, you can safely ignore this email.</p>
      <p>&copy; ${new Date().getFullYear()} ${this.appName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Build verification email text
   */
  private buildVerificationEmailText(verificationUrl: string): string {
    return `
Verify Your Email - ${this.appName}

Thanks for signing up for ${this.appName}! Please verify your email address to complete your registration.

Click the link below to verify your email:
${verificationUrl}

This link will expire in 24 hours.

If you didn't create an account, you can safely ignore this email.

---
© ${new Date().getFullYear()} ${this.appName}. All rights reserved.
    `.trim();
  }

  /**
   * Build password reset email HTML
   */
  private buildPasswordResetEmailHtml(resetUrl: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .container { background: #f9fafb; border-radius: 8px; padding: 32px; text-align: center; }
    .button { display: inline-block; background: #dc2626; color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 24px 0; }
    .button:hover { background: #b91c1c; }
    .footer { margin-top: 32px; font-size: 14px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Reset Your Password</h1>
    <p>You requested to reset your password for ${this.appName}.</p>
    
    <a href="${resetUrl}" class="button">Reset Password</a>
    
    <p>This link will expire in 1 hour.</p>
    
    <div class="footer">
      <p>If you didn't request this, you can safely ignore this email.</p>
      <p>&copy; ${new Date().getFullYear()} ${this.appName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Build password reset email text
   */
  private buildPasswordResetEmailText(resetUrl: string): string {
    return `
Reset Your Password - ${this.appName}

You requested to reset your password for ${this.appName}.

Click the link below to reset your password:
${resetUrl}

This link will expire in 1 hour.

If you didn't request this, you can safely ignore this email.

---
© ${new Date().getFullYear()} ${this.appName}. All rights reserved.
    `.trim();
  }
}

// Export singleton instance
export const emailService = new EmailService();
