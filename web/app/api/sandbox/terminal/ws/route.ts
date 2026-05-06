import { NextRequest, NextResponse } from 'next/server';


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

  // Build WebSocket URL with properly encoded parameters
  // SECURITY NOTE: Token in URL can be logged in server/access logs
  // RECOMMENDED: Use cookies or Authorization header for authentication
  // For now, we use short-lived tokens and ensure they're blacklisted after use
  const wsParams = new URLSearchParams();

  // SECURITY: Prefer cookie-based auth when available
  // Token is only added to URL if explicitly provided (not from cookies)
  // This maintains backward compatibility while encouraging safer patterns
  if (token) {
    // Note: Token will be validated and blacklisted after use by WebSocket server
    // Consider using HttpOnly cookies for token transmission in production
    wsParams.set('token', token);
  }
  wsParams.set('sessionId', sessionId);
  wsParams.set('sandboxId', sandboxId);

  const wsUrl = `${wsProtocol}://${wsHost}/ws?${wsParams.toString()}`;

  // Build SSE fallback URL with properly encoded parameters
  // SECURITY: Same token-in-URL concern as WebSocket URL
  const sseParams = new URLSearchParams();
  sseParams.set('sessionId', sessionId);
  sseParams.set('sandboxId', sandboxId);
  // SECURITY: Don't include token in SSE URL - use cookie-based auth
  // Token is validated from HttpOnly cookie in SSE route handler
  if (token && process.env.NODE_ENV === 'development') {
    // Only allow token in URL for development
    // Production should use HttpOnly cookies
    sseParams.set('token', token);
  }
  const sseUrl = `/api/sandbox/terminal/stream?${sseParams.toString()}`;

  return new Response(JSON.stringify({
    message: 'WebSocket endpoint - requires custom server for WebSocket upgrade',
    wsUrl,
    securityNote: 'Token in URL can be logged. Use HttpOnly cookies in production.',
    instructions: 'Connect to wsUrl using WebSocket client. See docs for custom server setup.',
    fallback: {
      type: 'sse',
      url: sseUrl
    }
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // SECURITY: Prevent caching of WebSocket credentials
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    },
  });
}
