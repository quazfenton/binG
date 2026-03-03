/**
 * Tambo OAuth Token Exchange API
 * 
 * Implements OAuth 2.0 Token Exchange per RFC 8693
 * Exchanges user JWT for Tambo-specific token
 * 
 * @see https://tambo.ai/docs/concepts/user-authentication
 * @see https://datatracker.ietf.org/doc/html/rfc8693
 */

import { NextRequest, NextResponse } from 'next/server';
import { verify } from 'jsonwebtoken';

export interface TokenExchangeRequest {
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange';
  subject_token: string;
  subject_token_type: 'urn:ietf:params:oauth:token-type:access_token';
  requested_token_type?: 'urn:ietf:params:oauth:token-type:access_token';
}

export interface TokenExchangeResponse {
  access_token: string;
  issued_token_type: 'urn:ietf:params:oauth:token-type:access_token';
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

/**
 * Verify JWT from OAuth provider
 * 
 * SECURITY: Never skip JWT verification in production.
 * Development mode requires explicit UNSAFE_SKIP_JWT_VERIFY=true flag.
 */
async function verifyUserJWT(token: string): Promise<{
  valid: boolean;
  userId?: string;
  email?: string;
  error?: string;
}> {
  try {
    const JWT_SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET;
    const SKIP_JWT_VERIFY = process.env.UNSAFE_SKIP_JWT_VERIFY === 'true';

    if (!JWT_SECRET) {
      // SECURITY: Never silently accept unverified JWTs based on NODE_ENV alone
      // Require explicit opt-in for development testing
      if (SKIP_JWT_VERIFY && process.env.NODE_ENV === 'development') {
        console.warn('[Tambo OAuth] ⚠️ SECURITY WARNING: JWT verification disabled. Only use in local development!');
        
        // Decode without verification for dev (explicit opt-in required)
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          Buffer.from(base64, 'base64').toString('utf-8')
            .split('').map(char =>
              '%' + ('00' + char.charCodeAt(0).toString(16)).slice(-2)
            ).join('')
        );
        const decoded = JSON.parse(jsonPayload);
        return {
          valid: true,
          userId: decoded.sub || decoded.userId || decoded.id,
          email: decoded.email || decoded.preferred_username,
        };
      }
      return { 
        valid: false, 
        error: 'JWT_SECRET not configured. Set JWT_SECRET or NEXTAUTH_SECRET environment variable.' 
      };
    }

    const decoded = verify(token, JWT_SECRET, {
      // SECURITY: Only accept HS256 (symmetric) algorithm
      // RS256 removed to prevent algorithm confusion attacks
      // See: https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE || 'user-access',
    }) as any;

    // Enforce token purpose/type to avoid token confusion
    if (decoded.token_use !== 'access') {
      return { valid: false, error: 'Invalid token type' };
    }

    return {
      valid: true,
      userId: decoded.sub || decoded.userId || decoded.id,
      email: decoded.email || decoded.preferred_username,
    };
    }

    return {
      valid: true,
      userId: decoded.sub || decoded.userId || decoded.id,
      email: decoded.email || decoded.preferred_username,
    };
    }

    return {
      valid: true,
      userId: decoded.sub || decoded.userId || decoded.id,
      email: decoded.email || decoded.preferred_username,
    };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || 'Invalid JWT',
    };
  }
}

/**
 * Exchange user JWT for Tambo token
 * 
 * In production, this would call Tambo's /oauth/token endpoint
 * For now, we create a signed token that identifies the user
 */
async function exchangeForTamboToken(
  userId: string,
  email?: string
): Promise<{ tamboToken: string; expiresAt: number }> {
  const { sign } = await import('jsonwebtoken');

  const TAMBO_SECRET = process.env.TAMBO_API_KEY || process.env.JWT_SECRET;
  
  // Require a configured secret in non-development environments
  if (!TAMBO_SECRET && process.env.NODE_ENV !== 'development') {
    throw new Error('TAMBO_API_KEY or JWT_SECRET environment variable is required');
  }
  
  // Use a secure default only in development
  const secret = TAMBO_SECRET || (process.env.NODE_ENV === 'development' ? 'tambo-dev-secret' : '');
  
  if (!secret) {
    throw new Error('Token signing secret is not configured');
  }

  const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

  const tamboToken = sign(
    {
      sub: userId,
      email,
      scope: 'threads:read threads:write components:render tools:execute',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(expiresAt / 1000),
    },
    secret,
    { algorithm: 'HS256' }
  );

  return { tamboToken, expiresAt };
}

/**
 * POST /api/tambo/oauth/token
 * 
 * Token exchange endpoint
 */
export async function POST(request: NextRequest) {
  try {
    const body: TokenExchangeRequest = await request.json();
    
    // Validate request
    if (!body.grant_type || body.grant_type !== 'urn:ietf:params:oauth:grant-type:token-exchange') {
      return NextResponse.json(
        { error: 'grant_type is required and must be urn:ietf:params:oauth:grant-type:token-exchange' },
        { status: 400 }
      );
    }
    
    if (!body.subject_token) {
      return NextResponse.json(
        { error: 'subject_token is required' },
        { status: 400 }
      );
    }
    
    // Verify user's JWT
    const verification = await verifyUserJWT(body.subject_token);
    
    if (!verification.valid) {
      return NextResponse.json(
        { error: 'Invalid user token', details: verification.error },
        { status: 401 }
      );
    }
    
    if (!verification.userId) {
      return NextResponse.json(
        { error: 'Could not extract user ID from token' },
        { status: 400 }
      );
    }
    
    // Exchange for Tambo token
    const { tamboToken, expiresAt } = await exchangeForTamboToken(
      verification.userId,
      verification.email
    );
    
    const response: TokenExchangeResponse = {
      access_token: tamboToken,
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      token_type: 'Bearer',
      expires_in: Math.floor((expiresAt - Date.now()) / 1000),
      scope: 'threads:read threads:write components:render tools:execute',
    };
    
    return NextResponse.json(response);
  } catch (error: any) {
    console.error('[Tambo OAuth] Token exchange failed:', error);
    return NextResponse.json(
      { error: 'Token exchange failed', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/tambo/oauth/token
 * 
 * Health check for token endpoint
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/tambo/oauth/token',
    supported_grant_types: ['urn:ietf:params:oauth:grant-type:token-exchange'],
  });
}
