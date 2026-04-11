/**
 * Zine Display SSE (Server-Sent Events) for Real-Time Push
 * 
 * Provides:
 * - Real-time notification streaming
 * - Live data source updates
 * - OAuth provider notification push
 * - Webhook event streaming
 * - Cron/scheduled event push
 */

import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

interface SSEMessage {
  id: string;
  event: string;
  data: unknown;
  timestamp: string;
}

interface ZineSSEManager {
  addClient: (clientId: string, channel: string) => void;
  removeClient: (clientId: string) => void;
  broadcast: (event: string, data: unknown, channel?: string) => void;
  getClientCount: (channel?: string) => number;
}

// ---------------------------------------------------------------------
// In-memory client registry
// ---------------------------------------------------------------------

// Active SSE connections by channel
const CHANNELS: Map<string, Set<string>> = new Map();

// Client response streams
const CLIENTS: Map<string, ReadableStreamDefaultController<Uint8Array>> = new Map();

// Generate unique client ID
function generateClientId(): string {
  return `sse-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Format SSE message
function formatSSEMessage(event: string, data: unknown): string {
  const message: SSEMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    event,
    data,
    timestamp: new Date().toISOString(),
  };
  return `event: ${event}\ndata: ${JSON.stringify(message)}\n\n`;
}

// ---------------------------------------------------------------------
// Public API - Add to SSE stream from external code
// ---------------------------------------------------------------------

export function pushToChannel(channel: string, event: string, data: unknown): void {
  const message = formatSSEMessage(event, data);
  const encoder = new TextEncoder();
  const encoded = encoder.encode(message);

  const channelClients = CHANNELS.get(channel);
  if (!channelClients) return;

  // Broadcast to all clients in channel
  for (const clientId of channelClients) {
    const controller = CLIENTS.get(clientId);
    if (controller) {
      try {
        controller.enqueue(encoded);
      } catch (e) {
        // Client disconnected, will be cleaned up
      }
    }
  }
}

// Helper to broadcast to all channels
export function broadcastToAll(event: string, data: unknown): void {
  const message = formatSSEMessage(event, data);
  const encoder = new TextEncoder();
  const encoded = encoder.encode(message);

  for (const [, controller] of CLIENTS) {
    try {
      controller.enqueue(encoded);
    } catch (e) {
      // Ignore
    }
  }
}



// ---------------------------------------------------------------------
// POST - Push events to SSE stream (for webhooks/cron/external triggers)
// ---------------------------------------------------------------------

interface PushEventRequest {
  channel?: string;
  event: string;
  data: Record<string, unknown>;
  clientId?: string; // Send to specific client instead of channel
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as PushEventRequest;
    const { channel, event, data, clientId } = body;

    if (!event || !data) {
      return NextResponse.json(
        { success: false, error: 'event and data are required' },
        { status: 400 }
      );
    }

    // Send to specific client
    if (clientId) {
      const controller = CLIENTS.get(clientId);
      if (controller) {
        const message = formatSSEMessage(event, data);
        controller.enqueue(new TextEncoder().encode(message));
        return NextResponse.json({
          success: true,
          delivered: true,
          target: 'client',
        });
      }
      return NextResponse.json(
        { success: false, error: 'Client not found' },
        { status: 404 }
      );
    }

    // Broadcast to channel or all
    const targetChannel = channel || 'default';
    pushToChannel(targetChannel, event, data);

    const clientCount = CHANNELS.get(targetChannel)?.size || 0;

    return NextResponse.json({
      success: true,
      delivered: true,
      target: 'channel',
      channel: targetChannel,
      clientsReached: clientCount,
    });
  } catch (error) {
    console.error('[Zine-SSE] Push error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to push event' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------
// GET - Channel info and stats (also handles SSE stream with ?channel= param)
// ---------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const channel = searchParams.get('channel');
  const action = searchParams.get('action');

  // If channel param exists, handle SSE stream connection
  if (channel !== null) {
    const events = searchParams.get('events')?.split(',') || ['notification', 'data', 'status'];
    const clientId = generateClientId();

    // Create streaming response
    const stream = new ReadableStream({
      start(controller) {
        // Register client
        if (!CHANNELS.has(channel)) {
          CHANNELS.set(channel, new Set());
        }
        CHANNELS.get(channel)!.add(clientId);
        CLIENTS.set(clientId, controller);

        // Send initial connection message
        const initMessage = formatSSEMessage('connected', {
          clientId,
          channel,
          events,
          timestamp: new Date().toISOString(),
        });
        controller.enqueue(new TextEncoder().encode(initMessage));

        // Heartbeat every 30 seconds
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
          } catch {
            clearInterval(heartbeat);
          }
        }, 30000);

        // Clean up on close
        request.signal.addEventListener('abort', () => {
          clearInterval(heartbeat);
          CHANNELS.get(channel)?.delete(clientId);
          CLIENTS.delete(clientId);
          try {
            controller.close();
          } catch {
            // Already closed
          }
        });
      },
      cancel() {
        CHANNELS.get(channel)?.delete(clientId);
        CLIENTS.delete(clientId);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // Handle stats/channels action
  if (action === 'channels' || action === 'stats') {
    const stats: Record<string, number> = {};
    for (const [c, clients] of CHANNELS) {
      stats[c] = clients.size;
    }

    return NextResponse.json({
      success: true,
      totalClients: Array.from(CLIENTS).length,
      channels: stats,
    });
  }

  // Default: return service info
  return NextResponse.json({
    service: 'Zine Display SSE',
    version: '1.0.0',
    endpoints: {
      'GET /?channel={name}': 'Connect to SSE stream (channel optional)',
      'POST /': 'Push event to channel or client',
      'GET /?action=channels': 'Get channel statistics',
    },
    channels: {
      'default': 'General notifications and updates',
      'notifications': 'OAuth provider notifications',
      'data': 'Data source updates',
      'webhooks': 'Webhook events',
      'cron': 'Scheduled task events',
    },
  });
}
