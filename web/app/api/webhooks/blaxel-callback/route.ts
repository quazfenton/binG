/**
 * Blaxel Async Execution Callback Webhook
 *
 * Receives callbacks from Blaxel when async executions complete.
 * Verifies callback signatures for security.
 *
 * @see https://docs.blaxel.ai/Agents/Asynchronous-triggers#verify-a-callback-using-its-signature
 */

import { NextRequest, NextResponse } from 'next/server';


import { verifyBlaxelCallbackFromRequest } from '@/lib/sandbox/providers';

const CALLBACK_SECRET = process.env.BLAXEL_CALLBACK_SECRET;

/**
 * POST handler for Blaxel webhook callbacks
 *
 * Verifies the callback signature and logs the async execution result.
 * 
 * Note: Results are logged for monitoring. For persistent storage or real-time
 * notifications, integrate with a database or event queue (e.g., Redis, SQS).
 */
export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require webhook authentication in production
    // In development, allow unauthenticated requests for testing
    const isDevelopment = process.env.NODE_ENV === 'development';

    // SECURITY FIX: Read body as text FIRST to avoid double-consumption
    // The body stream can only be read once, and verifyCallbackSignature
    // needs to read it for HMAC verification. We read it once, then parse.
    const rawBody = await request.text();

    if (CALLBACK_SECRET) {
      // Create verification request object for signature verification
      const verificationData = {
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()) as Record<string, string>,
        body: rawBody,
      };

      const isValid = verifyBlaxelCallbackFromRequest(verificationData, CALLBACK_SECRET);

      if (!isValid) {
        console.warn('[BlaxelCallback] Invalid signature detected');
        return NextResponse.json(
          { error: 'Invalid signature' },
          { status: 401 }
        );
      }
    } else if (!isDevelopment) {
      // In production, require the secret to be configured
      console.error('[BlaxelCallback] BLAXEL_CALLBACK_SECRET not configured - rejecting request');
      return NextResponse.json(
        { error: 'Webhook authentication not configured. Set BLAXEL_CALLBACK_SECRET environment variable.' },
        { status: 500 }
      );
    } else {
      // Development mode - log warning but allow request
      console.warn('[BlaxelCallback] Development mode: BLAXEL_CALLBACK_SECRET not configured, skipping verification');
    }

    // Parse callback payload from the raw body text we already read
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch (parseError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const {
      status_code,
      response_body,
      response_length,
      timestamp,
      execution_id,
      sandbox_id,
    } = body;

    console.log('[BlaxelCallback] Received callback:', {
      execution_id,
      sandbox_id,
      status_code,
      timestamp: timestamp ? new Date(timestamp).toISOString() : 'unknown',
    });

    // Log execution result for monitoring
    // For persistent storage, integrate with database or event queue
    console.log(`[BlaxelCallback] Execution ${execution_id} completed with status ${status_code}`);

    return NextResponse.json({
      success: true,
      message: 'Callback processed successfully',
      executionId: execution_id,
    });
  } catch (error) {
    console.error('[BlaxelCallback] Error processing callback:', error);
    return NextResponse.json(
      { error: 'Failed to process callback' },
      { status: 500 }
    );
  }
}

/**
 * GET handler for webhook testing
 * Returns webhook configuration info
 */
export async function GET() {
  return NextResponse.json({
    webhook: 'blaxel-callback',
    status: 'active',
    secretConfigured: !!CALLBACK_SECRET,
    description: 'Receives async execution callbacks from Blaxel',
    verificationMethod: 'HMAC-SHA256 signature in X-Blaxel-Signature header',
  });
}
