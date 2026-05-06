import { NextRequest, NextResponse } from 'next/server';


import { toolAuthManager } from '@/lib/tools/tool-authorization-manager';
import { getAccessTokenForConnection, AUTH0_CONNECTIONS } from '@/lib/auth0';

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

interface NotificationItem {
  id: string;
  content: string;
  type: string;
  source: string;
  author?: string;
  timestamp: string;
  url?: string;
  priority?: 'low' | 'normal' | 'high';
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------
// Token Helper - unified token retrieval across providers
// ---------------------------------------------------------------------

async function getProviderToken(
  userId: string,
  provider: string,
  toolName?: string
): Promise<{ token: string | null; source: string }> {
  // Map provider to tool name if not provided
  const toolMap: Record<string, string> = {
    discord: 'discord.read_messages',
    gmail: 'gmail.read',
    google: 'gmail.read',
    slack: 'slack.read_messages',
    github: 'github.list_repos',
    twitter: 'twitter.read',
  };

  const tool = toolName || toolMap[provider] || `${provider}.read`;

  // Try via toolAuthManager first (Nango/Arcade/Composio)
  try {
    const tokenResult = await toolAuthManager.getToolToken(String(userId), tool);
    if (tokenResult.token) {
      return { token: tokenResult.token, source: tokenResult.source || 'integration' };
    }
  } catch {
    // Continue to fallback
  }

  // Fallback: try Auth0 connected accounts
  const auth0ConnectionMap: Record<string, string> = {
    discord: 'discord',
    gmail: 'google-oauth2',
    google: 'google-oauth2',
    slack: 'slack',
    github: 'github',
    twitter: 'twitter',
  };

  const auth0Connection = auth0ConnectionMap[provider];
  if (auth0Connection) {
    try {
      const token = await getAccessTokenForConnection(auth0Connection, userId);
      if (token) {
        return { token, source: 'auth0' };
      }
    } catch {
      // Continue
    }
  }

  return { token: null, source: 'none' };
}

// ---------------------------------------------------------------------
// Provider-specific fetchers
// ---------------------------------------------------------------------

/**
 * Fetch Discord notifications (recent messages from configured channels)
 * Requires Discord bot token or user token via OAuth
 */
async function fetchDiscordNotifications(userId: string): Promise<NotificationItem[]> {
  try {
    const { token } = await getProviderToken(userId, 'discord');

    if (!token) {
      return [];
    }

    // Fetch recent messages from a test channel (in production, would fetch from user's configured channels)
    // Using Discord API - requires channel ID and appropriate scopes
    const response = await fetch('https://discord.com/api/v10/channels/0/messages?limit=5', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.log('[Zine-Notifications] Discord API returned:', response.status);
      return [];
    }

    const messages = await response.json();
    if (!Array.isArray(messages)) return [];

    return messages.slice(0, 3).map((msg: any) => ({
      id: `discord-${msg.id}`,
      content: msg.content?.slice(0, 200) || '[No text content]',
      type: 'notification',
      source: 'discord',
      author: msg.author?.username,
      timestamp: msg.timestamp,
      url: `https://discord.com/channels/@me/${msg.channel_id}/${msg.id}`,
      priority: msg.mention_everyone ? 'high' : 'normal',
      metadata: { channelId: msg.channel_id },
    }));
  } catch (error) {
    console.log('[Zine-Notifications] Discord fetch error:', error);
    return [];
  }
}

/**
 * Fetch Gmail notifications (recent unread emails)
 * Requires Gmail OAuth scope
 */
async function fetchGmailNotifications(userId: string): Promise<NotificationItem[]> {
  try {
    let token: string | null = null;
    
    // Try via toolAuthManager for Gmail
    const tokenResult = await toolAuthManager.getToolToken(String(userId), 'gmail.read');
    token = tokenResult.token;

    if (!token) {
      // Try Auth0 Google connection
      try {
        token = await getAccessTokenForConnection('google-oauth2', userId);
      } catch {
        return [];
      }
    }

    if (!token) return [];

    // Fetch recent unread emails
    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=is:unread',
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.log('[Zine-Notifications] Gmail API returned:', response.status);
      return [];
    }

    const data = await response.json();
    const messages = data.messages || [];
    
    // Get details for each message
    const notifications: NotificationItem[] = [];
    for (const msg of messages.slice(0, 3)) {
      const detailResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );
      
      if (detailResponse.ok) {
        const detail = await detailResponse.json();
        const headers = detail.payload?.headers || [];
        
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || 'No Subject';
        const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
        const date = headers.find((h: any) => h.name === 'Date')?.value;
        
        notifications.push({
          id: `gmail-${msg.id}`,
          content: subject,
          type: 'notification',
          source: 'gmail',
          author: from,
          timestamp: date || detail.internalDate,
          url: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
          priority: detail.labelIds?.includes('IMPORTANT') ? 'high' : 'normal',
        });
      }
    }

