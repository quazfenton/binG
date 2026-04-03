/**
 * Figma OAuth Utilities
 * 
 * PKCE (Proof Key for Code Exchange) implementation for Figma OAuth 2.0
 * 
 * @see https://www.figma.com/developers/api#oauth2
 * @see https://datatracker.ietf.org/doc/html/rfc7636
 */

import { randomUUID, createHash } from 'crypto';
import { FIGMA_OAUTH_CONFIG, getFigmaClientId, getFigmaClientSecret, getFigmaRedirectUri } from './config';

/**
 * Generate PKCE code verifier (43-128 characters)
 * Uses cryptographically secure random bytes
 */
export function generateCodeVerifier(): string {
  const verifier = createHash('sha256')
    .update(randomUUID())
    .update(randomUUID())
    .digest('base64url');
  // Ensure it's between 43-128 characters (RFC 7636 requirement)
  return verifier.slice(0, 128);
}

/**
 * Generate PKCE code challenge from verifier
 * Uses SHA-256 hash (S256 method - required by Figma)
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generate OAuth state parameter for CSRF protection
 */
export function generateState(): string {
  return randomUUID();
}

/**
 * Generate authorization URL for Figma OAuth
 */
export function generateAuthUrl(params: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}): string {
  const url = new URL(FIGMA_OAUTH_CONFIG.authUrl);
  
  url.searchParams.set('client_id', getFigmaClientId() || '');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scopes?.join(' ') || FIGMA_OAUTH_CONFIG.scopes);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  
  return url.toString();
}

/**
 * Exchange authorization code for access token
 * 
 * @param code - Authorization code from callback
 * @param codeVerifier - PKCE code verifier
 * @param redirectUri - Same redirect URI used in auth request
 * @returns Token response
 */
export async function exchangeCodeForToken(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<FigmaTokenResponse> {
  const clientId = getFigmaClientId();
  const clientSecret = getFigmaClientSecret();
  
  if (!clientId || !clientSecret) {
    throw new Error('Figma OAuth credentials not configured');
  }
  
  const tokenUrl = FIGMA_OAUTH_CONFIG.tokenUrl;
  
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
    code: params.code,
    code_verifier: params.codeVerifier,
  });
  
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`Token exchange failed: ${error.error || response.status}`);
  }
  
  return response.json();
}

/**
 * Refresh access token
 */
export async function refreshToken(params: {
  refreshToken: string;
}): Promise<FigmaTokenResponse> {
  const clientId = getFigmaClientId();
  const clientSecret = getFigmaClientSecret();
  
  if (!clientId || !clientSecret) {
    throw new Error('Figma OAuth credentials not configured');
  }
  
  const tokenUrl = FIGMA_OAUTH_CONFIG.tokenUrl;
  
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  });
  
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`Token refresh failed: ${error.error || response.status}`);
  }
  
  return response.json();
}

/**
 * Figma OAuth token response
 */
export interface FigmaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'Bearer';
  scope: string;
}

/**
 * Store OAuth token data (to be implemented with database)
 */
export interface FigmaTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  userId: number;
}

/**
 * Check if token is expired or about to expire
 */
export function isTokenExpired(tokenData: FigmaTokenData, bufferMinutes: number = 5): boolean {
  const now = new Date();
  const expiryWithBuffer = new Date(tokenData.expiresAt.getTime() - bufferMinutes * 60 * 1000);
  return now >= expiryWithBuffer;
}

/**
 * Calculate token expiry date
 */
export function calculateExpiryDate(expiresIn: number): Date {
  return new Date(Date.now() + expiresIn * 1000);
}
