/**
 * Check Auth0 Session and Create Local Session
 * 
 * This endpoint checks if the user has an Auth0 session and creates a local
 * session for them if they do. This bridges the gap between Auth0 authentication
 * and the app's local session system.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { getLocalUserIdFromAuth0, mapAuth0UserId } from '@/lib/oauth/connections';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Check if user has an Auth0 session
    const session = await auth0.getSession(request);
    
    if (!session?.user) {
      // No Auth0 session
      return NextResponse.json({ success: false, message: 'No Auth0 session' }, { status: 401 });
    }
    
    const auth0UserId = session.user.sub;
    const email = session.user.email;
    
    if (!auth0UserId || !email) {
      return NextResponse.json({ error: 'Invalid Auth0 session' }, { status: 400 });
    }
    
    console.log('[Auth0 Session Check] Found Auth0 session for:', email);
    
    // Get or create local user mapping
    let localUserId = await getLocalUserIdFromAuth0(auth0UserId);
    
    if (!localUserId) {
      // Try to find existing local user by email and create mapping
      const { getDatabase } = await import('@/lib/database/connection');
      const db = getDatabase();
      
      if (db) {
        const userRow = db.prepare('SELECT id FROM users WHERE email = ? AND is_active = TRUE').get(email) as { id: number } | undefined;
        
        if (userRow) {
          // Map existing user to Auth0
          await mapAuth0UserId(userRow.id, auth0UserId);
          localUserId = userRow.id;
          console.log('[Auth0 Session Check] Mapped existing user to Auth0:', localUserId);
        } else {
          // Create new user via register
          const { authService } = await import('@/lib/auth/auth-service');
          const registerResult = await authService.register({
            email,
            password: crypto.randomUUID(), // Random password - user logged in via OAuth
            username: email.split('@')[0],
            emailVerified: true,
          });
          
          if (registerResult.success && registerResult.user) {
            localUserId = registerResult.user.id;
            await mapAuth0UserId(localUserId, auth0UserId);
            console.log('[Auth0 Session Check] Created new user and mapped to Auth0:', localUserId);
          } else {
            return NextResponse.json({ error: 'Failed to create user: ' + registerResult.error }, { status: 500 });
          }
        }
      }
    }
    
    // Create local session
    const { authService } = await import('@/lib/auth/auth-service');
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    
    const sessionResult = await authService.createSessionForUser(localUserId, {
      ipAddress,
      userAgent,
    });
    
    if (!sessionResult.success || !sessionResult.sessionId) {
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }
    
    console.log('[Auth0 Session Check] Created local session for user:', localUserId);
    
    // Get user info
    const user = await authService.getUserById(localUserId);
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    // Return response with session cookie
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        isActive: user.isActive,
        subscriptionTier: user.subscriptionTier,
        emailVerified: user.emailVerified,
      },
    });
    
    response.cookies.set('session_id', sessionResult.sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });
    
    return response;
  } catch (error: any) {
    console.error('[Auth0 Session Check] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}
