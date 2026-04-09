/**
 * Antigravity Admin Connect Route
 *
 * GET /api/antigravity/admin/connect
 * Starts OAuth flow specifically for connecting the master account.
 * The admin authenticates with Google and the refresh token is saved
 * as the server-level master account.
 *
 * Requires admin authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApiOrForbidden } from '@/lib/auth/admin';
import { getAntigravityOAuthUrl } from '@/lib/llm/antigravity-provider';

export async function GET(req: NextRequest) {
  const admin = await requireAdminApiOrForbidden(req);
  if (admin instanceof NextResponse) return admin;

  const url = new URL(req.url);
  const projectId =
    url.searchParams.get('projectId') ||
    process.env.ANTIGRAVITY_DEFAULT_PROJECT_ID ||
    'rising-fact-p41fc';

  const oauthUrl = await getAntigravityOAuthUrl(projectId);
  return NextResponse.redirect(oauthUrl);
}
