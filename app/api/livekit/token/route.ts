import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

export async function POST(req: NextRequest) {
  try {
    // SECURITY: Require authentication to prevent unauthorized token generation
    const authResult = await resolveRequestAuth(req, {
      allowAnonymous: false,
    });
    
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { roomName } = await req.json();

    if (!roomName) {
      return NextResponse.json(
        { error: 'roomName is required' },
        { status: 400 }
      );
    }

    // Check if LiveKit is configured
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'LiveKit credentials not configured' },
        { status: 500 }
      );
    }

    // SECURITY: Derive identity from authenticated user ID, not user-supplied name
    // This prevents impersonation attacks
    const identity = `user_${authResult.userId}`;

    // Create access token
    const token = new AccessToken(apiKey, apiSecret, {
      identity,
      ttl: '5m',
    });

    // Add permissions
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return NextResponse.json({ token: await token.toJwt() });
  } catch (error: any) {
    console.error('[LiveKit Token] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate token' },
      { status: 500 }
    );
  }
}
