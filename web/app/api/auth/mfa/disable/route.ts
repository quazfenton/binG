/**
 * MFA Disable Endpoint
 *
 * MED-6 fix: Disables MFA for the authenticated user.
 * Requires a valid TOTP code or backup code to prevent unauthorized disabling.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/jwt';
import { verifyTotpCode, decryptTotpSecret, verifyBackupCode } from '@/lib/auth/totp';
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
    const { code, backupCode } = body;

    if (!code && !backupCode) {
      return NextResponse.json(
        { success: false, error: 'Current TOTP code or backup code is required to disable MFA' },
        { status: 400 }
      );
    }

    const { getDatabase } = require('@/lib/database/connection');
    const db = getDatabase();
    if (!db) {
      return NextResponse.json({ success: false, error: 'Database not available' }, { status: 500 });
    }

    // Get MFA record
    const mfaRecord = db.prepare(
      'SELECT secret_encrypted, backup_codes, is_enabled FROM user_mfa WHERE user_id = ? AND mfa_type = ?'
    ).get(authResult.userId, 'totp') as any;

    if (!mfaRecord || !mfaRecord.is_enabled) {
      return NextResponse.json({ success: false, error: 'MFA is not enabled' }, { status: 400 });
    }

    // Verify TOTP code or backup code
    let verified = false;

    if (code) {
      const secret = decryptTotpSecret(mfaRecord.secret_encrypted);
      const totpResult = verifyTotpCode(secret, code);
      verified = totpResult.valid;
    } else if (backupCode && mfaRecord.backup_codes) {
      const result = verifyBackupCode(mfaRecord.backup_codes, backupCode);
      verified = result.valid;
      if (verified) {
        // Update backup codes (single-use)
        db.prepare('UPDATE user_mfa SET backup_codes = ? WHERE user_id = ? AND mfa_type = ?')
          .run(result.remainingHashes, authResult.userId, 'totp');
      }
    }

    if (!verified) {
      // MED-5 fix: Log MFA disable failure (invalid code)
      try {
        const { logMfaDisableFailure } = await import('@/lib/auth/auth-audit-logger');
        logMfaDisableFailure(authResult.userId, request);
      } catch (auditError) {
        console.warn('[MFA Disable] Audit log failed:', auditError);
      }
      return NextResponse.json({ success: false, error: 'Invalid code' }, { status: 401 });
    }

    // Delete MFA record entirely
    db.prepare('DELETE FROM user_mfa WHERE user_id = ? AND mfa_type = ?')
      .run(authResult.userId, 'totp');

    // MED-5 fix: Log MFA disable (success)
    try {
      const { logMfaDisable } = await import('@/lib/auth/auth-audit-logger');
      logMfaDisable(authResult.userId, request);
    } catch (auditError) {
      console.warn('[MFA Disable] Audit log failed:', auditError);
    }

    return NextResponse.json({
      success: true,
      message: 'MFA disabled successfully.',
    });
  } catch (error) {
    console.error('[MFA Disable] Error:', error);

    // MED-5 fix: Log MFA disable failure (exception)
    try {
      const { logMfaDisableFailure } = await import('@/lib/auth/auth-audit-logger');
      logMfaDisableFailure(authResult.userId, request);
    } catch (auditError) {
      console.warn('[MFA Disable] Audit log failed:', auditError);
    }

    return NextResponse.json({ success: false, error: 'Failed to disable MFA' }, { status: 500 });
  }
}
