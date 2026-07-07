/**
 * Antigravity OAuth Start Route
 *
 * Redirects user to Google OAuth for Antigravity authentication.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { getAntigravityOAuthUrl } from '@/lib/providers/antigravity-provider';
import { verifyAuth } from '@/lib/auth/jwt';

export async function GET(req: NextRequest) {
  try {
    // NEW-1 (docs/async-parallelization-opportunities.md, Tier 4 #49):
    // Promise.all the verifyAuth (cookie/header JWT parse) and the OAuth URL
    // generation. getAntigravityOAuthUrl performs only local crypto (PKCE
    // randomBytes + URL composition) — no external network I/O, so it is
    // cheap and safe to fire for anonymous callers. A leaked oauthUrl cannot
    // be used to authenticate as the user (the callback's verifyAuth is the
    // actual auth-credential gate); it does disclose client_id + projectId,
    // which is acceptable info-disclosure already present in the public OAuth
    // authorize URL. The synchronous URL parse stays BEFORE the Promise.all so
    // the projectId arg to getAntigravityOAuthUrl is in scope at construction.
    // Wallclock gain is bounded by min(T_verifyAuth, T_oauthUrlGen) —
    // typically 5-15ms, smaller than the body-parse siblings (#47/#48)
    // because oauthUrlGen is local crypto rather than a body stream read.
    const url = new URL(req.url);
    const projectId = url.searchParams.get('projectId') || '';
    const [authResult, oauthUrl] = await Promise.all([
      verifyAuth(req),
      getAntigravityOAuthUrl(projectId),
    ]);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.redirect(oauthUrl);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to start OAuth' },
      { status: 500 }
    );
  }
}
