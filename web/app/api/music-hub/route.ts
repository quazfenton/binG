import { NextRequest } from 'next/server';

// Import all existing handlers
import { GET as playlistGET, POST as playlistPOST } from './playlist/gateway';
import { POST as webhookPOST, GET as webhookGET } from './webhook/gateway';
import { GET as embedGET } from './embed/[videoId]/gateway';

/**
 * Consolidated music-hub route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'playlist':
      return playlistGET(request);
    case 'webhook':
      return webhookGET();
    case 'embed': {
      const videoId = searchParams.get('videoId');
      if (!videoId) {
        return new Response(
          JSON.stringify({ error: 'videoId query parameter is required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return embedGET(request, { params: Promise.resolve({ videoId }) });
    }
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=playlist|webhook|embed' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'playlist':
      return playlistPOST(request);
    case 'webhook':
      return webhookPOST(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=playlist|webhook' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}
