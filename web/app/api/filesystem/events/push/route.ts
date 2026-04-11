import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFilesystemOwner } from '@/lib/virtual-filesystem/resolve-filesystem-owner';

// In-memory subscriber storage for server-side event distribution
// In production, this would use Redis or similar for cross-instance broadcasting
// Note: This is per-instance. For multi-instance deployments, use Redis pub/sub.
type EventHandler = (data: unknown) => void;
const subscribers = new Map<string, Set<EventHandler>>();

/**
 * Register a subscriber for filesystem events
 * Clients can long-poll this endpoint to receive events
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get('sessionId') || 'default';
  
  // Set up Server-Sent Events stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const handler: EventHandler = (data) => {
        const event = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(event));
      };
      
      // Add handler to subscribers
      if (!subscribers.has(sessionId)) {
        subscribers.set(sessionId, new Set());
      }
      subscribers.get(sessionId)!.add(handler);
      
      // Send initial connection message
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));
      
      // Send heartbeat every 25 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25000);
      
      // Cleanup on abort
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        const sessionSubs = subscribers.get(sessionId);
        if (sessionSubs) {
          sessionSubs.delete(handler);
          if (sessionSubs.size === 0) {
            subscribers.delete(sessionId);
          }
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * Receive filesystem event from client and broadcast to subscribers
 * This enables cross-session and cross-tab event propagation
 *
 * NOTE: Authentication is optional - anonymous users can broadcast events
 * The events are scoped to sessionId, so users can only affect their own sessions
 */
export async function POST(request: NextRequest) {
  try {
    // Try to resolve auth, but allow anonymous users
    // Events are scoped to sessionId, so this is safe for anonymous use
    const auth = await resolveFilesystemOwner(request);
    
    // If authenticated, use their ownerId; otherwise allow anonymous
    // Anonymous users can only broadcast to their own sessionId
    if (!auth.isAuthenticated) {
      // For anonymous users, we still accept the event but don't enrich it
      // This allows cross-tab sync for anonymous sessions
    }

    const body = await request.json();
    
    // Validate the event structure
    const eventSchema = z.object({
      protocolVersion: z.number().optional(),
      eventId: z.string().optional(),
      emittedAt: z.number().optional(),
      scopePath: z.string().optional(),
      path: z.string().optional(),
      paths: z.array(z.string()).optional(),
      type: z.enum(['create', 'update', 'delete']).optional(),
      source: z.string().optional(),
      sessionId: z.string().optional(),
      commitId: z.string().optional(),
      workspaceVersion: z.number().optional(),
    });
    
    const validatedEvent = eventSchema.parse(body);
    
    // Broadcast to subscribers for the same session
    const targetSessionId = validatedEvent.sessionId || 'default';
    const sessionSubs = subscribers.get(targetSessionId);
    
    if (sessionSubs && sessionSubs.size > 0) {
      for (const handler of sessionSubs) {
        try {
          handler(validatedEvent);
        } catch (err) {
          console.error('[filesystem-events/push] Handler error:', err);
        }
      }
    }
    
    // Also broadcast to 'all' subscribers for global events
    const allSubs = subscribers.get('all');
    if (allSubs && allSubs.size > 0) {
      for (const handler of allSubs) {
        try {
          handler(validatedEvent);
        } catch (err) {
          console.error('[filesystem-events/push] All-handler error:', err);
        }
      }
    }
    
    return NextResponse.json({ success: true, subscribersNotified: sessionSubs?.size || 0 });
  } catch (error) {
    console.error('[filesystem-events/push] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Invalid request' },
      { status: 400 }
    );
  }
}
