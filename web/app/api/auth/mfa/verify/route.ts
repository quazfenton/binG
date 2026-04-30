/**
 * MFA Verify & Enable Endpoint
 *
 * MED-6 fix: Verifies a TOTP code during setup to confirm the user
 * has correctly configured their authenticator app.
 * On success, marks MFA as enabled for the account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/jwt';
import { verifyTotpCode, decryptTotpSecret } from '@/lib/auth/totp';
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
    const body = await request.json();
    const { code } = body;

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ success: false, error: 'Verification code is required' }, { status: 400 });
    }

    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) {
      return NextResponse.json({ success: false, error: 'Database not available' }, { status: 500 });
    }

    // Get pending MFA record
    const mfaRecord = db.prepare(
      'SELECT secret_encrypted, is_enabled FROM user_mfa WHERE user_id = ? AND mfa_type = ?'
    ).get(authResult.userId, 'totp') as any;

    if (!mfaRecord) {
      return NextResponse.json({ success: false, error: 'MFA not set up. Call /mfa/setup first.' }, { status: 400 });
    }

    if (mfaRecord.is_enabled) {
      return NextResponse.json({ success: false, error: 'MFA is already enabled' }, { status: 400 });
    }

    // Decrypt and verify TOTP code
    const secret = decryptTotpSecret(mfaRecord.secret_encrypted);
    const totpResult = verifyTotpCode(secret, code);
    if (!totpResult.valid) {
      return NextResponse.json({ success: false, error: 'Invalid verification code' }, { status: 401 });
    }

    // Enable MFA
    db.prepare(`
      UPDATE user_mfa SET is_enabled = TRUE, verified_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND mfa_type = ?
    `).run(authResult.userId, 'totp');

    return NextResponse.json({
      success: true,
      message: 'MFA enabled successfully. You will be prompted for a code on next login.',
    });
  } catch (error) {
    console.error('[MFA Verify] Error:', error);
    return NextResponse.json({ success: false, error: 'MFA verification failed' }, { status: 500 });
  }
}
