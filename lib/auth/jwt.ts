import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';

// CRITICAL FIX: Enforce JWT_SECRET in production
const JWT_SECRET = process.env.JWT_SECRET;

// Validate JWT_SECRET is set in production
if (process.env.NODE_ENV === 'production' && !JWT_SECRET) {
  console.error('❌ CRITICAL: JWT_SECRET is not configured in production!');
  console.error('This is a critical security vulnerability. Set JWT_SECRET environment variable immediately.');
  throw new Error('JWT_SECRET must be set in production environment');
}

// Fallback for development only (with warning)
if (!JWT_SECRET) {
  console.warn('⚠️ WARNING: JWT_SECRET not configured. Using development default. DO NOT USE IN PRODUCTION.');
}

const DEVELOPMENT_SECRET = 'your-secret-key-change-in-production';
const SECRET = JWT_SECRET || DEVELOPMENT_SECRET;

export interface AuthResult {
  success: boolean;
  userId?: string;
  email?: string;
  error?: string;
}

export async function verifyAuth(request: NextRequest): Promise<AuthResult> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { success: false, error: 'No authorization header' };
    }

    const token = authHeader.substring(7);

    try {
      // CRITICAL FIX: Add validation options for JWT verification
      const decoded = jwt.verify(token, SECRET, {
        algorithms: ['HS256'], // Enforce specific algorithm
        issuer: 'bing-app', // Validate issuer
        audience: 'bing-users', // Validate audience
      }) as any;
      
      return {
        success: true,
        userId: decoded.userId,
        email: decoded.email
      };
    } catch (jwtError) {
      const error = jwtError instanceof Error ? jwtError : new Error('JWT verification failed');
      
      // Provide specific error messages for debugging
      if (error.name === 'TokenExpiredError') {
        return { success: false, error: 'Token has expired' };
      } else if (error.name === 'InvalidSignatureError') {
        return { success: false, error: 'Invalid token signature' };
      } else if (error.name === 'JsonWebTokenError') {
        return { success: false, error: 'Invalid token format' };
      }
      
      return { success: false, error: 'Invalid token' };
    }
  } catch (error) {
    return { success: false, error: 'Authentication failed' };
  }
}

export function generateToken(payload: { userId: string; email: string; type?: string }): string {
  const expiresIn = payload.type === 'password_reset' ? '1h' : '7d';
  
  // Add issuer and audience claims for better security
  const fullPayload = {
    ...payload,
    iss: 'bing-app',
    aud: 'bing-users',
  };
  
  return jwt.sign(fullPayload, SECRET, { 
    expiresIn,
    algorithm: 'HS256', // Explicitly specify algorithm
  });
}
