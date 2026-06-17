/**
 * Antigravity Admin Status Route
 *
 * GET /api/antigravity/admin/status
 * Returns the current master account configuration status
 * Requires admin authentication.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

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

  // Surface the pending HttpOnly token cookie set by the OAuth callback so
  // the static-exported setup page can render it client-side after fetching
  // this endpoint. Reading happens server-side because the cookie is HttpOnly.
  let pendingTokens: { email: string; refreshToken: string; projectId: string } | null = null;
  const raw = req.cookies.get('antigravity-admin-tokens')?.value;
  if (raw) {
    try { pendingTokens = JSON.parse(raw); } catch { /* invalid cookie, ignore */ }
  }

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
    pendingTokens,
  });
}

