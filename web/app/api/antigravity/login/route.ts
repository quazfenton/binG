/**
 * Antigravity OAuth Start Route
 *
 * Redirects user to Google OAuth for Antigravity authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAntigravityOAuthUrl } from '@/lib/llm/antigravity-provider';
import { verifyAuth } from '@/lib/auth/jwt';

export async function GET(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const projectId = url.searchParams.get('projectId') || '';

    const oauthUrl = getAntigravityOAuthUrl(projectId);
    return NextResponse.redirect(oauthUrl);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to start OAuth' },
      { status: 500 }
    );
  }
}
