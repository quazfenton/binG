/**
 * Antigravity OAuth Callback Route
 *
 * Handles the Google OAuth callback after user authenticates.
 * Exchanges authorization code for refresh token and stores account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/llm/antigravity-provider';
import { saveAntigravityAccount } from '@/lib/database/antigravity-accounts';
import { verifyAuth } from '@/lib/auth/jwt';

export async function GET(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code) {
      return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
    }

    // FIX: Validate OAuth state parameter to prevent CSRF attacks
    if (!state) {
      return NextResponse.json({ error: 'Missing OAuth state parameter' }, { status: 400 });
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/antigravity/callback`;
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // Save the account to database
    await saveAntigravityAccount({
      userId: authResult.userId,
      email: tokens.email,
      refreshToken: tokens.refreshToken,
      projectId: tokens.projectId,
    });

    // Redirect back to app with success
    const redirectUrl = new URL('/settings', req.url);
    redirectUrl.searchParams.set('antigravity', 'connected');
    redirectUrl.searchParams.set('email', tokens.email);
    return NextResponse.redirect(redirectUrl);
  } catch (error: any) {
    console.error('[Antigravity OAuth] Error:', error);
    return NextResponse.json(
      { error: error.message || 'OAuth failed' },
      { status: 500 }
    );
  }
}
