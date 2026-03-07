import { NextRequest, NextResponse } from 'next/server';
import {
  verifyBlaxelCallbackFromRequest,
  parseBlaxelCallbackPayload,
} from '@/lib/sandbox/providers/blaxel-callback-verify';
import { blaxelExecutionManager } from '@/lib/sandbox/providers/blaxel-execution-manager';

const CALLBACK_SECRET = process.env.BLAXEL_CALLBACK_SECRET;
const MAX_TIMESTAMP_DRIFT_S = 300; // 5 minutes

export async function POST(request: NextRequest) {
  // Validate callback secret is configured
  if (!CALLBACK_SECRET) {
    console.error('[Blaxel Callback] BLAXEL_CALLBACK_SECRET not configured');
    return NextResponse.json(
      { error: 'Callback secret not configured' },
      { status: 500 },
    );
  }

  // Validate content-type
  const contentType = request.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    console.warn('[Blaxel Callback] Invalid content-type:', contentType);
    return NextResponse.json(
      { error: 'Content-Type must be application/json' },
      { status: 400 },
    );
  }

  const rawBody = await request.text();
  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Validate timestamp drift
  const timestamp = headers['x-blaxel-timestamp'];
  if (timestamp) {
    const drift = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
    if (drift > MAX_TIMESTAMP_DRIFT_S) {
      console.warn('[Blaxel Callback] Rejected timestamp with drift:', {
        driftSeconds: drift,
        maxAllowed: MAX_TIMESTAMP_DRIFT_S,
        timestamp,
      });
      return NextResponse.json({ error: 'Timestamp too old' }, { status: 401 });
    }
  } else {
    console.warn('[Blaxel Callback] Missing timestamp header');
    return NextResponse.json({ error: 'Missing timestamp header' }, { status: 400 });
  }

  // Verify webhook signature
  const isValid = verifyBlaxelCallbackFromRequest(
    { body: rawBody, headers },
    CALLBACK_SECRET,
  );

  if (!isValid) {
    console.warn('[Blaxel Callback] Invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Parse and validate payload
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

  // Extract execution context from headers or payload
  const executionId = headers['x-blaxel-execution-id'];
  const agentId = headers['x-blaxel-agent-id'];
  const sandboxId = headers['x-blaxel-sandbox-id'];

  // Route callback to pending execution
  const routingResult = blaxelExecutionManager.routeCallback({
    executionId,
    agent: agentId,
    sandbox_id: sandboxId,
    status_code: payload.status_code,
    response_body: payload.response_body,
    response_length: payload.response_length,
    timestamp: payload.timestamp,
  });

  if (!routingResult.routed) {
    console.warn('[Blaxel Callback] Failed to route callback:', routingResult.error, {
      executionId,
      agentId,
      sandboxId,
    });
    // Still acknowledge receipt to prevent Blaxel retries
    return NextResponse.json({ 
      received: true, 
      warning: 'No pending execution found for this callback',
      executionId,
    }, { status: 202 });
  }

  console.log('[Blaxel Callback] Successfully routed callback to execution', {
    executionId,
  });

  return NextResponse.json({ 
    received: true,
    routed: true,
    executionId,
  });
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/blaxel/callback',
    configured: !!CALLBACK_SECRET,
  });
}
