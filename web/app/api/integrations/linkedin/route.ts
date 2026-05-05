/**
 * LinkedIn Integration API
 *
 * Provides LinkedIn operations via Auth0 connection tokens:
 * - GET /api/integrations/linkedin/profile - Get user profile
 * - GET /api/integrations/linkedin/posts - List user's posts
 * - POST /api/integrations/linkedin/post - Create a post
 *
 * Uses Auth0 connection tokens for authenticated access.
 * 
 * Auth0 Integration:
 * - Users connect via /auth/connect?connection=linkedin
 * - Tokens stored in Auth0 Token Vault
 * - Complementary to Nango/Composio/Arcade (not a replacement)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAccessTokenForConnection, AUTH0_CONNECTIONS } from '@/lib/auth0';

export const runtime = 'edge';

/**
 * LinkedIn API base URL
 */
const LINKEDIN_API = 'https://api.linkedin.com/v2';

/**
 * Fetch with LinkedIn token
 */
async function fetchLinkedIn<T>(endpoint: string, token: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
  };

  const response = await fetch(`${LINKEDIN_API}${endpoint}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  if (response.status === 204) {
    return {} as T;
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `LinkedIn API error: ${response.status}`);
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * GET /api/integrations/linkedin
 * 
 * Query params:
 * - action: 'profile' | 'posts' | 'connections' (default: 'profile')
 * - count: number (default: 10, for posts/connections)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action') || 'profile';
    const rawCount = searchParams.get('count');
    const countValue = rawCount ? Number.parseInt(rawCount, 10) : 10;
    if (!Number.isFinite(countValue) || countValue < 1 || countValue > 100) {
      return NextResponse.json({ error: 'count must be an integer between 1 and 100' }, { status: 400 });
    }
    const count = String(countValue);

    // Try to get Auth0 LinkedIn token
    const auth0Token = await getAccessTokenForConnection(AUTH0_CONNECTIONS.LINKEDIN);
    
    if (!auth0Token) {
      return NextResponse.json({
        error: 'LinkedIn not connected',
        requiresAuth: true,
        connection: 'linkedin',
        connectUrl: '/auth/connect?connection=linkedin',
      }, { status: 401 });
    }

    // Route to appropriate action
    switch (action) {
      case 'profile':
        return await handleGetProfile(auth0Token);
      
      case 'posts':
        return await handleGetPosts(auth0Token, count);
      
      case 'connections':
        return await handleGetConnections(auth0Token, count);
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('[LinkedIn Integration] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to process LinkedIn request'
    }, { status: 500 });
  }
}

/**
 * Get authenticated user's profile
 */
async function handleGetProfile(token: string) {
  const profile: any = await fetchLinkedIn('/me', token);

  // Extract profile picture URL if available
  let profilePicture: string | null = null;
  if (profile.profilePicture?.['displayImage~']?.elements?.[0]?.identifiers?.[0]?.identifier) {
    profilePicture = profile.profilePicture['displayImage~'].elements[0].identifiers[0].identifier;
  }

  return NextResponse.json({
    success: true,
    action: 'profile',
    profile: {
      id: profile.id,
      firstName: profile.localizedFirstName || '',
      lastName: profile.localizedLastName || '',
      headline: profile.headline || '',
      profilePicture,
    },
    authSource: 'auth0',
  });
}

/**
 * Get user's recent posts
 */
async function handleGetPosts(token: string, count: string) {
  // Get user's URN
  const me = await fetchLinkedIn<{ id: string }>('/me', token);
  const personUrn = `urn:li:person:${me.id}`;

  // Get posts (using shares endpoint for user posts)
  const posts = await fetchLinkedIn<{ elements: Array<{ id: string; text?: { text: string }; created?: { time: number } }> }>(
    `/shares?q=owners&owners=${encodeURIComponent(personUrn)}&count=${count}`,
    token
  );

  return NextResponse.json({
    success: true,
    action: 'posts',
    posts: (posts.elements || []).map((p: any) => ({
      id: p.id,
      text: p.text?.text || '',
      createdAt: p.created?.time ? new Date(p.created.time).toISOString() : null,
    })),
    authSource: 'auth0',
  });
}

/**
 * Get user's connections count (LinkedIn API doesn't provide full connection list)
 */
async function handleGetConnections(token: string, count: string) {
  // LinkedIn API v2 doesn't provide full connection list, only count
  // This is a limitation of their API
  const connections = await fetchLinkedIn<{ elements: Array<{ id: string }>; paging?: { total: number } }>(
    `/connections?count=${count}`,
    token
  );

  return NextResponse.json({
    success: true,
    action: 'connections',
    count: typeof connections.paging?.total === 'number'
      ? connections.paging.total
      : (connections.elements || []).length,
    authSource: 'auth0',
  });
}

/**
 * POST /api/integrations/linkedin
 *
 * Body:
 * - action: 'post'
 * - text: string (post content)
 */
export async function POST(request: NextRequest) {
  // Handle malformed JSON separately
  let body: any;
  try {
    body = await request.json();
  } catch (error: any) {
    console.warn('[LinkedIn Integration] Malformed JSON:', error.message);
    return NextResponse.json(
      { 
        error: 'Invalid JSON in request body',
        details: error.message 
      }, 
      { status: 400 }
    );
  }

  try {
    const { action, text } = body;

    // Try to get Auth0 LinkedIn token
    const auth0Token = await getAccessTokenForConnection(AUTH0_CONNECTIONS.LINKEDIN);

    if (!auth0Token) {
      return NextResponse.json({
        error: 'LinkedIn not connected',
        requiresAuth: true,
        connection: 'linkedin',
        connectUrl: '/auth/connect?connection=linkedin',
      }, { status: 401 });
    }

    if (action === 'post') {
      if (!text) {
        return NextResponse.json({ error: 'text is required' }, { status: 400 });
      }

      // Get user's URN
      const me = await fetchLinkedIn<{ id: string }>('/me', auth0Token);
      const personUrn = `urn:li:person:${me.id}`;

      // Create post
      const result = await fetchLinkedIn<{ id: string }>(
        '/shares',
        auth0Token,
        {
          method: 'POST',
          body: JSON.stringify({
            owner: personUrn,
            text: { text },
            visibility: 'PUBLIC',
          }),
        }
      );

      return NextResponse.json({
        success: true,
        action: 'post',
        post: { id: result.id },
        authSource: 'auth0',
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[LinkedIn Integration] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to process LinkedIn request'
    }, { status: 500 });
  }
}
