/**
 * MFA Setup Endpoint
 *
 * MED-6 fix: Initiates TOTP setup for a user.
 * Generates a new TOTP secret, stores it encrypted, and returns
 * the otpauth:// URI for QR code provisioning.
 *
 * The secret is NOT enabled until the user verifies with a code (see /mfa/verify).
 */

import { NextRequest, NextResponse } from 'next/server';


import { verifyAuth } from '@/lib/auth/jwt';
import { generateTotpSecret, generateTotpUri, encryptTotpSecret, generateBackupCodes, hashBackupCodes } from '@/lib/auth/totp';
import { csrfCheckOrReject } from '@/lib/auth/csrf';

export async function POST(request: NextRequest) {
  // CSRF protection
  const csrfReject = csrfCheckOrReject(request);
  if (csrfReject) return csrfReject;

  // Require authentication
  const authResult = await verifyAuth(request);
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) {
      return NextResponse.json({ success: false, error: 'Database not available' }, { status: 500 });
    }

    // Check if MFA already set up
    const existing = db.prepare(
      'SELECT id FROM user_mfa WHERE user_id = ? AND mfa_type = ?'
    ).get(authResult.userId, 'totp');

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'MFA is already set up. Disable it first to reconfigure.' },
        { status: 400 }
      );
    }

    // Generate TOTP secret
    const secret = generateTotpSecret();
    const encryptedSecret = encryptTotpSecret(secret);

    // Generate backup codes
    const backupCodes = generateBackupCodes(10);
    const hashedBackupCodes = hashBackupCodes(backupCodes);

    // Get user email for provisioning URI
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(authResult.userId) as any;

    // Store in DB in a transaction to ensure atomicity
    try {
      db.transaction(() => {
        db.prepare(`
          INSERT INTO user_mfa (user_id, mfa_type, secret_encrypted, backup_codes, is_enabled)
          VALUES (?, ?, ?, ?, FALSE)
        `).run(authResult.userId, 'totp', encryptedSecret, hashedBackupCodes);
      })();
    } catch (dbError) {
      console.error('[MFA Setup] DB insertion failed:', dbError);
      throw new Error('Failed to initialize MFA record');
    }

    // Generate provisioning URI for QR code
    const provisioningUri = generateTotpUri(secret, user?.email || '', 'binG');

    // MED-5 fix: Log MFA setup (success — not enabled yet, verification needed)
    try {
      const { logMfaSetup } = await import('@/lib/auth/auth-audit-logger');
      await logMfaSetup(authResult.userId, request);
    } catch (auditError) {
      console.warn('[MFA Setup] Audit log failed:', auditError);
    }

    return NextResponse.json({
      success: true,
      provisioningUri,
      backupCodes, // Show once — user must save these
      message: 'MFA initialized. IMPORTANT: Save your backup codes now! They will not be shown again.',
      warning: 'Store your backup codes in a safe place. If you lose access to your authenticator app, these are the only way to recover your account.',
    });
  } catch (error) {
    console.error('[MFA Setup] Error:', error);

    // MED-5 fix: Log MFA setup failure
    try {
      const { logMfaSetupFailure } = await import('@/lib/auth/auth-audit-logger');
      logMfaSetupFailure(authResult.userId, request);
    } catch (auditError) {
      console.warn('[MFA Setup] Audit log failed:', auditError);
    }

    return NextResponse.json({ success: false, error: 'Failed to set up MFA' }, { status: 500 });
  }
}
