/**
 * Email Service
 * Handles sending verification emails, password resets, and notifications
 *
 * Supports multiple providers with automatic quota-based failover:
 * - Brevo (recommended - 300 emails/month free)
 * - Resend (3000 emails/month free)
 * - SendGrid (100 emails/day free)
 * - SMTP (nodemailer) - works with Brevo SMTP relay or any SMTP server
 *
 * Quota Management:
 * - Tracks monthly usage per provider
 * - Automatically switches to fallback provider when quota is hit
 * - Persists quotas to database + file for restart survival
 */

import { v4 as uuidv4 } from 'uuid';
import type { BrevoClient } from '@getbrevo/brevo';
import { emailQuotaManager } from './email-quota-manager';

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
  private provider: 'brevo' | 'mailersend' | 'resend' | 'sendgrid' | 'smtp' | 'mock';
  private apiKey?: string;
  private fromEmail: string;
  private fromName?: string;
  private appName: string;
  private appUrl: string;
  private brevoClient?: any;
  private mailerSendClient?: any;
  private autoFailoverEnabled: boolean;

  constructor() {
    // Determine email provider from environment
    // Priority: BREVO > MAILERSEND > RESEND > SENDGRID > SMTP
    const primaryProvider = process.env.EMAIL_PROVIDER || 'auto';
    this.autoFailoverEnabled = process.env.EMAIL_AUTO_FAILOVER !== 'false';

    if (primaryProvider === 'brevo' || (primaryProvider === 'auto' && process.env.BREVO_API_KEY)) {
      this.provider = 'brevo';
      this.apiKey = process.env.BREVO_API_KEY;
      if (this.apiKey) {
        // Lazy import Brevo client
        import('@getbrevo/brevo').then(({ BrevoClient }) => {
          this.brevoClient = new BrevoClient({ apiKey: this.apiKey! });
        }).catch(err => {
          console.error('Failed to initialize Brevo client:', err);
        });
      }
    } else if (primaryProvider === 'mailersend' || (primaryProvider === 'auto' && process.env.MAILERSEND_API_KEY)) {
      this.provider = 'mailersend';
      this.apiKey = process.env.MAILERSEND_API_KEY;
      if (this.apiKey) {
        // Lazy import MailerSend client
        import('mailersend').then(({ MailerSend }) => {
          this.mailerSendClient = new MailerSend({ apiKey: this.apiKey! });
        }).catch(err => {
          console.error('Failed to initialize MailerSend client:', err);
        });
      }
    } else if (primaryProvider === 'resend' || (primaryProvider === 'auto' && process.env.RESEND_API_KEY)) {
      this.provider = 'resend';
      this.apiKey = process.env.RESEND_API_KEY;
    } else if (primaryProvider === 'sendgrid' || (primaryProvider === 'auto' && process.env.SENDGRID_API_KEY)) {
      this.provider = 'sendgrid';
      this.apiKey = process.env.SENDGRID_API_KEY;
    } else if (primaryProvider === 'smtp' || (primaryProvider === 'auto' && process.env.SMTP_HOST && process.env.SMTP_USER)) {
      this.provider = 'smtp';
    } else {
      this.provider = 'mock';
      console.warn('⚠️  No email provider configured. Emails will be logged to console only.');
      console.warn('Set EMAIL_PROVIDER=brevo|mailersend|resend|sendgrid|smtp, or configure BREVO_API_KEY, MAILERSEND_API_KEY, RESEND_API_KEY, SENDGRID_API_KEY, or SMTP_* environment variables.');
    }

    this.fromEmail = process.env.EMAIL_FROM || 'noreply@bing.local';
    this.fromName = process.env.EMAIL_FROM_NAME;
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
   * Send a generic email with automatic quota tracking and failover
   */
  async sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.provider === 'mock') {
        console.log('📧 [MOCK EMAIL] Would send to:', options.to);
        console.log('📧 [MOCK EMAIL] Subject:', options.subject);
        console.log('📧 [MOCK EMAIL] Body:', options.html);
        return { success: true };
      }

      // Try to send with current provider, with automatic failover
      return this.sendWithFailover(options);
    } catch (error) {
      console.error('Email send error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send email'
      };
    }
  }

  /**
   * Send email with automatic provider failover when quota is hit or provider fails
   */
  private async sendWithFailover(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    const attemptedProviders: string[] = [];
    let lastError: string | undefined;

    // Get provider chain: current provider first, then fallbacks
    const providerChain = this.getProviderChain();

    for (const provider of providerChain) {
      if (attemptedProviders.includes(provider)) continue;
      attemptedProviders.push(provider);

      try {
        // Check quota before attempting
        if (!emailQuotaManager.isAvailable(provider)) {
          const remaining = emailQuotaManager.getRemaining(provider);
          console.warn(`📧 Skipping provider '${provider}': quota exceeded (${remaining} remaining)`);
          continue;
        }

        const result = await this.sendViaProvider(provider, options);
        
        if (result.success) {
          // Record successful send in quota tracker
          emailQuotaManager.recordUsage(provider, 1);
          console.log(`📧 Email sent successfully via ${provider} (${emailQuotaManager.getUsagePercent(provider)}.1f)% of monthly quota used)`);
          return { success: true };
        }

        // Provider failed but not due to quota - record error and try next
        lastError = result.error;
        console.warn(`📧 Provider '${provider}' failed: ${result.error}`);
        
        // If it's an API error (not quota), temporarily disable provider
        if (result.error?.includes('API') || result.error?.includes('auth') || result.error?.includes('unauthorized')) {
          emailQuotaManager.disableProvider(provider, `API error: ${result.error}`);
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        console.error(`📧 Provider '${provider}' error:`, error);
        
        // Disable provider on error
        emailQuotaManager.disableProvider(provider, `Error: ${lastError}`);
      }
    }

    // All providers failed
    const errorMsg = `All email providers failed. Attempted: ${attemptedProviders.join(', ')}. Last error: ${lastError || 'Unknown'}`;
    console.error('📧', errorMsg);
    
    return { success: false, error: errorMsg };
  }

  /**
   * Get ordered list of providers to try (current provider first, then fallbacks by priority)
   */
  private getProviderChain(): string[] {
    const fallbacks = emailQuotaManager.getFallbackChain(this.provider);
    
    // Current provider first, then fallbacks
    return [this.provider, ...fallbacks].filter(Boolean) as string[];
  }

  /**
   * Dispatch email sending to specific provider
   */
  private async sendViaProvider(provider: string, options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    switch (provider) {
      case 'brevo':
        return this.sendViaBrevo(options);
      case 'mailersend':
        return this.sendViaMailerSend(options);
      case 'resend':
        return this.sendViaResend(options);
      case 'sendgrid':
        return this.sendViaSendGrid(options);
      case 'smtp':
        return this.sendViaSmtp(options);
      default:
        return { success: false, error: `Unknown provider: ${provider}` };
    }
  }

  /**
   * Send via Brevo (https://brevo.com)
   * Uses Brevo's transactional email API
   *
   * Quota: 300 emails/day (9000/month)
   * Alternative: Brevo SMTP Relay
   * - Host: smtp-relay.brevo.com
   * - Port: 587
   * - Login: a2dd32001@smtp-brevo.com (use your actual SMTP login)
   */
  private async sendViaBrevo(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'Brevo API key is not configured' };
    }

    // Try SDK first if client is initialized
    if (this.brevoClient) {
      try {
        await this.brevoClient.transactionalEmails.sendTransacEmail({
          htmlContent: options.html,
          textContent: options.text,
          sender: {
            email: this.fromEmail,
            name: this.fromName || this.appName,
          },
          subject: options.subject,
          to: [
            {
              email: options.to,
            },
          ],
        });
        return { success: true };
      } catch (error) {
        console.error('Brevo SDK send error:', error);
        // Fall through to API fetch method
      }
    }

    // Fallback: Use direct API call (no SDK required)
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        htmlContent: options.html,
        textContent: options.text,
        sender: {
          email: this.fromEmail,
          name: this.fromName || this.appName,
        },
        subject: options.subject,
        to: [
          {
            email: options.to,
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to send via Brevo');
    }

    return { success: true };
  }

  /**
   * Send via MailerSend (https://mailersend.com)
   * Uses MailerSend's transactional email API
   *
   * Quota: 100 emails/day (3000/month) free tier
   */
  private async sendViaMailerSend(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    const apiKey = process.env.MAILERSEND_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'MailerSend API key is not configured' };
    }

    // Try SDK first if client is initialized
    if (this.mailerSendClient) {
      try {
        const { EmailParams, Sender, Recipient } = await import('mailersend');

        const sentFrom = new Sender(this.fromEmail, this.fromName || this.appName);
        const recipients = [new Recipient(options.to)];

        const emailParams = new EmailParams()
          .setFrom(sentFrom)
          .setTo(recipients)
          .setReplyTo(sentFrom)
          .setSubject(options.subject)
          .setHtml(options.html)
          .setText(options.text || '');

        await this.mailerSendClient.email.send(emailParams);
        return { success: true };
      } catch (error) {
        console.error('MailerSend SDK send error:', error);
        // Fall through to API fetch method
      }
    }

    // Fallback: Use direct API call (no SDK required)
    const response = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        from: {
          email: this.fromEmail,
          name: this.fromName || this.appName,
        },
        to: [
          {
            email: options.to,
          },
        ],
        subject: options.subject,
        text: options.text,
        html: options.html,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to send via MailerSend');
    }

    return { success: true };
  }

  /**
   * Send via Resend (https://resend.com)
   */
  private async sendViaResend(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'Resend API key is not configured' };
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
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
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'SendGrid API key is not configured' };
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
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
   * Works with any SMTP server including:
   * - Brevo SMTP Relay: smtp-relay.brevo.com:587
   * - Gmail: smtp.gmail.com:587
   * - SendGrid: smtp.sendgrid.net:587
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
      from: {
        address: this.fromEmail,
        name: this.fromName || this.appName,
      },
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

  /**
   * Get current provider
   */
  getCurrentProvider(): string {
    return this.provider;
  }

  /**
   * Get quota status for all email providers
   * Useful for admin dashboards
   */
  getQuotaStatus(): Array<{
    provider: string;
    monthlyLimit: number;
    currentUsage: number;
    remaining: number;
    usagePercent: number;
    isDisabled: boolean;
    resetDate: string;
  }> {
    return emailQuotaManager.getAllQuotas().map(q => ({
      provider: q.provider,
      monthlyLimit: q.monthlyLimit,
      currentUsage: q.currentUsage,
      remaining: emailQuotaManager.getRemaining(q.provider),
      usagePercent: emailQuotaManager.getUsagePercent(q.provider),
      isDisabled: q.isDisabled,
      resetDate: q.resetDate,
    }));
  }

  /**
   * Manually switch email provider (admin action)
   */
  switchProvider(provider: 'brevo' | 'mailersend' | 'resend' | 'sendgrid' | 'smtp'): boolean {
    const available = emailQuotaManager.isAvailable(provider);
    if (!available) {
      console.warn(`Cannot switch to '${provider}': provider is disabled (quota exceeded)`);
      return false;
    }

    const oldProvider = this.provider;
    this.provider = provider;
    console.log(`📧 Switched email provider from '${oldProvider}' to '${provider}'`);
    return true;
  }

  /**
   * Reset quota for a provider (admin action)
   */
  resetProviderQuota(provider: string): void {
    emailQuotaManager.resetUsage(provider);
    console.log(`📧 Reset quota for provider '${provider}'`);
  }
}

// Export singleton instance
export const emailService = new EmailService();

// Also export quota manager for external access (e.g., admin APIs)
export { emailQuotaManager };
