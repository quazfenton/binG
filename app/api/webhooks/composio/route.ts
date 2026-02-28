/**
 * Composio Webhook API Route
 *
 * Receives webhook events from Composio triggers.
 * Verifies webhook signatures for security.
 *
 * @see lib/composio/webhook-handler.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  handleComposioWebhook, 
  verifyWebhookSignature,
} from '@/lib/composio/webhook-handler';
import { checkRateLimit } from '@/lib/middleware/rate-limit';
import { addCORSHeaders } from '@/lib/middleware/cors';

export async function POST(request: NextRequest) {
  const requestId = `webhook_composio_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  try {
    // Check rate limit
    const rateLimitResponse = await checkRateLimit(request, '/api/webhooks/composio');
    if (rateLimitResponse) {
      return addCORSHeaders(rateLimitResponse);
    }

    // Get webhook signature from headers
    const signature = request.headers.get('x-composio-webhook-signature');
    const timestamp = request.headers.get('x-composio-webhook-timestamp');

    // Get raw body for signature verification
    const body = await request.text();

    // Verify signature if secret is configured
    const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
    if (secret) {
      if (!signature) {
        console.warn(`[ComposioWebhook] Missing signature (${requestId})`);
        const response = NextResponse.json({ 
          success: false,
          error: {
            type: 'missing_signature',
            message: 'Webhook signature required',
          },
          requestId,
        }, { status: 401 });
        return addCORSHeaders(response);
      }

      const isValid = verifyWebhookSignature(body, signature, secret);
      if (!isValid) {
        console.error(`[ComposioWebhook] Invalid signature (${requestId})`);
        const response = NextResponse.json({ 
          success: false,
          error: {
            type: 'invalid_signature',
            message: 'Invalid webhook signature',
          },
          requestId,
        }, { status: 401 });
        return addCORSHeaders(response);
      }
    }

    // Parse webhook payload
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (error: any) {
      console.error(`[ComposioWebhook] Invalid JSON (${requestId}):`, error);
      const response = NextResponse.json({ 
        success: false,
        error: {
          type: 'invalid_json',
          message: 'Invalid webhook payload',
        },
        requestId,
      }, { status: 400 });
      return addCORSHeaders(response);
    }

    // Process webhook
    const result = await handleComposioWebhook(request);

    // Log webhook processing
    console.log(`[ComposioWebhook] Processed (${requestId}):`, {
      eventType: payload.event_type,
      success: result.status === 200,
    });

    return addCORSHeaders(result);
  } catch (error: any) {
    console.error(`[ComposioWebhook] Error (${requestId}):`, error);
    const response = NextResponse.json({ 
      success: false,
      error: {
        type: 'internal_error',
        message: 'Webhook processing failed',
      },
      requestId,
    }, { status: 500 });
    return addCORSHeaders(response);
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Composio webhook endpoint',
    timestamp: new Date().toISOString(),
  });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Composio-Webhook-Signature, X-Composio-Webhook-Timestamp',
      'Access-Control-Max-Age': '86400',
    },
  });
}
