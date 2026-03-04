import { NextRequest, NextResponse } from 'next/server';
import {
  verifyBlaxelCallbackFromRequest,
  parseBlaxelCallbackPayload,
} from '@/lib/sandbox/providers/blaxel-callback-verify';

const CALLBACK_SECRET = process.env.BLAXEL_CALLBACK_SECRET;
const MAX_TIMESTAMP_DRIFT_S = 300; // 5 minutes

export async function POST(request: NextRequest) {
  if (!CALLBACK_SECRET) {
    console.error('[Blaxel Callback] BLAXEL_CALLBACK_SECRET not configured');
    return NextResponse.json(
      { error: 'Callback secret not configured' },
      { status: 500 },
    );
  }

  const rawBody = await request.text();
  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const timestamp = headers['x-blaxel-timestamp'];
  if (timestamp) {
    const drift = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
    if (drift > MAX_TIMESTAMP_DRIFT_S) {
      return NextResponse.json({ error: 'Timestamp too old' }, { status: 401 });
    }
  }

  const isValid = verifyBlaxelCallbackFromRequest(
    { body: rawBody, headers },
    CALLBACK_SECRET,
  );

  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = parseBlaxelCallbackPayload(rawBody);
  if (!payload) {
    return NextResponse.json(
      { error: 'Invalid payload format' },
      { status: 400 },
    );
  }

  console.log(
    `[Blaxel Callback] Received: status=${payload.status_code} length=${payload.response_length}`,
  );

  // TODO: Route payload to the appropriate sandbox/session handler.
  // This depends on how sandbox sessions track pending async executions.
  // For now, acknowledge receipt so Blaxel stops retrying.

  return NextResponse.json({ received: true });
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/blaxel/callback',
    configured: !!CALLBACK_SECRET,
  });
}
