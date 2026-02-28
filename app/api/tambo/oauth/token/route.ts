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
 */
async function verifyUserJWT(token: string): Promise<{
  valid: boolean;
  userId?: string;
  email?: string;
  error?: string;
}> {
  try {
    const JWT_SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET;
    
    if (!JWT_SECRET) {
      // In development, accept any valid JWT structure
      if (process.env.NODE_ENV === 'development') {
        // Decode without verification for dev
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
      return { valid: false, error: 'JWT_SECRET not configured' };
    }

    const decoded = verify(token, JWT_SECRET, {
      algorithms: ['HS256', 'RS256'],
    }) as any;

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
  
  const TAMBO_SECRET = process.env.TAMBO_API_KEY || process.env.JWT_SECRET || 'tambo-dev-secret';
  
  const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
  
  const tamboToken = sign(
    {
      sub: userId,
      email,
      scope: 'threads:read threads:write components:render tools:execute',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(expiresAt / 1000),
    },
    TAMBO_SECRET,
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
