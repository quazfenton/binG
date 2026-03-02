/**
 * Blaxel Async Execution Callback Webhook
 * 
 * Receives callbacks from Blaxel when async executions complete.
 * Verifies callback signatures for security.
 * 
 * @see https://docs.blaxel.ai/Agents/Asynchronous-triggers#verify-a-callback-using-its-signature
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCallbackSignature, verifyCallbackMiddleware } from '@/lib/sandbox/providers';

const CALLBACK_SECRET = process.env.BLAXEL_CALLBACK_SECRET;

/**
 * POST handler for Blaxel webhook callbacks
 * 
 * Verifies the callback signature and processes the async execution result.
 */
const executionResults = new Map<string, {
  executionId: string;
  statusCode: number;
  responseBody?: string;
  responseLength?: number;
  timestamp: string;
  sandboxId?: string;
  processedAt: Date;
}>();

/**
 * Process the async execution result
 */
async function processExecutionResult(data: {
  execution_id: string;
  sandbox_id?: string;
  status_code: number;
  response_body?: string;
  response_length?: number;
  timestamp: string;
}): Promise<void> {
  const result = {
    executionId: data.execution_id,
    statusCode: data.status_code,
    responseBody: data.response_body,
    responseLength: data.response_length,
    timestamp: data.timestamp,
    sandboxId: data.sandbox_id,
    processedAt: new Date(),
  };
  
  executionResults.set(data.execution_id, result);
  
  console.log(`[BlaxelCallback] Processed execution ${data.execution_id} with status ${data.status_code}`);
}

export async function POST(request: NextRequest) {
  try {
    // Verify callback signature for security
    if (CALLBACK_SECRET) {
      const isValid = await verifyCallbackSignature(request, CALLBACK_SECRET);
      
      if (!isValid) {
        console.warn('[BlaxelCallback] Invalid signature detected');
        return NextResponse.json(
          { error: 'Invalid signature' },
          { status: 401 }
        );
      }
    } else {
      console.warn('[BlaxelCallback] BLAXEL_CALLBACK_SECRET not configured, skipping verification');
    }

    // Parse callback payload
    const body = await request.json();
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
      timestamp: new Date(timestamp).toISOString(),
    });

    // Process the async execution result
    await processExecutionResult({
      execution_id: executionId,
      sandbox_id: sandboxId,
      status_code: statusCode,
      response_body: responseBody,
      response_length: responseLength,
      timestamp: timestamp,
    });

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
