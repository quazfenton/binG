/**
 * Antigravity Admin OAuth Callback Route
 *
 * GET /api/antigravity/admin/callback
 * Handles the Google OAuth callback for master account setup.
 * Exchanges authorization code for refresh token and displays it
 * securely on a server-rendered page for copying to env vars.
 *
 * Requires admin authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/llm/antigravity-provider';
import { requireAdminApiOrForbidden } from '@/lib/auth/admin';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdminApiOrForbidden(req);
    if (admin instanceof NextResponse) return admin;

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code) {
      return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/antigravity/admin/callback`;
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // Set the tokens in a secure httpOnly cookie for the display page
    // The cookie is short-lived (5 min) and only readable by server
    const cookieStore = await cookies();
    cookieStore.set('antigravity-admin-tokens', JSON.stringify({
      email: tokens.email,
      refreshToken: tokens.refreshToken,
      projectId: tokens.projectId,
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 300, // 5 minutes
      path: '/admin/antigravity/setup',
    });

    // Redirect to the setup page which will read and display the token
    return NextResponse.redirect(
      new URL('/admin/antigravity/setup', req.url)
    );
  } catch (error: any) {
    console.error('[Antigravity Admin OAuth] Error:', error);
    return NextResponse.json(
      { error: error.message || 'OAuth failed' },
      { status: 500 }
    );
  }
}
