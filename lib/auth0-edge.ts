/**
 * Auth0 Client - Edge Runtime Compatible
 *
 * This module exports ONLY the Auth0Client instance and constants that are
 * safe to use in Edge Runtime (middleware). No Node.js module imports (fs,
 * path, crypto, better-sqlite3) are referenced here.
 *
 * For database-dependent Auth0 helpers (saveConnectedAccount, getStoredAccessToken, etc.),
 * import from './auth0' instead.
 */

import { NextResponse } from 'next/server';
import { Auth0Client } from "@auth0/nextjs-auth0/server";

console.log('[Auth0] Initializing Auth0Client', {
  domain: process.env.AUTH0_DOMAIN,
  clientId: process.env.AUTH0_CLIENT_ID,
  hasSecret: !!process.env.AUTH0_SECRET,
  baseUrl: process.env.AUTH0_BASE_URL || process.env.NEXT_PUBLIC_APP_URL,
});

export const auth0 = new Auth0Client({
  enableConnectAccountEndpoint: true,
  routes: {
    connectAccount: "/auth/connect",
  },
  async onCallback(error, context, session) {
    const baseUrl = context?.appBaseUrl
      || process.env.APP_BASE_URL
      || process.env.NEXT_PUBLIC_APP_URL
      || 'http://localhost:3000';
    
    try {
      console.log('[Auth0] onCallback invoked', {
        error: error ? {
          message: error.message,
          code: error.code,
          name: error.name,
          cause: error.cause,
        } : null,
        hasContext: !!context,
        hasSession: !!session,
        returnTo: context?.returnTo,
        sessionUser: session?.user ? { sub: (session.user as any).sub, email: (session.user as any).email } : null,
      });
      if (error) {
        const errorUrl = new URL('/auth/error', baseUrl);
        errorUrl.searchParams.set('error', 'callback_error');
        errorUrl.searchParams.set('error_description', error.message);
        return NextResponse.redirect(errorUrl.toString());
      }

      const returnTo = context?.returnTo || '/';
      const parsedReturnTo = new URL(returnTo, baseUrl);
      const appOrigin = new URL(baseUrl).origin;
      const redirectUrl = parsedReturnTo.origin === appOrigin
        ? parsedReturnTo.toString()
        : new URL('/', baseUrl).toString();
      console.log('[Auth0] onCallback successful, redirecting to:', redirectUrl);
      return NextResponse.redirect(redirectUrl);
    } catch (e: any) {
      console.error('[Auth0] onCallback threw:', e?.message, e?.stack);
      const safeBaseUrl = (() => {
        try { return new URL(baseUrl).origin; } catch { return 'http://localhost:3000'; }
      })();
      return NextResponse.redirect(new URL('/', safeBaseUrl).toString());
    }
  },
});

/**
 * Extended connection names for Auth0 social logins and enterprise connections
 */
export const AUTH0_CONNECTIONS = {
  GITHUB: 'github',
  GOOGLE: 'google-oauth2',
  FACEBOOK: 'facebook',
  TWITTER: 'twitter',
  LINKEDIN: 'linkedin',
  MICROSOFT: 'windowslive',
  APPLE: 'apple',
  AMAZON: 'amazon',
  INSTAGRAM: 'instagram',
  BITBUCKET: 'bitbucket',
  YAHOO: 'yahoo',
  BOX: 'box',
  SALESFORCE: 'salesforce',
  SLACK: 'slack',
} as const;

/**
 * Mapping of provider IDs to connection names for the IntegrationPanel
 */
export const PROVIDER_CONNECTION_MAP: Record<string, string> = {
  'github': 'github',
  'google': 'google-oauth2',
  'facebook': 'facebook',
  'twitter': 'twitter',
  'linkedin': 'linkedin',
  'microsoft': 'windowslive',
  'apple': 'apple',
  'instagram': 'instagram',
  'bitbucket': 'bitbucket',
  'slack': 'slack',
};
