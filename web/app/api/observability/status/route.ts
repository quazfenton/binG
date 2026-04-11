/**
 * Observability Status API
 *
 * GET /api/observability/status - Observability status
 */

import { NextResponse } from 'next/server';
import { getObservabilityStatus } from '@/lib/observability';

/**
 * GET /api/observability/status
 *
 * Returns observability system status
 */
export async function GET() {
  try {
    const status = getObservabilityStatus();

    return NextResponse.json({
      success: true,
      status,
    });
  } catch (error: unknown) {
    // Log detailed error server-side, return generic message to client
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Observability] Failed to get status', { message });
    return NextResponse.json({
      error: 'Failed to get status',
    }, { status: 500 });
  }
}
