/**
 * Antigravity Admin Status Route
 *
 * GET /api/antigravity/admin/status
 * Returns the current master account configuration status
 * Requires admin authentication.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { requireAdminApiOrForbidden } from '@/lib/auth/admin';
import { isMasterAccountConfigured, getMasterAccountInfo } from '@/lib/database/antigravity-accounts';

export async function GET(req: NextRequest) {
  const admin = await requireAdminApiOrForbidden(req);
  if (admin instanceof NextResponse) return admin;

  const masterConfigured = isMasterAccountConfigured();
  const masterInfo = getMasterAccountInfo();
  const oauthAppConfigured = !!(
    process.env.ANTIGRAVITY_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  );

  return NextResponse.json({
    masterAccount: {
      configured: masterConfigured,
      email: masterInfo?.email,
      projectId: masterInfo?.projectId,
    },
    oauthApp: {
      configured: oauthAppConfigured,
      clientId: process.env.ANTIGRAVITY_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
    },
    perUserOAuthEnabled: oauthAppConfigured,
    connectMasterUrl: '/api/antigravity/admin/connect',
  });
}

