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
  handleComposioWebhookWithPayload,
  verifyWebhookSignature,
} from '@/lib/integrations/composio/webhook-handler';
import { checkRateLimitMiddleware } from '@/lib/middleware/rate-limit';
import { addCORSHeaders } from '@/lib/middleware/cors';
import { secureRandomId } from '@/lib/utils/crypto-random';

export async function POST(request: NextRequest) {
  const requestId = secureRandomId('webhook_composio_');

  try {
    // Check rate limit
    const rateLimitResponse = checkRateLimitMiddleware(request, '/api/webhooks/composio', 100, 60000);
    if (rateLimitResponse) {
      return addCORSHeaders(rateLimitResponse, undefined, request);
    }

    // Get webhook signature from headers
    const signature = request.headers.get('x-composio-webhook-signature');
    const timestamp = request.headers.get('x-composio-webhook-timestamp');

    // Get raw body for signature verification
    const body = await request.text();

    // SECURITY: Require webhook secret in production
    const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      console.error(`[ComposioWebhook] CRITICAL: COMPOSIO_WEBHOOK_SECRET not set in production (${requestId})`);
      const response = NextResponse.json({
        success: false,
        error: {
          type: 'configuration_error',
          message: 'Webhook secret not configured',
        },
        requestId,
      }, { status: 500 });
      return addCORSHeaders(response);
    }

    // Verify signature if secret is configured
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

      // SECURITY: Validate timestamp freshness (prevent replay attacks)
      if (timestamp) {
        const timestampNum = parseInt(timestamp, 10);
        if (Number.isNaN(timestampNum)) {
          console.warn(`[ComposioWebhook] Invalid timestamp format (${requestId})`);
          const response = NextResponse.json({
            success: false,
            error: {
              type: 'invalid_timestamp',
              message: 'Webhook timestamp invalid',
            },
            requestId,
          }, { status: 401 });
          return addCORSHeaders(response);
        }
        const now = Math.floor(Date.now() / 1000);
        const maxAge = 5 * 60; // 5 minutes
        if (Math.abs(now - timestampNum) > maxAge) {
          console.warn(`[ComposioWebhook] Timestamp too old (${requestId})`);
          const response = NextResponse.json({
            success: false,
            error: {
              type: 'invalid_timestamp',
              message: 'Webhook timestamp too old',
            },
            requestId,
          }, { status: 401 });
          return addCORSHeaders(response);
        }
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

    // Process webhook - pass the already-parsed payload to avoid re-reading body
    const result = await handleComposioWebhookWithPayload(payload);

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