    return notifications;
  } catch (error) {
    console.log('[Zine-Notifications] Gmail fetch error:', error);
    return [];
  }
}

/**
 * Fetch Slack notifications (recent messages from configured channels)
 */
async function fetchSlackNotifications(userId: string): Promise<NotificationItem[]> {
  try {
    let token: string | null = null;
    
    // Try via toolAuthManager
    const tokenResult = await toolAuthManager.getToolToken(String(userId), 'slack.read_messages');
    token = tokenResult.token;

    if (!token) return [];

    // Fetch recent messages from user's channels
    // First get the user's DMs and channels
    const conversationsResponse = await fetch(
      'https://slack.com/api/conversations.list?types=im,mpim,public_channel,private_channel&limit=20',
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!conversationsResponse.ok) return [];
    
    const conversationsData = await conversationsResponse.json();
    const channels = conversationsData.channels || [];
    
    // Get recent messages from first few channels
    const notifications: NotificationItem[] = [];
    
    for (const channel of channels.slice(0, 2)) {
      const messagesResponse = await fetch(
        `https://slack.com/api/conversations.history?channel=${channel.id}&limit=3`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      if (messagesResponse.ok) {
        const messagesData = await messagesResponse.json();
        const messages = messagesData.messages || [];
        
        for (const msg of messages) {
          notifications.push({
            id: `slack-${msg.ts}`,
            content: msg.text?.slice(0, 200) || '[No text]',
            type: 'notification',
            source: 'slack',
            author: msg.user,
            timestamp: new Date(Number(msg.ts) * 1000).toISOString(),
            url: `https://slack.com/archives/${channel.id}/p${msg.ts.replace('.', '')}`,
            priority: msg.is_starred ? 'high' : 'normal',
            metadata: { channel: channel.name },
          });
        }
      }
      
      if (notifications.length >= 3) break;
    }

    return notifications.slice(0, 3);
  } catch (error) {
    console.log('[Zine-Notifications] Slack fetch error:', error);
    return [];
  }
}

/**
 * Fetch GitHub notifications (notifications for the user)
 */
async function fetchGitHubNotifications(userId: string): Promise<NotificationItem[]> {
  try {
    let token: string | null = null;
    
    // Try via toolAuthManager
    const tokenResult = await toolAuthManager.getToolToken(String(userId), 'github.list_repos');
    token = tokenResult.token;

    if (!token) {
      // Try Auth0 GitHub connection
      try {
        token = await getAccessTokenForConnection(AUTH0_CONNECTIONS.GITHUB, userId);
      } catch {
        return [];
      }
    }

    if (!token) return [];

    // Fetch notifications (GitHub Notifications API)
    const response = await fetch(
      'https://api.github.com/notifications?all=false&participating=false&per_page=5',
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (!response.ok) {
      console.log('[Zine-Notifications] GitHub API returned:', response.status);
      return [];
    }

    const notifications = await response.json();
    if (!Array.isArray(notifications)) return [];

    return notifications.slice(0, 3).map((notif: any) => ({
      id: `github-${notif.id}`,
      content: notif.subject?.title || 'No title',
      type: notif.subject?.type === 'Issue' ? 'announcement' : 'notification',
      source: 'github',
      author: notif.repository?.full_name,
      timestamp: notif.updated_at,
      url: notif.subject?.url 
        ? notif.subject.url.replace('api.github.com/repos', 'github.com').replace('/pulls/', '/pull/').replace('/issues/', '/issues/')
        : notif.repository?.html_url,
      priority: notif.unread ? 'high' : 'normal',
      metadata: { 
        reason: notif.reason,
        type: notif.subject?.type,
      },
    }));
  } catch (error) {
    console.log('[Zine-Notifications] GitHub fetch error:', error);
    return [];
  }
}

/**
 * Fetch Twitter/X notifications (if connected)
 */
async function fetchTwitterNotifications(userId: string): Promise<NotificationItem[]> {
  // Twitter API v2 requires elevated access - return mock for now
  // In production, would use OAuth token to fetch mentions/timeline
  return [];
}

// ---------------------------------------------------------------------
// Main fetch handler - gets all connected provider notifications
// ---------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const userId = searchParams.get('userId') || '';
  const provider = searchParams.get('provider'); // Optional: fetch specific provider only

  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'Invalid userId' },
      { status: 400 }
    );
  }

  try {
    // Get connected providers
    const connectionResult = await toolAuthManager.listConnections(userId);
    const connectedProviders = connectionResult.success ? connectionResult.providers : [];

    // If specific provider requested, only fetch from that one
    const providersToFetch = provider 
      ? [provider] 
      : connectedProviders;

    const allNotifications: NotificationItem[] = [];

    // Fetch from each connected provider
    for (const p of providersToFetch) {
      let notifs: NotificationItem[] = [];
      
      switch (p) {
        case 'discord':
          notifs = await fetchDiscordNotifications(userId);
          break;
        case 'gmail':
        case 'google':
          notifs = await fetchGmailNotifications(userId);
          break;
        case 'slack':
          notifs = await fetchSlackNotifications(userId);
          break;
        case 'github':
          notifs = await fetchGitHubNotifications(userId);
          break;
        case 'twitter':
          notifs = await fetchTwitterNotifications(userId);
          break;
        default:
          console.log(`[Zine-Notifications] Unknown provider: ${p}`);
      }

      allNotifications.push(...notifs);
    }

    // Sort by timestamp (newest first)
    allNotifications.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeB - timeA;
    });

    return NextResponse.json({
      success: true,
      notifications: allNotifications.slice(0, 20),
      count: allNotifications.length,
      connectedProviders,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Zine-Notifications] Fetch error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------
// POST handler - fetch from specific source URL (custom webhook style)
// ---------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, provider, userId, sourceUrl } = body;

    if (!userId) {
      return NextResponse.json({ success: false, error: 'Invalid userId' }, { status: 400 });
    }

    // Fetch custom URL with stored OAuth token
    if (action === 'fetch-with-token' && sourceUrl && provider) {
      let token: string | null = null;
      
      // Get token for the provider
      const tokenResult = await toolAuthManager.getToolToken(userId, `${provider}.read`);
      token = tokenResult.token;

      if (!token) {
        return NextResponse.json(
          { success: false, error: `No token available for ${provider}` },
          { status: 401 }
        );
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(sourceUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        const data = await response.json();

        return NextResponse.json({
          success: true,
          data,
          provider,
          fetchedAt: new Date().toISOString(),
        });
      } catch (error) {
        return NextResponse.json(
          { success: false, error: 'Failed to fetch from source' },
          { status: 502 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: 'Unknown action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Zine-Notifications] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
