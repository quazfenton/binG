/**
 * Debug endpoint: Tool Call Telemetry
 *
 * GET /api/debug/tool-telemetry
 *
 * Returns per-model tool call success/failure stats.
 * Only available in development or when DEBUG_ENDPOINTS=true.
 */

import { NextResponse } from 'next/server';
import { getToolCallTelemetrySummary, logTelemetrySummary } from '@/lib/chat/tool-call-telemetry';

export async function GET() {
  // Gate to dev or explicit opt-in
  const isDev = process.env.NODE_ENV === 'development';
  const debugEnabled = process.env.DEBUG_ENDPOINTS === 'true';

  if (!isDev && !debugEnabled) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  // Also log to server console
  logTelemetrySummary();

  const summary = getToolCallTelemetrySummary();

  return NextResponse.json({
    telemetry: summary,
    timestamp: new Date().toISOString(),
  });
}
