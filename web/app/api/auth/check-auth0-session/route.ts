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

    console.log('[Auth0 Session Check] Found Auth0 session for user');

    // Get or create local user mapping
    let localUserId: number | null = null;
    
    try {
      localUserId = await getLocalUserIdFromAuth0(auth0UserId);
      console.log('[Auth0 Session Check] getLocalUserIdFromAuth0 returned:', localUserId);
    } catch (mapError: any) {
      console.error('[Auth0 Session Check] getLocalUserIdFromAuth0 error:', mapError.message);
      // Continue - we'll try to find by email
    }

    if (!localUserId) {
      // Try to find existing local user by email and create mapping
      try {
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
            // Create new user via register - OAuth users bypass email verification
            // since Google/Auth0 already verified their email
            const { authService } = await import('@/lib/auth/auth-service');
            // Generate a random password that meets requirements (uppercase, lowercase, number)
            // This is never used - OAuth users authenticate via their provider
            const randomPassword = 'OAuth' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
            
            // Register the user
            const registerResult = await authService.register({
              email,
              password: randomPassword,
              username: email.split('@')[0],
              emailVerified: true, // OAuth providers verify emails
            });

            if (registerResult.success && registerResult.user) {
              localUserId = registerResult.user.id;
              await mapAuth0UserId(localUserId, auth0UserId);
              console.log('[Auth0 Session Check] Created new user and mapped to Auth0:', localUserId);
              // Note: register() sets requiresVerification but we bypass it for OAuth users
              // by creating a session immediately below
            } else {
              console.error('[Auth0 Session Check] Register failed:', registerResult.error);
              return NextResponse.json({ error: 'Failed to create user: ' + registerResult.error }, { status: 500 });
            }
          }
        } else {
          return NextResponse.json({ error: 'Database not available' }, { status: 500 });
        }
      } catch (dbError: any) {
        console.error('[Auth0 Session Check] Database error:', dbError.message);
        return NextResponse.json({ error: 'Database error: ' + dbError.message }, { status: 500 });
      }
    }

    if (!localUserId) {
      return NextResponse.json({ error: 'Could not determine user ID' }, { status: 500 });
    }

    // Create local session
    try {
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

      // Generate JWT token for the user
      const { generateToken } = await import('@/lib/auth/jwt');
      const token = generateToken({
        userId: user.id.toString(),
        email: user.email,
      });

      // Return response with session cookie and token
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
        token,
      });

      response.cookies.set('session_id', sessionResult.sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60, // 7 days
        path: '/',
      });

      return response;
    } catch (sessionError: any) {
      console.error('[Auth0 Session Check] Session creation error:', sessionError.message);
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }
  } catch (error: any) {
    console.error('[Auth0 Session Check] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
