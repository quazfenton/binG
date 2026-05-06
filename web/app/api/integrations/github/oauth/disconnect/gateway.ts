/**
 * Disconnect GitHub
 * 
 * Remove GitHub connection from user account.
 */

import { NextRequest, NextResponse } from 'next/server';


import { auth0 } from '@/lib/auth0';
import { disconnectGitHub } from '@/lib/github/github-oauth';
import { getLocalUserIdFromAuth0 } from '@/lib/oauth/connections';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    // Get local user ID from Auth0
    const auth0UserId = session.user.sub;
    const localUserId = await getLocalUserIdFromAuth0(auth0UserId);
    
    if (!localUserId) {
      return NextResponse.json({ error: 'Local user not found' }, { status: 404 });
    }
    
    // Disconnect GitHub
    const success = disconnectGitHub(localUserId);
    
    if (success) {
      return NextResponse.json({ success: true, message: 'GitHub disconnected' });
    } else {
      return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
    }
  } catch (error: any) {
    console.error('[GitHub Disconnect] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}
