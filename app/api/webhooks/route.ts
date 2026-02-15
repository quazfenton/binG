import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const provider = req.nextUrl.searchParams.get('provider');

    if (provider === 'arcade') {
      return handleArcadeWebhook(body);
    }

    if (provider === 'nango') {
      return handleNangoWebhook(body);
    }

    return NextResponse.json({ error: 'Unknown webhook provider' }, { status: 400 });
  } catch (error: any) {
    console.error('[Webhook] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function handleArcadeWebhook(body: any): NextResponse {
  const { user_id, tool_name, status, auth_id } = body;
  console.log(`[Webhook/Arcade] user=${user_id} tool=${tool_name} status=${status} auth=${auth_id}`);
  return NextResponse.json({ success: true });
}

function handleNangoWebhook(body: any): NextResponse {
  const { connectionId, providerConfigKey, type } = body;
  console.log(`[Webhook/Nango] connection=${connectionId} provider=${providerConfigKey} type=${type}`);
  return NextResponse.json({ success: true });
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'webhooks' });
}
