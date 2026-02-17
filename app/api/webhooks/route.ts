import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { oauthService } from '@/lib/auth/oauth-service';

function verifyWebhookSignature(body: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  return signature === expected || signature === `sha256=${expected}`;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const provider = req.nextUrl.searchParams.get('provider');

    if (provider === 'arcade') {
      const signature = req.headers.get('x-arcade-signature');
      if (!verifyWebhookSignature(rawBody, signature, process.env.ARCADE_WEBHOOK_SECRET)) {
        console.warn('[Webhook/Arcade] Invalid signature');
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
      }
      return await handleArcadeWebhook(JSON.parse(rawBody));
    }

    if (provider === 'nango') {
      const signature = req.headers.get('x-nango-signature');
      if (!verifyWebhookSignature(rawBody, signature, process.env.NANGO_WEBHOOK_SECRET)) {
        console.warn('[Webhook/Nango] Invalid signature');
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
      }
      return await handleNangoWebhook(JSON.parse(rawBody));
    }

    return NextResponse.json({ error: 'Unknown webhook provider' }, { status: 400 });
  } catch (error: any) {
    console.error('[Webhook] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handleArcadeWebhook(body: any): Promise<NextResponse> {
  // According to Arcade documentation, Arcade handles the OAuth flow internally
  // and the webhook contains information about the authorization status
  const { user_id, tool_name, status, auth_id, connection_data } = body;
  console.log(`[Webhook/Arcade] user=${user_id} tool=${tool_name} status=${status} auth=${auth_id}`);

  if (status === 'completed' && user_id) {
    try {
      // Map Arcade tool names to our internal provider names
      const providerMap: Record<string, string> = {
        'Gmail': 'google',
        'GoogleDocs': 'google',
        'GoogleSheets': 'google',
        'GoogleCalendar': 'google',
        'GoogleDrive': 'google',
        'GoogleMaps': 'google',
        'GoogleNews': 'google',
        'Outlook': 'microsoft',
        'Notion': 'notion',
        'Dropbox': 'dropbox',
        'Exa': 'exa',
        'Twilio': 'twilio',
        'Slack': 'slack',
        'Discord': 'discord',
        'Twitter': 'twitter',
        'Reddit': 'reddit',
        'Spotify': 'spotify',
        'Vercel': 'vercel',
        'Railway': 'railway',
      };

      // Extract provider from tool name (e.g., "Gmail.SendEmail" -> "Gmail")
      const toolPrefix = tool_name.split('.')[0];
      const provider = providerMap[toolPrefix] || toolPrefix.toLowerCase();

      // Arcade handles token storage internally, so we just need to record that the user
      // has authorized this provider/service combination
      // For Arcade, we'll store minimal information since Arcade manages the tokens
      await oauthService.saveConnection({
        userId: parseInt(user_id, 10),
        provider,
        providerAccountId: `arcade_${user_id}`, // Unique identifier for Arcade connection
        providerDisplayName: `${toolPrefix} via Arcade`,
        accessToken: '', // Arcade manages tokens internally
        refreshToken: '', // Arcade manages tokens internally
        expiresIn: 0, // Not applicable for Arcade
        scopes: [], // Scopes managed by Arcade
      });

      console.log(`[Webhook/Arcade] Authorization recorded for user ${user_id}, provider ${provider}`);
    } catch (saveError) {
      console.error('[Webhook/Arcade] Error recording authorization:', saveError);
      return NextResponse.json({ error: 'Failed to record authorization', details: saveError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

async function handleNangoWebhook(body: any): Promise<NextResponse> {
  // According to Nango documentation, successful authorization webhooks look like:
  // {
  //   "type": "auth",
  //   "operation": "creation",
  //   "success": true,
  //   "connectionId": "<CONNECTION-ID>",
  //   "tags": {
  //     "end_user_id": "<END-USER-ID>",
  //     "end_user_email": "<END-USER-EMAIL>",
  //     "organization_id": "<ORGANIZATION-ID>"
  //   },
  //   ...
  // }
  const { type, operation, success, connectionId, providerConfigKey, tags } = body;
  console.log(`[Webhook/Nango] connection=${connectionId} provider=${providerConfigKey} type=${type} operation=${operation} success=${success} tags=${JSON.stringify(tags)}`);

  if (success && type === 'auth' && operation === 'creation' && tags) {
    try {
      // Map Nango provider config keys to our internal provider names
      const providerMap: Record<string, string> = {
        'google': 'google',
        'github': 'github',
        'slack': 'slack',
        'notion': 'notion',
        'discord': 'discord',
        'twitter': 'twitter',
        'reddit': 'reddit',
        'spotify': 'spotify',
        'twilio': 'twilio',
        'vercel': 'vercel',
        'railway': 'railway',
      };

      const provider = providerMap[providerConfigKey] || providerConfigKey.toLowerCase();

      // Extract user info from tags
      const userIdStr = tags.end_user_id || tags.userId || tags.user_id;
      if (!userIdStr) {
        console.error('[Webhook/Nango] No user ID found in tags:', tags);
        return NextResponse.json({ error: 'No user ID found in webhook tags' }, { status: 400 });
      }

      const userId = parseInt(userIdStr.toString(), 10);
      if (isNaN(userId)) {
        console.error('[Webhook/Nango] Invalid user ID:', userIdStr);
        return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
      }

      // For Nango, we store the connectionId which can be used to retrieve tokens later
      // Nango manages the actual tokens, we just need to associate the connectionId with our user
      await oauthService.saveConnection({
        userId,
        provider,
        providerAccountId: connectionId, // Nango's connection ID
        providerDisplayName: `${providerConfigKey} via Nango`,
        accessToken: '', // Nango manages tokens, we don't store them directly
        refreshToken: '', // Nango manages tokens, we don't store them directly
        expiresIn: 0, // Nango handles token refresh internally
        scopes: [], // Scopes managed by Nango
      });

      console.log(`[Webhook/Nango] Connection saved for user ${userId}, provider ${provider}, connectionId ${connectionId}`);
    } catch (saveError) {
      console.error('[Webhook/Nango] Error saving connection:', saveError);
      return NextResponse.json({ error: 'Failed to save connection', details: saveError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'webhooks' });
}
