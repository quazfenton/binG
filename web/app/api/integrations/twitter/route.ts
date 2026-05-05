/**
 * Twitter/X Integration API
 *
 * Provides Twitter/X operations via Auth0 connection tokens:
 * - GET /api/integrations/twitter/tweets - List user's tweets
 * - GET /api/integrations/twitter/search - Search Twitter
 * - POST /api/integrations/twitter/tweet - Post a new tweet
 *
 * Uses Auth0 connection tokens for authenticated access.
 * 
 * Auth0 Integration:
 * - Users connect via /auth/connect?connection=twitter
 * - Tokens stored in Auth0 Token Vault
 * - Complementary to Nango/Composio/Arcade (not a replacement)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAccessTokenForConnection, AUTH0_CONNECTIONS } from '@/lib/auth0';



/**
 * Twitter API v2 base URL
 */
const TWITTER_API = 'https://api.twitter.com/2';

/**
 * Fetch with Twitter token
 */
async function fetchTwitter<T>(endpoint: string, token: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  const response = await fetch(`${TWITTER_API}${endpoint}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || error.title || `Twitter API error: ${response.status}`);
  }

  return response.json();
}

/**
 * GET /api/integrations/twitter
 *
 * Query params:
 * - action: 'tweets' | 'search' | 'me' (default: 'me')
 * - query: string (for search action)
 * - maxResults: number (default: 10)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action') || 'me';
    const query = searchParams.get('query');
    const maxResults = searchParams.get('maxResults') || '10';

    // Try to get Auth0 Twitter token
    const auth0Token = await getAccessTokenForConnection(AUTH0_CONNECTIONS.TWITTER);

    if (!auth0Token) {
      return NextResponse.json({
        error: 'Twitter not connected',
        requiresAuth: true,
        connection: 'twitter',
        connectUrl: '/auth/connect?connection=twitter',
      }, { status: 401 });
    }

    // Route to appropriate action
    switch (action) {
      case 'me':
        return await handleGetMe(auth0Token);

      case 'tweets':
        return await handleGetTweets(auth0Token, maxResults);

      case 'search':
        if (!query) {
          return NextResponse.json({ error: 'query parameter required for search' }, { status: 400 });
        }
        return await handleSearch(auth0Token, query, maxResults);

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('[Twitter Integration] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to process Twitter request'
    }, { status: 500 });
  }
}

/**
 * Get authenticated user's profile
 */
async function handleGetMe(token: string) {
  const user = await fetchTwitter<{ data: { id: string; name: string; username: string } }>(
    '/users/me',
    token
  );

  return NextResponse.json({
    success: true,
    action: 'me',
    user: user.data,
    authSource: 'auth0',
  });
}

/**
 * Get user's recent tweets
 */
async function handleGetTweets(token: string, maxResults: string) {
  // First get user ID
  const me = await fetchTwitter<{ data: { id: string } }>('/users/me', token);
  const userId = me.data.id;

  // Then get tweets
  const tweets = await fetchTwitter<{ data: Array<{ id: string; text: string; created_at: string; public_metrics: { retweet_count: number; reply_count: number; like_count: number; quote_count: number } }> }>(
    `/users/${userId}/tweets?max_results=${maxResults}&tweet.fields=created_at,public_metrics`,
    token
  );

  return NextResponse.json({
    success: true,
    action: 'tweets',
    tweets: tweets.data.map(t => ({
      id: t.id,
      text: t.text,
      createdAt: t.created_at,
      metrics: t.public_metrics,
    })),
    authSource: 'auth0',
  });
}

/**
 * Search Twitter
 */
async function handleSearch(token: string, query: string, maxResults: string) {
  const searchResults = await fetchTwitter<{ data: Array<{ id: string; text: string; author_id: string; created_at: string }> }>(
    `/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${maxResults}`,
    token
  );

  return NextResponse.json({
    success: true,
    action: 'search',
    query,
    tweets: searchResults.data.map(t => ({
      id: t.id,
      text: t.text,
      authorId: t.author_id,
      createdAt: t.created_at,
    })),
    authSource: 'auth0',
  });
}

/**
 * POST /api/integrations/twitter
 *
 * Body:
 * - action: 'tweet' | 'reply'
 * - text: string (tweet content)
 * - replyToTweetId?: string (for replies)
 */
export async function POST(request: NextRequest) {
  // Handle malformed JSON separately
  let body: any;
  try {
    body = await request.json();
  } catch (error: any) {
    console.warn('[Twitter Integration] Malformed JSON:', error.message);
    return NextResponse.json(
      { 
        error: 'Invalid JSON in request body',
        details: error.message 
      }, 
      { status: 400 }
    );
  }

  try {
    const { action, text, replyToTweetId } = body;

    // Try to get Auth0 Twitter token
    const auth0Token = await getAccessTokenForConnection(AUTH0_CONNECTIONS.TWITTER);

    if (!auth0Token) {
      return NextResponse.json({
        error: 'Twitter not connected',
        requiresAuth: true,
        connection: 'twitter',
        connectUrl: '/auth/connect?connection=twitter',
      }, { status: 401 });
    }

    if (action === 'tweet') {
      if (!text) {
        return NextResponse.json({ error: 'text is required' }, { status: 400 });
      }

      const tweetData: Record<string, any> = { text };
      if (replyToTweetId) {
        tweetData.reply = { in_reply_to_tweet_id: replyToTweetId };
      }

      const result = await fetchTwitter<{ data: { id: string; text: string } }>(
        '/tweets',
        auth0Token,
        {
          method: 'POST',
          body: JSON.stringify(tweetData),
        }
      );

      return NextResponse.json({
        success: true,
        action: 'tweet',
        tweet: result.data,
        authSource: 'auth0',
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[Twitter Integration] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to process Twitter request'
    }, { status: 500 });
  }
}
