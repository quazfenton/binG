import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * WebSocket endpoint for bidirectional terminal streaming
 * 
 * Note: Next.js App Router doesn't natively support WebSocket upgrade.
 * This endpoint returns connection info for the client to establish WebSocket.
 * 
 * For production WebSocket support, you need:
 * 1. A custom server (see server.ts example)
 * 2. Or use an edge-compatible WebSocket service
 * 
 * Message format (client -> server):
 *   { type: 'input', data: string } - Send input to terminal
 *   { type: 'resize', cols: number, rows: number } - Resize terminal
 *   { type: 'ping' } - Keep-alive ping
 * 
 * Message format (server -> client):
 *   { type: 'connected', data: { sessionId, sandboxId } } - Connection established
 *   { type: 'pty', data: string } - Terminal output
 *   { type: 'error', data: string } - Error message
 *   { type: 'ping' } - Keep-alive pong
 */
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const sessionId = searchParams.get('sessionId');
  const sandboxId = searchParams.get('sandboxId');
  const token = searchParams.get('token');

  if (!sessionId || !sandboxId) {
    return new Response(JSON.stringify({ 
      error: 'sessionId and sandboxId are required',
      fallback: 'Use SSE endpoint instead',
      sseUrl: `/api/sandbox/terminal/stream?sessionId=${sessionId}&sandboxId=${sandboxId}`
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // For deployments with custom WebSocket server, return the WS URL
  const wsProtocol = process.env.WEBSOCKET_PROTOCOL || 'ws';
  const wsHost = process.env.WEBSOCKET_HOST || 'localhost:3001';
  
  const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
  const wsUrl = `${wsProtocol}://${wsHost}/ws${tokenParam}&sessionId=${encodeURIComponent(sessionId)}&sandboxId=${encodeURIComponent(sandboxId)}`;

  return new Response(JSON.stringify({ 
    message: 'WebSocket endpoint - requires custom server for WebSocket upgrade',
    wsUrl,
    instructions: 'Connect to wsUrl using WebSocket client. See docs for custom server setup.',
    fallback: {
      type: 'sse',
      url: `/api/sandbox/terminal/stream?sessionId=${sessionId}&sandboxId=${sandboxId}${token ? `&token=${token}` : ''}`
    }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
