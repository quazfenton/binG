import { NextRequest, NextResponse } from 'next/server';
import Arcade from '@arcadeai/arcadejs';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { authService } from '@/lib/auth/auth-service';

const arcade = new Arcade({
  apiKey: process.env.ARCADE_API_KEY || '',
});

function isEnabled(): boolean {
  return process.env.ARCADE_CUSTOM_VERIFIER_ENABLED === 'true';
}

async function resolveArcadeUserId(appUserId: string): Promise<string> {
  const strategy = (process.env.ARCADE_USER_ID_STRATEGY || 'email').toLowerCase();
  if (strategy !== 'email') return appUserId;

  const numeric = Number(appUserId);
  if (Number.isNaN(numeric)) return appUserId;
  const user = await authService.getUserById(numeric);
  return user?.email || appUserId;
}

async function confirmUserWithArcade(flowId: string, userId: string): Promise<any> {
  // SDK path (preferred)
  const sdkConfirm = (arcade as any)?.auth?.confirmUser;
  if (typeof sdkConfirm === 'function') {
    return sdkConfirm.call((arcade as any).auth, {
      flow_id: flowId,
      user_id: userId,
    });
  }

  // REST fallback for SDK compatibility differences
  const apiKey = process.env.ARCADE_API_KEY || '';
  const response = await fetch('https://cloud.arcade.dev/api/v1/oauth/confirm_user', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      flow_id: flowId,
      user_id: userId,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `Arcade confirm_user failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

/**
 * Validate redirect URI to prevent open redirect vulnerabilities
 * Only allows same-origin URLs or relative paths
 */
function isValidRedirectUri(uri: string, origin: string): boolean {
  // Allow relative paths (start with / but not //)
  if (uri.startsWith('/') && !uri.startsWith('//')) {
    return true;
  }
  
  // Allow same-origin absolute URLs
  try {
    const parsed = new URL(uri);
    return parsed.origin === origin;
  } catch {
    // Invalid URL format
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!isEnabled()) {
    return NextResponse.json({ error: 'Arcade custom verifier is disabled' }, { status: 404 });
  }

  if (!process.env.ARCADE_API_KEY) {
    return NextResponse.json({ error: 'Arcade API key not configured' }, { status: 500 });
  }

  const flowId = req.nextUrl.searchParams.get('flow_id');
  if (!flowId) {
    return NextResponse.json({ error: 'Missing flow_id' }, { status: 400 });
  }

  const tokenFromQuery = req.nextUrl.searchParams.get('token');
  const authResult = await resolveRequestAuth(req, {
    bearerToken: tokenFromQuery,
    allowAnonymous: false,
  });

  if (!authResult.success || !authResult.userId) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl.toString(), { status: 303 });
  }

  try {
    const arcadeUserId = await resolveArcadeUserId(authResult.userId);
    const result = await confirmUserWithArcade(flowId, arcadeUserId);

    const nextUri = result?.next_uri || result?.nextUri;
    if (typeof nextUri === 'string' && nextUri.trim().length > 0) {
      // Validate redirect URI to prevent open redirect vulnerability
      if (isValidRedirectUri(nextUri, req.nextUrl.origin)) {
        return NextResponse.redirect(new URL(nextUri, req.url), { status: 303 });
      } else {
        console.warn('[Arcade Custom Verifier] Invalid redirect URI rejected:', nextUri);
        // Fall through to default success URL instead of redirecting to invalid URI
      }
    }

    const successUrl = new URL('/settings', req.nextUrl.origin);
    successUrl.searchParams.set('arcade_verify', 'success');
    return NextResponse.redirect(successUrl.toString(), { status: 303 });
  } catch (error: any) {
    console.error('[Arcade Custom Verifier] Error:', error);
    const failureUrl = new URL('/settings', req.nextUrl.origin);
    failureUrl.searchParams.set('arcade_verify', 'error');
    failureUrl.searchParams.set('message', encodeURIComponent(error?.message || 'verification_failed'));
    return NextResponse.redirect(failureUrl.toString(), { status: 303 });
  }
}

